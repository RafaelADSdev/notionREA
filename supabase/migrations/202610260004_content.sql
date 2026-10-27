-- Content is validated in the bounded Node worker before this privileged RPC.
-- This boundary rechecks current authorization, references, quotas and CAS.
-- PostgreSQL limits each tsvector to 1 MiB. Bounded, deduplicated lexeme chunks
-- keep multi-MiB bodies searchable without splitting words or truncating text.
create table public.page_search_chunks (
  page_id uuid not null,
  workspace_id uuid not null,
  chunk_index integer not null check (chunk_index >= 0),
  source_revision bigint not null check (source_revision > 0),
  search_vector tsvector not null,
  primary key (page_id, chunk_index),
  foreign key (page_id, workspace_id) references public.pages(id, workspace_id) on delete cascade
);
create index page_search_chunks_workspace_idx on public.page_search_chunks(workspace_id,page_id,chunk_index);
create index page_search_chunks_search_idx on public.page_search_chunks using gin(search_vector);
alter table public.page_search_chunks enable row level security;
create policy search_chunks_read on public.page_search_chunks for select to authenticated
  using (private.page_role(page_id, (select auth.uid())) is not null);
revoke all on public.page_search_chunks from public, anon, authenticated;
grant select(page_id,workspace_id,chunk_index,source_revision) on public.page_search_chunks to authenticated;
grant all on public.page_search_chunks to service_role;

create function private.index_content_body(p_page_id uuid,p_workspace_id uuid,p_revision bigint,p_text text)
returns void language plpgsql set search_path = '' as $$
begin
  delete from public.page_search_chunks where page_id=p_page_id;
  insert into public.page_search_chunks(page_id,workspace_id,chunk_index,source_revision,search_vector)
    with lexemes as materialized (
      select distinct word.lexeme collate "C" as lexeme
      from (values ('pg_catalog.portuguese'::regconfig,p_text),('pg_catalog.english'::regconfig,p_text),
        ('pg_catalog.portuguese'::regconfig,extensions.unaccent(p_text)),
        ('pg_catalog.english'::regconfig,extensions.unaccent(p_text))) forms(configuration,body)
      cross join lateral ts_debug(forms.configuration,forms.body) token
      cross join lateral unnest(token.lexemes) word(lexeme)
      -- Match PostgreSQL's parser word-size bound while preserving every byte
      -- in the canonical snapshot; no complete-page vector is ever allocated.
      where octet_length(word.lexeme) <= 2047
    ), numbered as (
      select lexeme,((row_number() over(order by lexeme))-1)/100 as chunk_index from lexemes
    ) select p_page_id,p_workspace_id,n.chunk_index::integer,p_revision,array_to_tsvector(array_agg(n.lexeme))
      from numbered n group by n.chunk_index;
end;
$$;
revoke all on function private.index_content_body(uuid,uuid,bigint,text) from public,anon,authenticated;

create or replace function public.search_pages(p_workspace_id uuid,p_query text,p_after_rank real default null,
  p_after_id uuid default null,p_after_updated_at timestamptz default null)
returns table(id uuid,title text,icon text,rank real,updated_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare v_actor uuid := private.require_confirmed_user(); v_term text := btrim(p_query);
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
    return query with visible as materialized(select * from private.visible_page_scope(p_workspace_id,v_actor)),
    forms as materialized (
      select f.form,tsvector_to_array(to_tsvector(f.configuration,f.term)) as terms
      from (values (1,'pg_catalog.portuguese'::regconfig,v_term),(2,'pg_catalog.english'::regconfig,v_term),
        (3,'pg_catalog.portuguese'::regconfig,extensions.unaccent(v_term)),
        (4,'pg_catalog.english'::regconfig,extensions.unaccent(v_term))) f(form,configuration,term)
    ), terms as materialized (
      select f.form,t.term,to_tsquery('pg_catalog.simple',quote_literal(t.term)) as query
      from forms f cross join lateral unnest(f.terms) t(term)
    ), hits as (
      select p.id as page_id,t.form,t.term,4 as weight from terms t
      join public.pages p on p.workspace_id=p_workspace_id and p.search_vector @@ t.query
      join visible v on v.page_id=p.id where p.deleted_at is null
      union all
      select c.page_id,t.form,t.term,1 as weight from terms t
      join public.page_search_chunks c on c.workspace_id=p_workspace_id and c.search_vector @@ t.query
      join visible v on v.page_id=c.page_id
    ), best_hits as (
      select h.page_id,h.form,h.term,max(h.weight) as weight from hits h group by h.page_id,h.form,h.term
    ), matched_forms as (
      select h.page_id,h.form,(sum(h.weight)::real/cardinality(f.terms))::real as score
      from best_hits h join forms f on f.form=h.form group by h.page_id,h.form,f.terms
      having count(*)=cardinality(f.terms)
    ), scores as (
      select m.page_id,max(m.score)::real as score from matched_forms m group by m.page_id
    ) select p.id,p.title,p.icon,s.score,p.updated_at from scores s join public.pages p on p.id=s.page_id
      where p_after_rank is null or s.score<p_after_rank or (s.score=p_after_rank and p.id>p_after_id)
      order by s.score desc,p.id limit 51;
  end if;
end;
$$;

create table public.page_backlinks (
  workspace_id uuid not null,
  source_page_id uuid not null,
  target_page_id uuid not null,
  source_revision bigint not null check (source_revision > 0),
  primary key (source_page_id, target_page_id),
  foreign key (source_page_id, workspace_id) references public.pages(id, workspace_id) on delete cascade,
  foreign key (target_page_id, workspace_id) references public.pages(id, workspace_id) on delete cascade
);
create index page_backlinks_incoming_idx on public.page_backlinks(workspace_id, target_page_id, source_page_id);
create index page_backlinks_outgoing_idx on public.page_backlinks(workspace_id, source_page_id, target_page_id);
create index document_updates_actor_quota_idx on public.document_updates(workspace_id, actor_id, created_at);

-- Reserve CPU budget before any binary decoding. Accepted-update quotas alone
-- cannot limit an authenticated caller repeatedly submitting malformed bytes.
create table private.document_request_windows (
  workspace_id uuid not null,
  actor_id uuid not null,
  window_start timestamptz not null,
  attempts integer not null check (attempts between 1 and 240),
  primary key(workspace_id,actor_id,window_start),
  foreign key(workspace_id,actor_id) references public.workspace_members(workspace_id,user_id) on delete cascade
);
alter table private.document_request_windows enable row level security;
revoke all on private.document_request_windows from public,anon,authenticated;
grant all on private.document_request_windows to service_role;

create function public.reserve_document_validation(p_page_id uuid,p_actor_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_workspace uuid; v_window timestamptz := date_trunc('minute',now()); v_attempts integer;
begin
  select workspace_id into v_workspace from public.pages where id=p_page_id;
  if not found then raise exception 'Document unavailable' using errcode='42501'; end if;
  perform 1 from public.workspaces where id=v_workspace for update;
  perform 1 from public.pages where id=p_page_id for update;
  if coalesce(private.page_role(p_page_id,p_actor_id),'') not in ('owner','editor')
    or not exists(select 1 from auth.users where id=p_actor_id and email_confirmed_at is not null) then
    raise exception 'Document unavailable' using errcode='42501';
  end if;
  delete from private.document_request_windows w where (w.workspace_id,w.actor_id,w.window_start) in (
    select old.workspace_id,old.actor_id,old.window_start from private.document_request_windows old
    where old.workspace_id=v_workspace and old.actor_id=p_actor_id and old.window_start<v_window-interval '2 minutes'
    order by old.window_start limit 32);
  insert into private.document_request_windows as w(workspace_id,actor_id,window_start,attempts)
    values(v_workspace,p_actor_id,v_window,1)
    on conflict(workspace_id,actor_id,window_start) do update set attempts=w.attempts+1
      where w.attempts<240 returning attempts into v_attempts;
  if v_attempts is null then raise exception 'Document validation limit reached; retry later' using errcode='54000'; end if;
end;
$$;
revoke all on function public.reserve_document_validation(uuid,uuid) from public,anon,authenticated;
grant execute on function public.reserve_document_validation(uuid,uuid) to service_role;

alter table public.page_backlinks enable row level security;
create policy backlinks_read on public.page_backlinks for select to authenticated
  using (private.page_role(source_page_id, (select auth.uid())) is not null
    and private.page_role(target_page_id, (select auth.uid())) is not null);
revoke all on public.page_backlinks from public, anon, authenticated;
grant select on public.page_backlinks to authenticated;
grant all on public.page_backlinks to service_role;
-- Preserve explicit pages column privileges: physical parent pointers and title
-- vectors remain accessible only through existing authorized projections.

create function public.get_document_manifest(p_page_id uuid)
returns table(revision bigint, byte_length integer, schema_version integer)
language plpgsql stable security definer set search_path = '' as $$
declare v_actor uuid := private.require_confirmed_user(); v_head public.document_heads%rowtype; v_version text;
begin
  if private.page_role(p_page_id, v_actor) is null then
    raise exception 'Document unavailable' using errcode = '42501';
  end if;
  select * into v_head from public.document_heads where page_id = p_page_id;
  if not found then return query select 0::bigint, 0, 1; return; end if;
  v_version := v_head.projection->>'schemaVersion';
  return query select v_head.revision, octet_length(v_head.snapshot),
    case when jsonb_typeof(v_head.projection->'schemaVersion') = 'number'
      and v_version ~ '^[0-9]{1,10}$' then
        case when v_version::numeric <= 2147483647 then v_version::integer else -1 end
      else -1 end;
end;
$$;

create function public.read_document_chunk(p_page_id uuid, p_revision bigint, p_offset integer default 0)
returns bytea language plpgsql stable security definer set search_path = '' as $$
declare v_actor uuid := private.require_confirmed_user(); v_head public.document_heads%rowtype;
begin
  if private.page_role(p_page_id, v_actor) is null then
    raise exception 'Document unavailable' using errcode = '42501';
  end if;
  if p_offset is null or p_offset < 0 or p_offset > 8388608 or p_offset % 524288 <> 0 then
    raise exception 'Invalid document chunk offset' using errcode = '22023';
  end if;
  select * into v_head from public.document_heads where page_id = p_page_id;
  if p_revision is null or p_revision <> coalesce(v_head.revision, 0) then
    raise exception 'Document revision conflict' using errcode = '40001';
  end if;
  return substring(coalesce(v_head.snapshot, '\x'::bytea) from p_offset + 1 for 524288);
end;
$$;

create function public.resolve_page_mentions(p_workspace_id uuid, p_page_ids uuid[])
returns table(id uuid, title text, icon text)
language plpgsql stable security definer set search_path = '' as $$
declare v_actor uuid := private.require_confirmed_user();
begin
  if p_page_ids is null or cardinality(p_page_ids) > 100 or array_ndims(p_page_ids) > 1
    or (cardinality(p_page_ids) > 0 and array_lower(p_page_ids, 1) <> 1)
    or array_position(p_page_ids, null) is not null then
    raise exception 'Invalid mention identities' using errcode = '22023';
  end if;
  if not private.is_workspace_member(p_workspace_id, v_actor) then return; end if;
  return query select p.id, p.title, p.icon from public.pages p
    where p.workspace_id = p_workspace_id and p.id = any(p_page_ids)
      and private.page_role(p.id, v_actor) is not null
    order by p.id;
end;
$$;

create function public.list_page_backlinks(p_page_id uuid, p_after_id uuid default null)
returns table(id uuid, title text, icon text)
language plpgsql stable security definer set search_path = '' as $$
declare v_actor uuid := private.require_confirmed_user(); v_workspace uuid;
begin
  if private.page_role(p_page_id, v_actor) is null then
    raise exception 'Page unavailable' using errcode = '42501';
  end if;
  select p.workspace_id into v_workspace from public.pages p where p.id = p_page_id;
  return query with visible as materialized(select * from private.visible_page_scope(v_workspace, v_actor))
    select p.id, p.title, p.icon from public.page_backlinks b
    join public.pages p on p.id = b.source_page_id and p.workspace_id = b.workspace_id
    join visible v on v.page_id = p.id
    where b.workspace_id = v_workspace and b.target_page_id = p_page_id
      and (p_after_id is null or p.id > p_after_id)
    order by p.id limit 51;
end;
$$;

create function public.commit_content_document(p_page_id uuid, p_actor_id uuid, p_expected_revision bigint,
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
    or octet_length(p_projection::text) > 8388608
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

revoke all on function public.get_document_manifest(uuid), public.read_document_chunk(uuid,bigint,integer),
  public.resolve_page_mentions(uuid,uuid[]), public.list_page_backlinks(uuid,uuid),
  public.commit_content_document(uuid,uuid,bigint,uuid,bytea,text,bytea,jsonb) from public, anon, authenticated;
grant execute on function public.get_document_manifest(uuid), public.read_document_chunk(uuid,bigint,integer),
  public.resolve_page_mentions(uuid,uuid[]), public.list_page_backlinks(uuid,uuid) to authenticated;
grant execute on function public.commit_content_document(uuid,uuid,bigint,uuid,bytea,text,bytea,jsonb) to service_role;

-- Existing supported projections, if any, join the same title/body index. Unknown
-- legacy/future schema documents keep their bytes and remain explicitly unknown.
do $$declare v_head public.document_heads%rowtype; begin
  for v_head in select * from public.document_heads where projection->'schemaVersion' = '1'::jsonb
    and jsonb_typeof(projection->'text') = 'string' and revision > 0 loop
    perform private.index_content_body(v_head.page_id,v_head.workspace_id,v_head.revision,v_head.projection->>'text');
  end loop;
end$$;
