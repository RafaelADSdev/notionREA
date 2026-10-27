begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
select has_function('public','query_database_records',array['uuid','uuid','jsonb','boolean','jsonb','jsonb','uuid','boolean','text'],'authoritative database query RPC exists');

insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select ('b1000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'query-'||n||'@example.test',now(),'{}',
  case when n=2 then '{"display_name":"Nome visível"}'::jsonb else '{}'::jsonb end,now(),now() from generate_series(1,4) n;
insert into public.workspaces(id,name,created_by) values
('b2000000-0000-4000-8000-000000000001','Query workspace','b1000000-0000-4000-8000-000000000001'),
('b2000000-0000-4000-8000-000000000002','Foreign query workspace','b1000000-0000-4000-8000-000000000004');
insert into public.workspace_members(workspace_id,user_id,role)
select 'b2000000-0000-4000-8000-000000000001',('b1000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,case when n=1 then 'owner' else 'member' end from generate_series(1,3) n;
insert into public.workspace_members(workspace_id,user_id,role) values('b2000000-0000-4000-8000-000000000002','b1000000-0000-4000-8000-000000000004','owner');
select set_config('request.jwt.claims','{"sub":"b1000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select set_config('query.base',public.create_database('b2000000-0000-4000-8000-000000000001',null,'Consulta','b3000000-0000-4000-8000-000000000001')::text,true);
select set_config('query.db',current_setting('query.base')::jsonb->>'id',true);
select set_config('query.view',public.get_database_metadata(current_setting('query.db')::uuid)->'views'->0->>'id',true);
select set_config('query.title',public.get_database_metadata(current_setting('query.db')::uuid)->'properties'->0->>'id',true);
select set_config('query.number',public.put_database_property(current_setting('query.db')::uuid,null,'Número','number','{}',0)->>'id',true);
select set_config('query.text',public.put_database_property(current_setting('query.db')::uuid,null,'Texto','text','{}',0)->>'id',true);
select set_config('query.check',public.put_database_property(current_setting('query.db')::uuid,null,'Checkbox','checkbox','{}',0)->>'id',true);
select set_config('query.date',public.put_database_property(current_setting('query.db')::uuid,null,'Data','date','{"mode":"civil"}',0)->>'id',true);
select set_config('query.created',public.put_database_property(current_setting('query.db')::uuid,null,'Criado','createdTime','{}',0)->>'id',true);
select set_config('query.tags',public.put_database_property(current_setting('query.db')::uuid,null,'Tags','multiSelect','{"options":[{"id":"b6000000-0000-4000-8000-000000000001","label":"Uma","color":"green"}]}',0)->>'id',true);
reset role;
insert into public.pages(id,workspace_id,parent_id,title,position,owner_id,restricted)
select ('b4000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'b2000000-0000-4000-8000-000000000001',(current_setting('query.base')::jsonb->>'pageId')::uuid,
  'Registro '||n,lpad(n::text,4,'0')||'V','b1000000-0000-4000-8000-000000000001',n=1 from generate_series(1,56) n;
insert into public.database_records(database_id,page_id,workspace_id,position,is_template)
select current_setting('query.db')::uuid,id,workspace_id,position,id='b4000000-0000-4000-8000-000000000056' from public.pages where id::text like 'b4000000-%';
insert into public.database_cells(database_id,page_id,property_id,workspace_id,value)
select current_setting('query.db')::uuid,id,current_setting('query.number')::uuid,workspace_id,
  to_jsonb(case right(id::text,12)::integer when 2 then '0' when 3 then '9007199254740993' else right(id::text,12)::integer::text end)
from public.pages where id::text like 'b4000000-%' and id<>'b4000000-0000-4000-8000-000000000004';
insert into public.database_cells(database_id,page_id,property_id,workspace_id,value) values
(current_setting('query.db')::uuid,'b4000000-0000-4000-8000-000000000001',current_setting('query.text')::uuid,'b2000000-0000-4000-8000-000000000001','"alpha%literal"'),
(current_setting('query.db')::uuid,'b4000000-0000-4000-8000-000000000002',current_setting('query.text')::uuid,'b2000000-0000-4000-8000-000000000001','""'),
(current_setting('query.db')::uuid,'b4000000-0000-4000-8000-000000000001',current_setting('query.check')::uuid,'b2000000-0000-4000-8000-000000000001','true'),
(current_setting('query.db')::uuid,'b4000000-0000-4000-8000-000000000001',current_setting('query.tags')::uuid,'b2000000-0000-4000-8000-000000000001','["b6000000-0000-4000-8000-000000000001"]'),
(current_setting('query.db')::uuid,'b4000000-0000-4000-8000-000000000001',current_setting('query.date')::uuid,'b2000000-0000-4000-8000-000000000001','{"kind":"civil","start":"2026-10-20","end":"2026-11-05"}');
insert into public.page_grants(page_id,workspace_id,user_id,role) values
((current_setting('query.base')::jsonb->>'pageId')::uuid,'b2000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000002','editor'),
((current_setting('query.base')::jsonb->>'pageId')::uuid,'b2000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000003','viewer');
set local role authenticated;
select set_config('query.first',public.query_database_records(current_setting('query.db')::uuid,current_setting('query.view')::uuid)::text,true);
select is(jsonb_array_length(current_setting('query.first')::jsonb->'rows'),50,'first page is capped at fifty records');
select set_config('query.second',public.query_database_records(current_setting('query.db')::uuid,current_setting('query.view')::uuid,p_cursor=>current_setting('query.first')::jsonb->'nextCursor')::text,true);
select is(jsonb_array_length(current_setting('query.second')::jsonb->'rows'),5,'keyset continuation reaches all remaining non-template records');
select is(current_setting('query.second')::jsonb->'nextCursor','null'::jsonb,'last page has no continuation');
select is(current_setting('query.first')::jsonb->'rows'->0->'values'->>current_setting('query.title'),'Registro 1','title is projected from the canonical page');
select ok(current_setting('query.first')::jsonb->'rows'->0->'values' ? current_setting('query.created'),'system time is projected without an editable cell');
select throws_ok($$select public.query_database_records(current_setting('query.db')::uuid,current_setting('query.view')::uuid,p_cursor=>jsonb_set(current_setting('query.first')::jsonb->'nextCursor','{queryKey}','null'))$$,'40001',null,'null or changed query binding cannot bypass cursor checks');
select throws_ok($$select public.query_database_records(current_setting('query.db')::uuid,current_setting('query.view')::uuid,jsonb_build_object('kind','condition','propertyId',current_setting('query.number'),'operator','gt','value','0'),true,p_cursor=>current_setting('query.first')::jsonb->'nextCursor')$$,'40001',null,'a cursor cannot be reused with a different temporary filter');
select set_config('query.numeric',public.query_database_records(current_setting('query.db')::uuid,current_setting('query.view')::uuid,jsonb_build_object('kind','condition','propertyId',current_setting('query.number'),'operator','gt','value','9007199254740992'),true)::text,true);
select is(current_setting('query.numeric')::jsonb->'rows'->0->>'id','b4000000-0000-4000-8000-000000000003','exact numeric comparison preserves precision beyond JavaScript integers');
select is(jsonb_array_length((public.query_database_records(current_setting('query.db')::uuid,current_setting('query.view')::uuid,jsonb_build_object('kind','condition','propertyId',current_setting('query.text'),'operator','contains','value','%'),true))->'rows'),1,'text operators treat percent as a literal, not SQL wildcards');
select set_config('query.zero',public.query_database_records(current_setting('query.db')::uuid,current_setting('query.view')::uuid,jsonb_build_object('kind','or','children',jsonb_build_array(
  jsonb_build_object('kind','condition','propertyId',current_setting('query.number'),'operator','eq','value','0'),jsonb_build_object('kind','condition','propertyId',current_setting('query.number'),'operator','isEmpty'))),true,
  jsonb_build_array(jsonb_build_object('propertyId',current_setting('query.number'),'direction','desc')))::text,true);
select is(current_setting('query.zero')::jsonb->'rows'->0->>'id','b4000000-0000-4000-8000-000000000002','descending sorts keep zero before null');
select is(current_setting('query.zero')::jsonb->'rows'->1->>'id','b4000000-0000-4000-8000-000000000004','null remains last in descending order');
select is(jsonb_array_length((public.query_database_records(current_setting('query.db')::uuid,current_setting('query.view')::uuid,jsonb_build_object('kind','condition','propertyId',current_setting('query.check'),'operator','isEmpty'),true))->'rows'),0,'false defaults are not empty checkboxes');
select is((public.query_database_records(current_setting('query.db')::uuid,current_setting('query.view')::uuid,jsonb_build_object('kind','condition','propertyId',current_setting('query.check'),'operator','eq','value',false),true))->'rows'->0->'values'->current_setting('query.check'),'false'::jsonb,'missing checkbox cells have the declared false default');
select ok(not exists(select 1 from jsonb_array_elements(public.query_database_records(current_setting('query.db')::uuid,current_setting('query.view')::uuid,jsonb_build_object('kind','condition','propertyId',current_setting('query.tags'),'operator','containsNone','value',jsonb_build_array('b6000000-0000-4000-8000-000000000001')),true)->'rows') r where r->>'id'='b4000000-0000-4000-8000-000000000001'),'containsNone includes absent sets and excludes a matching set');
select throws_ok($$select public.query_database_records(current_setting('query.db')::uuid,current_setting('query.view')::uuid,jsonb_build_object('kind','condition','propertyId',current_setting('query.number'),'operator','sql','value','1'),true)$$,'22023',null,'direct query RPC validates the operator whitelist');
select is((public.get_page_database((current_setting('query.base')::jsonb->>'pageId')::uuid)->>'isContainer')::boolean,true,'container lookup uses the database identity');
select is((public.get_page_database('b4000000-0000-4000-8000-000000000056')->>'isTemplate')::boolean,true,'template lookup is explicit');
select is((select count(*)::integer from public.find_database_references(current_setting('query.db')::uuid)),51,'reference search uses fifty-one lookahead and excludes templates');
select is((select count(*)::integer from public.resolve_database_references(current_setting('query.db')::uuid,array['b4000000-0000-4000-8000-000000000055'::uuid])),1,'bulk resolution reaches selected identities beyond the first search page');
select ok(not exists(select 1 from public.database_people(current_setting('query.db')::uuid) where position('@' in label)>0),'person labels never include email addresses');
select is((select label from public.database_people(current_setting('query.db')::uuid) where id='b1000000-0000-4000-8000-000000000002'),'Nome visível','person labels use safe display names');
reset role;

select set_config('request.jwt.claims','{"sub":"b1000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select is(public.move_database_record(current_setting('query.db')::uuid,'b4000000-0000-4000-8000-000000000002','b4000000-0000-4000-8000-000000000003',0),1::bigint,'editor moves an authorized record with independent ordering revision');
select throws_ok($$select public.move_database_record(current_setting('query.db')::uuid,'b4000000-0000-4000-8000-000000000002',null,0)$$,'40001',null,'stale record movement does not overwrite another move');
select throws_ok($$select public.move_database_record(current_setting('query.db')::uuid,'b4000000-0000-4000-8000-000000000001',null,0)$$,'42501',null,'base editor cannot move a restricted record');
reset role;
select is((select parent_id from public.pages where id='b4000000-0000-4000-8000-000000000002'),(current_setting('query.base')::jsonb->>'pageId')::uuid,'manual database movement preserves physical parent security');
select set_config('request.jwt.claims','{"sub":"b1000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
set local role authenticated;
select ok(not exists(select 1 from jsonb_array_elements(public.query_database_records(current_setting('query.db')::uuid,current_setting('query.view')::uuid)->'rows') r where r->>'id'='b4000000-0000-4000-8000-000000000001'),'viewer queries exclude a restricted record');
select is(public.get_page_database('b4000000-0000-4000-8000-000000000001'),null::jsonb,'page lookup does not reveal a hidden record relation');
select is((select count(*)::integer from public.resolve_database_references(current_setting('query.db')::uuid,array['b4000000-0000-4000-8000-000000000001'::uuid])),0,'bulk labels apply current record ACL');
select throws_ok($$select public.move_database_record(current_setting('query.db')::uuid,'b4000000-0000-4000-8000-000000000002',null,1)$$,'42501',null,'viewer cannot move records');
select is((select count(*)::integer from public.list_databases('b2000000-0000-4000-8000-000000000002')),0,'database discovery cannot cross workspaces');
reset role;
select set_config('request.jwt.claims','{"sub":"b1000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.query_database_records(current_setting('query.db')::uuid,current_setting('query.view')::uuid)$$,'42501',null,'foreign members cannot query the base');
reset role;
select ok(not has_function_privilege('anon','public.query_database_records(uuid,uuid,jsonb,boolean,jsonb,jsonb,uuid,boolean,text)','execute'),'anonymous callers cannot execute record queries');
select ok(not has_function_privilege('authenticated','private.database_filter_query(uuid,jsonb,integer)','execute'),'clients cannot execute the internal compiler');

select set_config('request.jwt.claims','{"sub":"b1000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select is((select count(*)::integer from public.database_people(current_setting('query.db')::uuid,p_user_ids=>array['b1000000-0000-4000-8000-000000000002'::uuid,'b1000000-0000-4000-8000-000000000004'::uuid])),1,'bulk people resolution excludes foreign-workspace identities');
select throws_ok($$select public.database_people(current_setting('query.db')::uuid,p_user_ids=>array_fill('b1000000-0000-4000-8000-000000000002'::uuid,array[101]))$$,'22023',null,'bulk person resolution is bounded to one hundred identities');
select is(jsonb_array_length(public.query_database_records(current_setting('query.db')::uuid,current_setting('query.view')::uuid,jsonb_build_object('kind','condition','propertyId',current_setting('query.date'),'operator','between','value',jsonb_build_object('kind','civil','start','2026-10-01','end','2026-10-31')),true)->'rows'),1,'date interval filters compare the start inclusively without shifting civil dates');
select set_config('query.select',public.put_database_property(current_setting('query.db')::uuid,null,'Etapa','select','{"options":[{"id":"b6000000-0000-4000-8000-000000000002","label":"B","color":"green"},{"id":"b6000000-0000-4000-8000-000000000001","label":"A","color":"indigo"}]}',0)->>'id',true);
select public.put_database_cell(current_setting('query.db')::uuid,'b4000000-0000-4000-8000-000000000001',current_setting('query.select')::uuid,'"b6000000-0000-4000-8000-000000000001"',0);
select public.put_database_cell(current_setting('query.db')::uuid,'b4000000-0000-4000-8000-000000000002',current_setting('query.select')::uuid,'"b6000000-0000-4000-8000-000000000002"',0);
select set_config('query.sorted',public.query_database_records(current_setting('query.db')::uuid,current_setting('query.view')::uuid,p_sorts=>jsonb_build_array(jsonb_build_object('propertyId',current_setting('query.select'),'direction','asc')))::text,true);
select is(current_setting('query.sorted')::jsonb->'rows'->0->>'id','b4000000-0000-4000-8000-000000000002','select order follows configured options rather than UUID or label order');
select is(jsonb_array_length(public.query_database_records(current_setting('query.db')::uuid,current_setting('query.view')::uuid,p_sorts=>jsonb_build_array(jsonb_build_object('propertyId',current_setting('query.select'),'direction','asc')),p_cursor=>current_setting('query.sorted')::jsonb->'nextCursor')->'rows'),5,'typed sorted cursor continues through tied nulls without losing records');
select lives_ok($$
do $views$
declare v_type text; v_id uuid; v_result jsonb; v_expected jsonb;
begin
  v_expected:=public.query_database_records(current_setting('query.db')::uuid,current_setting('query.view')::uuid)->'rows';
  foreach v_type in array array['table','board','list','calendar','gallery'] loop
    v_id:=(public.put_database_view(current_setting('query.db')::uuid,null,v_type,v_type,jsonb_build_object(
      'visibleProperties',jsonb_build_array(current_setting('query.title')),'sorts','[]'::jsonb,'filter',null,
      'groupBy',case when v_type='board' then current_setting('query.check') else null end,
      'datePropertyId',case when v_type='calendar' then current_setting('query.date') else null end),0)->>'id')::uuid;
    v_result:=public.query_database_records(current_setting('query.db')::uuid,v_id,p_month=>case when v_type='calendar' then '2026-11' else null end)->'rows';
    if v_result<>v_expected then raise exception 'View lost reachable records'; end if;
  end loop;
end;
$views$;
$$,'all five views retain identical identities, including cross-month ranges and undated records');
select set_config('query.largeprops',(select jsonb_agg(public.put_database_property(current_setting('query.db')::uuid,null,'Longo '||n,'text','{}',0)->>'id') from generate_series(1,8) n)::text,true);
reset role;
insert into public.database_cells(database_id,page_id,property_id,workspace_id,value)
select r.database_id,r.page_id,(prop#>>'{}')::uuid,r.workspace_id,to_jsonb(repeat('x',16000)) from public.database_records r
cross join jsonb_array_elements(current_setting('query.largeprops')::jsonb) prop where r.database_id=current_setting('query.db')::uuid;
set local role authenticated;
select set_config('query.large',public.query_database_records(current_setting('query.db')::uuid,current_setting('query.view')::uuid)::text,true);
select ok(octet_length(current_setting('query.large'))<=1048576,'large cell payloads stay within the one MiB response budget');
select ok(jsonb_array_length(current_setting('query.large')::jsonb->'rows') between 1 and 49 and current_setting('query.large')::jsonb->'nextCursor'<>'null','byte budget returns a contiguous partial page with continuation');
select ok((public.query_database_records(current_setting('query.db')::uuid,current_setting('query.view')::uuid,p_cursor=>current_setting('query.large')::jsonb->'nextCursor')->'rows'->0->>'id')<>(current_setting('query.large')::jsonb->'rows'->0->>'id'),'byte-limited continuation reaches a later record');
reset role;
select * from finish();
rollback;
