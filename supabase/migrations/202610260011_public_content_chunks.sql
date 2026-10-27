-- Public transfer keeps the canonical 8 MiB capacity. References are resolved once per target.
-- Budget: 8 MiB source + <=10,000 escaped 500-character titles/tokens/IDs < 40 MiB;
-- 48 MiB includes structural/database-reference expansion. Oversize is explicit, never truncated.
-- Each bounded 256 KiB UTF-8 slice rechecks current publication and all referenced scopes.
create or replace function private.public_inline(p_content jsonb,p_workspace_id uuid)
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
      if v_target_id is not null then v_inline:=v_inline||jsonb_build_array(jsonb_build_object('type','pageMention','attrs',jsonb_build_object('pageId',v_target_id)));
      else v_inline:=v_inline||jsonb_build_array(jsonb_build_object('type','unavailable')); end if;
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
create or replace function private.public_content(p_page_id uuid,p_workspace_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_source jsonb;v_block jsonb;v_blocks jsonb:='[]';v_attrs jsonb;v_key text;v_target record;v_references jsonb;v_result jsonb;
begin
  select projection into v_source from public.document_heads where page_id=p_page_id and workspace_id=p_workspace_id;
  if v_source is null or v_source='{}' then return jsonb_build_object('schemaVersion',1,'blocks','[]'::jsonb); end if;
  if v_source->>'schemaVersion' is distinct from '1' or jsonb_typeof(v_source->'blocks') is distinct from 'array' then raise exception 'Published content version unavailable' using errcode='22023'; end if;
  if octet_length(v_source::text)>8388608 then raise exception 'Published page exceeds response limit' using errcode='54000'; end if;
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
create or replace function public.read_page_publication(p_token text,p_after_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_pub public.page_publications;v_page public.pages;v_database public.databases;v_result jsonb;v_properties jsonb:='[]';v_rows jsonb:='[]';v_values jsonb;
  v_row record;v_property public.database_properties;v_value jsonb;v_next uuid;v_ids uuid[];v_cover uuid;v_files jsonb;v_options jsonb;v_content jsonb;v_bytes bytea;
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
  v_content:=private.public_content(v_page.id,v_page.workspace_id);
  v_bytes:=convert_to(v_content::text,'UTF8');
  v_result:=jsonb_build_object('page',jsonb_build_object('id',v_page.id,'title',v_page.title,'icon',v_page.icon,'coverFileId',v_cover),
    'content',v_content,
    'database',case when v_database.id is null then null else jsonb_build_object('id',v_database.id,'properties',v_properties,'rows',v_rows,'nextCursor',v_next) end,'files',v_files);

  if octet_length(v_result::text)>1048576 then
    v_result:=jsonb_set(v_result,'{content}',jsonb_build_object('schemaVersion',1,'blocks','[]'::jsonb,
      'chunked',jsonb_build_object('hash',encode(extensions.digest(v_bytes,'sha256'),'hex'),'byteLength',octet_length(v_bytes),
        'chunks',(octet_length(v_bytes)+262143)/262144)));
  end if;
  if octet_length(v_result::text)>1048576 then raise exception 'Published database exceeds response limit' using errcode='54000'; end if;
  return v_result;
end;
$$;

create function public.read_public_content_chunk(p_token text,p_hash text,p_index integer)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_page public.pages;v_bytes bytea;v_hash text;v_count integer;
begin
  if p_token is null or p_token!~'^[0-9a-f]{64}$' or p_hash is null or p_hash!~'^[0-9a-f]{64}$'
    or p_index is null or p_index<0 or p_index>=192 then raise exception 'Invalid publication chunk' using errcode='22023'; end if;
  select p.* into v_page from public.pages p join public.page_publications pub on pub.page_id=p.id
    where pub.token=p_token and private.publication_live(p.id);
  if not found then return null; end if;
  v_bytes:=convert_to(private.public_content(v_page.id,v_page.workspace_id)::text,'UTF8');
  v_hash:=encode(extensions.digest(v_bytes,'sha256'),'hex');
  if v_hash<>p_hash then raise exception 'Publication changed during transfer' using errcode='40001'; end if;
  v_count:=(octet_length(v_bytes)+262143)/262144;
  if p_index>=v_count then raise exception 'Invalid publication chunk' using errcode='22023'; end if;
  return jsonb_build_object('hash',v_hash,'index',p_index,'byteLength',octet_length(v_bytes),
    'data',replace(encode(substring(v_bytes from p_index*262144+1 for 262144),'base64'),E'\n',''));
end;
$$;
revoke all on function public.read_public_content_chunk(text,text,integer) from public,anon,authenticated;
grant execute on function public.read_public_content_chunk(text,text,integer) to anon,authenticated,service_role;
