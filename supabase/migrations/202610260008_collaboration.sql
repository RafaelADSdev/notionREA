-- Private leases are an authorization boundary; Realtime state is only an untrusted hint.
-- Policies are cached on channel join, so ACL changes also rotate the channel epoch:
-- https://supabase.com/docs/guides/realtime/authorization
create table private.page_presence_epochs (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  epoch bigint not null default 0 check(epoch>=0)
);
create table private.page_presence_leases (
  workspace_id uuid not null,page_id uuid not null,participant_id uuid not null,actor_id uuid not null,
  epoch bigint not null check(epoch>=0),expires_at timestamptz not null,
  primary key(page_id,participant_id),
  foreign key(page_id,workspace_id) references public.pages(id,workspace_id) on delete cascade,
  foreign key(workspace_id,actor_id) references public.workspace_members(workspace_id,user_id) on delete cascade
);
create index page_presence_actor_idx on private.page_presence_leases(workspace_id,actor_id,expires_at);
create index page_presence_page_idx on private.page_presence_leases(page_id,epoch,expires_at);
create table private.collaboration_windows (
  workspace_id uuid not null,actor_id uuid not null,action text not null check(action in ('presence','comment')),
  window_start timestamptz not null,attempts integer not null check(attempts between 1 and 120),
  primary key(workspace_id,actor_id,action,window_start),
  foreign key(workspace_id,actor_id) references public.workspace_members(workspace_id,user_id) on delete cascade
);
alter table private.page_presence_epochs enable row level security;
alter table private.page_presence_leases enable row level security;
alter table private.collaboration_windows enable row level security;
revoke all on private.page_presence_epochs,private.page_presence_leases,private.collaboration_windows from public,anon,authenticated;
grant all on private.page_presence_epochs,private.page_presence_leases,private.collaboration_windows to service_role;

create function private.collaboration_rate(p_workspace_id uuid,p_actor_id uuid,p_action text)
returns void language plpgsql security definer set search_path='' as $$
declare v_minute timestamptz:=date_trunc('minute',clock_timestamp());
begin
  delete from private.collaboration_windows where (workspace_id,actor_id,action,window_start) in (
    select workspace_id,actor_id,action,window_start from private.collaboration_windows
    where workspace_id=p_workspace_id and actor_id=p_actor_id and action=p_action and window_start<v_minute-interval '2 minutes'
    order by window_start limit 32);
  insert into private.collaboration_windows(workspace_id,actor_id,action,window_start,attempts)
    values(p_workspace_id,p_actor_id,p_action,v_minute,1)
    on conflict(workspace_id,actor_id,action,window_start) do update set attempts=collaboration_windows.attempts+1 where collaboration_windows.attempts<120;
  if not found then raise exception 'Collaboration rate exceeded' using errcode='54000'; end if;
end;
$$;
create function private.rotate_presence_epoch()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_workspace uuid;
begin
  if tg_table_name='pages' and tg_op='UPDATE' then
    if (old.parent_id,old.owner_id,old.restricted,old.deleted_at,to_jsonb(old)->'default_role',to_jsonb(old)->'workspace_role')
      is not distinct from (new.parent_id,new.owner_id,new.restricted,new.deleted_at,to_jsonb(new)->'default_role',to_jsonb(new)->'workspace_role') then return new; end if;
  end if;
  v_workspace:=case when tg_op='DELETE' then old.workspace_id else new.workspace_id end;
  perform 1 from public.workspaces where id=v_workspace for update;
  -- A workspace's own cascade has already removed the scope; never recreate it.
  if not found then return case when tg_op='DELETE' then old else new end; end if;
  insert into private.page_presence_epochs(workspace_id,epoch) values(v_workspace,1)
    on conflict(workspace_id) do update set epoch=page_presence_epochs.epoch+1;
  delete from private.page_presence_leases where workspace_id=v_workspace;
  return case when tg_op='DELETE' then old else new end;
end;
$$;
create trigger rotate_grant_presence after insert or update or delete on public.page_grants for each row execute function private.rotate_presence_epoch();
create trigger rotate_member_presence after insert or update or delete on public.workspace_members for each row execute function private.rotate_presence_epoch();
create trigger rotate_page_presence after update or delete on public.pages for each row execute function private.rotate_presence_epoch();

create function public.renew_page_presence(p_page_id uuid,p_participant_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=private.require_confirmed_user();v_workspace uuid;v_epoch bigint;v_expiry timestamptz:=clock_timestamp()+interval '30 seconds';v_participants jsonb;
begin
  if p_participant_id is null then raise exception 'Invalid participant' using errcode='22023'; end if;
  select workspace_id into v_workspace from public.pages where id=p_page_id;
  perform 1 from public.workspaces where id=v_workspace for update;
  if private.page_role(p_page_id,v_actor) is null then raise exception 'Page unavailable' using errcode='42501'; end if;
  perform private.collaboration_rate(v_workspace,v_actor,'presence');
  delete from private.page_presence_leases where (page_id,participant_id) in (
    select page_id,participant_id from private.page_presence_leases where workspace_id=v_workspace and actor_id=v_actor and expires_at<=clock_timestamp()
    order by expires_at limit 64);
  if exists(select 1 from private.page_presence_leases where page_id=p_page_id and participant_id=p_participant_id and actor_id<>v_actor) then
    raise exception 'Participant unavailable' using errcode='42501'; end if;
  if not exists(select 1 from private.page_presence_leases where page_id=p_page_id and participant_id=p_participant_id and actor_id=v_actor and expires_at>clock_timestamp()) then
    if (select count(*) from private.page_presence_leases where workspace_id=v_workspace and actor_id=v_actor and expires_at>clock_timestamp())>=8
      or (select count(*) from private.page_presence_leases where page_id=p_page_id and expires_at>clock_timestamp())>=256 then
      raise exception 'Presence capacity exceeded' using errcode='54000'; end if;
  end if;
  insert into private.page_presence_epochs(workspace_id) values(v_workspace) on conflict do nothing;
  select epoch into v_epoch from private.page_presence_epochs where workspace_id=v_workspace;
  v_expiry:=clock_timestamp()+interval '30 seconds';
  insert into private.page_presence_leases(workspace_id,page_id,participant_id,actor_id,epoch,expires_at)
    values(v_workspace,p_page_id,p_participant_id,v_actor,v_epoch,v_expiry)
    on conflict(page_id,participant_id) do update set epoch=excluded.epoch,expires_at=excluded.expires_at;
  select coalesce(jsonb_agg(jsonb_build_object('participantId',l.participant_id,'label',
    case when n.name='' or position('@' in n.name)>0 then 'Membro' else n.name end,'expiresAt',l.expires_at) order by l.participant_id),'[]')
    into v_participants from private.page_presence_leases l join auth.users u on u.id=l.actor_id
    cross join lateral(select left(btrim(coalesce(nullif(u.raw_user_meta_data->>'display_name',''),u.raw_user_meta_data->>'name','')),120) name) n
    where l.page_id=p_page_id and l.epoch=v_epoch and l.expires_at>clock_timestamp();
  return jsonb_build_object('epoch',v_epoch,'expiresAt',v_expiry,'participants',v_participants);
end;
$$;
create function private.page_presence_allowed(p_topic text,p_actor uuid)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare v_page uuid;v_epoch text;
begin
  if p_actor is null or p_actor is distinct from auth.uid() or p_topic is null or p_topic!~'^page-presence:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9]{1,19}$' then return false; end if;
  v_page:=split_part(p_topic,':',2)::uuid;v_epoch:=split_part(p_topic,':',3);
  return exists(select 1 from private.page_presence_leases l join private.page_presence_epochs e on e.workspace_id=l.workspace_id
    join auth.users u on u.id=l.actor_id where l.page_id=v_page and l.actor_id=p_actor and e.epoch::text=v_epoch and l.epoch=e.epoch
    and l.expires_at>clock_timestamp() and (u.email_confirmed_at is not null or u.phone_confirmed_at is not null))
    and private.page_role(v_page,p_actor) is not null;
end;
$$;
create policy page_presence_receive on realtime.messages for select to authenticated
  using(extension='presence' and private.page_presence_allowed((select realtime.topic()),(select auth.uid())));
create policy page_presence_send on realtime.messages for insert to authenticated
  with check(extension='presence' and private.page_presence_allowed((select realtime.topic()),(select auth.uid())));

create table public.comment_threads (
  id uuid primary key,workspace_id uuid not null,page_id uuid not null,block_id text,
  anchor jsonb,author_id uuid references auth.users(id) on delete set null,request_hash text not null check(request_hash~'^[0-9a-f]{64}$'),
  resolved boolean not null default false,revision bigint not null default 0 check(revision>=0),created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
  unique(id,page_id,workspace_id),foreign key(page_id,workspace_id) references public.pages(id,workspace_id) on delete cascade,
  check(block_id is null or block_id~'^[A-Za-z0-9_-]{1,80}$'),check(anchor is null or (jsonb_typeof(anchor)='object' and octet_length(anchor::text)<=4096))
);
create index comment_threads_page_idx on public.comment_threads(page_id,created_at,id);
create table public.comments (
  id uuid primary key,workspace_id uuid not null,page_id uuid not null,thread_id uuid not null,
  author_id uuid references auth.users(id) on delete set null,deleted_at timestamptz,
  body text not null check((deleted_at is null and octet_length(body) between 1 and 8192 and btrim(body)<>'') or(deleted_at is not null and body='')),
  request_hash text not null check(request_hash~'^[0-9a-f]{64}$'),revision bigint not null default 0 check(revision>=0),
  created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
  foreign key(thread_id,page_id,workspace_id) references public.comment_threads(id,page_id,workspace_id) on delete cascade
);
create index comments_thread_idx on public.comments(thread_id,created_at,id);
alter table public.comment_threads enable row level security;
alter table public.comments enable row level security;
create policy comment_threads_read on public.comment_threads for select to authenticated using(private.page_role(page_id,(select auth.uid())) is not null);
create policy comments_read on public.comments for select to authenticated using(deleted_at is null and private.page_role(page_id,(select auth.uid())) is not null);
revoke all on public.comment_threads,public.comments from public,anon,authenticated;
grant select(id,workspace_id,page_id,block_id,anchor,author_id,resolved,revision,created_at,updated_at) on public.comment_threads to authenticated;
grant select(id,workspace_id,page_id,thread_id,author_id,body,revision,created_at,updated_at) on public.comments to authenticated;
grant all on public.comment_threads,public.comments to service_role;

create function private.require_comment_page(p_page_id uuid,p_write boolean default false)
returns public.pages language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=private.require_confirmed_user();v_page public.pages;v_role text;
begin
  select * into v_page from public.pages where id=p_page_id;
  if p_write then perform 1 from public.workspaces where id=v_page.workspace_id for update; end if;
  v_role:=private.page_role(p_page_id,v_actor);
  if v_role is null or (p_write and v_role not in ('owner','editor','commenter')) then raise exception 'Comments unavailable' using errcode='42501'; end if;
  return v_page;
end;
$$;
create function private.validate_comment_body(p_body text)
returns void language plpgsql immutable set search_path='' as $$
begin if p_body is null or octet_length(p_body) not between 1 and 8192 or btrim(p_body)='' then raise exception 'Invalid comment body' using errcode='22023'; end if; end;
$$;
create function public.create_comment_thread(p_page_id uuid,p_body text,p_block_id text default null,p_anchor jsonb default null,p_request_id uuid default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_page public.pages:=private.require_comment_page(p_page_id,true);v_actor uuid:=auth.uid();v_id uuid:=coalesce(p_request_id,gen_random_uuid());v_hash text;v_existing public.comment_threads;
begin
  perform private.validate_comment_body(p_body);
  if p_block_id is not null and p_block_id!~'^[A-Za-z0-9_-]{1,80}$' then raise exception 'Invalid comment block' using errcode='22023'; end if;
  if p_anchor is not null and (p_block_id is null or not private.database_object_keys(p_anchor,array['type','start','end'],array['type','start','end'])
    or octet_length(p_anchor::text)>4096 or p_anchor->>'type' is distinct from 'relative' or jsonb_typeof(p_anchor->'start')<>'string' or jsonb_typeof(p_anchor->'end')<>'string'
    or char_length(p_anchor->>'start') not between 1 and 2048 or char_length(p_anchor->>'end') not between 1 and 2048
    or p_anchor->>'start'!~'^[A-Za-z0-9_-]+$' or p_anchor->>'end'!~'^[A-Za-z0-9_-]+$') then raise exception 'Invalid comment anchor' using errcode='22023'; end if;
  v_hash:=encode(extensions.digest(convert_to(jsonb_build_array(p_page_id,p_body,p_block_id,p_anchor)::text,'UTF8'),'sha256'),'hex');
  select * into v_existing from public.comment_threads where id=v_id;
  if found then if v_existing.author_id=v_actor and v_existing.page_id=p_page_id and v_existing.request_hash=v_hash then return v_id; end if; raise exception 'Comment request reused' using errcode='22023'; end if;
  if p_block_id is not null and not exists(select 1 from public.document_heads h cross join lateral jsonb_array_elements(case when jsonb_typeof(h.projection->'blocks')='array' then h.projection->'blocks' else '[]'::jsonb end) b where h.page_id=p_page_id and b->>'id'=p_block_id) then
    raise exception 'Comment block unavailable' using errcode='22023'; end if;
  perform private.collaboration_rate(v_page.workspace_id,v_actor,'comment');
  insert into public.comment_threads(id,workspace_id,page_id,block_id,anchor,author_id,request_hash) values(v_id,v_page.workspace_id,p_page_id,p_block_id,p_anchor,v_actor,v_hash);
  insert into public.comments(id,workspace_id,page_id,thread_id,author_id,body,request_hash) values(v_id,v_page.workspace_id,p_page_id,v_id,v_actor,p_body,v_hash);
  return v_id;
end;
$$;
create function public.add_comment(p_thread_id uuid,p_body text,p_request_id uuid default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_thread public.comment_threads;v_page public.pages;v_actor uuid:=private.require_confirmed_user();v_id uuid:=coalesce(p_request_id,gen_random_uuid());v_hash text;v_existing public.comments;
begin
  select * into v_thread from public.comment_threads where id=p_thread_id;
  v_page:=private.require_comment_page(v_thread.page_id,true);
  perform private.validate_comment_body(p_body);
  v_hash:=encode(extensions.digest(convert_to(jsonb_build_array(p_thread_id,p_body)::text,'UTF8'),'sha256'),'hex');
  select * into v_existing from public.comments where id=v_id;
  if found then if v_existing.author_id=v_actor and v_existing.thread_id=p_thread_id and v_existing.request_hash=v_hash then return v_id; end if; raise exception 'Comment request reused' using errcode='22023'; end if;
  perform private.collaboration_rate(v_page.workspace_id,v_actor,'comment');
  insert into public.comments(id,workspace_id,page_id,thread_id,author_id,body,request_hash) values(v_id,v_page.workspace_id,v_page.id,p_thread_id,v_actor,p_body,v_hash);
  update public.comment_threads set updated_at=clock_timestamp() where id=p_thread_id;
  return v_id;
end;
$$;
create function public.edit_comment(p_comment_id uuid,p_body text,p_expected_revision bigint)
returns bigint language plpgsql security definer set search_path='' as $$
declare v_comment public.comments;v_page public.pages;v_revision bigint;
begin
  select * into v_comment from public.comments where id=p_comment_id;
  v_page:=private.require_comment_page(v_comment.page_id,true);
  if v_comment.author_id is distinct from auth.uid() or v_comment.deleted_at is not null then raise exception 'Comment unavailable' using errcode='42501'; end if;
  if p_expected_revision is null or p_expected_revision<0 then raise exception 'Invalid comment revision' using errcode='22023'; end if;
  perform private.validate_comment_body(p_body);perform private.collaboration_rate(v_page.workspace_id,auth.uid(),'comment');
  update public.comments set body=p_body,revision=revision+1,updated_at=clock_timestamp() where id=p_comment_id and revision=p_expected_revision returning revision into v_revision;
  if not found then raise exception 'Comment revision conflict' using errcode='40001'; end if;
  return v_revision;
end;
$$;
create function public.delete_comment(p_comment_id uuid,p_expected_revision bigint)
returns void language plpgsql security definer set search_path='' as $$
declare v_comment public.comments;v_page public.pages;
begin
  select * into v_comment from public.comments where id=p_comment_id;
  v_page:=private.require_comment_page(v_comment.page_id,true);
  if v_comment.author_id is distinct from auth.uid() or v_comment.deleted_at is not null then raise exception 'Comment unavailable' using errcode='42501'; end if;
  if p_expected_revision is null or p_expected_revision<0 then raise exception 'Invalid comment revision' using errcode='22023'; end if;
  perform private.collaboration_rate(v_page.workspace_id,auth.uid(),'comment');
  -- Retain the operation receipt without its text so a lost-ACK retry cannot
  -- recreate an explicitly removed reply.
  update public.comments set body='',deleted_at=clock_timestamp(),revision=revision+1,updated_at=clock_timestamp() where id=p_comment_id and revision=p_expected_revision;
  if not found then raise exception 'Comment revision conflict' using errcode='40001'; end if;
end;
$$;
create function public.resolve_comment_thread(p_thread_id uuid,p_resolved boolean,p_expected_revision bigint)
returns bigint language plpgsql security definer set search_path='' as $$
declare v_thread public.comment_threads;v_page public.pages;v_role text;v_revision bigint;
begin
  select * into v_thread from public.comment_threads where id=p_thread_id;
  v_page:=private.require_comment_page(v_thread.page_id,true);v_role:=private.page_role(v_page.id,auth.uid());
  if v_role not in ('owner','editor') and v_thread.author_id is distinct from auth.uid() then raise exception 'Thread unavailable' using errcode='42501'; end if;
  if p_resolved is null or p_expected_revision is null or p_expected_revision<0 then raise exception 'Invalid thread revision' using errcode='22023'; end if;
  perform private.collaboration_rate(v_page.workspace_id,auth.uid(),'comment');
  update public.comment_threads set resolved=p_resolved,revision=revision+1,updated_at=clock_timestamp() where id=p_thread_id and revision=p_expected_revision returning revision into v_revision;
  if not found then raise exception 'Thread revision conflict' using errcode='40001'; end if;
  return v_revision;
end;
$$;

create function private.comment_label(p_metadata jsonb)
returns text language sql immutable set search_path='' as $$
  select case when name='' or position('@' in name)>0 then 'Membro' else name end
  from(select left(btrim(coalesce(nullif(p_metadata->>'display_name',''),p_metadata->>'name','')),120) name) n;
$$;
create function public.list_comment_threads(p_page_id uuid,p_after_created_at timestamptz default null,p_after_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_page public.pages:=private.require_comment_page(p_page_id);v_result jsonb;
begin
  if (p_after_created_at is null)<>(p_after_id is null) then raise exception 'Invalid thread cursor' using errcode='22023'; end if;
  with blocks as materialized(select b->>'id' id from public.document_heads h cross join lateral jsonb_array_elements(case when jsonb_typeof(h.projection->'blocks')='array' then h.projection->'blocks' else '[]'::jsonb end) b where h.page_id=p_page_id),
  candidates as materialized(select t.* from public.comment_threads t where t.page_id=p_page_id and (p_after_id is null or (t.created_at,t.id)>(p_after_created_at,p_after_id)) order by t.created_at,t.id limit 51),
  visible as(select t.*,row_number() over(order by t.created_at,t.id) n from candidates t),
  payload as(select n,t.created_at,t.id,jsonb_build_object('id',t.id,'pageId',t.page_id,'blockId',t.block_id,'anchor',t.anchor,
    'anchorAvailable',t.block_id is null or exists(select 1 from blocks where id=t.block_id),
    'authorId',t.author_id,'authorLabel',private.comment_label(u.raw_user_meta_data),'resolved',t.resolved,'revision',t.revision,'createdAt',t.created_at,'updatedAt',t.updated_at,
    'preview',preview.value) value from visible t left join auth.users u on u.id=t.author_id
    left join lateral(select jsonb_build_object('id',c.id,'threadId',c.thread_id,'authorId',c.author_id,'authorLabel',private.comment_label(cu.raw_user_meta_data),'body',c.body,'revision',c.revision,'createdAt',c.created_at,'updatedAt',c.updated_at) value
      from public.comments c left join auth.users cu on cu.id=c.author_id where c.thread_id=t.id and c.deleted_at is null order by c.created_at,c.id limit 1) preview on true where n<=50),
  budget as(select *,sum(octet_length(value::text)) over(order by created_at,id) bytes from payload),
  included as(select * from budget where bytes<=1047552)
  select jsonb_build_object('threads',coalesce((select jsonb_agg(value order by created_at,id) from included),'[]'::jsonb),
    'nextCursor',case when(select count(*) from candidates)>(select count(*) from included) then(select jsonb_build_object('createdAt',created_at,'id',id) from included order by created_at desc,id desc limit 1) else null end) into v_result;
  return v_result;
end;
$$;
create function public.list_thread_comments(p_thread_id uuid,p_after_created_at timestamptz default null,p_after_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_thread public.comment_threads;v_result jsonb;
begin
  select * into v_thread from public.comment_threads where id=p_thread_id;
  perform private.require_comment_page(v_thread.page_id);
  if (p_after_created_at is null)<>(p_after_id is null) then raise exception 'Invalid comment cursor' using errcode='22023'; end if;
  with candidates as materialized(select c.* from public.comments c where c.thread_id=p_thread_id and c.deleted_at is null and(p_after_id is null or(c.created_at,c.id)>(p_after_created_at,p_after_id)) order by c.created_at,c.id limit 51),
  visible as(select c.*,row_number() over(order by c.created_at,c.id) n from candidates c),
  payload as(select c.created_at,c.id,jsonb_build_object('id',c.id,'threadId',c.thread_id,'authorId',c.author_id,'authorLabel',private.comment_label(u.raw_user_meta_data),'body',c.body,'revision',c.revision,'createdAt',c.created_at,'updatedAt',c.updated_at) value
    from visible c left join auth.users u on u.id=c.author_id where n<=50),
  budget as(select *,sum(octet_length(value::text)) over(order by created_at,id) bytes from payload),
  included as(select * from budget where bytes<=1047552)
  select jsonb_build_object('comments',coalesce((select jsonb_agg(value order by created_at,id) from included),'[]'::jsonb),
    'nextCursor',case when(select count(*) from candidates)>(select count(*) from included) then(select jsonb_build_object('createdAt',created_at,'id',id) from included order by created_at desc,id desc limit 1) else null end) into v_result;
  return v_result;
end;
$$;
revoke all on function private.collaboration_rate(uuid,uuid,text),private.rotate_presence_epoch(),private.page_presence_allowed(text,uuid),
  private.require_comment_page(uuid,boolean),private.validate_comment_body(text),private.comment_label(jsonb) from public,anon,authenticated;
grant execute on function private.page_presence_allowed(text,uuid) to authenticated;
revoke all on function public.renew_page_presence(uuid,uuid),public.create_comment_thread(uuid,text,text,jsonb,uuid),public.add_comment(uuid,text,uuid),
  public.edit_comment(uuid,text,bigint),public.delete_comment(uuid,bigint),public.resolve_comment_thread(uuid,boolean,bigint),
  public.list_comment_threads(uuid,timestamptz,uuid),public.list_thread_comments(uuid,timestamptz,uuid) from public,anon;
grant execute on function public.renew_page_presence(uuid,uuid),public.create_comment_thread(uuid,text,text,jsonb,uuid),public.add_comment(uuid,text,uuid),
  public.edit_comment(uuid,text,bigint),public.delete_comment(uuid,bigint),public.resolve_comment_thread(uuid,boolean,bigint),
  public.list_comment_threads(uuid,timestamptz,uuid),public.list_thread_comments(uuid,timestamptz,uuid) to authenticated;
