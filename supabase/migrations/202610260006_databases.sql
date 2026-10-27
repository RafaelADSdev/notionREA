-- Database values are independent relational cells. Page bodies remain stable Yjs documents.
create table public.databases (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null,
  page_id uuid not null unique, revision bigint not null default 0 check (revision >= 0),
  unique (id,workspace_id),
  foreign key (page_id,workspace_id) references public.pages(id,workspace_id) on delete cascade
);
create table public.database_properties (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null, database_id uuid not null,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  type text not null check (type in ('title','text','number','select','multiSelect','date','checkbox','url','person','relation','createdTime','editedTime')),
  config jsonb not null default '{}' check (jsonb_typeof(config)='object' and octet_length(config::text)<=262144),
  position text collate "C" not null check (position ~ '^[0-9A-Za-z]{1,128}$'),
  revision bigint not null default 0 check (revision>=0), unique (id,database_id,workspace_id),
  foreign key (database_id,workspace_id) references public.databases(id,workspace_id) on delete cascade
);
create unique index database_single_title_idx on public.database_properties(database_id) where type='title';
create index database_properties_order_idx on public.database_properties(database_id,position,id);
create table public.database_records (
  database_id uuid not null, page_id uuid primary key, workspace_id uuid not null,
  position text collate "C" not null check (position ~ '^[0-9A-Za-z]{1,128}$'),
  is_template boolean not null default false, unique(database_id,page_id,workspace_id),
  foreign key(database_id,workspace_id) references public.databases(id,workspace_id) on delete cascade,
  foreign key(page_id,workspace_id) references public.pages(id,workspace_id) on delete cascade
);
create index database_records_order_idx on public.database_records(database_id,is_template,position,page_id);
create table public.database_cells (
  database_id uuid not null, page_id uuid not null, property_id uuid not null, workspace_id uuid not null,
  value jsonb not null check (octet_length(value::text)<=32768),
  revision bigint not null default 0 check (revision>=0), primary key(page_id,property_id),
  foreign key(database_id,page_id,workspace_id) references public.database_records(database_id,page_id,workspace_id) on delete cascade,
  foreign key(property_id,database_id,workspace_id) references public.database_properties(id,database_id,workspace_id) on delete cascade
);
create index database_cells_property_idx on public.database_cells(database_id,property_id,page_id);
create table public.database_views (
  id uuid primary key default gen_random_uuid(), database_id uuid not null, workspace_id uuid not null,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  type text not null check (type in ('table','board','list','calendar','gallery')),
  config jsonb not null check (jsonb_typeof(config)='object' and octet_length(config::text)<=65536),
  position text collate "C" not null check (position ~ '^[0-9A-Za-z]{1,128}$'),
  revision bigint not null default 0 check (revision>=0),
  foreign key(database_id,workspace_id) references public.databases(id,workspace_id) on delete cascade
);
create index database_views_order_idx on public.database_views(database_id,position,id);
create table public.database_templates (
  id uuid primary key default gen_random_uuid(), database_id uuid not null, workspace_id uuid not null,
  page_id uuid not null unique, title text not null check (char_length(btrim(title)) between 1 and 120),
  revision bigint not null default 0 check (revision>=0),
  foreign key(database_id,page_id,workspace_id) references public.database_records(database_id,page_id,workspace_id) on delete cascade
);
create index database_templates_database_idx on public.database_templates(database_id,id);

create function private.database_readable(p_database_id uuid,p_page_id uuid default null)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.databases d where d.id=p_database_id
    and private.page_role(d.page_id,auth.uid()) is not null
    and (p_page_id is null or exists(select 1 from public.database_records r
      where r.database_id=d.id and r.page_id=p_page_id and r.workspace_id=d.workspace_id
      and private.page_role(r.page_id,auth.uid()) is not null)));
$$;
create function private.database_record_allowed(p_database_id uuid,p_page_id uuid,p_actor uuid,p_write boolean default false)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.databases d join public.database_records r on r.database_id=d.id and r.workspace_id=d.workspace_id
    where d.id=p_database_id and r.page_id=p_page_id
    and private.page_role(d.page_id,p_actor) is not null and private.page_role(r.page_id,p_actor) is not null
    and (not p_write or (private.page_role(d.page_id,p_actor) in ('owner','editor') and private.page_role(r.page_id,p_actor) in ('owner','editor'))));
$$;
create function private.require_database(p_database_id uuid,p_write boolean default false)
returns public.databases language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=private.require_confirmed_user(); v_database public.databases; v_role text;
begin
  select * into v_database from public.databases where id=p_database_id;
  if p_write then
    perform 1 from public.workspaces where id=v_database.workspace_id for update;
    select * into v_database from public.databases where id=p_database_id for update;
  end if;
  v_role:=private.page_role(v_database.page_id,v_actor);
  if v_role is null or (p_write and v_role not in ('owner','editor')) then
    raise exception 'Database unavailable' using errcode='42501';
  end if;
  return v_database;
end;
$$;

-- Strict JSON shapes and canonical decimal/identity forms also protect direct RPC calls.
create function private.database_object_keys(p_value jsonb,p_keys text[],p_required text[] default '{}')
returns boolean language sql immutable set search_path='' as $$
  select jsonb_typeof(p_value)='object' and not exists(select 1 from jsonb_object_keys(p_value) k where not(k=any(p_keys)))
    and p_value ?& p_required;
$$;
create function private.database_uuid(p_value text)
returns boolean language sql immutable set search_path='' as $$
  select coalesce(p_value ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',false);
$$;
create function private.validate_database_property_config(p_type text,p_config jsonb,p_workspace_id uuid,p_actor uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v_option jsonb; v_seen text[]:='{}'; v_id uuid;
begin
  if p_type is null or p_type not in ('title','text','number','select','multiSelect','date','checkbox','url','person','relation','createdTime','editedTime')
    or p_config is null or jsonb_typeof(p_config)<>'object' or octet_length(p_config::text)>262144 then
    raise exception 'Invalid property definition' using errcode='22023';
  end if;
  if p_type in ('select','multiSelect') then
    if not private.database_object_keys(p_config,array['options'],array['options']) or jsonb_typeof(p_config->'options')<>'array'
      or jsonb_array_length(p_config->'options')>500 then raise exception 'Invalid options' using errcode='22023'; end if;
    for v_option in select value from jsonb_array_elements(p_config->'options') loop
      if not private.database_object_keys(v_option,array['id','label','color'],array['id','label','color'])
        or jsonb_typeof(v_option->'id')<>'string' or not private.database_uuid(v_option->>'id') or v_option->>'id'=any(v_seen)
        or jsonb_typeof(v_option->'label')<>'string' or char_length(btrim(v_option->>'label')) not between 1 and 120
        or jsonb_typeof(v_option->'color')<>'string' or v_option->>'color' not in ('default','indigo','copper','green','red','yellow') then
        raise exception 'Invalid option' using errcode='22023';
      end if;
      v_seen:=array_append(v_seen,v_option->>'id');
    end loop;
  elsif p_type='date' then
    if not private.database_object_keys(p_config,array['mode'],array['mode']) or jsonb_typeof(p_config->'mode')<>'string' or p_config->>'mode' not in ('civil','instant') then
      raise exception 'Invalid date configuration' using errcode='22023'; end if;
  elsif p_type='relation' then
    if not private.database_object_keys(p_config,array['targetDatabaseId'],array['targetDatabaseId'])
      or not private.database_uuid(p_config->>'targetDatabaseId') then raise exception 'Invalid relation configuration' using errcode='22023'; end if;
    v_id:=(p_config->>'targetDatabaseId')::uuid;
    if not exists(select 1 from public.databases d where d.id=v_id and d.workspace_id=p_workspace_id
      and private.page_role(d.page_id,p_actor) is not null) then raise exception 'Relation unavailable' using errcode='42501'; end if;
  elsif p_config<>'{}'::jsonb then raise exception 'Unexpected property configuration' using errcode='22023';
  end if;
end;
$$;
create function private.validate_database_date(p_value jsonb,p_mode text)
returns void language plpgsql stable set search_path='' as $$
declare v_start text:=p_value->>'start'; v_end text:=p_value->>'end'; v_date date; v_instant timestamptz;
begin
  if p_mode is null or p_mode not in ('civil','instant') or p_value->>'kind' is distinct from p_mode
    or not private.database_object_keys(p_value,case when p_mode='civil' then array['kind','start','end'] else array['kind','start','end','timeZone'] end,
      case when p_mode='civil' then array['kind','start','end'] else array['kind','start','end','timeZone'] end)
    or jsonb_typeof(p_value->'start')<>'string' or jsonb_typeof(p_value->'end') not in ('string','null') then
    raise exception 'Invalid date value' using errcode='22023'; end if;
  if p_mode='civil' then
    if v_start !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or left(v_start,4)='0000'
      or (v_end is not null and (v_end !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or left(v_end,4)='0000')) then
      raise exception 'Invalid civil date' using errcode='22023'; end if;
    v_date:=v_start::date;
    if to_char(v_date,'YYYY-MM-DD')<>v_start then raise exception 'Invalid civil date' using errcode='22023'; end if;
    if v_end is not null then v_date:=v_end::date; if to_char(v_date,'YYYY-MM-DD')<>v_end or v_end<v_start then
      raise exception 'Invalid date range' using errcode='22023'; end if; end if;
  else
    if jsonb_typeof(p_value->'timeZone')<>'string' or char_length(p_value->>'timeZone') not between 1 and 100
      or not exists(select 1 from pg_catalog.pg_timezone_names where name=p_value->>'timeZone') then
      raise exception 'Invalid time zone' using errcode='22023'; end if;
    if v_start !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$' or left(v_start,4)='0000'
      or (v_end is not null and (v_end !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$' or left(v_end,4)='0000')) then
      raise exception 'Invalid canonical instant' using errcode='22023'; end if;
    v_instant:=v_start::timestamptz;
    if to_char(v_instant at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')<>v_start
      or (v_end is not null and (to_char(v_end::timestamptz at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')<>v_end or v_end::timestamptz<v_instant)) then
      raise exception 'Invalid instant range' using errcode='22023'; end if;
  end if;
exception when datetime_field_overflow or invalid_datetime_format then raise exception 'Invalid date value' using errcode='22023';
end;
$$;
create function private.validate_database_value(p_property public.database_properties,p_value jsonb,p_previous jsonb default 'null',p_authorize_refs boolean default true)
returns void language plpgsql security definer set search_path='' as $$
declare v_text text:=p_value#>>'{}'; v_item jsonb; v_id uuid; v_ids text[]:='{}'; v_previous text; v_target uuid;
begin
  if p_value is null or octet_length(p_value::text)>32768 then raise exception 'Invalid property value' using errcode='22023'; end if;
  if p_value='null'::jsonb then return; end if;
  if p_property.type in ('title','text','url','number','select','createdTime','editedTime') and jsonb_typeof(p_value)<>'string' then
    raise exception 'Expected string value' using errcode='22023'; end if;
  case p_property.type
    when 'title' then if char_length(v_text)>500 then raise exception 'Title too long' using errcode='22023'; end if;
    when 'text' then if char_length(v_text)>16384 then raise exception 'Text too long' using errcode='22023'; end if;
    when 'number' then
      if char_length(v_text)>128 or v_text !~ '^-?(0|[1-9][0-9]*)(\.[0-9]*[1-9])?$' or v_text='-0' then
        raise exception 'Invalid canonical decimal' using errcode='22023'; end if;
    when 'checkbox' then if jsonb_typeof(p_value)<>'boolean' then raise exception 'Expected boolean' using errcode='22023'; end if;
    when 'url' then
      if char_length(v_text)>2048 or v_text ~ '[[:space:][:cntrl:]\\]' or v_text !~ '^(https?://[^/?#@:]+(:[0-9]+)?([/?#]|$)|mailto:[^?@/]+@[^?@/]+)'
        or v_text ~ '^https?://[^/]*@' then raise exception 'Unsafe URL' using errcode='22023'; end if;
    when 'select' then
      if not private.database_uuid(v_text) or not exists(select 1 from jsonb_array_elements(p_property.config->'options') o where o->>'id'=v_text) then
        raise exception 'Unknown option' using errcode='22023'; end if;
    when 'date' then perform private.validate_database_date(p_value,p_property.config->>'mode');
    when 'createdTime','editedTime' then
      perform private.validate_database_date(jsonb_build_object('kind','instant','start',p_value,'end',null,'timeZone','UTC'),'instant');
    when 'multiSelect','person','relation' then
      if jsonb_typeof(p_value)<>'array' or jsonb_array_length(p_value)>100 then raise exception 'Invalid set' using errcode='22023'; end if;
      for v_item in select value from jsonb_array_elements(p_value) loop
        v_text:=v_item#>>'{}';
        if jsonb_typeof(v_item)<>'string' or not private.database_uuid(v_text) or (v_previous is not null and v_text collate "C"<=v_previous collate "C") then
          raise exception 'Noncanonical identity set' using errcode='22023'; end if;
        v_previous:=v_text; v_ids:=array_append(v_ids,v_text); v_id:=v_text::uuid;
        if p_property.type='multiSelect' and not exists(select 1 from jsonb_array_elements(p_property.config->'options') o where o->>'id'=v_text) then
          raise exception 'Unknown option' using errcode='22023'; end if;
        -- Existing identities remain opaque after revocation. Removing then re-adding reauthorizes.
        if p_authorize_refs and not (coalesce(p_previous,'null') @> jsonb_build_array(v_text)) then
          if p_property.type='person' and not exists(select 1 from public.workspace_members m where m.workspace_id=p_property.workspace_id and m.user_id=v_id) then
            raise exception 'Person unavailable' using errcode='42501';
          elsif p_property.type='relation' then
            v_target:=(p_property.config->>'targetDatabaseId')::uuid;
            if not exists(select 1 from public.database_records r join public.databases d on d.id=r.database_id and d.workspace_id=r.workspace_id
              where r.database_id=v_target and r.page_id=v_id and r.workspace_id=p_property.workspace_id and not r.is_template
              and private.page_role(d.page_id,auth.uid()) is not null and private.page_role(r.page_id,auth.uid()) is not null) then
              raise exception 'Relation unavailable' using errcode='42501'; end if;
          end if;
        end if;
      end loop;
    else raise exception 'Unknown property type' using errcode='22023';
  end case;
end;
$$;

create function private.validate_database_filter(p_database_id uuid,p_filter jsonb,p_depth integer default 1)
returns integer language plpgsql security definer set search_path='' as $$
declare v_kind text:=p_filter->>'kind'; v_operator text:=p_filter->>'operator'; v_property public.database_properties; v_child jsonb; v_count integer:=0; v_allowed text[];
begin
  if p_filter is null or p_depth>5 or octet_length(p_filter::text)>65536 then raise exception 'Invalid filter budget' using errcode='22023'; end if;
  if v_kind in ('and','or') then
    if not private.database_object_keys(p_filter,array['kind','children'],array['kind','children']) or jsonb_typeof(p_filter->'children')<>'array'
      or jsonb_array_length(p_filter->'children') not between 1 and 50 then raise exception 'Invalid filter group' using errcode='22023'; end if;
    for v_child in select value from jsonb_array_elements(p_filter->'children') loop
      v_count:=v_count+private.validate_database_filter(p_database_id,v_child,p_depth+1);
      if v_count>50 then raise exception 'Too many filter conditions' using errcode='22023'; end if;
    end loop;
    return v_count;
  end if;
  if v_kind is distinct from 'condition' or not private.database_object_keys(p_filter,array['kind','propertyId','operator','value'],array['kind','propertyId','operator'])
    or not private.database_uuid(p_filter->>'propertyId') then raise exception 'Invalid filter condition' using errcode='22023'; end if;
  select * into v_property from public.database_properties where database_id=p_database_id and id=(p_filter->>'propertyId')::uuid;
  if not found then raise exception 'Unknown filter property' using errcode='22023'; end if;
  v_allowed:=case
    when v_property.type in ('title','text','url') then array['eq','neq','contains','startsWith']
    when v_property.type='number' then array['eq','neq','lt','lte','gt','gte']
    when v_property.type in ('date','createdTime','editedTime') then array['before','after','between']
    when v_property.type='select' then array['eq','neq'] when v_property.type='checkbox' then array['eq']
    else array['containsAny','containsAll','containsNone'] end || array['isEmpty','isNotEmpty'];
  if v_operator is null or not(v_operator=any(v_allowed)) then raise exception 'Invalid filter operator' using errcode='22023'; end if;
  if v_operator in ('isEmpty','isNotEmpty') then
    if p_filter ? 'value' then raise exception 'Unexpected filter operand' using errcode='22023'; end if;
  else
    if not(p_filter ? 'value') or p_filter->'value'='null' then raise exception 'Missing filter operand' using errcode='22023'; end if;
    if v_property.type in ('title','text','url') then
      if jsonb_typeof(p_filter->'value')<>'string' or char_length(p_filter->>'value')>16384 then raise exception 'Invalid text operand' using errcode='22023'; end if;
    elsif v_property.type in ('createdTime','editedTime') and v_operator='between' then
      perform private.validate_database_date(p_filter->'value','instant');
    else perform private.validate_database_value(v_property,p_filter->'value','null',false);
    end if;
    if v_operator='between' and (jsonb_typeof(p_filter->'value')<>'object' or p_filter->'value'->'end'='null' or not(p_filter->'value' ? 'end')) then
      raise exception 'Missing interval end' using errcode='22023'; end if;
  end if;
  return 1;
end;
$$;
create function private.validate_database_view_config(p_database_id uuid,p_type text,p_config jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare v_item jsonb; v_id uuid; v_seen text[]:='{}'; v_type text;
begin
  if p_type is null or p_type not in ('table','board','list','calendar','gallery') or p_config is null or octet_length(p_config::text)>65536
    or not private.database_object_keys(p_config,array['visibleProperties','sorts','filter','groupBy','datePropertyId'],array['visibleProperties','sorts','filter','groupBy','datePropertyId'])
    or jsonb_typeof(p_config->'visibleProperties')<>'array' or jsonb_array_length(p_config->'visibleProperties')>500
    or jsonb_typeof(p_config->'sorts')<>'array' or jsonb_array_length(p_config->'sorts')>10 then
    raise exception 'Invalid view configuration' using errcode='22023'; end if;
  for v_item in select value from jsonb_array_elements(p_config->'visibleProperties') loop
    if jsonb_typeof(v_item)<>'string' or not private.database_uuid(v_item#>>'{}') or (v_item#>>'{}')=any(v_seen) then
      raise exception 'Invalid visible property' using errcode='22023'; end if;
    v_seen:=array_append(v_seen,v_item#>>'{}'); v_id:=(v_item#>>'{}')::uuid;
    if not exists(select 1 from public.database_properties where database_id=p_database_id and id=v_id) then raise exception 'Unknown view property' using errcode='22023'; end if;
  end loop;
  v_seen:='{}';
  for v_item in select value from jsonb_array_elements(p_config->'sorts') loop
    if not private.database_object_keys(v_item,array['propertyId','direction'],array['propertyId','direction']) or not private.database_uuid(v_item->>'propertyId')
      or v_item->>'direction' not in ('asc','desc') or (v_item->>'propertyId')=any(v_seen) then raise exception 'Invalid view sort' using errcode='22023'; end if;
    v_seen:=array_append(v_seen,v_item->>'propertyId');
    if not exists(select 1 from public.database_properties where database_id=p_database_id and id=(v_item->>'propertyId')::uuid) then raise exception 'Unknown sort property' using errcode='22023'; end if;
  end loop;
  if p_config->'groupBy'<>'null' then
    if not private.database_uuid(p_config->>'groupBy') then raise exception 'Invalid grouping' using errcode='22023'; end if;
    select type into v_type from public.database_properties where database_id=p_database_id and id=(p_config->>'groupBy')::uuid;
    if v_type is null or p_type='calendar' or (p_type='board' and v_type not in ('select','checkbox'))
      or v_type not in ('select','multiSelect','checkbox','person') then raise exception 'Unsupported grouping' using errcode='22023'; end if;
  elsif p_type='board' then raise exception 'Board requires grouping' using errcode='22023'; end if;
  if p_type='calendar' then
    if not private.database_uuid(p_config->>'datePropertyId') or not exists(select 1 from public.database_properties
      where database_id=p_database_id and id=(p_config->>'datePropertyId')::uuid and type='date') then raise exception 'Calendar requires date property' using errcode='22023'; end if;
  elsif p_config->'datePropertyId'<>'null' then raise exception 'Unexpected date property' using errcode='22023'; end if;
  if p_config->'filter'<>'null' then perform private.validate_database_filter(p_database_id,p_config->'filter'); end if;
end;
$$;

create function private.guard_database_cell()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_property public.database_properties; v_previous jsonb:='null'; v_bytes bigint;
begin
  if tg_op='UPDATE' and (new.database_id,new.page_id,new.property_id,new.workspace_id) is distinct from (old.database_id,old.page_id,old.property_id,old.workspace_id) then
    raise exception 'Cell identity is immutable' using errcode='23514'; end if;
  select * into v_property from public.database_properties where id=new.property_id and database_id=new.database_id and workspace_id=new.workspace_id;
  if v_property.type in ('title','createdTime','editedTime') then raise exception 'Virtual property is read-only here' using errcode='22023'; end if;
  if tg_op='UPDATE' then v_previous:=old.value; end if;
  perform private.validate_database_value(v_property,new.value,v_previous,true);
  perform 1 from public.database_records where page_id=new.page_id and database_id=new.database_id for update;
  select coalesce(sum(octet_length(value::text)),0) into v_bytes from public.database_cells where page_id=new.page_id and property_id<>new.property_id;
  if v_bytes+octet_length(new.value::text)>262144 then raise exception 'Record values exceed budget' using errcode='22023'; end if;
  return new;
end;
$$;
create trigger validate_database_cell before insert or update on public.database_cells for each row execute function private.guard_database_cell();

create function public.create_database(p_workspace_id uuid,p_parent_page_id uuid,p_title text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=private.require_confirmed_user(); v_page uuid; v_id uuid; v_title uuid;
begin
  v_page:=public.create_page(p_workspace_id,p_parent_page_id,p_title,p_request_id);
  select id into v_id from public.databases where page_id=v_page;
  if found then return jsonb_build_object('id',v_id,'pageId',v_page); end if;
  if exists(select 1 from public.database_records where page_id=v_page) then raise exception 'Page already belongs to a database' using errcode='22023'; end if;
  insert into public.databases(workspace_id,page_id) values(p_workspace_id,v_page) returning id into v_id;
  insert into public.database_properties(workspace_id,database_id,name,type,position) values(p_workspace_id,v_id,'Nome','title','V') returning id into v_title;
  insert into public.database_views(database_id,workspace_id,name,type,position,config) values(v_id,p_workspace_id,'Tabela','table','V',
    jsonb_build_object('visibleProperties',jsonb_build_array(v_title),'sorts','[]'::jsonb,'filter',null,'groupBy',null,'datePropertyId',null));
  return jsonb_build_object('id',v_id,'pageId',v_page);
end;
$$;
create function public.add_database_record(p_database_id uuid,p_title text,p_request_id uuid,p_is_template boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_database public.databases:=private.require_database(p_database_id,true); v_page uuid; v_position text;
begin
  if p_is_template is null then raise exception 'Invalid template flag' using errcode='22023'; end if;
  v_page:=public.create_page(v_database.workspace_id,v_database.page_id,p_title,p_request_id);
  if exists(select 1 from public.databases where page_id=v_page) or exists(select 1 from public.database_records where page_id=v_page and (database_id<>p_database_id or is_template<>p_is_template)) then
    raise exception 'Idempotency key reused' using errcode='22023'; end if;
  if exists(select 1 from public.database_records where page_id=v_page) then return jsonb_build_object('id',v_page,'pageId',v_page); end if;
  select max(position collate "C") into v_position from public.database_records where database_id=p_database_id and is_template=p_is_template;
  begin v_position:=private.position_between(v_position,null);
  exception when program_limit_exceeded then
    with ordered as(select page_id,row_number() over(order by position collate "C",page_id) n from public.database_records where database_id=p_database_id and is_template=p_is_template)
    update public.database_records r set position=lpad(to_hex(o.n*1024),16,'0')||'V' from ordered o where o.page_id=r.page_id;
    select max(position collate "C") into v_position from public.database_records where database_id=p_database_id and is_template=p_is_template;
    v_position:=private.position_between(v_position,null);
  end;
  insert into public.database_records(database_id,page_id,workspace_id,position,is_template) values(p_database_id,v_page,v_database.workspace_id,v_position,p_is_template);
  update public.databases set revision=revision+1 where id=p_database_id;
  return jsonb_build_object('id',v_page,'pageId',v_page);
end;
$$;
create function public.put_database_cell(p_database_id uuid,p_page_id uuid,p_property_id uuid,p_value jsonb,p_expected_revision bigint)
returns bigint language plpgsql security definer set search_path='' as $$
declare v_database public.databases:=private.require_database(p_database_id,true); v_property public.database_properties; v_cell public.database_cells; v_revision bigint;
begin
  if not private.database_record_allowed(p_database_id,p_page_id,auth.uid(),true) then raise exception 'Record unavailable' using errcode='42501'; end if;
  select * into v_property from public.database_properties where id=p_property_id and database_id=p_database_id for key share;
  if not found or p_expected_revision is null or p_expected_revision<0 then raise exception 'Invalid cell target' using errcode='22023'; end if;
  if v_property.type in ('createdTime','editedTime') then raise exception 'System property is read-only' using errcode='42501'; end if;
  if v_property.type='title' then
    perform private.validate_database_value(v_property,p_value);
    if jsonb_typeof(p_value) is distinct from 'string' then raise exception 'Title must be text' using errcode='22023'; end if;
    v_revision:=public.update_page(p_page_id,p_expected_revision,jsonb_build_object('title',p_value));
  else
    select * into v_cell from public.database_cells where page_id=p_page_id and property_id=p_property_id for update;
    if coalesce(v_cell.revision,0)<>p_expected_revision then raise exception 'Cell revision conflict' using errcode='40001'; end if;
    v_revision:=p_expected_revision+1;
    -- Avoid INSERT .. ON CONFLICT: its BEFORE INSERT trigger would see no previous
    -- value and incorrectly reauthorize opaque identities on an existing cell.
    if v_cell.page_id is null then
      insert into public.database_cells(database_id,page_id,property_id,workspace_id,value,revision)
        values(p_database_id,p_page_id,p_property_id,v_database.workspace_id,p_value,v_revision);
    else
      update public.database_cells set value=p_value,revision=v_revision where page_id=p_page_id and property_id=p_property_id;
    end if;
    -- Cell writes advance editedTime without causing unrelated page-metadata CAS conflicts.
    update public.pages set updated_at=clock_timestamp() where id=p_page_id;
  end if;
  update public.databases set revision=revision+1 where id=p_database_id;
  return v_revision;
end;
$$;

-- A rolling digest binds confirmation to the previewed cells/views without materializing
-- a complete database JSON document. Changed values/revisions invalidate the receipt.
create function private.database_property_preview_token(p_database_id uuid,p_property_id uuid,p_type text,p_config jsonb)
returns text language plpgsql stable security definer set search_path='' as $$
declare v_hash text; v_row record;
begin
  select encode(extensions.digest(convert_to(jsonb_build_array(auth.uid(),p_database_id,p_property_id,p_type,p_config,to_jsonb(p))::text,'UTF8'),'sha256'),'hex')
    into v_hash from public.database_properties p where p.database_id=p_database_id and p.id=p_property_id;
  for v_row in select page_id,revision,value from public.database_cells where database_id=p_database_id and property_id=p_property_id order by page_id loop
    v_hash:=encode(extensions.digest(convert_to(jsonb_build_array(v_hash,v_row.page_id,v_row.revision,v_row.value)::text,'UTF8'),'sha256'),'hex');
  end loop;
  for v_row in select id,revision,config from public.database_views where database_id=p_database_id order by id loop
    v_hash:=encode(extensions.digest(convert_to(jsonb_build_array(v_hash,v_row.id,v_row.revision,v_row.config)::text,'UTF8'),'sha256'),'hex');
  end loop;
  return v_hash;
end;
$$;
-- New property/view/template entities start at revision zero; updates use entity CAS.
-- Type changes return a non-mutating preview until p_confirm=true. Invalid dependent
-- views must be reconfigured first; incompatible cells are discarded only on confirmation.
create function public.put_database_property(p_database_id uuid,p_id uuid,p_name text,p_type text,p_config jsonb,p_expected_revision bigint,p_confirm boolean default false,p_preview_token text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_database public.databases:=private.require_database(p_database_id,true); v_old public.database_properties; v_new public.database_properties;
  v_cell record; v_bad uuid[]:='{}'; v_view record; v_dependencies uuid[]:='{}'; v_position text; v_token text;
begin
  if p_name is null or char_length(btrim(p_name)) not between 1 and 120 or p_expected_revision is null or p_expected_revision<0 or p_confirm is null then
    raise exception 'Invalid property input' using errcode='22023'; end if;
  if p_type is null or p_type not in ('title','text','number','select','multiSelect','date','checkbox','url','person','relation','createdTime','editedTime')
    or p_config is null or jsonb_typeof(p_config)<>'object' or octet_length(p_config::text)>262144 then
    raise exception 'Invalid property definition' using errcode='22023'; end if;
  if p_id is not null then select * into v_old from public.database_properties where database_id=p_database_id and id=p_id for update;
    if not found then raise exception 'Property unavailable' using errcode='22023'; end if;
  end if;
  if coalesce(v_old.revision,0)<>p_expected_revision then raise exception 'Property revision conflict' using errcode='40001'; end if;
  if (v_old.type='title' and p_type<>'title') or (p_type='title' and v_old.type is distinct from 'title') then raise exception 'Required title property is immutable' using errcode='22023'; end if;
  -- An unchanged relation target may remain opaque after its access is revoked.
  if v_old.id is null or v_old.type<>p_type or v_old.config<>p_config then
    perform private.validate_database_property_config(p_type,p_config,v_database.workspace_id,auth.uid());
  end if;
  v_new:=v_old; v_new.id:=coalesce(v_old.id,gen_random_uuid()); v_new.workspace_id:=v_database.workspace_id;
  v_new.database_id:=p_database_id; v_new.name:=btrim(p_name); v_new.type:=p_type; v_new.config:=p_config;
  if v_old.id is not null and (v_old.type<>p_type or v_old.config<>p_config) then
    v_token:=private.database_property_preview_token(p_database_id,p_id,p_type,p_config);
    for v_cell in select page_id,value from public.database_cells where property_id=p_id loop
      if not private.database_record_allowed(p_database_id,v_cell.page_id,auth.uid(),true) then
        raise exception 'Affected record unavailable for schema change' using errcode='42501'; end if;
      begin
        if p_type in ('title','createdTime','editedTime') then raise exception 'Cannot retain stored virtual value' using errcode='22023'; end if;
        perform private.validate_database_value(v_new,v_cell.value,case when v_old.type=p_type and v_old.config=p_config then v_cell.value else 'null'::jsonb end,true);
      exception when invalid_parameter_value or insufficient_privilege then v_bad:=array_append(v_bad,v_cell.page_id);
      end;
    end loop;
    select coalesce(array_agg(id order by id),'{}') into v_dependencies from public.database_views where database_id=p_database_id and config::text like '%'||p_id::text||'%';
    if not p_confirm and (v_old.type<>p_type or cardinality(v_bad)>0) then
      return jsonb_build_object('id',p_id,'revision',v_old.revision,'requiresConfirmation',true,'incompatibleCount',cardinality(v_bad),'dependentViews',to_jsonb(v_dependencies),'previewToken',v_token);
    elsif p_confirm and (p_preview_token is null or p_preview_token<>v_token) then
      raise exception 'Property preview is stale' using errcode='40001';
    end if;
  end if;
  if v_old.id is null then
    select max(position collate "C") into v_position from public.database_properties where database_id=p_database_id;
    v_new.position:=private.position_between(v_position,null); v_new.revision:=0;
    insert into public.database_properties select v_new.*;
  else
    update public.database_properties set name=v_new.name,type=p_type,config=p_config,revision=revision+1 where id=p_id returning * into v_new;
    v_dependencies:='{}';
    for v_view in select id,type,config from public.database_views where database_id=p_database_id loop
      begin perform private.validate_database_view_config(p_database_id,v_view.type,v_view.config);
      exception when invalid_parameter_value then v_dependencies:=array_append(v_dependencies,v_view.id); end;
    end loop;
    if cardinality(v_dependencies)>0 then raise exception 'Reconfigure dependent views before changing property' using errcode='23514'; end if;
    update public.pages set updated_at=clock_timestamp() where id=any(v_bad);
    delete from public.database_cells where property_id=p_id and page_id=any(v_bad);
  end if;
  if (select coalesce(sum(octet_length(jsonb_build_object('id',id,'name',name,'type',type,'config',config)::text)),0) from public.database_properties where database_id=p_database_id)>262144 then
    raise exception 'Database schema exceeds budget' using errcode='22023'; end if;
  update public.databases set revision=revision+1 where id=p_database_id;
  return jsonb_build_object('id',v_new.id,'revision',v_new.revision,'requiresConfirmation',false,'incompatibleCount',cardinality(v_bad),'dependentViews',to_jsonb(v_dependencies));
end;
$$;
create function public.delete_database_property(p_database_id uuid,p_property_id uuid,p_expected_revision bigint,p_confirm boolean default false,p_preview_token text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_database public.databases:=private.require_database(p_database_id,true); v_property public.database_properties; v_views jsonb; v_count bigint; v_token text;
begin
  select * into v_property from public.database_properties where database_id=p_database_id and id=p_property_id for update;
  if not found or v_property.type='title' then raise exception 'Property cannot be removed' using errcode='22023'; end if;
  if p_expected_revision is null or v_property.revision<>p_expected_revision then raise exception 'Property revision conflict' using errcode='40001'; end if;
  if exists(select 1 from public.database_cells c where c.property_id=p_property_id
    and not private.database_record_allowed(p_database_id,c.page_id,auth.uid(),true)) then
    raise exception 'Affected record unavailable for schema change' using errcode='42501'; end if;
  select coalesce(jsonb_agg(id order by id),'[]') into v_views from public.database_views where database_id=p_database_id
    and config::text like '%'||p_property_id::text||'%';
  select count(*) into v_count from public.database_cells where property_id=p_property_id;
  v_token:=private.database_property_preview_token(p_database_id,p_property_id,null,null);
  if p_confirm is null then raise exception 'Invalid confirmation' using errcode='22023'; end if;
  if p_confirm then
    if p_preview_token is null or p_preview_token<>v_token then raise exception 'Property preview is stale' using errcode='40001'; end if;
    if jsonb_array_length(v_views)>0 then raise exception 'Reconfigure dependent views before removing property' using errcode='23514'; end if;
    update public.pages set updated_at=clock_timestamp() where id in(select page_id from public.database_cells where property_id=p_property_id);
    delete from public.database_properties where id=p_property_id;
    update public.databases set revision=revision+1 where id=p_database_id;
  end if;
  return jsonb_build_object('deleted',p_confirm,'dependentViews',v_views,'valueCount',v_count,'previewToken',v_token);
end;
$$;
create function public.put_database_view(p_database_id uuid,p_id uuid,p_name text,p_type text,p_config jsonb,p_expected_revision bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_database public.databases:=private.require_database(p_database_id,true); v_view public.database_views; v_position text;
begin
  if p_name is null or char_length(btrim(p_name)) not between 1 and 120 or p_expected_revision is null or p_expected_revision<0 then raise exception 'Invalid view input' using errcode='22023'; end if;
  perform private.validate_database_view_config(p_database_id,p_type,p_config);
  if p_id is null then
    if p_expected_revision<>0 then raise exception 'View revision conflict' using errcode='40001'; end if;
    select max(position collate "C") into v_position from public.database_views where database_id=p_database_id;
    insert into public.database_views(database_id,workspace_id,name,type,config,position) values(p_database_id,v_database.workspace_id,btrim(p_name),p_type,p_config,private.position_between(v_position,null)) returning * into v_view;
  else
    select * into v_view from public.database_views where database_id=p_database_id and id=p_id for update;
    if not found then raise exception 'View unavailable' using errcode='22023'; end if;
    if v_view.revision<>p_expected_revision then raise exception 'View revision conflict' using errcode='40001'; end if;
    update public.database_views set name=btrim(p_name),type=p_type,config=p_config,revision=revision+1 where id=p_id returning * into v_view;
  end if;
  update public.databases set revision=revision+1 where id=p_database_id;
  return jsonb_build_object('id',v_view.id,'revision',v_view.revision);
end;
$$;
create function public.delete_database_view(p_database_id uuid,p_view_id uuid,p_expected_revision bigint)
returns void language plpgsql security definer set search_path='' as $$
declare v_database public.databases:=private.require_database(p_database_id,true); v_revision bigint;
begin
  select revision into v_revision from public.database_views where database_id=p_database_id and id=p_view_id for update;
  if not found then raise exception 'View unavailable' using errcode='22023'; end if;
  if p_expected_revision is null or v_revision<>p_expected_revision then raise exception 'View revision conflict' using errcode='40001'; end if;
  if (select count(*) from public.database_views where database_id=p_database_id)<=1 then raise exception 'Keep at least one view' using errcode='23514'; end if;
  delete from public.database_views where id=p_view_id;
  update public.databases set revision=revision+1 where id=p_database_id;
end;
$$;
create function public.put_database_template(p_database_id uuid,p_id uuid,p_page_id uuid,p_title text,p_expected_revision bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_database public.databases:=private.require_database(p_database_id,true); v_template public.database_templates;
begin
  if not private.database_record_allowed(p_database_id,p_page_id,auth.uid(),true)
    or not exists(select 1 from public.database_records where database_id=p_database_id and page_id=p_page_id and is_template) then raise exception 'Template page unavailable' using errcode='42501'; end if;
  if p_title is null or char_length(btrim(p_title)) not between 1 and 120 or p_expected_revision is null or p_expected_revision<0 then raise exception 'Invalid template input' using errcode='22023'; end if;
  if p_id is null then
    if p_expected_revision<>0 then raise exception 'Template revision conflict' using errcode='40001'; end if;
    insert into public.database_templates(database_id,workspace_id,page_id,title) values(p_database_id,v_database.workspace_id,p_page_id,btrim(p_title)) returning * into v_template;
  else
    select * into v_template from public.database_templates where database_id=p_database_id and id=p_id for update;
    if not found or v_template.page_id<>p_page_id then raise exception 'Template unavailable' using errcode='22023'; end if;
    if v_template.revision<>p_expected_revision then raise exception 'Template revision conflict' using errcode='40001'; end if;
    update public.database_templates set title=btrim(p_title),revision=revision+1 where id=p_id returning * into v_template;
  end if;
  update public.databases set revision=revision+1 where id=p_database_id;
  return jsonb_build_object('id',v_template.id,'revision',v_template.revision);
end;
$$;
create function public.delete_database_template(p_database_id uuid,p_template_id uuid,p_expected_revision bigint)
returns void language plpgsql security definer set search_path='' as $$
declare v_database public.databases:=private.require_database(p_database_id,true); v_template public.database_templates;
begin
  select * into v_template from public.database_templates where database_id=p_database_id and id=p_template_id for update;
  if not found or not private.database_record_allowed(p_database_id,v_template.page_id,auth.uid(),true) then raise exception 'Template unavailable' using errcode='42501'; end if;
  if p_expected_revision is null or v_template.revision<>p_expected_revision then raise exception 'Template revision conflict' using errcode='40001'; end if;
  delete from public.database_templates where id=p_template_id;
  -- Metadata deletion preserves its body/defaults page for explicit lifecycle handling.
  update public.databases set revision=revision+1 where id=p_database_id;
end;
$$;
create function public.get_database_metadata(p_database_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_database public.databases:=private.require_database(p_database_id); v_properties jsonb; v_views jsonb; v_templates jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'type',type,'config',config,'position',position,'revision',revision) order by position collate "C",id),'[]')
    into v_properties from public.database_properties where database_id=p_database_id;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'type',type,'config',config,'position',position,'revision',revision) order by position collate "C",id),'[]')
    into v_views from public.database_views where database_id=p_database_id;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'pageId',page_id,'title',title,'revision',revision) order by id),'[]')
    into v_templates from public.database_templates where database_id=p_database_id and private.database_record_allowed(p_database_id,page_id,auth.uid());
  return jsonb_build_object('id',v_database.id,'workspaceId',v_database.workspace_id,'pageId',v_database.page_id,'revision',v_database.revision,
    'role',private.page_role(v_database.page_id,auth.uid()),'properties',v_properties,'views',v_views,'templates',v_templates);
end;
$$;

alter table public.databases enable row level security;
alter table public.database_properties enable row level security;
alter table public.database_records enable row level security;
alter table public.database_cells enable row level security;
alter table public.database_views enable row level security;
alter table public.database_templates enable row level security;
create policy database_read on public.databases for select to authenticated using(private.database_readable(id));
create policy database_properties_read on public.database_properties for select to authenticated using(private.database_readable(database_id));
create policy database_records_read on public.database_records for select to authenticated using(private.database_readable(database_id,page_id));
create policy database_cells_read on public.database_cells for select to authenticated using(private.database_readable(database_id,page_id));
create policy database_views_read on public.database_views for select to authenticated using(private.database_readable(database_id));
create policy database_templates_read on public.database_templates for select to authenticated using(private.database_readable(database_id,page_id));
revoke all on public.databases,public.database_properties,public.database_records,public.database_cells,public.database_views,public.database_templates from anon,authenticated;
grant select on public.databases,public.database_properties,public.database_records,public.database_cells,public.database_views,public.database_templates to authenticated;
grant all on public.databases,public.database_properties,public.database_records,public.database_cells,public.database_views,public.database_templates to service_role;
revoke all on function private.database_readable(uuid,uuid),private.database_record_allowed(uuid,uuid,uuid,boolean),private.require_database(uuid,boolean),
  private.database_object_keys(jsonb,text[],text[]),private.database_uuid(text),private.validate_database_property_config(text,jsonb,uuid,uuid),private.validate_database_date(jsonb,text),
  private.validate_database_value(public.database_properties,jsonb,jsonb,boolean),private.validate_database_filter(uuid,jsonb,integer),private.validate_database_view_config(uuid,text,jsonb),private.guard_database_cell(),
  private.database_property_preview_token(uuid,uuid,text,jsonb)
  from public,anon,authenticated;
grant execute on function private.database_readable(uuid,uuid) to authenticated;
revoke all on function public.create_database(uuid,uuid,text,uuid),public.add_database_record(uuid,text,uuid,boolean),public.put_database_cell(uuid,uuid,uuid,jsonb,bigint),
  public.put_database_property(uuid,uuid,text,text,jsonb,bigint,boolean,text),public.delete_database_property(uuid,uuid,bigint,boolean,text),public.put_database_view(uuid,uuid,text,text,jsonb,bigint),
  public.delete_database_view(uuid,uuid,bigint),public.put_database_template(uuid,uuid,uuid,text,bigint),public.delete_database_template(uuid,uuid,bigint),public.get_database_metadata(uuid) from public,anon;
grant execute on function public.create_database(uuid,uuid,text,uuid),public.add_database_record(uuid,text,uuid,boolean),public.put_database_cell(uuid,uuid,uuid,jsonb,bigint),
  public.put_database_property(uuid,uuid,text,text,jsonb,bigint,boolean,text),public.delete_database_property(uuid,uuid,bigint,boolean,text),public.put_database_view(uuid,uuid,text,text,jsonb,bigint),
  public.delete_database_view(uuid,uuid,bigint),public.put_database_template(uuid,uuid,uuid,text,bigint),public.delete_database_template(uuid,uuid,bigint),public.get_database_metadata(uuid) to authenticated;
