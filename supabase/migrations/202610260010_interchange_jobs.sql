-- Durable coordination only. Untrusted ZIP/Markdown/Yjs are validated by the bounded server pipeline.
create table public.interchange_jobs (
  id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id) on delete cascade,
  actor_id uuid not null references auth.users(id),request_id uuid not null,request_hash text not null,
  kind text not null check(kind in ('import','export','templateCopy')),
  state text not null check(state in ('uploading','scanning','preview','running','complete','cancelled','error')),
  root_page_id uuid,parent_id uuid,source_name text not null default 'Arquivo' check(char_length(source_name) between 1 and 180),source_path text not null,source_size bigint not null default 0 check(source_size between 0 and 52428800),
  source_digest text not null default '' check(source_digest='' or source_digest~'^[a-f0-9]{64}$'),confirmed boolean not null default false,
  cursor jsonb not null default '{}' check(jsonb_typeof(cursor)='object' and octet_length(cursor::text)<=524288),
  report jsonb not null default '[]' check(jsonb_typeof(report)='array' and jsonb_array_length(report)<=1000 and octet_length(report::text)<=262144),
  revision bigint not null default 0 check(revision>=0),lease_id uuid,lease_expires_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
  unique(actor_id,request_id),unique(id,workspace_id,actor_id),
  foreign key(root_page_id,workspace_id) references public.pages(id,workspace_id),
  foreign key(parent_id,workspace_id) references public.pages(id,workspace_id),
  check(source_path=workspace_id::text||'/'||actor_id::text||'/'||id::text||'/source.zip')
);
create index interchange_jobs_actor_idx on public.interchange_jobs(workspace_id,actor_id,created_at,id);
create table public.interchange_items (
  job_id uuid not null,workspace_id uuid not null,actor_id uuid not null,key text not null check(char_length(key) between 1 and 1100),
  index integer not null check(index>=0),kind text not null check(char_length(kind) between 1 and 40),
  state text not null default 'pending' check(state in ('pending','ready','running','done','error','skipped')),
  payload jsonb not null default '{}' check(jsonb_typeof(payload)='object' and octet_length(payload::text)<=524288),
  page_id uuid,database_id uuid,file_id uuid,source_page_id uuid,
  primary key(job_id,key),unique(job_id,index),
  foreign key(job_id,workspace_id,actor_id) references public.interchange_jobs(id,workspace_id,actor_id) on delete cascade,
  foreign key(page_id,workspace_id) references public.pages(id,workspace_id),
  foreign key(source_page_id,workspace_id) references public.pages(id,workspace_id),
  foreign key(database_id,workspace_id) references public.databases(id,workspace_id),
  foreign key(file_id) references public.page_files(id)
);
create index interchange_items_order_idx on public.interchange_items(job_id,state,index);

create function private.interchange_access(p_job_id uuid,p_actor uuid)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare v_job public.interchange_jobs;v_role text;
begin
  if auth.role() is distinct from 'service_role' and p_actor is distinct from auth.uid() then return false; end if;
  select * into v_job from public.interchange_jobs where id=p_job_id;
  if not found or v_job.actor_id is distinct from p_actor or not private.is_workspace_member(v_job.workspace_id,p_actor)
    or not exists(select 1 from auth.users where id=p_actor and(email_confirmed_at is not null or phone_confirmed_at is not null)) then return false; end if;
  if v_job.root_page_id is not null and private.page_role(v_job.root_page_id,p_actor) is null then return false; end if;
  if v_job.parent_id is not null and coalesce(private.page_role(v_job.parent_id,p_actor),'') not in ('owner','editor') then return false; end if;
  if v_job.kind='export' then
    if exists(with visible as materialized(select page_id from private.visible_page_scope(v_job.workspace_id,p_actor))
      select 1 from public.interchange_items i left join visible v on v.page_id=i.source_page_id where i.job_id=p_job_id and i.source_page_id is not null and v.page_id is null) then return false; end if;
  end if;
  return true;
end;
$$;
create function private.require_interchange_job(p_job_id uuid,p_actor uuid,p_lease uuid default null)
returns public.interchange_jobs language plpgsql security definer set search_path='' as $$
declare v_job public.interchange_jobs;
begin
  select * into v_job from public.interchange_jobs where id=p_job_id;
  perform 1 from public.workspaces where id=v_job.workspace_id for update;
  select * into v_job from public.interchange_jobs where id=p_job_id for update;
  if not private.interchange_access(p_job_id,p_actor) then raise exception 'Interchange job unavailable' using errcode='42501'; end if;
  if p_lease is not null and(v_job.lease_id is distinct from p_lease or v_job.lease_expires_at<=clock_timestamp() or v_job.state in ('cancelled','complete')) then
    raise exception 'Interchange lease conflict' using errcode='40001'; end if;
  return v_job;
end;
$$;
create function private.interchange_job_json(p_job public.interchange_jobs)
returns jsonb language sql stable set search_path='' as $$
  select jsonb_build_object('id',p_job.id,'workspaceId',p_job.workspace_id,'actorId',p_job.actor_id,'operationId',p_job.request_id,'sourceName',p_job.source_name,'kind',p_job.kind,'state',p_job.state,
    'revision',p_job.revision,'rootPageId',p_job.root_page_id,'parentId',p_job.parent_id,'sourcePath',p_job.source_path,'sourceSize',p_job.source_size,
    'sourceDigest',p_job.source_digest,'cursor',p_job.cursor,'report',p_job.report,'confirmed',p_job.confirmed,'createdAt',p_job.created_at,'updatedAt',p_job.updated_at);
$$;
create function public.create_interchange_job(p_workspace_id uuid,p_kind text,p_request_id uuid,p_root_page_id uuid default null,p_parent_id uuid default null,
  p_source_size bigint default 0,p_source_digest text default '',p_source_name text default 'Arquivo')
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=private.require_confirmed_user();v_job public.interchange_jobs;v_hash text;v_id uuid:=gen_random_uuid();
begin
  perform 1 from public.workspaces where id=p_workspace_id for update;
  if not private.is_workspace_member(p_workspace_id,v_actor) then raise exception 'Workspace unavailable' using errcode='42501'; end if;
  if p_source_name is null or char_length(p_source_name) not between 1 and 180 or p_kind is null or p_kind not in ('import','export','templateCopy') or p_request_id is null or p_source_size is null or p_source_digest is null
    or(p_kind='import' and(p_source_size not between 1 and 52428800 or p_source_digest!~'^[a-f0-9]{64}$'))
    or(p_kind<>'import' and(p_source_size<>0 or p_source_digest<>'' or p_root_page_id is null)) then raise exception 'Invalid interchange request' using errcode='22023'; end if;
  if p_root_page_id is not null and not exists(select 1 from public.pages where id=p_root_page_id and workspace_id=p_workspace_id and private.page_role(id,v_actor) is not null) then
    raise exception 'Source unavailable' using errcode='42501'; end if;
  if p_parent_id is not null and not exists(select 1 from public.pages where id=p_parent_id and workspace_id=p_workspace_id and private.page_role(id,v_actor) in('owner','editor')) then
    raise exception 'Destination unavailable' using errcode='42501'; end if;
  v_hash:=encode(extensions.digest(convert_to(jsonb_build_array(p_workspace_id,p_kind,p_root_page_id,p_parent_id,p_source_size,p_source_digest)::text,'UTF8'),'sha256'),'hex');
  select * into v_job from public.interchange_jobs where actor_id=v_actor and request_id=p_request_id;
  if found then if v_job.request_hash<>v_hash then raise exception 'Interchange request reused' using errcode='22023'; end if; return private.interchange_job_json(v_job); end if;
  if(p_kind<>'templateCopy' and(select count(*) from public.interchange_jobs where actor_id=v_actor and workspace_id=p_workspace_id and kind<>'templateCopy' and created_at>clock_timestamp()-interval '1 hour')>=6)
    or(p_kind='templateCopy' and(select count(*) from public.interchange_jobs where actor_id=v_actor and workspace_id=p_workspace_id and kind='templateCopy' and created_at>clock_timestamp()-interval '1 minute')>=240) then
    raise exception 'Interchange rate exceeded' using errcode='54000'; end if;
  insert into public.interchange_jobs(id,workspace_id,actor_id,request_id,request_hash,kind,state,root_page_id,parent_id,source_path,source_size,source_digest,confirmed,source_name)
    values(v_id,p_workspace_id,v_actor,p_request_id,v_hash,p_kind,case p_kind when 'import' then 'uploading' else 'running' end,
      p_root_page_id,p_parent_id,p_workspace_id::text||'/'||v_actor::text||'/'||v_id::text||'/source.zip',p_source_size,p_source_digest,p_kind<>'import',p_source_name) returning * into v_job;
  return private.interchange_job_json(v_job);
end;
$$;
create function public.get_interchange_job(p_job_id uuid,p_after_index integer default -1)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=private.require_confirmed_user();v_job public.interchange_jobs;v_items jsonb;v_next integer;v_public jsonb;
begin
  if not private.interchange_access(p_job_id,v_actor) then raise exception 'Interchange job unavailable' using errcode='42501'; end if;
  select * into v_job from public.interchange_jobs where id=p_job_id;
  v_public:=private.interchange_job_json(v_job)||jsonb_build_object('cursor',jsonb_build_object('phase',v_job.cursor->'phase','processed',v_job.cursor->'processed','total',v_job.cursor->'total'));
  with candidates as materialized(select * from public.interchange_items where job_id=p_job_id and index>p_after_index order by index limit 51),
  visible as(select *,row_number() over(order by index) n from candidates),
  payloads as(select index,jsonb_build_object('key',key,'index',index,'kind',kind,'state',state,'pageId',page_id,'databaseId',database_id,'fileId',file_id)||jsonb_strip_nulls(jsonb_build_object(
    'path',payload->'path','size',payload->'size','header',payload->'header','sample',payload->'sample','error',payload->'error','mapping',payload->'mapping')) value from visible where n<=50),
  budget as(select *,sum(octet_length(value::text)) over(order by index) bytes from payloads),
  included as(select * from budget where bytes+octet_length(v_public::text)+1024<=1048576)
  select coalesce(jsonb_agg(value order by index),'[]'),case when(select count(*) from candidates)>count(*) then max(index) else null end into v_items,v_next from included;
  return jsonb_build_object('job',v_public,'items',v_items,'nextIndex',v_next);
end;
$$;
create function public.confirm_interchange_job(p_job_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_job public.interchange_jobs:=private.require_interchange_job(p_job_id,private.require_confirmed_user());
begin
  if v_job.state='running' and v_job.confirmed then return private.interchange_job_json(v_job); end if;
  if v_job.state<>'preview' or exists(select 1 from public.interchange_items where job_id=p_job_id and state='error') then raise exception 'Preview requires attention' using errcode='22023'; end if;
  update public.interchange_jobs set state='running',confirmed=true,revision=revision+1,updated_at=clock_timestamp() where id=p_job_id returning * into v_job;
  return private.interchange_job_json(v_job);
end;
$$;
create function public.cancel_interchange_job(p_job_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_job public.interchange_jobs:=private.require_interchange_job(p_job_id,private.require_confirmed_user());
begin
  if v_job.state='cancelled' then return private.interchange_job_json(v_job); end if;
  if v_job.state='complete' then raise exception 'Interchange already complete' using errcode='22023'; end if;
  update public.interchange_jobs set state='cancelled',lease_id=null,lease_expires_at=null,revision=revision+1,updated_at=clock_timestamp() where id=p_job_id returning * into v_job;
  return private.interchange_job_json(v_job);
end;
$$;
create function public.claim_interchange_job(p_job_id uuid,p_actor_id uuid,p_lease_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_job public.interchange_jobs:=private.require_interchange_job(p_job_id,p_actor_id);
begin
  if p_lease_id is null or v_job.state in('cancelled','complete') then raise exception 'Interchange unavailable' using errcode='22023'; end if;
  if v_job.lease_expires_at>clock_timestamp() and v_job.lease_id is distinct from p_lease_id then raise exception 'Interchange busy' using errcode='40001'; end if;
  update public.interchange_jobs set lease_id=p_lease_id,lease_expires_at=clock_timestamp()+interval '60 seconds' where id=p_job_id returning * into v_job;
  return private.interchange_job_json(v_job);
end;
$$;
create function public.write_interchange_job(p_job_id uuid,p_actor_id uuid,p_lease_id uuid,p_state text,p_cursor jsonb,p_report jsonb,p_release boolean default true)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_job public.interchange_jobs:=private.require_interchange_job(p_job_id,p_actor_id,p_lease_id);
begin
  if p_state is null or p_state not in('scanning','preview','running','complete','error') or(p_state in('running','complete') and v_job.kind='import' and not v_job.confirmed) then
    raise exception 'Invalid interchange transition' using errcode='22023'; end if;
  update public.interchange_jobs set state=p_state,cursor=p_cursor,report=p_report,revision=revision+1,updated_at=clock_timestamp(),
    lease_id=case when p_release then null else lease_id end,lease_expires_at=case when p_release then null else clock_timestamp()+interval '60 seconds' end where id=p_job_id returning * into v_job;
  return private.interchange_job_json(v_job);
end;
$$;
create function public.put_interchange_item(p_job_id uuid,p_actor_id uuid,p_lease_id uuid,p_key text,p_index integer,p_kind text,p_state text,p_payload jsonb,
  p_page_id uuid default null,p_database_id uuid default null,p_file_id uuid default null,p_source_page_id uuid default null)
returns void language plpgsql security definer set search_path='' as $$
declare v_job public.interchange_jobs:=private.require_interchange_job(p_job_id,p_actor_id,p_lease_id);v_old public.interchange_items;
begin
  if p_file_id is not null and not exists(select 1 from public.page_files where id=p_file_id and workspace_id=v_job.workspace_id and(page_id=p_page_id or page_id=p_source_page_id)) then raise exception 'File unavailable' using errcode='42501'; end if;
  select * into v_old from public.interchange_items where job_id=p_job_id and key=p_key;
  if found and(v_old.index<>p_index or v_old.kind<>p_kind or(v_old.state='done' and(v_old.payload<>p_payload or p_state<>'done'))) then raise exception 'Interchange receipt conflict' using errcode='40001'; end if;
  insert into public.interchange_items(job_id,workspace_id,actor_id,key,index,kind,state,payload,page_id,database_id,file_id,source_page_id)
    values(p_job_id,v_job.workspace_id,p_actor_id,p_key,p_index,p_kind,p_state,p_payload,p_page_id,p_database_id,p_file_id,p_source_page_id)
    on conflict(job_id,key) do update set state=excluded.state,payload=excluded.payload,page_id=coalesce(excluded.page_id,interchange_items.page_id),
      database_id=coalesce(excluded.database_id,interchange_items.database_id),file_id=coalesce(excluded.file_id,interchange_items.file_id),source_page_id=coalesce(excluded.source_page_id,interchange_items.source_page_id);
  if v_old.key is null and p_kind='zipPart' and p_state='done' then
    if jsonb_typeof(p_payload->'bytes') is distinct from 'number' or(p_payload->>'bytes')!~'^[0-9]{1,9}$' or(p_payload->>'bytes')::bigint>52428800 then raise exception 'Invalid export part' using errcode='22023'; end if;
    update public.interchange_jobs set cursor=jsonb_set(cursor,'{zipOffset}',to_jsonb(coalesce((cursor->>'zipOffset')::bigint,0)+(p_payload->>'bytes')::bigint)) where id=p_job_id;
  end if;
end;
$$;
create function public.read_interchange_items(p_job_id uuid,p_actor_id uuid,p_lease_id uuid,p_after_index integer default -1,p_kind text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_job public.interchange_jobs:=private.require_interchange_job(p_job_id,p_actor_id,p_lease_id);v_items jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('key',key,'index',index,'kind',kind,'state',state,'payload',payload,'pageId',page_id,'databaseId',database_id,'fileId',file_id,'sourcePageId',source_page_id) order by index),'[]') into v_items
    from(select * from public.interchange_items where job_id=p_job_id and index>p_after_index and(p_kind is null or kind=p_kind) order by index limit 50) x;
  return v_items;
end;
$$;
create function public.interchange_export_pages(p_job_id uuid,p_actor_id uuid,p_lease_id uuid,p_after_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_job public.interchange_jobs:=private.require_interchange_job(p_job_id,p_actor_id,p_lease_id);v_rows jsonb;
begin
  if v_job.kind<>'export' then raise exception 'Invalid export scope' using errcode='22023'; end if;
  with scope as materialized(select id from private.page_subtree(v_job.root_page_id)),visible as materialized(select page_id from private.visible_page_scope(v_job.workspace_id,p_actor_id))
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'parentId',parent_id,'title',title,'databaseId',database_id,'recordDatabaseId',record_database_id,'isTemplate',is_template) order by id),'[]') into v_rows
  from(select p.id,case when exists(select 1 from visible v join scope s on s.id=v.page_id where v.page_id=p.parent_id) then p.parent_id end parent_id,p.title,d.id database_id,r.database_id record_database_id,coalesce(r.is_template,false) is_template
    from public.pages p join scope s on s.id=p.id join visible v on v.page_id=p.id left join public.databases d on d.page_id=p.id left join public.database_records r on r.page_id=p.id
    where p_after_id is null or p.id>p_after_id order by p.id limit 50) x;
  return v_rows;
end;
$$;
create function public.interchange_download_parts(p_job_id uuid,p_after_index integer default -1)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=private.require_confirmed_user();v_job public.interchange_jobs;v_rows jsonb;
begin
  if not private.interchange_access(p_job_id,v_actor) then raise exception 'Export unavailable' using errcode='42501'; end if;
  select * into v_job from public.interchange_jobs where id=p_job_id;
  if v_job.kind<>'export' or v_job.state<>'complete' then raise exception 'Export incomplete' using errcode='22023'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('index',index,'path',payload->'objectPath','size',payload->'bytes') order by index),'[]') into v_rows
    from(select * from public.interchange_items where job_id=p_job_id and kind='zipPart' and state='done' and index>p_after_index order by index limit 50) x;
  return v_rows;
end;
$$;
create function private.interchange_operation_id(p_job_id uuid,p_key text)
returns uuid language sql immutable set search_path='' as $$
  select (substr(h,1,8)||'-'||substr(h,9,4)||'-4'||substr(h,14,3)||'-8'||substr(h,18,3)||'-'||substr(h,21,12))::uuid
    from(select md5(p_job_id::text||':'||p_key) h) x;
$$;
create function public.ensure_interchange_page(p_job_id uuid,p_lease_id uuid,p_key text,p_title text,p_parent_id uuid default null,p_database_id uuid default null,p_is_database boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=private.require_confirmed_user();v_job public.interchange_jobs:=private.require_interchange_job(p_job_id,v_actor,p_lease_id);v_item public.interchange_items;v_result jsonb;v_page uuid;v_database uuid;
begin
  if not v_job.confirmed or v_job.state<>'running' then raise exception 'Import not confirmed' using errcode='42501'; end if;
  select * into v_item from public.interchange_items where job_id=p_job_id and key=p_key for update;
  if not found then raise exception 'Import item unavailable' using errcode='22023'; end if;
  if v_item.page_id is not null then
    if coalesce(private.page_role(v_item.page_id,v_actor),'') not in('owner','editor') then raise exception 'Destination unavailable' using errcode='42501'; end if;
    return jsonb_build_object('pageId',v_item.page_id,'databaseId',v_item.database_id);
  end if;
  if p_is_database then
    v_result:=public.create_database(v_job.workspace_id,p_parent_id,p_title,private.interchange_operation_id(p_job_id,p_key));v_page:=(v_result->>'pageId')::uuid;v_database:=(v_result->>'id')::uuid;
  elsif p_database_id is not null then
    if not exists(select 1 from public.databases where id=p_database_id and workspace_id=v_job.workspace_id) then raise exception 'Database unavailable' using errcode='42501'; end if;
    v_result:=public.add_database_record(p_database_id,p_title,private.interchange_operation_id(p_job_id,p_key));v_page:=(v_result->>'pageId')::uuid;v_database:=p_database_id;
  else v_page:=public.create_page(v_job.workspace_id,p_parent_id,p_title,private.interchange_operation_id(p_job_id,p_key)); end if;
  update public.interchange_items set page_id=v_page,database_id=v_database where job_id=p_job_id and key=p_key;
  return jsonb_build_object('pageId',v_page,'databaseId',v_database);
end;
$$;
create function public.commit_interchange_document(p_job_id uuid,p_actor_id uuid,p_lease_id uuid,p_key text,p_expected_revision bigint,p_operation_id uuid,p_payload bytea,p_hash text,p_snapshot bytea,p_projection jsonb)
returns bigint language plpgsql security definer set search_path='' as $$
declare v_job public.interchange_jobs:=private.require_interchange_job(p_job_id,p_actor_id,p_lease_id);v_page uuid;
begin
  if not v_job.confirmed or v_job.state<>'running' then raise exception 'Import not confirmed' using errcode='42501'; end if;
  select page_id into v_page from public.interchange_items where job_id=p_job_id and key=p_key;
  if v_page is null then raise exception 'Import item unavailable' using errcode='22023'; end if;
  return public.commit_content_document(v_page,p_actor_id,p_expected_revision,p_operation_id,p_payload,p_hash,p_snapshot,p_projection);
end;
$$;
create function public.prepare_interchange_file(p_job_id uuid,p_lease_id uuid,p_key text,p_page_id uuid,p_name text,p_mime_type text,p_size bigint,p_kind text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=private.require_confirmed_user();v_job public.interchange_jobs:=private.require_interchange_job(p_job_id,v_actor,p_lease_id);v_item public.interchange_items;v_file uuid;
begin
  if not v_job.confirmed or v_job.state<>'running' then raise exception 'Import not confirmed' using errcode='42501'; end if;
  select * into v_item from public.interchange_items where job_id=p_job_id and key=p_key for update;
  if not found or not exists(select 1 from public.interchange_items where job_id=p_job_id and page_id=p_page_id) or coalesce(private.page_role(p_page_id,v_actor),'') not in('owner','editor') then
    raise exception 'Import target unavailable' using errcode='42501'; end if;
  if v_item.file_id is not null then return v_item.file_id; end if;
  v_file:=public.prepare_block_file(p_page_id,p_name,p_mime_type,p_size,p_kind);
  update public.interchange_items set page_id=p_page_id,file_id=v_file where job_id=p_job_id and key=p_key;
  return v_file;
end;
$$;
create function public.ensure_interchange_property(p_job_id uuid,p_lease_id uuid,p_key text,p_column integer,p_name text,p_type text,p_config jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=private.require_confirmed_user();v_job public.interchange_jobs:=private.require_interchange_job(p_job_id,v_actor,p_lease_id);v_item public.interchange_items;v_id uuid;v_property public.database_properties;
begin
  if not v_job.confirmed or v_job.state<>'running' or p_column not between 0 and 499 then raise exception 'Import not confirmed' using errcode='42501'; end if;
  select * into v_item from public.interchange_items where job_id=p_job_id and key=p_key for update;
  if v_item.database_id is null then raise exception 'Import database unavailable' using errcode='22023'; end if;
  if v_item.payload->'properties' ? p_column::text then return (v_item.payload->'properties'->>p_column::text)::uuid; end if;
  if p_type='title' then
    select * into v_property from public.database_properties where database_id=v_item.database_id and type='title';v_id:=v_property.id;
    if v_property.name<>p_name then
      if v_property.revision<>0 then raise exception 'Imported schema changed' using errcode='40001'; end if;
      perform public.put_database_property(v_item.database_id,v_id,p_name,'title','{}',0);
    end if;
  else v_id:=(public.put_database_property(v_item.database_id,null,p_name,p_type,p_config,0)->>'id')::uuid; end if;
  update public.interchange_items set payload=jsonb_set(payload,'{properties}',coalesce(payload->'properties','{}')||jsonb_build_object(p_column::text,v_id)) where job_id=p_job_id and key=p_key;
  return v_id;
end;
$$;
create function public.validate_interchange_references(p_job_id uuid,p_actor_id uuid,p_lease_id uuid,p_kind text,p_ids uuid[],p_target_database_id uuid default null)
returns void language plpgsql security definer set search_path='' as $$
declare v_job public.interchange_jobs:=private.require_interchange_job(p_job_id,p_actor_id,p_lease_id);v_valid integer;
begin
  if p_kind is null or p_kind not in('person','relation') or p_ids is null or cardinality(p_ids)>1000 or coalesce(array_ndims(p_ids),1)<>1 or array_position(p_ids,null) is not null then raise exception 'Invalid reference mapping' using errcode='22023'; end if;
  if p_kind='person' then
    if exists(select 1 from unnest(p_ids) i where not exists(select 1 from public.workspace_members m where m.workspace_id=v_job.workspace_id and m.user_id=i)) then raise exception 'Person unavailable' using errcode='42501'; end if;
  else
    with visible as materialized(select page_id from private.visible_page_scope(v_job.workspace_id,p_actor_id))
    select count(distinct r.page_id)::integer into v_valid from public.database_records r join public.databases d on d.id=r.database_id join visible v on v.page_id=r.page_id
      where d.id=p_target_database_id and d.workspace_id=v_job.workspace_id and r.page_id=any(p_ids) and not r.is_template and exists(select 1 from visible where page_id=d.page_id);
    if v_valid<>(select count(distinct i) from unnest(p_ids) i) then raise exception 'Relation unavailable' using errcode='42501'; end if;
  end if;
end;
$$;
create function public.list_interchange_jobs(p_workspace_id uuid,p_after_created_at timestamptz default null,p_after_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=private.require_confirmed_user();v_result jsonb;
begin
  if not private.is_workspace_member(p_workspace_id,v_actor) then raise exception 'Workspace unavailable' using errcode='42501'; end if;
  if(p_after_created_at is null)<>(p_after_id is null) then raise exception 'Invalid interchange cursor' using errcode='22023'; end if;
  with candidates as materialized(select j.* from public.interchange_jobs j where j.workspace_id=p_workspace_id and j.actor_id=v_actor
    and(p_after_id is null or(j.created_at,j.id)<(p_after_created_at,p_after_id)) and private.interchange_access(j.id,v_actor) order by j.created_at desc,j.id desc limit 51),
  shown as(select *,row_number() over(order by created_at desc,id desc) n from candidates)
  select jsonb_build_object('jobs',coalesce(jsonb_agg(private.interchange_job_json(jsonb_populate_record(null::public.interchange_jobs,to_jsonb(shown)-'n'))||jsonb_build_object('cursor',jsonb_build_object('phase',cursor->'phase','processed',cursor->'processed','total',cursor->'total'),'report','[]'::jsonb) order by created_at desc,id desc) filter(where n<=50),'[]'::jsonb),
    'nextCursor',case when count(*)>50 then(select jsonb_build_object('createdAt',created_at,'id',id) from shown where n=50) else null end) into v_result from shown;
  return v_result;
end;
$$;
alter table public.interchange_jobs enable row level security;
alter table public.interchange_items enable row level security;
create policy interchange_jobs_read on public.interchange_jobs for select to authenticated using(private.interchange_access(id,(select auth.uid())));
create policy interchange_items_read on public.interchange_items for select to authenticated using(private.interchange_access(job_id,(select auth.uid())));
revoke all on public.interchange_jobs,public.interchange_items from public,anon,authenticated;
grant select on public.interchange_jobs,public.interchange_items to authenticated;
grant all on public.interchange_jobs,public.interchange_items to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('interchange','interchange',false,52428800,array['application/octet-stream','application/zip']) on conflict(id) do nothing;
revoke all on function private.interchange_access(uuid,uuid),private.require_interchange_job(uuid,uuid,uuid),private.interchange_job_json(public.interchange_jobs),private.interchange_operation_id(uuid,text) from public,anon,authenticated;
grant execute on function private.interchange_access(uuid,uuid) to authenticated;
revoke all on function public.create_interchange_job(uuid,text,uuid,uuid,uuid,bigint,text,text),public.get_interchange_job(uuid,integer),public.confirm_interchange_job(uuid),public.cancel_interchange_job(uuid),public.ensure_interchange_page(uuid,uuid,text,text,uuid,uuid,boolean) from public,anon;
grant execute on function public.create_interchange_job(uuid,text,uuid,uuid,uuid,bigint,text,text),public.get_interchange_job(uuid,integer),public.confirm_interchange_job(uuid),public.cancel_interchange_job(uuid),public.ensure_interchange_page(uuid,uuid,text,text,uuid,uuid,boolean) to authenticated;
revoke all on function public.prepare_interchange_file(uuid,uuid,text,uuid,text,text,bigint,text),public.ensure_interchange_property(uuid,uuid,text,integer,text,text,jsonb),public.list_interchange_jobs(uuid,timestamptz,uuid),public.interchange_download_parts(uuid,integer) from public,anon;
grant execute on function public.prepare_interchange_file(uuid,uuid,text,uuid,text,text,bigint,text),public.ensure_interchange_property(uuid,uuid,text,integer,text,text,jsonb),public.list_interchange_jobs(uuid,timestamptz,uuid),public.interchange_download_parts(uuid,integer) to authenticated;
revoke all on function public.validate_interchange_references(uuid,uuid,uuid,text,uuid[],uuid) from public,anon,authenticated;
grant execute on function public.validate_interchange_references(uuid,uuid,uuid,text,uuid[],uuid) to service_role;
revoke all on function public.claim_interchange_job(uuid,uuid,uuid),public.write_interchange_job(uuid,uuid,uuid,text,jsonb,jsonb,boolean),public.put_interchange_item(uuid,uuid,uuid,text,integer,text,text,jsonb,uuid,uuid,uuid,uuid),
  public.read_interchange_items(uuid,uuid,uuid,integer,text),public.interchange_export_pages(uuid,uuid,uuid,uuid),public.commit_interchange_document(uuid,uuid,uuid,text,bigint,uuid,bytea,text,bytea,jsonb) from public,anon,authenticated;
grant execute on function public.claim_interchange_job(uuid,uuid,uuid),public.write_interchange_job(uuid,uuid,uuid,text,jsonb,jsonb,boolean),public.put_interchange_item(uuid,uuid,uuid,text,integer,text,text,jsonb,uuid,uuid,uuid,uuid),
  public.read_interchange_items(uuid,uuid,uuid,integer,text),public.interchange_export_pages(uuid,uuid,uuid,uuid),public.commit_interchange_document(uuid,uuid,uuid,text,bigint,uuid,bytea,text,bytea,jsonb) to service_role;
