-- JSON.stringify budgets the canonical UTF-8 representation without separator whitespace.
-- jsonb::text adds spaces outside strings, so it must not lower the 8 MiB capacity.
-- Match entire quoted JSON strings first: escaped quotes/backslashes and authored
-- whitespace survive unchanged; only whitespace between JSON tokens is removed.
create function private.compact_json_bytes(p_value jsonb)
returns integer language sql immutable strict parallel safe set search_path='' as $$
  select octet_length(regexp_replace(p_value::text,
    '("(?:[^"\\]|\\.)*")|[[:space:]]+', '\1', 'g'));
$$;
revoke all on function private.compact_json_bytes(jsonb) from public,anon,authenticated,service_role;

-- Preserve the existing signature, security context, authorization, CAS and receipts.
create or replace function public.commit_document(p_page_id uuid, p_actor_id uuid, p_expected_revision bigint, p_operation_id uuid, p_payload bytea, p_hash text, p_snapshot bytea, p_projection jsonb)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_workspace uuid; v_revision bigint; v_existing public.document_updates%rowtype;
begin
  select workspace_id into v_workspace from public.pages where id = p_page_id;
  if not found then raise exception 'Document unavailable' using errcode = '42501'; end if;
  perform 1 from public.workspaces where id = v_workspace for update;
  perform 1 from public.pages where id = p_page_id for update;
  if coalesce(private.page_role(p_page_id, p_actor_id), '') not in ('owner', 'editor') then raise exception 'Document unavailable' using errcode = '42501'; end if;
  if p_operation_id is null or p_payload is null or octet_length(p_payload) not between 1 and 262144 or p_snapshot is null or octet_length(p_snapshot) > 8388608
    or p_projection is null or jsonb_typeof(p_projection) <> 'object' or private.compact_json_bytes(p_projection) > 8388608 or p_hash is null
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

-- Preserve the existing signature, security context, authorization, CAS and receipts.
create or replace function public.commit_content_document(p_page_id uuid, p_actor_id uuid, p_expected_revision bigint,
  p_operation_id uuid, p_payload bytea, p_hash text, p_snapshot bytea, p_projection jsonb)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_workspace uuid; v_head public.document_heads%rowtype; v_existing public.document_updates%rowtype;
  v_revision bigint; v_reference text; v_file text; v_old_references jsonb; v_old_files jsonb;
begin
  select workspace_id into v_workspace from public.pages where id = p_page_id;
  if not found then raise exception 'Document unavailable' using errcode = '42501'; end if;
  perform 1 from public.workspaces where id = v_workspace for update;
  perform 1 from public.pages where id = p_page_id for update;
  if coalesce(private.page_role(p_page_id, p_actor_id), '') not in ('owner', 'editor')
    or not exists(select 1 from auth.users where id = p_actor_id and email_confirmed_at is not null) then
    raise exception 'Document unavailable' using errcode = '42501';
  end if;
  if p_operation_id is null or p_payload is null or octet_length(p_payload) not between 1 and 262144
    or p_hash is null or p_hash is distinct from encode(extensions.digest(p_payload, 'sha256'), 'hex') then
    raise exception 'Invalid document payload' using errcode = '22023';
  end if;
  -- Retries are receipts, not a second write. In particular an old ACK retry
  -- cannot replace the current body index, references, snapshot or timestamps.
  select * into v_existing from public.document_updates where page_id = p_page_id and operation_id = p_operation_id;
  if found then
    if v_existing.payload_hash <> p_hash or v_existing.actor_id <> p_actor_id then
      raise exception 'Idempotency key reused with different input' using errcode = '22023';
    end if;
    return v_existing.revision;
  end if;
  insert into public.document_heads(page_id, workspace_id) values(p_page_id, v_workspace) on conflict do nothing;
  select * into v_head from public.document_heads where page_id = p_page_id for update;
  if p_expected_revision is null or v_head.revision <> p_expected_revision then
    raise exception 'Document revision conflict' using errcode = '40001';
  end if;
  if p_projection is null or jsonb_typeof(p_projection) <> 'object'
    or private.compact_json_bytes(p_projection) > 8388608
    or p_projection->'schemaVersion' is distinct from '1'::jsonb
    or jsonb_typeof(p_projection->'text') is distinct from 'string'
    or jsonb_typeof(p_projection->'references') is distinct from 'array'
    or jsonb_typeof(p_projection->'files') is distinct from 'array'
    or jsonb_typeof(p_projection->'blocks') is distinct from 'array'
    or p_snapshot is null or octet_length(p_snapshot) > 8388608 then
    raise exception 'Invalid document projection' using errcode = '22023';
  end if;
  if jsonb_array_length(p_projection->'references') > 10000 or jsonb_array_length(p_projection->'files') > 10000 then
    raise exception 'Document reference limit exceeded' using errcode = '22023';
  end if;
  v_old_references := case when jsonb_typeof(v_head.projection->'references') = 'array'
    then v_head.projection->'references' else '[]'::jsonb end;
  v_old_files := case when jsonb_typeof(v_head.projection->'files') = 'array'
    then v_head.projection->'files' else '[]'::jsonb end;
  -- UUID spelling is not identity. Normalize only valid old string values:
  -- legacy projection data must neither trigger a cast failure nor authorize
  -- a new identity just because another JSON value happens to stringify alike.
  select coalesce(jsonb_agg(lower(item.value #>> '{}')), '[]'::jsonb) into v_old_references
    from jsonb_array_elements(v_old_references) item(value)
    where jsonb_typeof(item.value)='string'
      and (item.value #>> '{}') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  select coalesce(jsonb_agg(lower(item.value #>> '{}')), '[]'::jsonb) into v_old_files
    from jsonb_array_elements(v_old_files) item(value)
    where jsonb_typeof(item.value)='string'
      and (item.value #>> '{}') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  for v_reference in select jsonb_array_elements_text(p_projection->'references') loop
    if v_reference is null or v_reference !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'Invalid document reference' using errcode = '22023';
    end if;
    if not (v_old_references ? lower(v_reference)) and not exists(select 1 from public.pages p
      where p.id = v_reference::uuid and p.workspace_id = v_workspace and private.page_role(p.id, p_actor_id) is not null) then
      raise exception 'Referenced page unavailable' using errcode = '42501';
    end if;
  end loop;
  for v_file in select jsonb_array_elements_text(p_projection->'files') loop
    if v_file is null or v_file !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'Invalid document file reference' using errcode = '22023';
    end if;
    if not (v_old_files ? lower(v_file)) and not exists(select 1 from public.page_files f where f.id = v_file::uuid
      and f.workspace_id = v_workspace and f.page_id = p_page_id and f.status = 'ready') then
      raise exception 'Referenced file unavailable' using errcode = '42501';
    end if;
  end loop;
  if (select count(*) from public.document_updates where workspace_id = v_workspace and actor_id = p_actor_id
    and created_at > now() - interval '1 minute') >= 240 then
    raise exception 'Document update limit reached; retry later' using errcode = '54000';
  end if;
  v_revision := public.commit_document(p_page_id, p_actor_id, p_expected_revision, p_operation_id,
    p_payload, p_hash, p_snapshot, p_projection);
  perform private.index_content_body(p_page_id,v_workspace,v_revision,p_projection->>'text');
  update public.pages set updated_at = now() where id = p_page_id;
  delete from public.page_backlinks where source_page_id = p_page_id;
  insert into public.page_backlinks(workspace_id, source_page_id, target_page_id, source_revision)
    select distinct v_workspace, p_page_id, p.id, v_revision from jsonb_array_elements_text(p_projection->'references') r(id)
    join public.pages p on p.id = r.id::uuid and p.workspace_id = v_workspace;
  return v_revision;
end;
$$;

-- Preserve the existing signature, security context, authorization, CAS and receipts.
create or replace function private.public_content(p_page_id uuid,p_workspace_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_source jsonb;v_block jsonb;v_blocks jsonb:='[]';v_attrs jsonb;v_key text;v_target record;v_references jsonb;v_result jsonb;
begin
  select projection into v_source from public.document_heads where page_id=p_page_id and workspace_id=p_workspace_id;
  if v_source is null or v_source='{}' then return jsonb_build_object('schemaVersion',1,'blocks','[]'::jsonb); end if;
  if v_source->>'schemaVersion' is distinct from '1' or jsonb_typeof(v_source->'blocks') is distinct from 'array' then raise exception 'Published content version unavailable' using errcode='22023'; end if;
  if private.compact_json_bytes(v_source)>8388608 then raise exception 'Published page exceeds response limit' using errcode='54000'; end if;
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

  select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'title',p.title,'token',pub.token) order by p.id),'[]')
    into v_references
    from (select distinct (n->'attrs'->>'pageId')::uuid id from jsonb_array_elements(v_blocks) b
      cross join lateral jsonb_array_elements(b->'content'->'content'->0->'content') n
      where n->>'type'='pageMention') refs
    join public.pages p on p.id=refs.id and p.workspace_id=p_workspace_id
    join public.page_publications pub on pub.page_id=p.id where private.publication_live(p.id);
  if jsonb_array_length(v_references)>10000 then raise exception 'Published reference budget exceeded' using errcode='54000'; end if;
  v_result:=jsonb_build_object('schemaVersion',1,'blocks',v_blocks,'references',v_references);
  if octet_length(v_result::text)>50331648 then raise exception 'Published projection budget exceeded' using errcode='54000'; end if;
  return v_result;
end;
$$;
