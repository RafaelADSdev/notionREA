create extension if not exists unaccent with schema extensions;

alter table public.pages
  add column revision bigint not null default 0 check (revision >= 0),
  add column icon text not null default '' check (char_length(icon) <= 16 and icon !~ '[[:cntrl:]<>]'),
  add column created_by uuid references auth.users(id),
  add column request_id uuid not null default gen_random_uuid(),
  add column request_hash text not null default '',
  add column deleted_batch_id uuid,
  add column deleted_by uuid references auth.users(id),
  add column deleted_parent_id uuid,
  add column deleted_position text collate "C",
  add column search_vector tsvector not null default ''::tsvector;
update public.pages set created_by = owner_id;
alter table public.pages alter column created_by set not null;
alter table public.pages add unique (created_by, request_id);
create index pages_recent_idx on public.pages(workspace_id, updated_at desc, id) where deleted_at is null;
create index pages_trash_idx on public.pages(workspace_id, id) where deleted_at is not null;
create index pages_deleted_batch_idx on public.pages(deleted_batch_id) where deleted_batch_id is not null;
create index pages_search_idx on public.pages using gin(search_vector);

-- Preserve any pre-M2 tombstones without letting a later restore revive an
-- independently removed branch. Existing content and identities are unchanged.
do $$
declare v_page record; v_batch uuid;
begin
  for v_page in select p.id,p.deleted_at from public.pages p where p.deleted_at is not null order by p.id loop
    v_batch := gen_random_uuid();
    update public.pages set deleted_batch_id=v_batch,deleted_parent_id=parent_id,deleted_position=position where id=v_page.id;
    with recursive hidden_descendants as (
      select p.id from public.pages p where p.parent_id=v_page.id and p.deleted_at is null
      union all select p.id from hidden_descendants d join public.pages p on p.parent_id=d.id where p.deleted_at is null
    ) update public.pages set deleted_at=v_page.deleted_at,deleted_batch_id=v_batch,deleted_parent_id=parent_id,
      deleted_position=position,revision=revision+1 where id in(select id from hidden_descendants);
  end loop;
end;
$$;

-- All ACL writers share the workspace lock with moves, including privileged
-- maintenance. RLS prevents clients from using these tables as a write API.
create function private.lock_acl_workspace()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and (new.workspace_id <> old.workspace_id or new.page_id <> old.page_id or new.user_id <> old.user_id) then
    raise exception 'Grant identity is immutable' using errcode = '23514';
  end if;
  if tg_op = 'DELETE' then
    perform 1 from public.workspaces where id = old.workspace_id for update;
    return old;
  end if;
  perform 1 from public.workspaces where id = new.workspace_id for update;
  return new;
end;
$$;
create trigger lock_page_grant_workspace before insert or update or delete on public.page_grants
  for each row execute function private.lock_acl_workspace();
create function private.lock_new_workspace_member()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.workspaces where id = new.workspace_id for update;
  return new;
end;
$$;
create trigger lock_new_workspace_member before insert on public.workspace_members
  for each row execute function private.lock_new_workspace_member();

-- Ancestor traversal remains unbounded; a restricted node only stops grants,
-- never the ancestor lifecycle check.
create function private.page_role_core(p_page_id uuid, p_user_id uuid, p_ignore_deleted boolean)
returns text language sql stable security definer set search_path = '' as $$
  with recursive ancestors as (
    select p.id, p.parent_id, p.workspace_id, p.owner_id, p.restricted, p.deleted_at, true as inherits
    from public.pages p where p.id = p_page_id
    union all
    select p.id, p.parent_id, p.workspace_id, p.owner_id, p.restricted, p.deleted_at,
      a.inherits and not a.restricted
    from ancestors a join lateral (select p.* from public.pages p
      where p.id = a.parent_id and p.workspace_id = a.workspace_id offset 0) p on true
  ), capabilities as (
    select max(case when m.role = 'owner' then 4
      when a.inherits and a.owner_id = p_user_id then 4
      when a.inherits then case g.role when 'owner' then 4 when 'editor' then 3 when 'commenter' then 2 when 'viewer' then 1 else 0 end
      else 0 end) as rank,
      bool_or(a.deleted_at is not null) as deleted
    from ancestors a join public.workspace_members m on m.workspace_id = a.workspace_id and m.user_id = p_user_id
    left join public.page_grants g on g.page_id = a.id and g.user_id = p_user_id
  )
  select case when not p_ignore_deleted and deleted then null
    else case rank when 4 then 'owner' when 3 then 'editor' when 2 then 'commenter' when 1 then 'viewer' else null end end
  from capabilities;
$$;
create or replace function private.page_role(p_page_id uuid, p_user_id uuid)
returns text language sql stable security definer set search_path = '' as $$
  select private.page_role_core(p_page_id, p_user_id, false);
$$;

-- Expand active ancestry once per query rather than walking the same ancestors
-- separately for every matching row. Zero-capability nodes remain in the walk
-- so a direct grant behind a hidden parent can still be discovered.
create function private.visible_page_scope(p_workspace_id uuid,p_user_id uuid)
returns table(page_id uuid,parent_id uuid,capability integer)
language sql stable security definer set search_path = '' as $$
  with recursive member as materialized (
    select m.role from public.workspace_members m where m.workspace_id=p_workspace_id and m.user_id=p_user_id
  ), nodes as materialized (
    select p.id,p.parent_id,p.restricted,
      case when m.role='owner' or p.owner_id=p_user_id then 4
        else case g.role when 'owner' then 4 when 'editor' then 3 when 'commenter' then 2 when 'viewer' then 1 else 0 end end as direct_rank
    from public.pages p cross join member m
      left join public.page_grants g on g.page_id=p.id and g.user_id=p_user_id
    where p.workspace_id=p_workspace_id and p.deleted_at is null
  ), tree as (
    select n.id,n.parent_id,n.direct_rank as capability from nodes n where n.parent_id is null
    union all
    select n.id,n.parent_id,case when n.restricted then n.direct_rank else greatest(n.direct_rank,t.capability) end
    from tree t join nodes n on n.parent_id=t.id
  ) select t.id,t.parent_id,t.capability from tree t where t.capability>0;
$$;

create or replace function private.guard_page_structure()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.workspace_id <> old.workspace_id then
    raise exception 'Page workspace is immutable' using errcode = '23514';
  end if;
  perform 1 from public.workspaces where id = new.workspace_id for update;
  if (tg_op = 'INSERT' or new.owner_id <> old.owner_id) and not private.is_workspace_member(new.workspace_id, new.owner_id) then
    raise exception 'Page owner must belong to workspace' using errcode = '23514';
  end if;
  if exists (
    with recursive ancestors as (
      select p.id, p.parent_id from public.pages p where p.id = new.parent_id and p.workspace_id = new.workspace_id
      union all
      select p.id, p.parent_id from ancestors a join lateral (select p.id,p.parent_id from public.pages p
        where p.id = a.parent_id and p.workspace_id = new.workspace_id and a.id <> new.id offset 0) p on true
    ) select 1 from ancestors where id = new.id
  ) then raise exception 'Page cycle detected' using errcode = '23514'; end if;
  if tg_op = 'INSERT' then new.created_by := coalesce(new.created_by, new.owner_id); end if;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;
create trigger lock_page_restriction_workspace before update of restricted on public.pages
  for each row execute function private.guard_page_structure();

create function private.index_page_title()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.search_vector := setweight(to_tsvector('pg_catalog.portuguese', new.title), 'A')
    || setweight(to_tsvector('pg_catalog.english', new.title), 'A')
    || setweight(to_tsvector('pg_catalog.portuguese', extensions.unaccent(new.title)), 'A')
    || setweight(to_tsvector('pg_catalog.english', extensions.unaccent(new.title)), 'A');
  return new;
end;
$$;
create trigger index_page_title before insert or update of title on public.pages
  for each row execute function private.index_page_title();
update public.pages set title = title;

create function private.page_subtree(p_page_id uuid)
returns table(id uuid) language sql stable security definer set search_path = '' as $$
  with recursive descendants as (
    select p.id,p.workspace_id from public.pages p where p.id = p_page_id
    union all
    select p.id,p.workspace_id from descendants d join public.pages p on p.parent_id = d.id and p.workspace_id = d.workspace_id
  ) select d.id from descendants d;
$$;

-- Compare every member's capability on every descendant, including tombstones.
-- Simulating an edge avoids mutating data before consent and preserves boundaries.
create function private.subtree_acl(p_scope uuid[], p_override_page uuid, p_override_parent uuid, p_override boolean)
returns table(page_id uuid, user_id uuid, capability integer)
language sql stable security definer set search_path = '' as $$
  with recursive ancestors as (
    select p.id as scope_id, p.id, case when p_override and p.id = p_override_page then p_override_parent else p.parent_id end as parent_id,
      p.workspace_id, p.owner_id, p.restricted, true as inherits
    from public.pages p where p.id = any(p_scope)
    union all
    select a.scope_id, p.id, case when p_override and p.id = p_override_page then p_override_parent else p.parent_id end,
      p.workspace_id, p.owner_id, p.restricted, a.inherits and not a.restricted
    from ancestors a join lateral (select p.* from public.pages p
      where p.id = a.parent_id and p.workspace_id = a.workspace_id offset 0) p on true
  )
  select a.scope_id, m.user_id, max(case when m.role = 'owner' then 4
    when a.inherits and a.owner_id = m.user_id then 4
    when a.inherits then case g.role when 'owner' then 4 when 'editor' then 3 when 'commenter' then 2 when 'viewer' then 1 else 0 end
    else 0 end)::integer
  from ancestors a join public.workspace_members m on m.workspace_id = a.workspace_id
  left join public.page_grants g on g.page_id = a.id and g.user_id = m.user_id
  group by a.scope_id, m.user_id;
$$;

create function private.acl_move_check(p_scope uuid[], p_page_id uuid, p_parent_id uuid, p_before_id uuid,
  p_actor uuid, p_revision bigint, p_accept boolean, p_preview_hash text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_changed boolean; v_hash text; v_count integer;
begin
  with before_acl as (select * from private.subtree_acl(p_scope, null, null, false)),
    after_acl as (select * from private.subtree_acl(p_scope, p_page_id, p_parent_id, true)),
    compared as (
      select b.page_id, b.user_id, b.capability as before_role, a.capability as after_role
      from before_acl b join after_acl a using(page_id, user_id)
    )
  select bool_or(before_role <> after_role),
    encode(extensions.digest(convert_to(jsonb_build_object('actor',p_actor,'page',p_page_id,'revision',p_revision,
      'parent',p_parent_id,'before',p_before_id,
      'scopes',(select jsonb_agg(jsonb_build_array(p.id,p.revision,p.deleted_batch_id) order by p.id) from public.pages p where p.id = any(p_scope)),
      'acl',jsonb_agg(jsonb_build_array(page_id,user_id,before_role,after_role) order by page_id,user_id))::text,'UTF8'),'sha256'),'hex')
  into v_changed, v_hash from compared;
  select count(*)::integer into v_count from unnest(p_scope) s(id) where private.page_role_core(s.id,p_actor,true) is not null;
  if coalesce(v_changed,false) then
    if exists (select 1 from unnest(p_scope) s(id) where private.page_role_core(s.id,p_actor,true) is distinct from 'owner') then
      raise exception 'Access changes require administration of every affected page' using errcode = '42501';
    end if;
    if not coalesce(p_accept,false) then
      return jsonb_build_object('requires_confirmation',true,'affected_pages',v_count,'preview_hash',v_hash);
    end if;
    if p_preview_hash is distinct from v_hash then raise exception 'Access preview has changed' using errcode = '40001'; end if;
  end if;
  return jsonb_build_object('requires_confirmation',false,'affected_pages',v_count,'preview_hash',null);
end;
$$;

create function private.position_between(p_after text, p_before text)
returns text language plpgsql immutable set search_path = '' as $$
declare v_alphabet constant text := '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  v_prefix text := ''; v_index integer := 1; v_low integer; v_high integer; v_upper text := p_before;
begin
  if (p_after is not null and p_after !~ '^[A-Za-z0-9]{1,128}$') or (p_before is not null and p_before !~ '^[A-Za-z0-9]{1,128}$')
    or (p_after is not null and p_before is not null and p_after collate "C" >= p_before collate "C") then
    raise exception 'Position interval requires rebalancing' using errcode = '54000';
  end if;
  loop
    if v_index > 128 or (v_upper is not null and v_index > char_length(v_upper)) then
      raise exception 'Position interval requires rebalancing' using errcode = '54000';
    end if;
    v_low := case when p_after is null or v_index > char_length(p_after) then 0 else strpos(v_alphabet,substr(p_after,v_index,1))-1 end;
    v_high := case when v_upper is null then 61 else strpos(v_alphabet,substr(v_upper,v_index,1))-1 end;
    if v_high-v_low > 1 then return v_prefix || substr(v_alphabet, (v_low+v_high)/2+1,1); end if;
    v_prefix := v_prefix || substr(v_alphabet,v_low+1,1);
    if v_low < v_high then v_upper := null; end if;
    v_index := v_index+1;
  end loop;
end;
$$;

create function private.rebalance_page_positions(p_workspace_id uuid, p_parent_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_row record; v_number numeric; v_key text; v_digit integer;
  v_alphabet constant text := '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
begin
  for v_row in select p.id, row_number() over(order by p.position collate "C",p.id) as ordinal
    from public.pages p where p.workspace_id = p_workspace_id and p.parent_id is not distinct from p_parent_id and p.deleted_at is null
  loop
    v_number := v_row.ordinal::numeric * 1024; v_key := '';
    for v_digit in 1..12 loop
      v_key := substr(v_alphabet,mod(v_number,62)::integer+1,1)||v_key;
      v_number := trunc(v_number/62);
    end loop;
    if v_number > 0 then raise exception 'Sibling position capacity exceeded' using errcode = '54000'; end if;
    update public.pages set position = v_key||'V', revision = revision+1, updated_at = clock_timestamp() where id = v_row.id;
  end loop;
end;
$$;

create function private.allocate_page_position(p_workspace_id uuid, p_parent_id uuid, p_before_id uuid, p_exclude_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare v_before text; v_after text; v_attempt integer;
begin
  for v_attempt in 1..2 loop
    v_before := null; v_after := null;
    if p_before_id is not null then
      select p.position into v_before from public.pages p where p.id = p_before_id and p.workspace_id = p_workspace_id
        and p.parent_id is not distinct from p_parent_id and p.deleted_at is null and p.id is distinct from p_exclude_id;
      if not found then raise exception 'Sibling destination unavailable' using errcode = '22023'; end if;
      select p.position into v_after from public.pages p where p.workspace_id = p_workspace_id and p.parent_id is not distinct from p_parent_id
        and p.deleted_at is null and p.id is distinct from p_exclude_id
        and (p.position collate "C",p.id) < (v_before collate "C",p_before_id)
        order by p.position collate "C" desc,p.id desc limit 1;
    else
      select p.position into v_after from public.pages p where p.workspace_id = p_workspace_id and p.parent_id is not distinct from p_parent_id
        and p.deleted_at is null and p.id is distinct from p_exclude_id order by p.position collate "C" desc,p.id desc limit 1;
    end if;
    begin return private.position_between(v_after,v_before);
    exception when program_limit_exceeded then
      if v_attempt = 2 then raise; end if;
      perform private.rebalance_page_positions(p_workspace_id,p_parent_id);
    end;
  end loop;
  raise exception 'Position allocation failed' using errcode = '54000';
end;
$$;

create function public.get_page_role(p_page_id uuid)
returns text language sql stable security definer set search_path = '' as $$
  select private.page_role(p_page_id,private.require_confirmed_user());
$$;

create function public.get_page_metadata(p_page_id uuid,p_workspace_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_actor uuid := private.require_confirmed_user(); v_page public.pages%rowtype;
begin
  select * into v_page from public.pages where id=p_page_id and workspace_id=p_workspace_id;
  if not found or private.page_role(p_page_id,v_actor) is null then return null; end if;
  return jsonb_build_object('id',v_page.id,'workspace_id',v_page.workspace_id,'title',v_page.title,'icon',v_page.icon,
    'parent_id',case when private.page_role(v_page.parent_id,v_actor) is not null then v_page.parent_id else null end,
    'position',v_page.position,'revision',v_page.revision,'cover_file_id',to_jsonb(v_page)->'cover_file_id');
end;
$$;

create function public.create_page(p_workspace_id uuid, p_parent_id uuid default null, p_title text default '', p_request_id uuid default gen_random_uuid())
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := private.require_confirmed_user(); v_id uuid; v_hash text; v_existing text; v_position text;
begin
  -- A request is unique per creator, including requests racing across workspaces.
  perform pg_advisory_xact_lock(hashtextextended(v_actor::text||':'||p_request_id::text,0));
  perform 1 from public.workspaces where id = p_workspace_id for update;
  if not private.is_workspace_member(p_workspace_id,v_actor) then raise exception 'Page destination unavailable' using errcode = '42501'; end if;
  if p_title is null or char_length(p_title)>500 or p_request_id is null then raise exception 'Invalid page input' using errcode = '22023'; end if;
  v_hash := encode(extensions.digest(convert_to(jsonb_build_array(p_workspace_id,p_parent_id,p_title)::text,'UTF8'),'sha256'),'hex');
  select p.id,p.request_hash into v_id,v_existing from public.pages p where p.created_by = v_actor and p.request_id = p_request_id;
  if found then
    if v_existing <> v_hash then raise exception 'Idempotency key reused with different input' using errcode = '22023'; end if;
    if private.page_role(v_id,v_actor) is null then raise exception 'Page unavailable' using errcode = '42501'; end if;
    return v_id;
  end if;
  if p_parent_id is not null and not exists(select 1 from public.pages p where p.id = p_parent_id and p.workspace_id = p_workspace_id
    and private.page_role(p.id,v_actor) in ('owner','editor')) then raise exception 'Page destination unavailable' using errcode = '42501'; end if;
  v_position := private.allocate_page_position(p_workspace_id,p_parent_id,null,null);
  insert into public.pages(workspace_id,parent_id,title,position,owner_id,created_by,request_id,request_hash,restricted)
    values(p_workspace_id,p_parent_id,p_title,v_position,v_actor,v_actor,p_request_id,v_hash,p_parent_id is null) returning id into v_id;
  -- The content provider initializes the stable-block Yjs document in M3.
  return v_id;
end;
$$;

create function public.update_page(p_page_id uuid, p_expected_revision bigint, p_patch jsonb)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := private.require_confirmed_user(); v_page public.pages%rowtype; v_revision bigint;
begin
  select * into v_page from public.pages where id = p_page_id;
  perform 1 from public.workspaces where id = v_page.workspace_id for update;
  select * into v_page from public.pages where id = p_page_id for update;
  if private.page_role(p_page_id,v_actor) not in ('owner','editor') or private.page_role(p_page_id,v_actor) is null then
    raise exception 'Page unavailable for editing' using errcode = '42501'; end if;
  if p_expected_revision is null or p_expected_revision <> v_page.revision then raise exception 'Page revision conflict' using errcode = '40001'; end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or not(p_patch ?| array['title','icon'])
    or exists(select 1 from jsonb_object_keys(p_patch) k where k not in ('title','icon'))
    or (p_patch ? 'title' and (jsonb_typeof(p_patch->'title') <> 'string' or char_length(p_patch->>'title')>500))
    or (p_patch ? 'icon' and (jsonb_typeof(p_patch->'icon') <> 'string' or char_length(p_patch->>'icon')>16 or p_patch->>'icon' ~ '[[:cntrl:]<>]')) then
    raise exception 'Invalid metadata patch' using errcode = '22023';
  end if;
  update public.pages set title = case when p_patch ? 'title' then p_patch->>'title' else title end,
    icon = case when p_patch ? 'icon' then p_patch->>'icon' else icon end, revision = revision+1,updated_at = clock_timestamp()
    where id = p_page_id returning revision into v_revision;
  return v_revision;
end;
$$;

create function public.move_page(p_page_id uuid, p_parent_id uuid default null, p_before_id uuid default null, p_expected_revision bigint default null,
  p_accept_acl_change boolean default false, p_preview_hash text default null,p_keep_parent boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := private.require_confirmed_user(); v_page public.pages%rowtype; v_scope uuid[]; v_check jsonb; v_position text;
begin
  select * into v_page from public.pages where id = p_page_id;
  perform 1 from public.workspaces where id = v_page.workspace_id for update;
  select * into v_page from public.pages where id = p_page_id for update;
  if private.page_role(p_page_id,v_actor) is null or private.page_role(p_page_id,v_actor) not in ('owner','editor') then
    raise exception 'Page unavailable for moving' using errcode = '42501'; end if;
  if p_expected_revision is null or p_expected_revision <> v_page.revision then raise exception 'Page revision conflict' using errcode = '40001'; end if;
  if p_keep_parent is null then raise exception 'Invalid move mode' using errcode = '22023'; end if;
  if p_keep_parent then p_parent_id := v_page.parent_id; end if;
  select array_agg(s.id) into v_scope from private.page_subtree(p_page_id) s;
  if p_parent_id = any(v_scope) then raise exception 'Page cycle detected' using errcode = '23514'; end if;
  if p_parent_id is not null and not exists(select 1 from public.pages p where p.id = p_parent_id and p.workspace_id = v_page.workspace_id
    and p.deleted_at is null and (p_keep_parent or private.page_role(p.id,v_actor) in ('owner','editor'))) then
    raise exception 'Page destination unavailable' using errcode = '42501'; end if;
  if p_before_id is not null and p_before_id <> p_page_id and not exists(select 1 from public.pages p where p.id = p_before_id
    and p.workspace_id = v_page.workspace_id and p.parent_id is not distinct from p_parent_id and private.page_role(p.id,v_actor) is not null) then
    raise exception 'Sibling destination unavailable' using errcode = '42501'; end if;
  if p_before_id = p_page_id then
    if v_page.parent_id is distinct from p_parent_id then raise exception 'Invalid self anchor' using errcode = '22023'; end if;
    return jsonb_build_object('moved',false,'requires_confirmation',false,'affected_pages',0,'preview_hash',null);
  end if;
  v_check := private.acl_move_check(v_scope,p_page_id,p_parent_id,p_before_id,v_actor,v_page.revision,p_accept_acl_change,p_preview_hash);
  if (v_check->>'requires_confirmation')::boolean then return v_check||jsonb_build_object('moved',false); end if;
  v_position := private.allocate_page_position(v_page.workspace_id,p_parent_id,p_before_id,p_page_id);
  update public.pages set parent_id = p_parent_id,position = v_position,revision = revision+1,updated_at = clock_timestamp() where id = p_page_id;
  return v_check||jsonb_build_object('moved',true);
end;
$$;

create function public.remove_page(p_page_id uuid, p_expected_revision bigint)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := private.require_confirmed_user(); v_page public.pages%rowtype; v_scope uuid[]; v_batch uuid := gen_random_uuid();
begin
  select * into v_page from public.pages where id = p_page_id;
  perform 1 from public.workspaces where id = v_page.workspace_id for update;
  select * into v_page from public.pages where id = p_page_id for update;
  if private.page_role(p_page_id,v_actor) is null or private.page_role(p_page_id,v_actor) not in ('owner','editor') then
    raise exception 'Page unavailable for removal' using errcode = '42501'; end if;
  if p_expected_revision is null or p_expected_revision <> v_page.revision then raise exception 'Page revision conflict' using errcode = '40001'; end if;
  with recursive active_subtree as (
    select p.id,p.workspace_id from public.pages p where p.id = p_page_id and p.deleted_at is null
    union all
    select p.id,p.workspace_id from active_subtree d join public.pages p on p.parent_id = d.id and p.workspace_id = d.workspace_id
      where p.deleted_at is null
  ) select array_agg(s.id) into v_scope from active_subtree s;
  if exists(select 1 from unnest(v_scope) s(id) where coalesce(private.page_role(s.id,v_actor),'') not in ('owner','editor')) then
    raise exception 'Removal requires editing every affected page' using errcode = '42501'; end if;
  update public.pages set deleted_at = clock_timestamp(),deleted_batch_id = v_batch,deleted_by = v_actor,
    deleted_parent_id = parent_id,deleted_position = position,revision = revision+1,updated_at = clock_timestamp() where id = any(v_scope);
  return v_batch;
end;
$$;

create function public.restore_page(p_page_id uuid, p_parent_id uuid default null, p_restore_original boolean default true,
  p_accept_acl_change boolean default false, p_preview_hash text default null, p_expected_revision bigint default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := private.require_confirmed_user(); v_page public.pages%rowtype; v_parent uuid; v_scope uuid[]; v_all_scope uuid[]; v_check jsonb; v_position text;
begin
  select * into v_page from public.pages where id = p_page_id;
  perform 1 from public.workspaces where id = v_page.workspace_id for update;
  select * into v_page from public.pages where id = p_page_id for update;
  if v_page.deleted_at is null or coalesce(private.page_role_core(p_page_id,v_actor,true),'') not in ('owner','editor') then
    raise exception 'Page unavailable for restoration' using errcode = '42501'; end if;
  if p_expected_revision is null or p_expected_revision <> v_page.revision then raise exception 'Page revision conflict' using errcode = '40001'; end if;
  if p_restore_original is null or (p_restore_original and p_parent_id is not null) then raise exception 'Invalid restore destination' using errcode = '22023'; end if;
  v_parent := case when p_restore_original then
    case when v_page.deleted_batch_id is null then v_page.parent_id else v_page.deleted_parent_id end else p_parent_id end;
  select array_agg(s.id) into v_all_scope from private.page_subtree(p_page_id) s;
  if v_parent = any(v_all_scope) then raise exception 'Page cycle detected' using errcode = '23514'; end if;
  if v_parent is not null and not exists(select 1 from public.pages p where p.id = v_parent and p.workspace_id = v_page.workspace_id
    and private.page_role(p.id,v_actor) in ('owner','editor')) then raise exception 'Choose an available restore destination' using errcode = '22023'; end if;
  select array_agg(s.id) into v_scope from private.page_subtree(p_page_id) s join public.pages p on p.id = s.id
    where p.deleted_batch_id = v_page.deleted_batch_id and p.deleted_at is not null;
  -- Legacy tombstones remain restorable as single pages; they have no batch.
  if v_scope is null then v_scope := array[p_page_id]; end if;
  if exists(select 1 from unnest(v_scope) s(id) where coalesce(private.page_role_core(s.id,v_actor,true),'') not in ('owner','editor')) then
    raise exception 'Restoration requires editing every affected page' using errcode = '42501'; end if;
  v_check := private.acl_move_check(v_all_scope,p_page_id,v_parent,null,v_actor,v_page.revision,p_accept_acl_change,p_preview_hash);
  v_check := v_check||jsonb_build_object('affected_pages',cardinality(v_scope),'page_id',p_page_id);
  if (v_check->>'requires_confirmation')::boolean then return v_check||jsonb_build_object('restored',false); end if;
  if v_page.parent_id is not distinct from v_parent and v_page.deleted_position is not null
    and not exists(select 1 from public.pages p where p.workspace_id = v_page.workspace_id and p.parent_id is not distinct from v_parent
      and p.deleted_at is null and p.position = v_page.deleted_position) then
    v_position := v_page.deleted_position;
  else
    v_position := private.allocate_page_position(v_page.workspace_id,v_parent,null,p_page_id);
  end if;
  update public.pages set parent_id = v_parent,position = v_position where id = p_page_id;
  update public.pages set deleted_at = null,deleted_batch_id = null,deleted_by = null,deleted_parent_id = null,deleted_position = null,
    revision = revision+1,updated_at = clock_timestamp() where id = any(v_scope);
  return v_check||jsonb_build_object('restored',true);
end;
$$;

create table public.page_favorites (
  workspace_id uuid not null,
  user_id uuid not null,
  page_id uuid not null,
  created_at timestamptz not null default now(),
  primary key(user_id,page_id),
  foreign key(page_id,workspace_id) references public.pages(id,workspace_id) on delete cascade,
  foreign key(workspace_id,user_id) references public.workspace_members(workspace_id,user_id) on delete cascade
);
create index page_favorites_workspace_idx on public.page_favorites(workspace_id,user_id,created_at,page_id);
alter table public.page_favorites enable row level security;
create policy favorites_read_own on public.page_favorites for select to authenticated
  using(user_id = auth.uid() and private.page_role(page_id,auth.uid()) is not null);
revoke all on public.page_favorites from public,anon,authenticated;
grant select on public.page_favorites to authenticated;
grant all on public.page_favorites to service_role;

create function public.toggle_page_favorite(p_page_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := private.require_confirmed_user(); v_workspace uuid;
begin
  select workspace_id into v_workspace from public.pages where id = p_page_id;
  perform 1 from public.workspaces where id = v_workspace for update;
  if private.page_role(p_page_id,v_actor) is null then raise exception 'Page unavailable' using errcode = '42501'; end if;
  delete from public.page_favorites where user_id = v_actor and page_id = p_page_id;
  if found then return false; end if;
  insert into public.page_favorites(workspace_id,user_id,page_id) values(v_workspace,v_actor,p_page_id);
  return true;
end;
$$;

create function public.list_page_children(p_workspace_id uuid, p_parent_id uuid default null,
  p_after_position text default null, p_after_id uuid default null)
returns table(id uuid,title text,icon text,parent_id uuid,"position" text,revision bigint)
language plpgsql stable security definer set search_path = '' as $$
declare v_actor uuid := private.require_confirmed_user();
begin
  if (p_after_position is null) <> (p_after_id is null) or (p_after_position is not null and p_after_position !~ '^[A-Za-z0-9]{1,128}$') then
    raise exception 'Invalid children cursor' using errcode = '22023'; end if;
  if not private.is_workspace_member(p_workspace_id,v_actor) then return; end if;
  return query with visible as materialized(select * from private.visible_page_scope(p_workspace_id,v_actor))
    select p.id,p.title,p.icon,case when parent.page_id is not null then p.parent_id else null end,p.position,p.revision
    from visible v join public.pages p on p.id=v.page_id left join visible parent on parent.page_id=p.parent_id
    where p.workspace_id = p_workspace_id and p.deleted_at is null
    and ((p_parent_id is not null and p.parent_id = p_parent_id and parent.page_id is not null) or
      (p_parent_id is null and parent.page_id is null))
    and (p_after_position is null or (p.position collate "C",p.id) > (p_after_position collate "C",p_after_id))
    order by p.position collate "C",p.id limit 51;
end;
$$;

create function public.list_page_breadcrumbs(p_page_id uuid,p_after_depth integer default -1)
returns table(id uuid,title text,depth integer) language plpgsql stable security definer set search_path = '' as $$
declare v_actor uuid := private.require_confirmed_user(); v_workspace_owner boolean;
begin
  if p_after_depth is null or p_after_depth < -1 then raise exception 'Invalid breadcrumb cursor' using errcode = '22023'; end if;
  if private.page_role(p_page_id,v_actor) is null then return; end if;
  select private.is_workspace_owner(p.workspace_id,v_actor) into v_workspace_owner from public.pages p where p.id = p_page_id;
  return query with recursive ancestors as (
    select p.id,p.parent_id,p.title,p.owner_id,p.restricted,0 as depth from public.pages p where p.id = p_page_id
    union all select p.id,p.parent_id,p.title,p.owner_id,p.restricted,a.depth+1 from ancestors a
      join lateral(select p.* from public.pages p where p.id = a.parent_id offset 0) p on true
  ), boundaries as (
    select a.*,coalesce(min(a.depth) filter(where a.restricted)
      over(order by a.depth rows between current row and unbounded following),2147483647) as stop_depth from ancestors a
  ), grants as (
    select a.depth from ancestors a left join public.page_grants g on g.page_id = a.id and g.user_id = v_actor
      where a.owner_id = v_actor or g.role is not null
  ), visible as (
    select a.id,a.title,(row_number() over(order by a.depth)-1)::integer as visible_depth from boundaries a
      where v_workspace_owner or exists(select 1 from grants g where g.depth between a.depth and a.stop_depth)
  ) select a.id,a.title,a.visible_depth from visible a where a.visible_depth > p_after_depth
    order by a.visible_depth limit 51;
end;
$$;

create function public.list_trash(p_workspace_id uuid,p_after_id uuid default null,p_query text default '')
returns table(id uuid,title text,parent_id uuid,deleted_at timestamptz,revision bigint)
language plpgsql stable security definer set search_path = '' as $$
declare v_actor uuid := private.require_confirmed_user(); v_term text := btrim(p_query); v_query tsquery;
begin
  if p_query is null or char_length(p_query)>500 then raise exception 'Invalid trash search query' using errcode = '22023'; end if;
  if not private.is_workspace_member(p_workspace_id,v_actor) then return; end if;
  if v_term <> '' then
    v_query := plainto_tsquery('pg_catalog.portuguese',v_term) || plainto_tsquery('pg_catalog.english',v_term)
      || plainto_tsquery('pg_catalog.portuguese',extensions.unaccent(v_term)) || plainto_tsquery('pg_catalog.english',extensions.unaccent(v_term));
  end if;
  return query select p.id,p.title,
    case when private.page_role(p.parent_id,v_actor) is not null then p.parent_id else null end,p.deleted_at,p.revision from public.pages p
    where p.workspace_id = p_workspace_id and p.deleted_at is not null
    and private.page_role_core(p.id,v_actor,true) in ('owner','editor')
    and (p_after_id is null or p.id > p_after_id)
    and (v_term = '' or p.search_vector @@ v_query)
    and (v_term <> '' or not exists(select 1 from public.pages parent where parent.id = p.parent_id and parent.deleted_at is not null
      and parent.deleted_batch_id = p.deleted_batch_id and private.page_role_core(parent.id,v_actor,true) in ('owner','editor')))
    order by p.id limit 51;
end;
$$;

create function public.search_pages(p_workspace_id uuid,p_query text,p_after_rank real default null,
  p_after_id uuid default null,p_after_updated_at timestamptz default null)
returns table(id uuid,title text,icon text,rank real,updated_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare v_actor uuid := private.require_confirmed_user(); v_query tsquery; v_term text := btrim(p_query);
begin
  if p_query is null or char_length(p_query)>500 then raise exception 'Invalid search query' using errcode = '22023'; end if;
  if v_term = '' then
    if p_after_rank is not null or (p_after_updated_at is null) <> (p_after_id is null) then raise exception 'Invalid recent cursor' using errcode = '22023'; end if;
  elsif p_after_updated_at is not null or (p_after_rank is null) <> (p_after_id is null) or p_after_rank < 0 or p_after_rank = 'NaN'::real then
    raise exception 'Invalid search cursor' using errcode = '22023';
  end if;
  if not private.is_workspace_member(p_workspace_id,v_actor) then return; end if;
  if v_term = '' then
    return query with visible as materialized(select * from private.visible_page_scope(p_workspace_id,v_actor))
      select p.id,p.title,p.icon,0::real,p.updated_at from public.pages p join visible v on v.page_id=p.id
      where p.workspace_id = p_workspace_id and p.deleted_at is null
      and (p_after_updated_at is null or p.updated_at < p_after_updated_at or (p.updated_at = p_after_updated_at and p.id > p_after_id))
      order by p.updated_at desc,p.id limit 51;
  else
    v_query := plainto_tsquery('pg_catalog.portuguese',v_term) || plainto_tsquery('pg_catalog.english',v_term)
      || plainto_tsquery('pg_catalog.portuguese',extensions.unaccent(v_term)) || plainto_tsquery('pg_catalog.english',extensions.unaccent(v_term));
    return query with visible as materialized(select * from private.visible_page_scope(p_workspace_id,v_actor)), matches as (
      select p.id,p.title,p.icon,ts_rank(p.search_vector,v_query)::real as rank,p.updated_at from public.pages p
      join visible v on v.page_id=p.id
      where p.workspace_id = p_workspace_id and p.deleted_at is null and p.search_vector @@ v_query
    ) select m.id,m.title,m.icon,m.rank,m.updated_at from matches m
      where p_after_rank is null or m.rank < p_after_rank or (m.rank = p_after_rank and m.id > p_after_id)
      order by m.rank desc,m.id limit 51;
  end if;
end;
$$;

revoke all on function private.lock_acl_workspace(),private.lock_new_workspace_member(),private.page_role_core(uuid,uuid,boolean),private.visible_page_scope(uuid,uuid), private.index_page_title(),private.page_subtree(uuid),
  private.subtree_acl(uuid[],uuid,uuid,boolean),private.acl_move_check(uuid[],uuid,uuid,uuid,uuid,bigint,boolean,text),
  private.position_between(text,text),private.rebalance_page_positions(uuid,uuid),private.allocate_page_position(uuid,uuid,uuid,uuid)
  from public,anon,authenticated;
-- Column privileges apply even when a caller bypasses the UI and queries Data API.
revoke select on public.pages from authenticated;
grant select(id,workspace_id,title,icon,position,revision,owner_id,restricted,deleted_at,created_at,updated_at,created_by)
  on public.pages to authenticated;

revoke all on function public.get_page_role(uuid),public.get_page_metadata(uuid,uuid),public.create_page(uuid,uuid,text,uuid),public.update_page(uuid,bigint,jsonb),
  public.move_page(uuid,uuid,uuid,bigint,boolean,text,boolean),public.remove_page(uuid,bigint),public.restore_page(uuid,uuid,boolean,boolean,text,bigint),
  public.toggle_page_favorite(uuid),public.list_page_children(uuid,uuid,text,uuid),public.list_page_breadcrumbs(uuid,integer),
  public.list_trash(uuid,uuid,text),public.search_pages(uuid,text,real,uuid,timestamptz) from public,anon;
grant execute on function public.get_page_role(uuid),public.get_page_metadata(uuid,uuid),public.create_page(uuid,uuid,text,uuid),public.update_page(uuid,bigint,jsonb),
  public.move_page(uuid,uuid,uuid,bigint,boolean,text,boolean),public.remove_page(uuid,bigint),public.restore_page(uuid,uuid,boolean,boolean,text,bigint),
  public.toggle_page_favorite(uuid),public.list_page_children(uuid,uuid,text,uuid),public.list_page_breadcrumbs(uuid,integer),
  public.list_trash(uuid,uuid,text),public.search_pages(uuid,text,real,uuid,timestamptz) to authenticated;
