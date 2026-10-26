create table public.page_files (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  page_id uuid not null,
  object_path text not null unique,
  original_name text not null check (char_length(btrim(original_name)) between 1 and 180 and original_name !~ '[[:cntrl:]/\\]'),
  mime_type text not null check (mime_type in ('image/png','image/jpeg','image/webp','image/gif')),
  expected_size bigint not null check (expected_size between 1 and 26214400),
  actual_size bigint,
  sha256 text,
  status text not null default 'staging' check (status in ('staging','ready')),
  uploaded_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  finalized_at timestamptz,
  unique (id, workspace_id, page_id),
  foreign key (page_id, workspace_id) references public.pages(id, workspace_id) on delete cascade,
  check (object_path = workspace_id::text || '/' || page_id::text || '/' || id::text),
  check ((status = 'staging' and actual_size is null and sha256 is null and finalized_at is null)
    or (status = 'ready' and actual_size is not null and actual_size = expected_size
      and sha256 is not null and sha256 ~ '^[0-9a-f]{64}$' and finalized_at is not null))
);
create index page_files_page_idx on public.page_files(workspace_id,page_id,id);
create index page_files_uploader_created_idx on public.page_files(uploaded_by,created_at);
create index page_files_staging_created_idx on public.page_files(created_at,id) where status = 'staging';

alter table public.pages add column cover_file_id uuid;
alter table public.pages add constraint pages_cover_file_fk foreign key (cover_file_id,workspace_id,id)
  references public.page_files(id,workspace_id,page_id);

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
  values ('page-assets','page-assets',false,26214400,array['image/png','image/jpeg','image/webp','image/gif'])
  on conflict (id) do update set public=false,file_size_limit=26214400,
    allowed_mime_types=array['image/png','image/jpeg','image/webp','image/gif'];

create function private.can_upload_page_object(p_path text,p_actor uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.page_files f where f.object_path=p_path and f.status='staging'
    and f.uploaded_by=p_actor and f.created_at > now()-interval '1 hour'
    and coalesce(private.page_role(f.page_id,p_actor),'') in ('owner','editor'));
$$;
create function private.can_read_page_object(p_path text,p_actor uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.page_files f where f.object_path=p_path and f.status='ready'
    and private.page_role(f.page_id,p_actor) is not null);
$$;

create function public.prepare_page_file(p_page_id uuid,p_name text,p_mime_type text,p_size bigint)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := private.require_confirmed_user(); v_workspace uuid; v_id uuid := gen_random_uuid();
begin
  perform pg_advisory_xact_lock(hashtextextended(v_actor::text,1087));
  select workspace_id into v_workspace from public.pages where id=p_page_id;
  if not found then raise exception 'Page unavailable' using errcode='42501'; end if;
  perform 1 from public.workspaces where id=v_workspace for update;
  perform 1 from public.pages where id=p_page_id for update;
  if coalesce(private.page_role(p_page_id,v_actor),'') not in ('owner','editor') then
    raise exception 'Page unavailable' using errcode='42501';
  end if;
  if p_name is null or char_length(btrim(p_name)) not between 1 and 180 or p_name ~ '[[:cntrl:]/\\]'
    or p_mime_type is null or p_mime_type not in ('image/png','image/jpeg','image/webp','image/gif')
    or p_size is null or p_size not between 1 and 26214400 then
    raise exception 'Invalid file declaration' using errcode='22023';
  end if;
  if (select count(*) from public.page_files where uploaded_by=v_actor and created_at > now()-interval '10 minutes') >= 30
    or (select count(*) from public.page_files where uploaded_by=v_actor and status='staging' and created_at > now()-interval '1 hour') >= 10 then
    raise exception 'Upload limit reached; retry later' using errcode='54000';
  end if;
  insert into public.page_files(id,workspace_id,page_id,object_path,original_name,mime_type,expected_size,uploaded_by)
    values (v_id,v_workspace,p_page_id,v_workspace::text||'/'||p_page_id::text||'/'||v_id::text,btrim(p_name),p_mime_type,p_size,v_actor);
  return v_id;
end;
$$;

create function public.finalize_page_cover(p_file_id uuid,p_actor_id uuid,p_expected_revision bigint,p_actual_size bigint,p_sha256 text)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_file public.page_files%rowtype; v_revision bigint;
begin
  select * into v_file from public.page_files where id=p_file_id;
  if not found then raise exception 'File unavailable' using errcode='42501'; end if;
  perform 1 from public.workspaces where id=v_file.workspace_id for update;
  select revision into v_revision from public.pages where id=v_file.page_id for update;
  select * into v_file from public.page_files where id=p_file_id for update;
  if v_file.uploaded_by <> p_actor_id or coalesce(private.page_role(v_file.page_id,p_actor_id),'') not in ('owner','editor') then
    raise exception 'File unavailable' using errcode='42501';
  end if;
  if p_actual_size is null or p_actual_size <> v_file.expected_size or p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid verified file' using errcode='22023';
  end if;
  if v_file.status='ready' and exists(select 1 from public.pages where id=v_file.page_id and cover_file_id=p_file_id)
    and v_file.sha256=p_sha256 and v_file.actual_size=p_actual_size then return v_revision; end if;
  if v_file.status<>'staging' or v_file.created_at <= now()-interval '1 hour' then
    raise exception 'Upload unavailable; start a new upload' using errcode='22023';
  end if;
  if p_expected_revision is null or v_revision <> p_expected_revision then
    raise exception 'Page revision conflict' using errcode='40001';
  end if;
  if not exists(select 1 from storage.objects where bucket_id='page-assets' and name=v_file.object_path
    and metadata->>'size'=p_actual_size::text) then
    raise exception 'Uploaded object does not match verified file' using errcode='22023';
  end if;
  update public.page_files set status='ready',actual_size=p_actual_size,sha256=p_sha256,finalized_at=now() where id=p_file_id;
  update public.pages set cover_file_id=p_file_id,revision=revision+1,updated_at=now() where id=v_file.page_id returning revision into v_revision;
  return v_revision;
end;
$$;

create function public.clear_page_cover(p_page_id uuid,p_expected_revision bigint)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := private.require_confirmed_user(); v_workspace uuid; v_revision bigint;
begin
  select workspace_id into v_workspace from public.pages where id=p_page_id;
  if not found then raise exception 'Page unavailable' using errcode='42501'; end if;
  perform 1 from public.workspaces where id=v_workspace for update;
  select revision into v_revision from public.pages where id=p_page_id for update;
  if coalesce(private.page_role(p_page_id,v_actor),'') not in ('owner','editor') then
    raise exception 'Page unavailable' using errcode='42501';
  end if;
  if p_expected_revision is null or p_expected_revision <> v_revision then
    raise exception 'Page revision conflict' using errcode='40001';
  end if;
  update public.pages set cover_file_id=null,revision=revision+1,updated_at=now() where id=p_page_id returning revision into v_revision;
  return v_revision;
end;
$$;

alter table public.page_files enable row level security;
create policy page_files_read on public.page_files for select to authenticated using (
  private.page_role(page_id,(select auth.uid())) is not null and
  (status='ready' or (uploaded_by=(select auth.uid()) and coalesce(private.page_role(page_id,(select auth.uid())),'') in ('owner','editor')))
);
create policy page_assets_insert on storage.objects for insert to authenticated with check (
  bucket_id='page-assets' and private.can_upload_page_object(name,(select auth.uid()))
);
create policy page_assets_read on storage.objects for select to authenticated using (
  bucket_id='page-assets' and storage.allow_only_operation('object.get_authenticated')
  and private.can_read_page_object(name,(select auth.uid()))
);
revoke all on public.page_files from public,anon,authenticated;
grant select on public.page_files to authenticated;
grant select (cover_file_id) on public.pages to authenticated;
grant all on public.page_files to service_role;
revoke execute on function private.can_upload_page_object(text,uuid),private.can_read_page_object(text,uuid) from public,anon,authenticated;
grant execute on function private.can_upload_page_object(text,uuid),private.can_read_page_object(text,uuid) to authenticated,service_role;
revoke execute on function public.prepare_page_file(uuid,text,text,bigint),public.finalize_page_cover(uuid,uuid,bigint,bigint,text),public.clear_page_cover(uuid,bigint) from public,anon,authenticated;
grant execute on function public.prepare_page_file(uuid,text,text,bigint),public.clear_page_cover(uuid,bigint) to authenticated;
grant execute on function public.finalize_page_cover(uuid,uuid,bigint,bigint,text) to service_role;
