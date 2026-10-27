alter table public.page_files
  add column purpose text not null default 'cover' check(purpose in('cover','block')),
  add column image_width integer,
  add column image_height integer;
alter table public.page_files drop constraint page_files_mime_type_check;
alter table public.page_files add constraint page_files_mime_type_check
  check(mime_type in('image/png','image/jpeg','image/webp','image/gif','application/octet-stream'));
alter table public.page_files add constraint page_files_verified_dimensions_check check(
  (image_width is null and image_height is null) or
  (image_width is not null and image_height is not null and image_width between 1 and 16384 and image_height between 1 and 16384 and image_width::bigint*image_height<=30000000));
alter table public.page_files add constraint page_files_media_purpose_check check(
  (purpose='block' or mime_type<>'application/octet-stream') and
  (mime_type<>'application/octet-stream' or (image_width is null and image_height is null)) and
  (purpose<>'block' or status<>'ready' or mime_type='application/octet-stream' or
    (image_width is not null and image_height is not null)));
update storage.buckets set allowed_mime_types=array['image/png','image/jpeg','image/webp','image/gif','application/octet-stream']
  where id='page-assets';

create table private.page_file_validation_windows (
  workspace_id uuid not null,
  actor_id uuid not null,
  window_start timestamptz not null,
  attempts integer not null check(attempts between 1 and 30),
  primary key(workspace_id,actor_id,window_start),
  foreign key(workspace_id,actor_id) references public.workspace_members(workspace_id,user_id) on delete cascade
);
alter table private.page_file_validation_windows enable row level security;
revoke all on private.page_file_validation_windows from public,anon,authenticated;
grant all on private.page_file_validation_windows to service_role;

create function public.reserve_page_file_validation(p_file_id uuid,p_actor_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v_file public.page_files%rowtype;v_window timestamptz:=date_bin('10 minutes'::interval,now(),'2000-01-01 00:00:00+00'::timestamptz);v_attempts integer;
begin
  select * into v_file from public.page_files where id=p_file_id;
  if not found then raise exception 'File unavailable' using errcode='42501';end if;
  perform 1 from public.workspaces where id=v_file.workspace_id for update;
  perform 1 from public.pages where id=v_file.page_id for update;
  select * into v_file from public.page_files where id=p_file_id for update;
  if v_file.uploaded_by<>p_actor_id or coalesce(private.page_role(v_file.page_id,p_actor_id),'') not in('owner','editor')
    or not exists(select 1 from auth.users where id=p_actor_id and email_confirmed_at is not null) then
    raise exception 'File unavailable' using errcode='42501';end if;
  -- Ready objects have already passed validation and are immutable. Their
  -- receipt-only retry must not download or consume another decoding attempt.
  if v_file.status='ready' then return;end if;
  if v_file.created_at<=now()-interval '1 hour' then raise exception 'Upload unavailable' using errcode='22023';end if;
  delete from private.page_file_validation_windows w where (w.workspace_id,w.actor_id,w.window_start) in (
    select old.workspace_id,old.actor_id,old.window_start from private.page_file_validation_windows old
    where old.workspace_id=v_file.workspace_id and old.actor_id=p_actor_id and old.window_start<v_window-interval '20 minutes'
    order by old.window_start limit 32);
  insert into private.page_file_validation_windows as w(workspace_id,actor_id,window_start,attempts)
    values(v_file.workspace_id,p_actor_id,v_window,1) on conflict(workspace_id,actor_id,window_start)
    do update set attempts=w.attempts+1 where w.attempts<30 returning attempts into v_attempts;
  if v_attempts is null then raise exception 'File validation limit reached; retry later' using errcode='54000';end if;
end;
$$;
revoke all on function public.reserve_page_file_validation(uuid,uuid) from public,anon,authenticated;
grant execute on function public.reserve_page_file_validation(uuid,uuid) to service_role;

create function public.prepare_block_file(p_page_id uuid,p_name text,p_mime_type text,p_size bigint,p_kind text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=private.require_confirmed_user();v_workspace uuid;v_id uuid:=gen_random_uuid();v_type text;
begin
  perform pg_advisory_xact_lock(hashtextextended(v_actor::text,1087));
  select workspace_id into v_workspace from public.pages where id=p_page_id;
  if not found then raise exception 'Page unavailable' using errcode='42501';end if;
  perform 1 from public.workspaces where id=v_workspace for update;
  perform 1 from public.pages where id=p_page_id for update;
  if coalesce(private.page_role(p_page_id,v_actor),'') not in('owner','editor') then
    raise exception 'Page unavailable' using errcode='42501';end if;
  if p_kind is null or p_kind not in('image','file') or p_name is null or char_length(btrim(p_name)) not between 1 and 180
    or p_name ~ '[[:cntrl:]/\\]' or p_size is null or p_size not between 1 and 26214400
    or (p_kind='image' and (p_mime_type is null or p_mime_type not in('image/png','image/jpeg','image/webp','image/gif'))) then
    raise exception 'Invalid file declaration' using errcode='22023';end if;
  v_type:=case when p_kind='file' then 'application/octet-stream' else p_mime_type end;
  if (select count(*) from public.page_files where uploaded_by=v_actor and created_at>now()-interval '10 minutes')>=30
    or (select count(*) from public.page_files where uploaded_by=v_actor and status='staging' and created_at>now()-interval '1 hour')>=10 then
    raise exception 'Upload limit reached; retry later' using errcode='54000';end if;
  insert into public.page_files(id,workspace_id,page_id,object_path,original_name,mime_type,expected_size,uploaded_by,purpose)
    values(v_id,v_workspace,p_page_id,v_workspace::text||'/'||p_page_id::text||'/'||v_id::text,btrim(p_name),v_type,p_size,v_actor,'block');
  return v_id;
end;
$$;

create function public.finalize_page_block_file(p_file_id uuid,p_actor_id uuid,p_actual_size bigint,p_sha256 text,
  p_width integer default null,p_height integer default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_file public.page_files%rowtype;
begin
  select * into v_file from public.page_files where id=p_file_id;
  if not found then raise exception 'File unavailable' using errcode='42501';end if;
  perform 1 from public.workspaces where id=v_file.workspace_id for update;
  perform 1 from public.pages where id=v_file.page_id for update;
  select * into v_file from public.page_files where id=p_file_id for update;
  if v_file.purpose<>'block' or v_file.uploaded_by<>p_actor_id
    or coalesce(private.page_role(v_file.page_id,p_actor_id),'') not in('owner','editor')
    or not exists(select 1 from auth.users where id=p_actor_id and email_confirmed_at is not null) then
    raise exception 'File unavailable' using errcode='42501';end if;
  if p_actual_size is null or p_actual_size<>v_file.expected_size or p_sha256 is null or p_sha256!~'^[0-9a-f]{64}$'
    or (v_file.mime_type='application/octet-stream' and (p_width is not null or p_height is not null))
    or (v_file.mime_type<>'application/octet-stream' and (p_width is null or p_height is null
      or p_width not between 1 and 16384 or p_height not between 1 and 16384 or p_width::bigint*p_height>30000000)) then
    raise exception 'Invalid verified file' using errcode='22023';end if;
  if v_file.status='ready' then
    if v_file.sha256=p_sha256 and v_file.actual_size=p_actual_size
      and v_file.image_width is not distinct from p_width and v_file.image_height is not distinct from p_height then return v_file.id;end if;
    raise exception 'Verified file is immutable' using errcode='22023';end if;
  if v_file.created_at<=now()-interval '1 hour' then
    raise exception 'Upload unavailable; start a new upload' using errcode='22023';end if;
  if not exists(select 1 from storage.objects where bucket_id='page-assets' and name=v_file.object_path
    and metadata->>'size'=p_actual_size::text) then
    raise exception 'Uploaded object does not match verified file' using errcode='22023';end if;
  update public.page_files set status='ready',actual_size=p_actual_size,sha256=p_sha256,finalized_at=now(),
    image_width=p_width,image_height=p_height where id=p_file_id;
  return p_file_id;
end;
$$;

create function private.guard_cover_file_purpose()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.cover_file_id is not null and exists(select 1 from public.page_files f where f.id=new.cover_file_id and f.purpose<>'cover') then
    raise exception 'A block file cannot replace a page cover' using errcode='23514';end if;
  return new;
end;
$$;
create trigger guard_cover_file_purpose before insert or update of cover_file_id on public.pages
  for each row execute function private.guard_cover_file_purpose();
revoke all on function private.guard_cover_file_purpose() from public,anon,authenticated;
revoke all on function public.prepare_block_file(uuid,text,text,bigint,text),
  public.finalize_page_block_file(uuid,uuid,bigint,text,integer,integer) from public,anon,authenticated;
grant execute on function public.prepare_block_file(uuid,text,text,bigint,text) to authenticated;
grant execute on function public.finalize_page_block_file(uuid,uuid,bigint,text,integer,integer) to service_role;
