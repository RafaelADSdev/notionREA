-- Database queries keep ACL expansion and pagination inside one bounded SQL plan.
alter table public.database_records add column revision bigint not null default 0 check(revision>=0);

create function private.database_numeric(p_value jsonb)
returns numeric language sql immutable parallel safe set search_path='' as $$
  select case when jsonb_typeof(p_value)='string' and char_length(p_value#>>'{}')<=128
    and (p_value#>>'{}') ~ '^-?(0|[1-9][0-9]*)(\.[0-9]*[1-9])?$' then (p_value#>>'{}')::numeric end;
$$;
create index database_cells_number_idx on public.database_cells(database_id,property_id,private.database_numeric(value),page_id);
-- A bounded prefix fits PostgreSQL btree entries even for maximum-length UTF-8 text.
-- Equality/prefix predicates still compare the full value; this index never truncates data.
create index database_cells_text_prefix_idx on public.database_cells(database_id,property_id,(left(value#>>'{}',512) collate "C"),page_id);
create index database_cells_date_idx on public.database_cells(database_id,property_id,((value->>'start') collate "C"),page_id);
create index database_cells_set_idx on public.database_cells using gin(value);

-- Only validated structure selects SQL tokens. Every client operand and identity is
-- retained in the bound conditions JSON ($4), never interpolated into a SQL fragment.
create function private.database_filter_query(p_database_id uuid,p_filter jsonb,p_index integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_property public.database_properties; v_child jsonb; v_part jsonb; v_parts text[]:='{}';
  v_conditions jsonb:='[]'; v_sql text; v_actual text; v_operand text; v_predicate text; v_operator text:=p_filter->>'operator';
  v_cell text; v_virtual boolean; v_index integer:=p_index;
begin
  if p_filter is null or p_filter='null' then return jsonb_build_object('sql','true','conditions','[]'::jsonb); end if;
  if p_filter->>'kind' in ('and','or') then
    for v_child in select value from jsonb_array_elements(p_filter->'children') loop
      v_part:=private.database_filter_query(p_database_id,v_child,v_index);
      v_parts:=array_append(v_parts,'('||(v_part->>'sql')||')');
      v_conditions:=v_conditions||(v_part->'conditions');
      v_index:=v_index+jsonb_array_length(v_part->'conditions');
    end loop;
    return jsonb_build_object('sql',array_to_string(v_parts,case when p_filter->>'kind'='and' then ' AND ' else ' OR ' end),'conditions',v_conditions);
  end if;
  select * into strict v_property from public.database_properties where database_id=p_database_id and id=(p_filter->>'propertyId')::uuid;
  v_virtual:=v_property.type in ('title','createdTime','editedTime');
  v_cell:=format('select 1 from public.database_cells fc where fc.database_id=$3 and fc.page_id=r.page_id and fc.property_id=($4->%s->>''propertyId'')::uuid',v_index);
  v_actual:=case v_property.type when 'title' then 'p.title' when 'createdTime' then 'to_char(p.created_at at time zone ''UTC'',''YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'')'
    when 'editedTime' then 'to_char(p.updated_at at time zone ''UTC'',''YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'')'
    when 'number' then 'private.database_numeric(fc.value)' when 'date' then '(fc.value->>''start'')'
    else '(fc.value#>>''{}'')' end;
  v_operand:=format('($4->%s->>''value'')',v_index);
  if v_operator in ('isEmpty','isNotEmpty') then
    if v_virtual then v_sql:=case when v_operator='isEmpty' then '('||v_actual||'='''')' else '('||v_actual||'<>'''')' end;
    elsif v_property.type='checkbox' then
      v_sql:='exists('||v_cell||' and fc.value=''null''::jsonb)';
      if v_operator='isNotEmpty' then v_sql:='not ('||v_sql||')'; end if;
    else
      v_sql:='exists('||v_cell||' and fc.value not in (''null''::jsonb,''""''::jsonb,''[]''::jsonb))';
      if v_operator='isEmpty' then v_sql:='not ('||v_sql||')'; end if;
    end if;
  elsif v_operator in ('containsAny','containsAll','containsNone') then
    if v_operator='containsAll' then
      v_sql:=format('($4->%s->''value''=''[]''::jsonb OR exists(%s and fc.value @> ($4->%s->''value'')))',v_index,v_cell,v_index);
    else
      v_sql:=format('exists(%s and fc.value ?| array(select jsonb_array_elements_text($4->%s->''value'')))',v_cell,v_index);
      if v_operator='containsNone' then v_sql:='not ('||v_sql||')'; end if;
    end if;
  else
    if v_property.type='number' then v_operand:='('||v_operand||')::numeric'; end if;
    if v_property.type='date' then v_operand:=format('($4->%s->''value''->>''start'')',v_index); end if;
    if v_property.type='checkbox' then v_actual:='(fc.value#>>''{}'')::boolean'; v_operand:='('||v_operand||')::boolean'; end if;
    v_predicate:=case v_operator
      when 'contains' then 'position('||v_operand||' in '||v_actual||')>0'
      when 'startsWith' then 'starts_with('||v_actual||','||v_operand||')'
      when 'between' then format('(%s collate "C">=($4->%s->''value''->>''start'') collate "C" AND %s collate "C"<=($4->%s->''value''->>''end'') collate "C")',v_actual,v_index,v_actual,v_index)
      else v_actual||case v_operator when 'eq' then ' = ' when 'neq' then ' <> ' when 'lt' then ' < ' when 'before' then ' < '
        when 'lte' then ' <= ' when 'gt' then ' > ' when 'after' then ' > ' when 'gte' then ' >= ' end||v_operand end;
    if v_property.type in ('title','text','url','date','createdTime','editedTime','select') and v_operator not in ('contains','startsWith','between') then
      v_predicate:=v_actual||' collate "C"'||case v_operator when 'eq' then ' = ' when 'neq' then ' <> ' when 'before' then ' < ' when 'after' then ' > ' end||v_operand||' collate "C"';
    end if;
    if v_virtual then v_sql:=v_predicate;
    else
      if v_property.type in ('text','url') and v_operator='eq' then
        v_predicate:='left(fc.value#>>''{}'',512) collate "C"=left('||v_operand||',512) collate "C" AND '||v_predicate;
      end if;
      v_sql:='exists('||v_cell||' and '||v_predicate||')';
      -- A missing checkbox has the declared default false; explicit null is absent.
      if v_property.type='checkbox' then v_sql:='('||v_sql||' OR (not exists('||v_cell||') AND '||v_operand||'=false))'; end if;
    end if;
  end if;
  return jsonb_build_object('sql','('||v_sql||')','conditions',jsonb_build_array(p_filter));
end;
$$;

create function public.query_database_records(p_database_id uuid,p_view_id uuid,p_filter jsonb default null,p_use_filter boolean default false,
  p_sorts jsonb default null,p_cursor jsonb default null,p_group_by uuid default null,p_use_group boolean default false,p_month text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=private.require_confirmed_user(); v_database public.databases:=private.require_database(p_database_id);
  v_view public.database_views; v_config jsonb; v_filter jsonb; v_compiled jsonb; v_sorts jsonb; v_properties jsonb:='[]';
  v_property public.database_properties; v_sort jsonb; v_index integer:=0; v_count integer; v_direction text;
  v_joins text:=''; v_columns text:=''; v_order text:=''; v_keys text:=''; v_key text; v_cursor_key text; v_key_type text;
  v_after text:='false'; v_equal text:='true'; v_compare text; v_key_json text; v_query_key text; v_sql text; v_result jsonb;
  v_cursor jsonb:=nullif(p_cursor,'null'::jsonb); v_check jsonb; v_key_value jsonb;
begin
  -- Schema/view mutations use this row's FOR UPDATE lock. Hold a shared lease for
  -- the short query so its descriptor and typed cell plan cannot change mid-call.
  select * into v_database from public.databases where id=p_database_id for share;
  select * into v_view from public.database_views where id=p_view_id and database_id=p_database_id;
  if not found then raise exception 'View unavailable' using errcode='42501'; end if;
  if p_use_filter is null or p_use_group is null or (p_month is not null and (p_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' or left(p_month,4)='0000')) then
    raise exception 'Invalid query configuration' using errcode='22023'; end if;
  v_config:=v_view.config;
  if p_use_filter then v_config:=jsonb_set(v_config,'{filter}',coalesce(p_filter,'null'::jsonb)); end if;
  if p_sorts is not null and p_sorts<>'null' then v_config:=jsonb_set(v_config,'{sorts}',p_sorts); end if;
  if p_use_group then v_config:=jsonb_set(v_config,'{groupBy}',coalesce(to_jsonb(p_group_by),'null'::jsonb)); end if;
  perform private.validate_database_view_config(p_database_id,v_view.type,v_config);
  v_filter:=v_config->'filter'; v_sorts:=v_config->'sorts'; v_count:=jsonb_array_length(v_sorts);
  v_compiled:=private.database_filter_query(p_database_id,v_filter);
  select encode(extensions.digest(convert_to(jsonb_build_array(p_database_id,p_view_id,v_database.revision,v_view.revision,v_config,p_month,
    (select jsonb_agg(jsonb_build_array(id,type,config,revision) order by id) from public.database_properties where database_id=p_database_id))::text,'UTF8'),'sha256'),'hex') into v_query_key;
  if v_cursor is not null then
    if octet_length(v_cursor::text)>65536 or not private.database_object_keys(v_cursor,array['version','viewId','revision','queryKey','recordId','position','keys'],array['version','viewId','revision','queryKey','recordId','position','keys'])
      or v_cursor->'version' is distinct from '1'::jsonb or v_cursor->>'viewId' is distinct from p_view_id::text or v_cursor->>'queryKey' is distinct from v_query_key
      or jsonb_typeof(v_cursor->'revision')<>'number' or v_cursor->>'revision' is distinct from v_database.revision::text
      or not private.database_uuid(v_cursor->>'recordId') or jsonb_typeof(v_cursor->'position')<>'string'
      or v_cursor->>'position'!~'^[0-9A-Za-z]{1,128}$' or jsonb_typeof(v_cursor->'keys')<>'array' or jsonb_array_length(v_cursor->'keys')<>v_count then
      raise exception 'Stale or invalid query cursor' using errcode='40001'; end if;
  end if;
  for v_sort in select value from jsonb_array_elements(v_sorts) loop
    select * into strict v_property from public.database_properties where database_id=p_database_id and id=(v_sort->>'propertyId')::uuid;
    v_properties:=v_properties||jsonb_build_array(to_jsonb(v_property));
    v_direction:=v_sort->>'direction';
    if v_property.type not in ('title','createdTime','editedTime') then
      v_joins:=v_joins||format(' LEFT JOIN public.database_cells s%s ON s%s.page_id=r.page_id AND s%s.database_id=$3 AND s%s.property_id=($5->%s->>''propertyId'')::uuid ',v_index,v_index,v_index,v_index,v_index);
    end if;
    v_key_type:='text';
    case v_property.type
      when 'title' then v_key:='p.title';
      when 'createdTime' then v_key:='to_char(p.created_at at time zone ''UTC'',''YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'')';
      when 'editedTime' then v_key:='to_char(p.updated_at at time zone ''UTC'',''YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'')';
      when 'number' then v_key:=format('private.database_numeric(s%s.value)',v_index); v_key_type:='numeric';
      when 'checkbox' then v_key:=format('case when s%s.page_id is null then false else (s%s.value#>>''{}'')::boolean end',v_index,v_index); v_key_type:='boolean';
      when 'date' then v_key:=format('(s%s.value->>''start'')',v_index);
      when 'select' then
        v_joins:=v_joins||format(' LEFT JOIN jsonb_array_elements($6->%s->''config''->''options'') with ordinality o%s(option,ordinal) ON o%s.option->>''id''=s%s.value#>>''{}'' ',v_index,v_index,v_index,v_index);
        v_key:=format('(o%s.ordinal-1)::integer',v_index); v_key_type:='integer';
      when 'multiSelect','person','relation' then
        v_key:=format('case when s%s.value=''null''::jsonb then null else coalesce((select string_agg(e#>>''{}'','','' order by e#>>''{}'' collate "C") from jsonb_array_elements(coalesce(s%s.value,''[]''::jsonb)) e),'''') end',v_index,v_index);
      else v_key:=format('(s%s.value#>>''{}'')',v_index);
    end case;
    if v_key_type='text' then v_key:='('||v_key||') collate "C"'; end if;
    v_columns:=v_columns||format(', %s as k%s',v_key,v_index);
    v_order:=v_order||format('k%s %s nulls last,',v_index,v_direction);
    v_key_json:=case when v_key_type='integer' then format('to_jsonb(lpad(k%s::text,4,''0''))',v_index)
      when v_key_type='numeric' then format('to_jsonb(k%s::text)',v_index) else format('to_jsonb(k%s)',v_index) end;
    v_keys:=v_keys||case when v_index>0 then ',' else '' end||v_key_json;
    v_cursor_key:=format('($7->''keys''->%s#>>''{}'')::%s',v_index,v_key_type);
    if v_key_type='text' then v_cursor_key:='('||v_cursor_key||') collate "C"'; end if;
    v_compare:=format('(k%s is null AND %s is not null OR k%s %s %s)',v_index,v_cursor_key,v_index,case when v_direction='asc' then '>' else '<' end,v_cursor_key);
    v_after:=v_after||' OR ('||v_equal||' AND '||v_compare||')';
    v_equal:=v_equal||format(' AND k%s is not distinct from %s',v_index,v_cursor_key);
    if v_cursor is not null then
      v_key_value:=v_cursor->'keys'->v_index;
      if v_key_value<>'null' then
        if v_property.type='select' then
          if jsonb_typeof(v_key_value)<>'string' or v_key_value#>>'{}'!~'^[0-9]{4}$' or (v_key_value#>>'{}')::integer>=jsonb_array_length(v_property.config->'options') then raise exception 'Invalid option cursor' using errcode='22023'; end if;
        elsif v_property.type in ('person','relation','multiSelect') then
          if jsonb_typeof(v_key_value)<>'string' then raise exception 'Invalid set cursor' using errcode='22023'; end if;
          v_check:=case when v_key_value='""' then '[]'::jsonb else to_jsonb(string_to_array(v_key_value#>>'{}',',')) end;
          perform private.validate_database_value(v_property,v_check,'null',false);
        elsif v_property.type='date' then
          perform private.validate_database_date(jsonb_build_object('kind',v_property.config->>'mode','start',v_key_value,'end',null)||case when v_property.config->>'mode'='instant' then '{"timeZone":"UTC"}'::jsonb else '{}'::jsonb end,v_property.config->>'mode');
        else perform private.validate_database_value(v_property,v_key_value,'null',false);
        end if;
      end if;
    end if;
    v_index:=v_index+1;
  end loop;
  if v_count=0 then
    v_order:='position collate "C",';
    v_after:='position collate "C">($7->>''position'') collate "C" OR (position=($7->>''position'') AND id>($7->>''recordId'')::uuid)';
  else v_after:=v_after||' OR ('||v_equal||' AND id>($7->>''recordId'')::uuid)'; end if;
  v_order:=v_order||'id';
  -- Month is a presentation context, bound to the cursor. Do not drop undated
  -- records or intervals outside an initially loaded month: all remain reachable.
  v_sql:='with visible as materialized(select * from private.visible_page_scope($1,$2)), keyed as (
    select r.page_id as id,r.page_id,r.position,r.revision,p.title,p.created_at,p.updated_at,p.cover_file_id'||v_columns||'
    from public.database_records r join public.pages p on p.id=r.page_id and p.workspace_id=r.workspace_id
    join visible vp on vp.page_id=r.page_id '||v_joins||'
    where r.database_id=$3 and not r.is_template and exists(select 1 from visible where page_id=$8) and '||(v_compiled->>'sql')||'
  ), candidates as materialized(select *,row_number() over(order by '||v_order||') ordinal,jsonb_build_array('||v_keys||') cursor_keys
    from keyed where ($7 is null OR ('||v_after||')) order by '||v_order||' limit 51),
  payloads as materialized(select c.ordinal,jsonb_build_object(''id'',c.id,''title'',c.title,''position'',c.position,''revision'',c.revision,
    ''values'',vals.value,''cellRevisions'',vals.revisions,''createdAt'',to_char(c.created_at at time zone ''UTC'',''YYYY-MM-DD"T"HH24:MI:SS.MS"Z"''),
    ''editedAt'',to_char(c.updated_at at time zone ''UTC'',''YYYY-MM-DD"T"HH24:MI:SS.MS"Z"''),''coverFileId'',c.cover_file_id) payload,
    jsonb_build_object(''version'',1,''viewId'',$9,''revision'',$10,''queryKey'',$11,''recordId'',c.id,''position'',c.position,''keys'',c.cursor_keys) cursor
    from candidates c cross join lateral(select jsonb_object_agg(dp.id::text,
      case dp.type when ''title'' then to_jsonb(c.title) when ''createdTime'' then to_jsonb(to_char(c.created_at at time zone ''UTC'',''YYYY-MM-DD"T"HH24:MI:SS.MS"Z"''))
      when ''editedTime'' then to_jsonb(to_char(c.updated_at at time zone ''UTC'',''YYYY-MM-DD"T"HH24:MI:SS.MS"Z"''))
      else coalesce(dc.value,case when dp.type=''checkbox'' then ''false''::jsonb when dp.type in (''person'',''relation'',''multiSelect'') then ''[]''::jsonb else ''null''::jsonb end) end) value,
      jsonb_object_agg(dp.id::text,case when dp.type=''title'' then (select revision from public.pages where id=c.id) else coalesce(dc.revision,0) end) revisions
      from public.database_properties dp left join public.database_cells dc on dc.page_id=c.id and dc.property_id=dp.id where dp.database_id=$3) vals),
  budget as(select *,sum(octet_length(payload::text)) over(order by ordinal) total_bytes from payloads),
  included as(select * from budget where ordinal<=50 and ordinal<coalesce((select min(ordinal) from budget where total_bytes+octet_length(cursor::text)+1024>1048576),52))
  select jsonb_build_object(''rows'',coalesce((select jsonb_agg(payload order by ordinal) from included),''[]''::jsonb),
    ''nextCursor'',case when (select count(*) from candidates)>(select count(*) from included) then (select cursor from included order by ordinal desc limit 1) else null end,
    ''queryKey'',$11,''revision'',$10,''viewId'',$9)';
  execute v_sql into v_result using v_database.workspace_id,v_actor,p_database_id,v_compiled->'conditions',v_sorts,v_properties,v_cursor,v_database.page_id,p_view_id,v_database.revision,v_query_key;
  if octet_length(v_result::text)>1048576 then raise exception 'Query response exceeds budget' using errcode='54000'; end if;
  return v_result;
end;
$$;

create function public.move_database_record(p_database_id uuid,p_page_id uuid,p_before_id uuid,p_expected_revision bigint)
returns bigint language plpgsql security definer set search_path='' as $$
declare v_database public.databases:=private.require_database(p_database_id,true); v_record public.database_records;
  v_before text; v_after text; v_position text; v_attempt integer;
begin
  if not private.database_record_allowed(p_database_id,p_page_id,auth.uid(),true) then raise exception 'Record unavailable' using errcode='42501'; end if;
  select * into v_record from public.database_records where database_id=p_database_id and page_id=p_page_id for update;
  if p_expected_revision is null or p_expected_revision<0 then raise exception 'Invalid record revision' using errcode='22023'; end if;
  if v_record.revision<>p_expected_revision then raise exception 'Record revision conflict' using errcode='40001'; end if;
  if p_before_id=p_page_id then return v_record.revision; end if;
  if p_before_id is not null and not private.database_record_allowed(p_database_id,p_before_id,auth.uid()) then raise exception 'Destination unavailable' using errcode='42501'; end if;
  for v_attempt in 1..2 loop
    v_before:=null; v_after:=null;
    if p_before_id is not null then
      select position into v_before from public.database_records where database_id=p_database_id and page_id=p_before_id and is_template=v_record.is_template;
      if not found then raise exception 'Invalid record destination' using errcode='22023'; end if;
    end if;
    select r.position into v_after from public.database_records r join public.pages p on p.id=r.page_id
      where r.database_id=p_database_id and r.is_template=v_record.is_template and r.page_id<>p_page_id and p.deleted_at is null
      and (p_before_id is null or (r.position collate "C",r.page_id)<(v_before collate "C",p_before_id)) order by r.position collate "C" desc,r.page_id desc limit 1;
    begin v_position:=private.position_between(v_after,v_before); exit;
    exception when program_limit_exceeded then
      if v_attempt=2 then raise; end if;
      with ordered as(select page_id,row_number() over(order by position collate "C",page_id) n from public.database_records where database_id=p_database_id and is_template=v_record.is_template)
      update public.database_records r set position=lpad(to_hex(o.n*1024),16,'0')||'V',revision=revision+1 from ordered o where r.page_id=o.page_id;
    end;
  end loop;
  update public.database_records set position=v_position,revision=revision+1 where page_id=p_page_id returning revision into v_record.revision;
  update public.pages set updated_at=clock_timestamp() where id=p_page_id;
  update public.databases set revision=revision+1 where id=p_database_id;
  return v_record.revision;
end;
$$;

create function public.list_databases(p_workspace_id uuid,p_query text default '',p_after_id uuid default null)
returns table(id uuid,"pageId" uuid,title text) language plpgsql stable security definer set search_path='' as $$
declare v_actor uuid:=private.require_confirmed_user();
begin
  if p_query is null or char_length(p_query)>500 then raise exception 'Invalid database query' using errcode='22023'; end if;
  return query with visible as materialized(select * from private.visible_page_scope(p_workspace_id,v_actor))
    select d.id,d.page_id,p.title from public.databases d join public.pages p on p.id=d.page_id join visible v on v.page_id=d.page_id
    where d.workspace_id=p_workspace_id and (p_after_id is null or d.id>p_after_id) and position(lower(p_query) in lower(p.title))>0 order by d.id limit 51;
end;
$$;
create function public.find_database_references(p_database_id uuid,p_query text default '',p_after_id uuid default null)
returns table(id uuid,label text,"databaseId" uuid) language plpgsql stable security definer set search_path='' as $$
declare v_actor uuid:=private.require_confirmed_user(); v_database public.databases:=private.require_database(p_database_id);
begin
  if p_query is null or char_length(p_query)>500 then raise exception 'Invalid reference query' using errcode='22023'; end if;
  return query with visible as materialized(select * from private.visible_page_scope(v_database.workspace_id,v_actor))
    select r.page_id,p.title,r.database_id from public.database_records r join public.pages p on p.id=r.page_id join visible v on v.page_id=r.page_id
    where r.database_id=p_database_id and not r.is_template and exists(select 1 from visible where page_id=v_database.page_id)
      and (p_after_id is null or r.page_id>p_after_id) and position(lower(p_query) in lower(p.title))>0 order by r.page_id limit 51;
end;
$$;
create function public.get_page_database(p_page_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_actor uuid:=private.require_confirmed_user(); v_workspace uuid; v_result jsonb;
begin
  select workspace_id into v_workspace from public.pages where id=p_page_id;
  with visible as materialized(select * from private.visible_page_scope(v_workspace,v_actor)), candidate as(
    select d.id,true is_container,false is_template,d.page_id from public.databases d where d.page_id=p_page_id
    union all select d.id,false,r.is_template,d.page_id from public.database_records r join public.databases d on d.id=r.database_id where r.page_id=p_page_id
  ) select jsonb_build_object('databaseId',c.id,'isContainer',c.is_container,'isTemplate',c.is_template) into v_result from candidate c
    where exists(select 1 from visible where page_id=p_page_id) and exists(select 1 from visible where page_id=c.page_id) limit 1;
  return v_result;
end;
$$;
create function public.resolve_database_references(p_database_id uuid,p_record_ids uuid[])
returns table(id uuid,label text,"databaseId" uuid) language plpgsql stable security definer set search_path='' as $$
declare v_actor uuid:=private.require_confirmed_user(); v_database public.databases:=private.require_database(p_database_id);
begin
  if p_record_ids is null or cardinality(p_record_ids)>100 or coalesce(array_ndims(p_record_ids),1)<>1 or array_position(p_record_ids,null) is not null then
    raise exception 'Invalid reference identities' using errcode='22023'; end if;
  return query with visible as materialized(select * from private.visible_page_scope(v_database.workspace_id,v_actor))
    select r.page_id,p.title,r.database_id from public.database_records r join public.pages p on p.id=r.page_id join visible v on v.page_id=r.page_id
    where r.database_id=p_database_id and not r.is_template and r.page_id=any(p_record_ids) and exists(select 1 from visible where page_id=v_database.page_id) order by r.page_id;
end;
$$;
create function public.database_people(p_database_id uuid,p_after_id uuid default null,p_user_ids uuid[] default null)
returns table(id uuid,label text) language plpgsql stable security definer set search_path='' as $$
declare v_database public.databases:=private.require_database(p_database_id);
begin
  if p_user_ids is not null and (cardinality(p_user_ids)>100 or coalesce(array_ndims(p_user_ids),1)<>1 or array_position(p_user_ids,null) is not null or p_after_id is not null) then
    raise exception 'Invalid person identities' using errcode='22023'; end if;
  return query select m.user_id,case when n.name is null or n.name='' or position('@' in n.name)>0 then 'Membro' else n.name end
    from public.workspace_members m join auth.users u on u.id=m.user_id
    cross join lateral(select left(btrim(coalesce(nullif(u.raw_user_meta_data->>'display_name',''),u.raw_user_meta_data->>'name','')),120) name) n
    where m.workspace_id=v_database.workspace_id and (p_after_id is null or m.user_id>p_after_id) and (p_user_ids is null or m.user_id=any(p_user_ids))
    order by m.user_id limit case when p_user_ids is null then 51 else 100 end;
end;
$$;
revoke all on function private.database_numeric(jsonb),private.database_filter_query(uuid,jsonb,integer) from public,anon,authenticated;
revoke all on function public.query_database_records(uuid,uuid,jsonb,boolean,jsonb,jsonb,uuid,boolean,text),public.move_database_record(uuid,uuid,uuid,bigint),
  public.list_databases(uuid,text,uuid),public.find_database_references(uuid,text,uuid),public.get_page_database(uuid),public.resolve_database_references(uuid,uuid[]),public.database_people(uuid,uuid,uuid[]) from public,anon;
grant execute on function public.query_database_records(uuid,uuid,jsonb,boolean,jsonb,jsonb,uuid,boolean,text),public.move_database_record(uuid,uuid,uuid,bigint),
  public.list_databases(uuid,text,uuid),public.find_database_references(uuid,text,uuid),public.get_page_database(uuid),public.resolve_database_references(uuid,uuid[]),public.database_people(uuid,uuid,uuid[]) to authenticated;
