create schema if not exists private;
create extension if not exists pgcrypto with schema extensions;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  request_id uuid not null default gen_random_uuid(),
  request_hash text not null default '',
  unique (created_by, request_id)
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  role text not null check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index workspace_members_user_idx on public.workspace_members(user_id, workspace_id);
create index workspace_members_cursor_idx on public.workspace_members(workspace_id, created_at, user_id);

create table public.workspace_invites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  email text not null check (email = lower(btrim(email)) and char_length(email) between 3 and 254),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
create unique index workspace_invites_active_email_idx on public.workspace_invites(workspace_id, email)
  where accepted_at is null and revoked_at is null;

create table public.pages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  parent_id uuid,
  title text not null default '' check (char_length(title) <= 500),
  position text collate "C" not null default 'a' check (position ~ '^[A-Za-z0-9]{1,128}$'),
  owner_id uuid not null references auth.users(id),
  restricted boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id),
  foreign key (parent_id, workspace_id) references public.pages(id, workspace_id),
  check (parent_id is distinct from id)
);
create index pages_parent_position_idx on public.pages(workspace_id, parent_id, position, id);

create table public.page_grants (
  page_id uuid not null,
  workspace_id uuid not null,
  user_id uuid not null,
  role text not null check (role in ('owner', 'editor', 'commenter', 'viewer')),
  primary key (page_id, user_id),
  foreign key (page_id, workspace_id) references public.pages(id, workspace_id) on delete cascade,
  foreign key (workspace_id, user_id) references public.workspace_members(workspace_id, user_id) on delete cascade
);
create index page_grants_user_idx on public.page_grants(user_id, workspace_id, page_id);

create table public.document_heads (
  page_id uuid primary key,
  workspace_id uuid not null,
  revision bigint not null default 0 check (revision >= 0),
  snapshot bytea not null default '\x',
  projection jsonb not null default '{}'::jsonb check (jsonb_typeof(projection) = 'object'),
  compacted_through bigint not null default 0 check (compacted_through >= 0 and compacted_through <= revision),
  updated_at timestamptz not null default now(),
  unique (page_id, workspace_id),
  foreign key (page_id, workspace_id) references public.pages(id, workspace_id) on delete cascade,
  check (octet_length(snapshot) <= 8388608)
);

create table public.document_updates (
  page_id uuid not null,
  workspace_id uuid not null,
  revision bigint not null check (revision > 0),
  operation_id uuid not null,
  actor_id uuid not null references auth.users(id),
  payload bytea,
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  compacted boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (page_id, revision),
  unique (page_id, operation_id),
  foreign key (page_id, workspace_id) references public.document_heads(page_id, workspace_id) on delete cascade,
  check ((compacted and payload is null) or (not compacted and payload is not null)),
  check (payload is null or octet_length(payload) between 1 and 262144)
);
create index document_updates_workspace_idx on public.document_updates(workspace_id, page_id, revision);

create function private.is_workspace_member(p_workspace_id uuid, p_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.workspace_members m where m.workspace_id = p_workspace_id and m.user_id = p_user_id);
$$;

create function private.is_workspace_owner(p_workspace_id uuid, p_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.workspace_members m where m.workspace_id = p_workspace_id and m.user_id = p_user_id and m.role = 'owner');
$$;

create function private.page_role(p_page_id uuid, p_user_id uuid)
returns text language plpgsql stable security definer set search_path = '' as $$
declare
  v_page public.pages%rowtype;
  v_current public.pages%rowtype;
  v_seen uuid[] := '{}';
  v_grant text;
  v_rank integer := 0;
begin
  select * into v_page from public.pages where id = p_page_id;
  if not found or not private.is_workspace_member(v_page.workspace_id, p_user_id) then return null; end if;
  v_current := v_page;
  loop
    if v_current.id = any(v_seen) or v_current.deleted_at is not null then return null; end if;
    v_seen := array_append(v_seen, v_current.id);
    exit when v_current.parent_id is null;
    select * into v_current from public.pages where id = v_current.parent_id and workspace_id = v_page.workspace_id;
    if not found then return null; end if;
  end loop;
  if private.is_workspace_owner(v_page.workspace_id, p_user_id) then return 'owner'; end if;
  v_current := v_page;
  loop
    if v_current.owner_id = p_user_id then return 'owner'; end if;
    select g.role into v_grant from public.page_grants g where g.page_id = v_current.id and g.user_id = p_user_id;
    v_rank := greatest(v_rank, case v_grant when 'owner' then 4 when 'editor' then 3 when 'commenter' then 2 when 'viewer' then 1 else 0 end);
    exit when v_current.restricted or v_current.parent_id is null;
    select * into v_current from public.pages where id = v_current.parent_id;
  end loop;
  return case v_rank when 4 then 'owner' when 3 then 'editor' when 2 then 'commenter' when 1 then 'viewer' else null end;
end;
$$;

create function private.require_confirmed_user()
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null or not exists (select 1 from auth.users where id = v_user and email_confirmed_at is not null) then
    raise exception 'Confirmed authentication required' using errcode = '28000';
  end if;
  return v_user;
end;
$$;

create function private.guard_membership_owner()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and (new.workspace_id <> old.workspace_id or new.user_id <> old.user_id) then
    raise exception 'Membership identity is immutable' using errcode = '23514';
  end if;
  perform 1 from public.workspaces where id = old.workspace_id for update;
  if not found and tg_op = 'DELETE' then return old; end if;
  if old.role = 'owner' and (tg_op = 'DELETE' or new.role <> 'owner') and not exists (
    select 1 from public.workspace_members where workspace_id = old.workspace_id and role = 'owner' and user_id <> old.user_id
  ) then raise exception 'The last workspace owner must be preserved' using errcode = '23514'; end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
create trigger preserve_workspace_owner before update or delete on public.workspace_members
  for each row execute function private.guard_membership_owner();

create function private.guard_page_structure()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_parent uuid := new.parent_id; v_seen uuid[] := array[new.id];
begin
  if tg_op = 'UPDATE' and new.workspace_id <> old.workspace_id then raise exception 'Page workspace is immutable' using errcode = '23514'; end if;
  perform 1 from public.workspaces where id = new.workspace_id for update;
  if (tg_op = 'INSERT' or new.owner_id <> old.owner_id) and not private.is_workspace_member(new.workspace_id, new.owner_id) then raise exception 'Page owner must belong to workspace' using errcode = '23514'; end if;
  while v_parent is not null loop
    if v_parent = any(v_seen) then raise exception 'Page cycle detected' using errcode = '23514'; end if;
    v_seen := array_append(v_seen, v_parent);
    select parent_id into v_parent from public.pages where id = v_parent and workspace_id = new.workspace_id;
    if not found then exit; end if;
  end loop;
  new.updated_at := now();
  return new;
end;
$$;
create trigger validate_page_structure before insert or update of workspace_id, parent_id, owner_id on public.pages
  for each row execute function private.guard_page_structure();

create function public.create_workspace(p_name text, p_request_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := private.require_confirmed_user(); v_id uuid; v_hash text; v_existing text;
begin
  if p_request_id is null or p_name is null or char_length(btrim(p_name)) not between 1 and 80 then raise exception 'Invalid workspace input' using errcode = '22023'; end if;
  v_hash := encode(extensions.digest(convert_to(btrim(p_name), 'UTF8'), 'sha256'), 'hex');
  insert into public.workspaces(name, created_by, request_id, request_hash) values (btrim(p_name), v_actor, p_request_id, v_hash)
    on conflict (created_by, request_id) do nothing returning id into v_id;
  if v_id is null then
    select id, request_hash into v_id, v_existing from public.workspaces where created_by = v_actor and request_id = p_request_id for update;
    if v_existing <> v_hash then raise exception 'Idempotency key reused with different input' using errcode = '22023'; end if;
  else
    insert into public.workspace_members(workspace_id, user_id, role) values (v_id, v_actor, 'owner');
  end if;
  return v_id;
end;
$$;

create function public.create_invite(p_workspace_id uuid, p_email text, p_token_hash text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := private.require_confirmed_user(); v_id uuid; v_email text := lower(btrim(p_email));
begin
  perform 1 from public.workspaces where id = p_workspace_id for update;
  if not private.is_workspace_owner(p_workspace_id, v_actor) then raise exception 'Insufficient permissions' using errcode = '42501'; end if;
  if v_email is null or char_length(v_email) > 254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' or p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid invitation input' using errcode = '22023';
  end if;
  update public.workspace_invites set revoked_at = now() where workspace_id = p_workspace_id and email = v_email and accepted_at is null and revoked_at is null;
  insert into public.workspace_invites(workspace_id, email, token_hash, created_by) values (p_workspace_id, v_email, p_token_hash, v_actor) returning id into v_id;
  return v_id;
end;
$$;

create function public.accept_invite(p_token text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := private.require_confirmed_user(); v_hash text; v_workspace uuid; v_email text; v_invite public.workspace_invites%rowtype;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{43,128}$' then raise exception 'Invitation unavailable' using errcode = 'P0001'; end if;
  v_hash := encode(extensions.digest(convert_to(p_token, 'UTF8'), 'sha256'), 'hex');
  select workspace_id into v_workspace from public.workspace_invites where token_hash = v_hash;
  if not found then raise exception 'Invitation unavailable' using errcode = 'P0001'; end if;
  perform 1 from public.workspaces where id = v_workspace for update;
  select * into v_invite from public.workspace_invites where token_hash = v_hash for update;
  select lower(email) into v_email from auth.users where id = v_actor and email_confirmed_at is not null;
  if v_invite.accepted_at is not null or v_invite.revoked_at is not null or v_invite.expires_at <= now() or v_invite.email is distinct from v_email then
    raise exception 'Invitation unavailable' using errcode = 'P0001';
  end if;
  insert into public.workspace_members(workspace_id, user_id, role) values (v_workspace, v_actor, 'member') on conflict do nothing;
  update public.workspace_invites set accepted_at = now() where id = v_invite.id;
  return v_workspace;
end;
$$;

create function public.set_member_role(p_workspace_id uuid, p_user_id uuid, p_role text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := private.require_confirmed_user();
begin
  perform 1 from public.workspaces where id = p_workspace_id for update;
  if not private.is_workspace_owner(p_workspace_id, v_actor) then raise exception 'Insufficient permissions' using errcode = '42501'; end if;
  if p_role is null or p_role not in ('owner', 'member') then raise exception 'Invalid membership role' using errcode = '22023'; end if;
  update public.workspace_members set role = p_role where workspace_id = p_workspace_id and user_id = p_user_id;
  if not found then raise exception 'Member unavailable' using errcode = 'P0002'; end if;
end;
$$;

create function public.remove_member(p_workspace_id uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := private.require_confirmed_user();
begin
  perform 1 from public.workspaces where id = p_workspace_id for update;
  if not private.is_workspace_owner(p_workspace_id, v_actor) then raise exception 'Insufficient permissions' using errcode = '42501'; end if;
  delete from public.workspace_members where workspace_id = p_workspace_id and user_id = p_user_id;
end;
$$;

create function public.list_workspace_members(p_workspace_id uuid, p_after_created_at timestamptz default null, p_after_user_id uuid default null)
returns table(user_id uuid, role text, email text, created_at timestamptz) language plpgsql stable security definer set search_path = '' as $$
declare v_actor uuid := private.require_confirmed_user();
begin
  if not private.is_workspace_owner(p_workspace_id, v_actor) then raise exception 'Insufficient permissions' using errcode = '42501'; end if;
  if (p_after_created_at is null) <> (p_after_user_id is null) then raise exception 'Invalid member cursor' using errcode = '22023'; end if;
  return query select m.user_id, m.role, u.email::text, m.created_at from public.workspace_members m join auth.users u on u.id = m.user_id
    where m.workspace_id = p_workspace_id and (p_after_created_at is null or (m.created_at, m.user_id) > (p_after_created_at, p_after_user_id))
    order by m.created_at, m.user_id limit 51;
end;
$$;

create function public.commit_document(p_page_id uuid, p_actor_id uuid, p_expected_revision bigint, p_operation_id uuid, p_payload bytea, p_hash text, p_snapshot bytea, p_projection jsonb)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_workspace uuid; v_revision bigint; v_existing public.document_updates%rowtype;
begin
  select workspace_id into v_workspace from public.pages where id = p_page_id;
  if not found then raise exception 'Document unavailable' using errcode = '42501'; end if;
  perform 1 from public.workspaces where id = v_workspace for update;
  perform 1 from public.pages where id = p_page_id for update;
  if coalesce(private.page_role(p_page_id, p_actor_id), '') not in ('owner', 'editor') then raise exception 'Document unavailable' using errcode = '42501'; end if;
  if p_operation_id is null or p_payload is null or octet_length(p_payload) not between 1 and 262144 or p_snapshot is null or octet_length(p_snapshot) > 8388608
    or p_projection is null or jsonb_typeof(p_projection) <> 'object' or octet_length(p_projection::text) > 8388608 or p_hash is null
    or p_hash is distinct from encode(extensions.digest(p_payload, 'sha256'), 'hex') then raise exception 'Invalid document payload' using errcode = '22023'; end if;
  select * into v_existing from public.document_updates where page_id = p_page_id and operation_id = p_operation_id;
  if found then
    if v_existing.payload_hash <> p_hash or v_existing.actor_id <> p_actor_id then raise exception 'Idempotency key reused with different input' using errcode = '22023'; end if;
    return v_existing.revision;
  end if;
  insert into public.document_heads(page_id, workspace_id) values (p_page_id, v_workspace) on conflict do nothing;
  select revision into v_revision from public.document_heads where page_id = p_page_id for update;
  if p_expected_revision is null or v_revision <> p_expected_revision then raise exception 'Document revision conflict' using errcode = '40001'; end if;
  v_revision := v_revision + 1;
  insert into public.document_updates(page_id, workspace_id, revision, operation_id, actor_id, payload, payload_hash)
    values (p_page_id, v_workspace, v_revision, p_operation_id, p_actor_id, p_payload, p_hash);
  update public.document_heads set revision = v_revision, snapshot = p_snapshot, projection = p_projection, updated_at = now() where page_id = p_page_id;
  perform realtime.send(jsonb_build_object('revision', v_revision), 'revision', 'page:' || p_page_id::text, true);
  return v_revision;
end;
$$;

create function public.compact_document(p_page_id uuid, p_expected_revision bigint, p_snapshot bytea)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_head public.document_heads%rowtype;
begin
  select * into v_head from public.document_heads where page_id = p_page_id for update;
  if not found or p_expected_revision is null or v_head.revision <> p_expected_revision then raise exception 'Document revision conflict' using errcode = '40001'; end if;
  if p_snapshot is null or v_head.snapshot is distinct from p_snapshot then raise exception 'Snapshot does not match durable head' using errcode = '22023'; end if;
  update public.document_heads set compacted_through = p_expected_revision where page_id = p_page_id;
  -- Retain operation receipts so retries stay idempotent after payload compaction.
  update public.document_updates set payload = null, compacted = true where page_id = p_page_id and revision <= p_expected_revision;
  return p_expected_revision;
end;
$$;

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.workspace_invites enable row level security;
alter table public.pages enable row level security;
alter table public.page_grants enable row level security;
alter table public.document_heads enable row level security;
alter table public.document_updates enable row level security;

create policy workspace_read on public.workspaces for select to authenticated using (private.is_workspace_member(id, (select auth.uid())));
create policy members_read on public.workspace_members for select to authenticated using (user_id = (select auth.uid()) or private.is_workspace_owner(workspace_id, (select auth.uid())));
create policy invitations_read on public.workspace_invites for select to authenticated using (private.is_workspace_owner(workspace_id, (select auth.uid())));
create policy pages_read on public.pages for select to authenticated using (private.page_role(id, (select auth.uid())) is not null);
create policy grants_read on public.page_grants for select to authenticated using (private.page_role(page_id, (select auth.uid())) is not null and (user_id = (select auth.uid()) or private.page_role(page_id, (select auth.uid())) = 'owner'));
create policy document_head_read on public.document_heads for select to authenticated using (private.page_role(page_id, (select auth.uid())) is not null);
create policy document_updates_read on public.document_updates for select to authenticated using (private.page_role(page_id, (select auth.uid())) is not null);

create policy page_revision_receive on realtime.messages for select to authenticated using (
  extension = 'broadcast' and realtime.topic() ~ '^page:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and private.page_role(case when realtime.topic() ~ '^page:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then substring(realtime.topic() from 6)::uuid else null end, (select auth.uid())) is not null
);

revoke all on all tables in schema public from anon, authenticated;
grant select on public.workspaces, public.workspace_members, public.workspace_invites, public.pages, public.page_grants, public.document_heads, public.document_updates to authenticated;
grant all on public.workspaces, public.workspace_members, public.workspace_invites, public.pages, public.page_grants, public.document_heads, public.document_updates to service_role;
revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.is_workspace_member(uuid, uuid), private.is_workspace_owner(uuid, uuid), private.page_role(uuid, uuid) to authenticated, service_role;
revoke execute on function public.create_workspace(text, uuid), public.create_invite(uuid, text, text), public.accept_invite(text), public.set_member_role(uuid, uuid, text), public.remove_member(uuid, uuid), public.list_workspace_members(uuid,timestamptz,uuid), public.commit_document(uuid, uuid, bigint, uuid, bytea, text, bytea, jsonb), public.compact_document(uuid, bigint, bytea) from public, anon, authenticated;
grant execute on function public.create_workspace(text, uuid), public.create_invite(uuid, text, text), public.accept_invite(text), public.set_member_role(uuid, uuid, text), public.remove_member(uuid, uuid), public.list_workspace_members(uuid,timestamptz,uuid) to authenticated;
grant execute on function public.commit_document(uuid, uuid, bigint, uuid, bytea, text, bytea, jsonb), public.compact_document(uuid, bigint, bytea) to service_role;
