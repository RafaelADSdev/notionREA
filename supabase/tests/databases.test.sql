begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select ('a1000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'database-'||n||'@example.test',now(),'{}','{}',now(),now() from generate_series(1,5) n;
insert into public.workspaces(id,name,created_by) values
('a2000000-0000-4000-8000-000000000001','Database A','a1000000-0000-4000-8000-000000000001'),
('a2000000-0000-4000-8000-000000000002','Database B','a1000000-0000-4000-8000-000000000005');
insert into public.workspace_members(workspace_id,user_id,role)
select 'a2000000-0000-4000-8000-000000000001',('a1000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  case when n=1 then 'owner' else 'member' end from generate_series(1,4) n;
insert into public.workspace_members(workspace_id,user_id,role) values('a2000000-0000-4000-8000-000000000002','a1000000-0000-4000-8000-000000000005','owner');
select is((select count(*)::integer from pg_class where relnamespace='public'::regnamespace and relname in
  ('databases','database_properties','database_records','database_cells','database_views','database_templates') and relrowsecurity),6,'all six database tables enable RLS');

select set_config('request.jwt.claims','{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select set_config('test.base',public.create_database('a2000000-0000-4000-8000-000000000001',null,'Projetos','a3000000-0000-4000-8000-000000000001')::text,true);
select is(public.create_database('a2000000-0000-4000-8000-000000000001',null,'Projetos','a3000000-0000-4000-8000-000000000001'),current_setting('test.base')::jsonb,'base retry preserves database and container page identities');
select throws_ok($$select public.create_database('a2000000-0000-4000-8000-000000000001',null,'Changed','a3000000-0000-4000-8000-000000000001')$$,'22023',null,'changed create retry rejected');
select set_config('test.db',(current_setting('test.base')::jsonb->>'id'),true);
select set_config('test.title',(public.get_database_metadata(current_setting('test.db')::uuid)->'properties'->0->>'id'),true);
select set_config('test.view',(public.get_database_metadata(current_setting('test.db')::uuid)->'views'->0->>'id'),true);
select is((select count(*)::integer from public.database_properties where database_id=current_setting('test.db')::uuid and type='title'),1,'exactly one virtual required title property');
select ok(not(public.get_database_metadata(current_setting('test.db')::uuid) ? 'parent_id'),'metadata does not expose physical page ancestry');
select set_config('test.record',(public.add_database_record(current_setting('test.db')::uuid,'Primeiro','a3000000-0000-4000-8000-000000000002')->>'pageId'),true);
select is(public.add_database_record(current_setting('test.db')::uuid,'Primeiro','a3000000-0000-4000-8000-000000000002')->>'pageId',current_setting('test.record'),'record creation is idempotent');
select set_config('test.target',(public.add_database_record(current_setting('test.db')::uuid,'Destino','a3000000-0000-4000-8000-000000000003')->>'pageId'),true);
select set_config('test.number',(public.put_database_property(current_setting('test.db')::uuid,null,'Número','number','{}',0)->>'id'),true);
select set_config('test.text',(public.put_database_property(current_setting('test.db')::uuid,null,'Texto','text','{}',0)->>'id'),true);
select set_config('test.system',(public.put_database_property(current_setting('test.db')::uuid,null,'Criado','createdTime','{}',0)->>'id'),true);
select set_config('test.person',(public.put_database_property(current_setting('test.db')::uuid,null,'Pessoas','person','{}',0)->>'id'),true);
select set_config('test.relation',(public.put_database_property(current_setting('test.db')::uuid,null,'Relação','relation',jsonb_build_object('targetDatabaseId',current_setting('test.db')),0)->>'id'),true);
select is(public.put_database_cell(current_setting('test.db')::uuid,current_setting('test.record')::uuid,current_setting('test.number')::uuid,'"0"',0),1::bigint,'zero is a canonical decimal string with its own cell revision');
select is(public.put_database_cell(current_setting('test.db')::uuid,current_setting('test.record')::uuid,current_setting('test.text')::uuid,'""',0),1::bigint,'a different property writes independently and preserves empty text');
select is((select revision from public.pages where id=current_setting('test.record')::uuid),0::bigint,'cell writes do not cause metadata revision conflicts');
select throws_ok($$select public.put_database_cell(current_setting('test.db')::uuid,current_setting('test.record')::uuid,current_setting('test.number')::uuid,'"1"',0)$$,'40001',null,'same-cell stale revision does not overwrite');
select is(public.put_database_cell(current_setting('test.db')::uuid,current_setting('test.record')::uuid,current_setting('test.title')::uuid,'"Renomeado"',0),1::bigint,'title writes use the page revision');
select is((select title from public.pages where id=current_setting('test.record')::uuid),'Renomeado','title has only the pages source of truth');
select is((select count(*)::integer from public.database_cells where property_id=current_setting('test.title')::uuid),0,'virtual title is never duplicated as a cell');
select throws_ok($$select public.put_database_cell(current_setting('test.db')::uuid,current_setting('test.record')::uuid,current_setting('test.system')::uuid,'"2026-10-26T00:00:00.000Z"',0)$$,'42501',null,'system fields cannot be written');
select throws_ok($$select public.put_database_cell(current_setting('test.db')::uuid,current_setting('test.record')::uuid,current_setting('test.number')::uuid,'0',1)$$,'22023',null,'direct RPC rejects a non-string decimal');
select throws_ok($$select public.put_database_cell(current_setting('test.db')::uuid,current_setting('test.record')::uuid,current_setting('test.number')::uuid,'"01"',1)$$,'22023',null,'direct RPC rejects a noncanonical decimal');
select throws_ok($$select public.put_database_cell(current_setting('test.db')::uuid,current_setting('test.record')::uuid,current_setting('test.text')::uuid,to_jsonb(repeat('x',32769)),1)$$,'22023',null,'cell byte budget is enforced by SQL');
select throws_ok($$select public.put_database_property(current_setting('test.db')::uuid,null,'Injected','text','{"html":"<script>"}',0)$$,'22023',null,'unknown property configuration is rejected');
select set_config('test.date',(public.put_database_property(current_setting('test.db')::uuid,null,'Data','date','{"mode":"civil"}',0)->>'id'),true);
select is(public.put_database_cell(current_setting('test.db')::uuid,current_setting('test.record')::uuid,current_setting('test.date')::uuid,'{"kind":"civil","start":"2026-10-26","end":null}',0),1::bigint,'civil dates retain their day without UTC conversion');
select throws_ok($$select public.put_database_cell(current_setting('test.db')::uuid,current_setting('test.record')::uuid,current_setting('test.date')::uuid,'{"kind":"civil","start":"2026-02-30","end":null}',1)$$,'22023',null,'SQL rejects impossible civil dates');
select set_config('test.url',(public.put_database_property(current_setting('test.db')::uuid,null,'Link','url','{}',0)->>'id'),true);
select throws_ok($$select public.put_database_cell(current_setting('test.db')::uuid,current_setting('test.record')::uuid,current_setting('test.url')::uuid,'"javascript:alert(1)"',0)$$,'22023',null,'SQL rejects executable URL protocols');
select throws_ok($$select public.put_database_cell(current_setting('test.db')::uuid,current_setting('test.record')::uuid,current_setting('test.person')::uuid,'["a1000000-0000-4000-8000-000000000002","a1000000-0000-4000-8000-000000000002"]',0)$$,'22023',null,'identity sets cannot contain duplicates');
select throws_ok($$select public.delete_database_property(current_setting('test.db')::uuid,current_setting('test.title')::uuid,0,true)$$,'22023',null,'required title cannot be removed');
select throws_ok($$select public.delete_database_view(current_setting('test.db')::uuid,current_setting('test.view')::uuid,0)$$,'23514',null,'last view cannot be removed');
select throws_ok($$select public.put_database_view(current_setting('test.db')::uuid,null,'Unsafe','table','{"visibleProperties":[],"sorts":[],"filter":{"kind":"condition","propertyId":"00000000-0000-4000-8000-000000000000","operator":"sql"},"groupBy":null,"datePropertyId":null}',0)$$,'22023',null,'view filter identifiers and operators are SQL validated');
select throws_ok($$insert into public.database_cells(database_id,page_id,property_id,workspace_id,value) values(current_setting('test.db')::uuid,current_setting('test.record')::uuid,current_setting('test.number')::uuid,'a2000000-0000-4000-8000-000000000001','"9"')$$,'42501',null,'clients cannot bypass the cell RPC');
select throws_ok($$update public.database_properties set name='Bypass' where id=current_setting('test.number')::uuid$$,'42501',null,'clients cannot bypass schema CAS');

-- A preview receipt includes cells, not just the property revision.
select set_config('test.preview',public.put_database_property(current_setting('test.db')::uuid,current_setting('test.number')::uuid,'Número','checkbox','{}',0)::text,true);
select ok((current_setting('test.preview')::jsonb->>'requiresConfirmation')::boolean,'incompatible type conversion first returns a non-mutating preview');
select is((select value from public.database_cells where page_id=current_setting('test.record')::uuid and property_id=current_setting('test.number')::uuid),'"0"'::jsonb,'preview preserves the incompatible value');
select is(public.put_database_cell(current_setting('test.db')::uuid,current_setting('test.record')::uuid,current_setting('test.number')::uuid,'"2"',1),2::bigint,'a cell may change after a schema preview');
select throws_ok($$select public.put_database_property(current_setting('test.db')::uuid,current_setting('test.number')::uuid,'Número','checkbox','{}',0,true,current_setting('test.preview')::jsonb->>'previewToken')$$,'40001',null,'stale preview cannot delete a newly edited cell');
select set_config('test.preview',public.put_database_property(current_setting('test.db')::uuid,current_setting('test.number')::uuid,'Número','checkbox','{}',0)::text,true);
select ok(not(public.put_database_property(current_setting('test.db')::uuid,current_setting('test.number')::uuid,'Número','checkbox','{}',0,true,current_setting('test.preview')::jsonb->>'previewToken')->>'requiresConfirmation')::boolean,'fresh confirmation applies the atomic conversion');
select is((select count(*)::integer from public.database_cells where property_id=current_setting('test.number')::uuid),0,'only explicitly previewed incompatible cells are removed');

select is(public.put_database_cell(current_setting('test.db')::uuid,current_setting('test.record')::uuid,current_setting('test.person')::uuid,'["a1000000-0000-4000-8000-000000000004"]',0),1::bigint,'person references require current workspace membership');
select is(public.put_database_cell(current_setting('test.db')::uuid,current_setting('test.record')::uuid,current_setting('test.relation')::uuid,jsonb_build_array(current_setting('test.target')),0),1::bigint,'relation references require a readable record in the target base');
select set_config('test.template_page',(public.add_database_record(current_setting('test.db')::uuid,'Modelo','a3000000-0000-4000-8000-000000000004',true)->>'pageId'),true);
select set_config('test.template',(public.put_database_template(current_setting('test.db')::uuid,null,current_setting('test.template_page')::uuid,'Modelo',0)->>'id'),true);
select is((select count(*)::integer from public.database_templates where id=current_setting('test.template')::uuid),1,'template metadata points to a separate template record/body page');
reset role;

insert into public.page_grants(page_id,workspace_id,user_id,role) values
((current_setting('test.base')::jsonb->>'pageId')::uuid,'a2000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000002','editor'),
((current_setting('test.base')::jsonb->>'pageId')::uuid,'a2000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000003','viewer');
update public.pages set restricted=true where id in(current_setting('test.target')::uuid,current_setting('test.template_page')::uuid);
delete from public.workspace_members where workspace_id='a2000000-0000-4000-8000-000000000001' and user_id='a1000000-0000-4000-8000-000000000004';
select set_config('request.jwt.claims','{"sub":"a1000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select is((select count(*)::integer from public.database_records where database_id=current_setting('test.db')::uuid),1,'base editor does not see independently restricted records/templates');
select is(jsonb_array_length(public.get_database_metadata(current_setting('test.db')::uuid)->'templates'),0,'template metadata does not disclose a hidden template title');
select is(public.put_database_cell(current_setting('test.db')::uuid,current_setting('test.record')::uuid,current_setting('test.person')::uuid,'["a1000000-0000-4000-8000-000000000004"]',1),2::bigint,'an unchanged removed member remains an opaque accepted identity');
select is(public.put_database_cell(current_setting('test.db')::uuid,current_setting('test.record')::uuid,current_setting('test.relation')::uuid,jsonb_build_array(current_setting('test.target')),1),2::bigint,'an unchanged inaccessible relation remains opaque');
select is(public.put_database_cell(current_setting('test.db')::uuid,current_setting('test.record')::uuid,current_setting('test.relation')::uuid,'[]',2),3::bigint,'an opaque relation can be removed');
select throws_ok($$select public.put_database_cell(current_setting('test.db')::uuid,current_setting('test.record')::uuid,current_setting('test.relation')::uuid,jsonb_build_array(current_setting('test.target')),3)$$,'42501',null,'reintroducing an inaccessible relation reauthorizes and fails');
select throws_ok($$select public.put_database_cell(current_setting('test.db')::uuid,current_setting('test.target')::uuid,current_setting('test.text')::uuid,'"leak"',0)$$,'42501',null,'base editing capability does not override record-page ACL');
reset role;

select set_config('request.jwt.claims','{"sub":"a1000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
set local role authenticated;
select is((public.get_database_metadata(current_setting('test.db')::uuid)->>'role'),'viewer','viewer receives safe schema metadata');
select throws_ok($$select public.put_database_cell(current_setting('test.db')::uuid,current_setting('test.record')::uuid,current_setting('test.text')::uuid,'"no"',1)$$,'42501',null,'viewer cannot edit a cell');
select throws_ok($$select public.add_database_record(current_setting('test.db')::uuid,'No','a3000000-0000-4000-8000-000000000005')$$,'42501',null,'viewer cannot create a record');
select throws_ok($$select public.put_database_property(current_setting('test.db')::uuid,null,'No','text','{}',0)$$,'42501',null,'viewer cannot modify schema');
reset role;

select set_config('request.jwt.claims','{"sub":"a1000000-0000-4000-8000-000000000005","role":"authenticated"}',true);
set local role authenticated;
select is((select count(*)::integer from public.databases),0,'foreign workspace member cannot discover the database');
select throws_ok($$select public.get_database_metadata(current_setting('test.db')::uuid)$$,'42501',null,'metadata RPC does not bypass workspace/page ACL');
select set_config('test.foreign',public.create_database('a2000000-0000-4000-8000-000000000002',null,'Foreign','a3000000-0000-4000-8000-000000000006')->>'id',true);
reset role;
select set_config('request.jwt.claims','{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.put_database_property(current_setting('test.db')::uuid,null,'Foreign relation','relation',jsonb_build_object('targetDatabaseId',current_setting('test.foreign')),0)$$,'42501',null,'relations cannot target another workspace');
select set_config('test.delete_preview',public.delete_database_property(current_setting('test.db')::uuid,current_setting('test.text')::uuid,0)::text,true);
select is(public.put_database_cell(current_setting('test.db')::uuid,current_setting('test.record')::uuid,current_setting('test.text')::uuid,'"Recent edit"',1),2::bigint,'cell editing remains available between delete preview and confirmation');
select throws_ok($$select public.delete_database_property(current_setting('test.db')::uuid,current_setting('test.text')::uuid,0,true,current_setting('test.delete_preview')::jsonb->>'previewToken')$$,'40001',null,'stale property-deletion preview cannot discard a recent edit');
select set_config('test.delete_preview',public.delete_database_property(current_setting('test.db')::uuid,current_setting('test.text')::uuid,0)::text,true);
select ok((public.delete_database_property(current_setting('test.db')::uuid,current_setting('test.text')::uuid,0,true,current_setting('test.delete_preview')::jsonb->>'previewToken')->>'deleted')::boolean,'fresh property-deletion confirmation removes the previewed values atomically');
reset role;
select * from finish();
rollback;
