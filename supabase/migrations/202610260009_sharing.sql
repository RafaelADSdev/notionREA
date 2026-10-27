-- Sharing uses the same workspace serialization lock as hierarchy, grants and leases.
alter table public.pages add column workspace_role text
  check(workspace_role in ('viewer','commenter','editor'));
create trigger lock_page_workspace_role_workspace before update of workspace_role on public.pages
  for each row execute function private.guard_page_structure();

create or replace function private.page_role_core(p_page_id uuid,p_user_id uuid,p_ignore_deleted boolean)
returns text language sql stable security definer set search_path='' as $$
  with recursive ancestors as (
    select p.id,p.parent_id,p.workspace_id,p.owner_id,p.restricted,p.workspace_role,p.deleted_at,true inherits
    from public.pages p where p.id=p_page_id
    union all select p.id,p.parent_id,p.workspace_id,p.owner_id,p.restricted,p.workspace_role,p.deleted_at,a.inherits and not a.restricted
    from ancestors a join lateral(select p.* from public.pages p where p.id=a.parent_id and p.workspace_id=a.workspace_id offset 0) p on true
  ), capabilities as (
    select max(case when m.role='owner' then 4 when a.inherits and a.owner_id=p_user_id then 4
      when a.inherits then greatest(case g.role when 'owner' then 4 when 'editor' then 3 when 'commenter' then 2 when 'viewer' then 1 else 0 end,
        case a.workspace_role when 'editor' then 3 when 'commenter' then 2 when 'viewer' then 1 else 0 end) else 0 end) rank,
      bool_or(a.deleted_at is not null) deleted
    from ancestors a join public.workspace_members m on m.workspace_id=a.workspace_id and m.user_id=p_user_id
    left join public.page_grants g on g.page_id=a.id and g.user_id=p_user_id
  ) select case when not p_ignore_deleted and deleted then null else case rank when 4 then 'owner' when 3 then 'editor' when 2 then 'commenter' when 1 then 'viewer' end end from capabilities;
$$;
create or replace function private.visible_page_scope(p_workspace_id uuid,p_user_id uuid)
returns table(page_id uuid,parent_id uuid,capability integer)
language sql stable security definer set search_path='' as $$
  with recursive member as materialized(select role from public.workspace_members where workspace_id=p_workspace_id and user_id=p_user_id),
  nodes as materialized (
    select p.id,p.parent_id,p.restricted,case when m.role='owner' or p.owner_id=p_user_id then 4
      else greatest(case g.role when 'owner' then 4 when 'editor' then 3 when 'commenter' then 2 when 'viewer' then 1 else 0 end,
        case p.workspace_role when 'editor' then 3 when 'commenter' then 2 when 'viewer' then 1 else 0 end) end direct_rank
    from public.pages p cross join member m left join public.page_grants g on g.page_id=p.id and g.user_id=p_user_id
    where p.workspace_id=p_workspace_id and p.deleted_at is null
  ), tree as (
    select n.id,n.parent_id,n.direct_rank capability from nodes n where n.parent_id is null
    union all select n.id,n.parent_id,case when n.restricted then n.direct_rank else greatest(n.direct_rank,t.capability) end
    from tree t join nodes n on n.parent_id=t.id
  ) select t.id,t.parent_id,t.capability from tree t where t.capability>0;
$$;
create or replace function private.subtree_acl(p_scope uuid[],p_override_page uuid,p_override_parent uuid,p_override boolean)
returns table(page_id uuid,user_id uuid,capability integer)
language sql stable security definer set search_path='' as $$
  with recursive ancestors as (
    select p.id scope_id,p.id,case when p_override and p.id=p_override_page then p_override_parent else p.parent_id end parent_id,
      p.workspace_id,p.owner_id,p.restricted,p.workspace_role,true inherits from public.pages p where p.id=any(p_scope)
    union all select a.scope_id,p.id,case when p_override and p.id=p_override_page then p_override_parent else p.parent_id end,
      p.workspace_id,p.owner_id,p.restricted,p.workspace_role,a.inherits and not a.restricted
    from ancestors a join lateral(select p.* from public.pages p where p.id=a.parent_id and p.workspace_id=a.workspace_id offset 0) p on true
  ) select a.scope_id,m.user_id,max(case when m.role='owner' then 4 when a.inherits and a.owner_id=m.user_id then 4
      when a.inherits then greatest(case g.role when 'owner' then 4 when 'editor' then 3 when 'commenter' then 2 when 'viewer' then 1 else 0 end,
        case a.workspace_role when 'editor' then 3 when 'commenter' then 2 when 'viewer' then 1 else 0 end) else 0 end)::integer
  from ancestors a join public.workspace_members m on m.workspace_id=a.workspace_id
  left join public.page_grants g on g.page_id=a.id and g.user_id=m.user_id group by a.scope_id,m.user_id;
$$;
-- Breadcrumb ordinals count visible ancestors only, including workspace defaults.
create or replace function public.list_page_breadcrumbs(p_page_id uuid,p_after_depth integer default -1)
returns table(id uuid,title text,depth integer) language plpgsql stable security definer set search_path='' as $$
declare v_actor uuid:=private.require_confirmed_user();v_workspace uuid;
begin
  if p_after_depth is null or p_after_depth < -1 then raise exception 'Invalid breadcrumb cursor' using errcode='22023'; end if;
  if private.page_role(p_page_id,v_actor) is null then return; end if;
  select workspace_id into v_workspace from public.pages where pages.id=p_page_id;
  return query with recursive ancestors as (
    select p.id,p.parent_id,p.title,0 actual_depth from public.pages p where p.id=p_page_id
    union all select p.id,p.parent_id,p.title,a.actual_depth+1 from ancestors a join public.pages p on p.id=a.parent_id and p.workspace_id=v_workspace
  ), visible as materialized(select page_id from private.visible_page_scope(v_workspace,v_actor)), numbered as (
    select a.id,a.title,(row_number() over(order by a.actual_depth)-1)::integer visible_depth
    from ancestors a join visible v on v.page_id=a.id
  ) select n.id,n.title,n.visible_depth from numbered n where n.visible_depth>p_after_depth order by n.visible_depth limit 51;
end;
$$;

create table public.page_publications (
  page_id uuid primary key,workspace_id uuid not null,token text not null unique check(token~'^[0-9a-f]{64}$'),
  fields uuid[] not null default '{}' check(cardinality(fields)<=100),revision bigint not null default 0 check(revision>=0),
  created_by uuid not null references auth.users(id),created_at timestamptz not null default clock_timestamp(),revoked_at timestamptz,
  foreign key(page_id,workspace_id) references public.pages(id,workspace_id) on delete cascade
);
create table public.sharing_audit (
  id uuid primary key default gen_random_uuid(),workspace_id uuid not null,page_id uuid not null,actor_id uuid not null references auth.users(id),
  action text not null check(action in ('sharing','publish','revoke','rotate')),result text not null check(result='accepted'),
  created_at timestamptz not null default clock_timestamp(),
  foreign key(page_id,workspace_id) references public.pages(id,workspace_id) on delete cascade
);
create index sharing_audit_page_idx on public.sharing_audit(page_id,created_at desc,id);
alter table public.page_publications enable row level security;
alter table public.sharing_audit enable row level security;
create policy publication_owner_read on public.page_publications for select to authenticated using(private.page_role(page_id,(select auth.uid()))='owner');
create policy sharing_audit_owner_read on public.sharing_audit for select to authenticated using(private.page_role(page_id,(select auth.uid()))='owner');
revoke all on public.page_publications,public.sharing_audit from public,anon,authenticated;
grant select on public.page_publications,public.sharing_audit to authenticated;
grant all on public.page_publications,public.sharing_audit to service_role;

create function private.sharing_member_label(p_user_id uuid)
returns text language sql stable security definer set search_path='' as $$
  select case when n.name='' or position('@' in n.name)>0 then 'Membro' else n.name end from auth.users u
  cross join lateral(select left(regexp_replace(btrim(coalesce(nullif(u.raw_user_meta_data->>'display_name',''),u.raw_user_meta_data->>'name','')),'[[:cntrl:]]','','g'),120) name) n where u.id=p_user_id;
$$;
create function public.get_page_sharing(p_page_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_actor uuid:=private.require_confirmed_user();v_page public.pages;v_grants jsonb;v_publication jsonb;
begin
  if private.page_role(p_page_id,v_actor) is distinct from 'owner' then raise exception 'Page unavailable' using errcode='42501'; end if;
  select * into strict v_page from public.pages where id=p_page_id;
  select coalesce(jsonb_agg(jsonb_build_object('userId',g.user_id,'label',private.sharing_member_label(g.user_id),'role',g.role) order by g.user_id),'[]') into v_grants
    from public.page_grants g where g.page_id=p_page_id;
  select jsonb_build_object('token',p.token,'fields',p.fields,'revision',p.revision) into v_publication from public.page_publications p where p.page_id=p_page_id and p.revoked_at is null;
  return jsonb_build_object('revision',v_page.revision,'ownerId',v_page.owner_id,'restricted',v_page.restricted,'workspaceRole',v_page.workspace_role,'grants',v_grants,'publication',v_publication);
end;
$$;
create function public.list_page_sharing_targets(p_page_id uuid,p_after_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_actor uuid:=private.require_confirmed_user();v_workspace uuid;v_items jsonb;v_next uuid;
begin
  if private.page_role(p_page_id,v_actor) is distinct from 'owner' then raise exception 'Page unavailable' using errcode='42501'; end if;
  select workspace_id into v_workspace from public.pages where id=p_page_id;
  with candidates as materialized(select m.user_id,private.sharing_member_label(m.user_id) label from public.workspace_members m
    where m.workspace_id=v_workspace and (p_after_id is null or m.user_id>p_after_id) order by m.user_id limit 51),
  shown as(select * from candidates order by user_id limit 50)
  select coalesce((select jsonb_agg(jsonb_build_object('userId',user_id,'label',label) order by user_id) from shown),'[]'),
    case when (select count(*) from candidates)>50 then (select user_id from shown order by user_id desc limit 1) end into v_items,v_next;
  return jsonb_build_object('items',v_items,'nextCursor',v_next);
end;
$$;
create function private.sharing_patch_acl(p_scope uuid[],p_page_id uuid,p_restricted boolean,p_workspace_role text,p_grants jsonb,p_owner_id uuid)
returns table(page_id uuid,user_id uuid,capability integer)
language sql stable security definer set search_path='' as $$
  with recursive nodes as materialized(
    select p.id,p.parent_id,p.workspace_id,case when p.id=p_page_id then p_owner_id else p.owner_id end owner_id,
      case when p.id=p_page_id then p_restricted else p.restricted end restricted,
      case when p.id=p_page_id then p_workspace_role else p.workspace_role end workspace_role from public.pages p
    where p.workspace_id=(select workspace_id from public.pages where id=p_page_id)
  ), ancestors as (
    select n.id scope_id,n.*,true inherits from nodes n where n.id=any(p_scope)
    union all select a.scope_id,n.*,a.inherits and not a.restricted from ancestors a join nodes n on n.id=a.parent_id
  ), grants as (
    select g.page_id,g.user_id,g.role from public.page_grants g where g.page_id<>p_page_id
    union all select p_page_id,(value->>'userId')::uuid,value->>'role' from jsonb_array_elements(p_grants)
  ) select a.scope_id,m.user_id,max(case when m.role='owner' then 4 when a.inherits and a.owner_id=m.user_id then 4
      when a.inherits then greatest(case g.role when 'owner' then 4 when 'editor' then 3 when 'commenter' then 2 when 'viewer' then 1 else 0 end,
        case a.workspace_role when 'editor' then 3 when 'commenter' then 2 when 'viewer' then 1 else 0 end) else 0 end)::integer
    from ancestors a join public.workspace_members m on m.workspace_id=a.workspace_id
    left join grants g on g.page_id=a.id and g.user_id=m.user_id group by a.scope_id,m.user_id;
$$;
create function public.configure_page_sharing(p_page_id uuid,p_expected_revision bigint,p_restricted boolean default true,p_workspace_role text default null,
  p_grants jsonb default '[]',p_owner_id uuid default null,p_confirm boolean default false,p_preview_token text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=private.require_confirmed_user();v_page public.pages;v_owner uuid;v_scope uuid[];v_changed uuid[];v_grant jsonb;
  v_grants jsonb;v_before jsonb;v_after jsonb;v_hash text;v_old_grants jsonb;
begin
  select * into v_page from public.pages where id=p_page_id;
  perform 1 from public.workspaces where id=v_page.workspace_id for update;
  select * into v_page from public.pages where id=p_page_id for update;
  if private.page_role(p_page_id,v_actor) is distinct from 'owner' then raise exception 'Page unavailable' using errcode='42501'; end if;
  if p_expected_revision is distinct from v_page.revision then raise exception 'Page revision conflict' using errcode='40001'; end if;
  if p_restricted is null or (p_workspace_role is not null and p_workspace_role not in ('viewer','commenter','editor'))
    or p_grants is null or jsonb_typeof(p_grants)<>'array' or jsonb_array_length(p_grants)>100 or octet_length(p_grants::text)>32768 then
    raise exception 'Invalid sharing patch' using errcode='22023'; end if;
  v_owner:=coalesce(p_owner_id,v_page.owner_id);
  if not private.is_workspace_member(v_page.workspace_id,v_owner) then raise exception 'Owner unavailable' using errcode='42501'; end if;
  for v_grant in select value from jsonb_array_elements(p_grants) loop
    if not private.database_object_keys(v_grant,array['userId','role'],array['userId','role'])
      or not private.database_uuid(v_grant->>'userId') or v_grant->>'role' is null or v_grant->>'role' not in ('owner','editor','commenter','viewer') then
      raise exception 'Invalid page grant' using errcode='22023'; end if;
    if not private.is_workspace_member(v_page.workspace_id,(v_grant->>'userId')::uuid) then raise exception 'Member unavailable' using errcode='42501'; end if;
  end loop;
  if (select count(*)<>count(distinct value->>'userId') from jsonb_array_elements(p_grants)) then raise exception 'Duplicate page grant' using errcode='22023'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('userId',(value->>'userId')::uuid,'role',value->>'role') order by (value->>'userId')::uuid),'[]') into v_grants from jsonb_array_elements(p_grants);
  select coalesce(jsonb_agg(jsonb_build_object('userId',user_id,'role',role) order by user_id),'[]') into v_old_grants from public.page_grants where page_id=p_page_id;
  if (v_owner,p_restricted,p_workspace_role,v_grants) is not distinct from (v_page.owner_id,v_page.restricted,v_page.workspace_role,v_old_grants) then
    return jsonb_build_object('requiresConfirmation',false)||public.get_page_sharing(p_page_id); end if;
  select array_agg(id order by id) into v_scope from private.page_subtree(p_page_id);
  with before_acl as materialized(select * from private.subtree_acl(v_scope,null,null,false)),
    after_acl as materialized(select * from private.sharing_patch_acl(v_scope,p_page_id,p_restricted,p_workspace_role,v_grants,v_owner)),
    compared as(select b.page_id,b.user_id,b.capability before_role,a.capability after_role from before_acl b join after_acl a using(page_id,user_id))
  select array_agg(distinct page_id) filter(where before_role<>after_role),
    jsonb_agg(jsonb_build_array(page_id,user_id,before_role) order by page_id,user_id),
    jsonb_agg(jsonb_build_array(page_id,user_id,after_role) order by page_id,user_id) into v_changed,v_before,v_after from compared;
  if exists(select 1 from unnest(v_changed) s(id) where private.page_role_core(s.id,v_actor,true) is distinct from 'owner') then
    raise exception 'Access changes require administration of every affected page' using errcode='42501'; end if;
  v_hash:=encode(extensions.digest(convert_to(jsonb_build_object('actor',v_actor,'page',p_page_id,'revision',v_page.revision,
    'restricted',p_restricted,'workspaceRole',p_workspace_role,'ownerId',v_owner,'grants',v_grants,'before',v_before,'after',v_after,
    'scope',(select jsonb_agg(jsonb_build_array(p.id,p.revision,p.owner_id,p.restricted,p.workspace_role,p.deleted_at) order by p.id) from public.pages p where p.id=any(v_scope)))::text,'UTF8'),'sha256'),'hex');
  if coalesce(cardinality(v_changed),0)>0 then
    if not coalesce(p_confirm,false) then return jsonb_build_object('requiresConfirmation',true,'affectedPages',cardinality(v_changed),'previewToken',v_hash); end if;
    if p_preview_token is distinct from v_hash then raise exception 'Access preview has changed' using errcode='40001'; end if;
  end if;
  update public.pages set owner_id=v_owner,restricted=p_restricted,workspace_role=p_workspace_role,revision=revision+1 where id=p_page_id;
  delete from public.page_grants g where g.page_id=p_page_id and not exists(select 1 from jsonb_array_elements(v_grants) i where (i->>'userId')::uuid=g.user_id);
  insert into public.page_grants(page_id,workspace_id,user_id,role)
    select p_page_id,v_page.workspace_id,(value->>'userId')::uuid,value->>'role' from jsonb_array_elements(v_grants)
    on conflict(page_id,user_id) do update set role=excluded.role where page_grants.role is distinct from excluded.role;
  insert into public.sharing_audit(workspace_id,page_id,actor_id,action,result) values(v_page.workspace_id,p_page_id,v_actor,'sharing','accepted');
  if private.page_role(p_page_id,v_actor) is distinct from 'owner' then return jsonb_build_object('requiresConfirmation',false,'accessChanged',true); end if;
  return jsonb_build_object('requiresConfirmation',false)||public.get_page_sharing(p_page_id);
end;
$$;

-- Publication is explicit per page, and its author must still be allowed to manage it.
-- The owner membership and full ancestor lifecycle are checked on every public read.
create function private.publication_live(p_page_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.page_publications pub join public.pages p on p.id=pub.page_id and p.workspace_id=pub.workspace_id
    join public.workspace_members m on m.workspace_id=p.workspace_id and m.user_id=p.owner_id
    where p.id=p_page_id and pub.revoked_at is null and p.deleted_at is null
      and private.page_role(p.id,p.owner_id)='owner' and private.page_role(p.id,pub.created_by)='owner');
$$;
create function private.public_file_for_page(p_file_id uuid,p_page_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.page_files f join public.pages p on p.id=f.page_id and p.workspace_id=f.workspace_id
    where f.id=p_file_id and p.id=p_page_id and f.status='ready' and private.publication_live(p.id)
    and ((f.purpose='cover' and p.cover_file_id=f.id) or (f.purpose='block' and exists(select 1 from public.document_heads h
      where h.page_id=p.id and h.workspace_id=p.workspace_id and h.projection->>'schemaVersion'='1'
        and (h.projection @> jsonb_build_object('blocks',jsonb_build_array(jsonb_build_object('type','image','attributes',jsonb_build_object('fileId',f.id))))
          or h.projection @> jsonb_build_object('blocks',jsonb_build_array(jsonb_build_object('type','file','attributes',jsonb_build_object('fileId',f.id)))))))));
$$;
create function private.public_inline(p_content jsonb,p_workspace_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_node jsonb;v_mark jsonb;v_inline jsonb:='[]';v_marks jsonb;v_target_id uuid;v_target_title text;v_target_token text;v_attrs jsonb;
begin
  for v_node in select value from jsonb_array_elements(case when jsonb_typeof(p_content->'content'->0->'content')='array' then p_content->'content'->0->'content' else '[]'::jsonb end) loop
    if v_node->>'type'='pageMention' then
      v_target_id:=null;
      if private.database_uuid(v_node->'attrs'->>'pageId') then
        select p.id,p.title,pub.token into v_target_id,v_target_title,v_target_token from public.pages p join public.page_publications pub on pub.page_id=p.id
          where p.id=(v_node->'attrs'->>'pageId')::uuid and p.workspace_id=p_workspace_id and private.publication_live(p.id);
      end if;
      if v_target_id is not null then v_inline:=v_inline||jsonb_build_array(jsonb_build_object('type','pageMention','attrs',jsonb_build_object('pageId',v_target_id,'title',v_target_title,'token',v_target_token)));
      else v_inline:=v_inline||jsonb_build_array(jsonb_build_object('type','text','text','Conteúdo indisponível')); end if;
    elsif v_node->>'type'='hardBreak' then v_inline:=v_inline||jsonb_build_array(jsonb_build_object('type','hardBreak'));
    elsif v_node->>'type'='text' and jsonb_typeof(v_node->'text')='string' then
      v_marks:='[]';
      for v_mark in select value from jsonb_array_elements(case when jsonb_typeof(v_node->'marks')='array' then v_node->'marks' else '[]'::jsonb end) loop
        if v_mark->>'type' in ('bold','italic','underline','strike','code') then v_marks:=v_marks||jsonb_build_array(jsonb_build_object('type',v_mark->>'type'));
        elsif v_mark->>'type'='link' and char_length(v_mark->'attrs'->>'href')<=4096
          and (v_mark->'attrs'->>'href')~*'^(https?://|mailto:|tel:)' and (v_mark->'attrs'->>'href')!~'[[:cntrl:][:space:]]' then
          v_marks:=v_marks||jsonb_build_array(jsonb_build_object('type','link','attrs',jsonb_build_object('href',v_mark->'attrs'->>'href')));
        elsif v_mark->>'type'='textStyle' then
          v_attrs:='{}';
          if v_mark->'attrs'->>'color' in ('default','indigo','copper','green','red','yellow') then v_attrs:=v_attrs||jsonb_build_object('color',v_mark->'attrs'->>'color'); end if;
          if v_mark->'attrs'->>'background' in ('default','indigo','copper','green','red','yellow') then v_attrs:=v_attrs||jsonb_build_object('background',v_mark->'attrs'->>'background'); end if;
          v_marks:=v_marks||jsonb_build_array(jsonb_build_object('type','textStyle','attrs',v_attrs));
        end if;
      end loop;
      v_inline:=v_inline||jsonb_build_array(jsonb_build_object('type','text','text',v_node->>'text')||case when jsonb_array_length(v_marks)>0 then jsonb_build_object('marks',v_marks) else '{}' end);
    end if;
  end loop;
  return jsonb_build_object('type','doc','content',jsonb_build_array(jsonb_build_object('type','paragraph','content',v_inline)));
end;
$$;
create function private.public_content(p_page_id uuid,p_workspace_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_source jsonb;v_block jsonb;v_blocks jsonb:='[]';v_attrs jsonb;v_key text;v_target record;
begin
  select projection into v_source from public.document_heads where page_id=p_page_id and workspace_id=p_workspace_id;
  if v_source is null or v_source='{}' then return jsonb_build_object('schemaVersion',1,'blocks','[]'::jsonb); end if;
  if v_source->>'schemaVersion' is distinct from '1' or jsonb_typeof(v_source->'blocks') is distinct from 'array' then raise exception 'Published content version unavailable' using errcode='22023'; end if;
  if octet_length(v_source::text)>1048576 then raise exception 'Published page exceeds response limit' using errcode='54000'; end if;
  for v_block in select value from jsonb_array_elements(v_source->'blocks') loop
    if v_block->>'type' not in ('paragraph','heading','bulletListItem','numberListItem','task','toggle','quote','callout','divider','code','image','file','table','tableRow','tableCell','columns','column','databaseRef') then continue; end if;
    v_attrs:='{}';
    for v_key in select unnest(case v_block->>'type' when 'heading' then array['level'] when 'numberListItem' then array['start'] when 'task' then array['checked'] when 'callout' then array['tone'] when 'code' then array['language']
      when 'image' then array['caption','alt','width'] when 'file' then array['caption','displayName'] when 'table' then array['header'] when 'tableCell' then array['columnId'] when 'columns' then array['widths'] else '{}'::text[] end) loop
      if v_block->'attributes' ? v_key then v_attrs:=v_attrs||jsonb_build_object(v_key,v_block->'attributes'->v_key); end if;
    end loop;
    if v_block->>'type' in ('image','file') and private.database_uuid(v_block->'attributes'->>'fileId')
      and private.public_file_for_page((v_block->'attributes'->>'fileId')::uuid,p_page_id) then v_attrs:=v_attrs||jsonb_build_object('fileId',v_block->'attributes'->>'fileId'); end if;
    if v_block->>'type'='databaseRef' and private.database_uuid(v_block->'attributes'->>'databaseId') then
      select d.id,pub.token into v_target from public.databases d join public.page_publications pub on pub.page_id=d.page_id
        where d.id=(v_block->'attributes'->>'databaseId')::uuid and d.workspace_id=p_workspace_id and private.publication_live(d.page_id);
      if found then v_attrs:=jsonb_build_object('databaseId',v_target.id,'token',v_target.token); end if;
    end if;
    v_blocks:=v_blocks||jsonb_build_array(jsonb_build_object('id',v_block->>'id','type',v_block->>'type','parentId',v_block->'parentId','position',v_block->>'position',
      'attributes',v_attrs,'content',private.public_inline(v_block->'content',p_workspace_id)));
  end loop;
  return jsonb_build_object('schemaVersion',1,'blocks',v_blocks);
end;
$$;
create function public.read_page_publication(p_token text,p_after_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_pub public.page_publications;v_page public.pages;v_database public.databases;v_result jsonb;v_properties jsonb:='[]';v_rows jsonb:='[]';v_values jsonb;
  v_row record;v_property public.database_properties;v_value jsonb;v_next uuid;v_ids uuid[];v_cover uuid;v_files jsonb;v_options jsonb;
begin
  if p_token is null or p_token!~'^[0-9a-f]{64}$' then return null; end if;
  select * into v_pub from public.page_publications where token=p_token;
  if not found or not private.publication_live(v_pub.page_id) then return null; end if;
  select * into strict v_page from public.pages where id=v_pub.page_id;
  select * into v_database from public.databases where page_id=v_page.id and workspace_id=v_page.workspace_id;
  select case when private.public_file_for_page(v_page.cover_file_id,v_page.id) then v_page.cover_file_id end into v_cover;
  if v_database.id is not null then
    select array_agg(q.page_id order by q.page_id) into v_ids from (
      select r.page_id from public.database_records r where r.database_id=v_database.id and r.workspace_id=v_page.workspace_id and not r.is_template
        and (p_after_id is null or r.page_id>p_after_id) and private.publication_live(r.page_id) order by r.page_id limit 51) q;
    if cardinality(v_ids)>50 then v_ids:=v_ids[1:50];v_next:=v_ids[50]; end if;
    for v_row in select p.id,p.title,p.icon,p.created_at,p.updated_at,p.cover_file_id,pub.token from public.pages p join public.page_publications pub on pub.page_id=p.id where p.id=any(v_ids) order by p.id loop
      v_values:='{}';
      for v_property in select * from public.database_properties where database_id=v_database.id and workspace_id=v_page.workspace_id and id=any(v_pub.fields) order by position collate "C",id loop
        if v_property.type='title' then v_value:=to_jsonb(v_row.title);
        elsif v_property.type='createdTime' then v_value:=to_jsonb(v_row.created_at);
        elsif v_property.type='editedTime' then v_value:=to_jsonb(v_row.updated_at);
        else select value into v_value from public.database_cells where database_id=v_database.id and page_id=v_row.id and property_id=v_property.id and workspace_id=v_page.workspace_id; end if;
        if v_property.type='person' then
          select coalesce(jsonb_agg('"Membro"'::jsonb),'[]') into v_value from jsonb_array_elements(case when jsonb_typeof(v_value)='array' then v_value else '[]'::jsonb end);
        elsif v_property.type='relation' then
          select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'title',p.title,'token',pub.token) order by p.id),'[]') into v_value
          from jsonb_array_elements_text(case when jsonb_typeof(v_value)='array' then v_value else '[]'::jsonb end) ids(id)
          join public.database_records r on r.page_id::text=ids.id and r.workspace_id=v_page.workspace_id and r.database_id::text=v_property.config->>'targetDatabaseId'
          join public.pages p on p.id=r.page_id and p.workspace_id=v_page.workspace_id
          join public.page_publications pub on pub.page_id=p.id where private.publication_live(p.id);
        end if;
        v_values:=v_values||jsonb_build_object(v_property.id::text,coalesce(v_value,'null'::jsonb));
      end loop;
      v_rows:=v_rows||jsonb_build_array(jsonb_build_object('id',v_row.id,'title',v_row.title,'icon',v_row.icon,'token',v_row.token,
        'coverFileId',case when private.public_file_for_page(v_row.cover_file_id,v_row.id) then v_row.cover_file_id end,'values',v_values));
    end loop;
    for v_property in select * from public.database_properties where database_id=v_database.id and workspace_id=v_page.workspace_id and id=any(v_pub.fields) order by position collate "C",id loop
      v_options:='{}';
      if v_property.type in ('select','multiSelect') then
        select jsonb_build_object('options',coalesce(jsonb_agg(jsonb_build_object('id',o->>'id','label',o->>'label','color',o->>'color')),'[]')) into v_options
          from jsonb_array_elements(v_property.config->'options') o where exists(select 1 from jsonb_array_elements(v_rows) r
            where r->'values'->(v_property.id::text)=to_jsonb(o->>'id') or r->'values'->(v_property.id::text) @> jsonb_build_array(o->>'id'));
      end if;
      v_properties:=v_properties||jsonb_build_array(jsonb_build_object('id',v_property.id,'name',v_property.name,'type',v_property.type)||v_options);
    end loop;
  end if;
  select coalesce(jsonb_agg(f.id order by f.id),'[]') into v_files from public.page_files f where
    (f.page_id=v_page.id and private.public_file_for_page(f.id,v_page.id)) or
    (f.page_id=any(v_ids) and f.purpose='cover' and private.public_file_for_page(f.id,f.page_id));
  v_result:=jsonb_build_object('page',jsonb_build_object('id',v_page.id,'title',v_page.title,'icon',v_page.icon,'coverFileId',v_cover),
    'content',private.public_content(v_page.id,v_page.workspace_id),
    'database',case when v_database.id is null then null else jsonb_build_object('id',v_database.id,'properties',v_properties,'rows',v_rows,'nextCursor',v_next) end,'files',v_files);
  if octet_length(v_result::text)>1048576 then raise exception 'Published page exceeds response limit' using errcode='54000'; end if;
  return v_result;
end;
$$;
create function public.verify_public_file(p_token text,p_file_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.page_publications pub join public.pages source on source.id=pub.page_id and source.workspace_id=pub.workspace_id
    join public.page_files f on f.workspace_id=source.workspace_id and f.id=p_file_id
    where pub.token=p_token and char_length(p_token)=64 and private.publication_live(source.id) and private.public_file_for_page(f.id,f.page_id)
      and (f.page_id=source.id or exists(select 1 from public.databases d join public.database_records r on r.database_id=d.id and r.workspace_id=d.workspace_id
        where d.page_id=source.id and d.workspace_id=source.workspace_id and r.page_id=f.page_id and not r.is_template)));
$$;

create function public.configure_page_publication(p_page_id uuid,p_expected_revision bigint,p_enabled boolean,p_fields uuid[] default '{}',p_rotate boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=private.require_confirmed_user();v_page public.pages;v_fields uuid[];v_publication public.page_publications;
begin
  select * into v_page from public.pages where id=p_page_id;
  perform 1 from public.workspaces where id=v_page.workspace_id for update;
  select * into v_page from public.pages where id=p_page_id for update;
  if private.page_role(p_page_id,v_actor) is distinct from 'owner' then raise exception 'Page unavailable' using errcode='42501'; end if;
  if p_expected_revision is distinct from v_page.revision then raise exception 'Page revision conflict' using errcode='40001'; end if;
  if p_enabled is null or p_rotate is null or p_fields is null or cardinality(p_fields)>100 or array_position(p_fields,null) is not null then raise exception 'Invalid publication patch' using errcode='22023'; end if;
  select coalesce(array_agg(distinct f order by f),'{}') into v_fields from unnest(p_fields) f;
  if exists(select 1 from unnest(v_fields) f where not exists(select 1 from public.database_properties pr join public.databases d on d.id=pr.database_id and d.workspace_id=pr.workspace_id where d.page_id=p_page_id and pr.id=f)) then
    raise exception 'Published field unavailable' using errcode='22023'; end if;
  select * into v_publication from public.page_publications where page_id=p_page_id;
  if p_enabled then
    insert into public.page_publications(page_id,workspace_id,token,fields,revision,created_by)
      values(p_page_id,v_page.workspace_id,encode(extensions.gen_random_bytes(32),'hex'),v_fields,v_page.revision+1,v_actor)
      on conflict(page_id) do update set token=case when p_rotate or page_publications.revoked_at is not null then excluded.token else page_publications.token end,
        fields=excluded.fields,revision=excluded.revision,created_by=v_actor,revoked_at=null;
  else update public.page_publications set revoked_at=clock_timestamp(),revision=v_page.revision+1 where page_id=p_page_id; end if;
  update public.pages set revision=revision+1 where id=p_page_id;
  insert into public.sharing_audit(workspace_id,page_id,actor_id,action,result)
    values(v_page.workspace_id,p_page_id,v_actor,case when not p_enabled then 'revoke' when p_rotate then 'rotate' else 'publish' end,'accepted');
  return public.get_page_sharing(p_page_id);
end;
$$;

revoke all on function private.sharing_member_label(uuid),private.sharing_patch_acl(uuid[],uuid,boolean,text,jsonb,uuid),
  private.publication_live(uuid),private.public_file_for_page(uuid,uuid),private.public_inline(jsonb,uuid),private.public_content(uuid,uuid) from public,anon,authenticated;
revoke all on function public.get_page_sharing(uuid),public.list_page_sharing_targets(uuid,uuid),
  public.configure_page_sharing(uuid,bigint,boolean,text,jsonb,uuid,boolean,text),public.configure_page_publication(uuid,bigint,boolean,uuid[],boolean),
  public.read_page_publication(text,uuid),public.verify_public_file(text,uuid) from public,anon,authenticated;
grant execute on function public.get_page_sharing(uuid),public.list_page_sharing_targets(uuid,uuid),
  public.configure_page_sharing(uuid,bigint,boolean,text,jsonb,uuid,boolean,text),public.configure_page_publication(uuid,bigint,boolean,uuid[],boolean) to authenticated;
grant execute on function public.read_page_publication(text,uuid) to anon,authenticated,service_role;
grant execute on function public.verify_public_file(text,uuid) to service_role;
