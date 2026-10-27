begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select ('e1000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'sharing-'||n||'@example.test',now(),'{}',
  case when n=2 then '{"display_name":"Pessoa Dois"}'::jsonb else '{"display_name":"private@example.test"}'::jsonb end,now(),now() from generate_series(1,5) n;
insert into public.workspaces(id,name,created_by) values
('e2000000-0000-4000-8000-000000000001','Sharing A','e1000000-0000-4000-8000-000000000001'),
('e2000000-0000-4000-8000-000000000002','Sharing B','e1000000-0000-4000-8000-000000000005');
insert into public.workspace_members(workspace_id,user_id,role)
select 'e2000000-0000-4000-8000-000000000001',('e1000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,case when n=1 then 'owner' else 'member' end from generate_series(1,4) n;
insert into public.workspace_members(workspace_id,user_id,role) values('e2000000-0000-4000-8000-000000000002','e1000000-0000-4000-8000-000000000005','owner');
insert into public.pages(id,workspace_id,parent_id,title,owner_id,restricted) values
('e3000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001',null,'Published source','e1000000-0000-4000-8000-000000000001',true),
('e3000000-0000-4000-8000-000000000002','e2000000-0000-4000-8000-000000000001','e3000000-0000-4000-8000-000000000001','Inherited child','e1000000-0000-4000-8000-000000000001',false),
('e3000000-0000-4000-8000-000000000003','e2000000-0000-4000-8000-000000000001',null,'Hidden parent','e1000000-0000-4000-8000-000000000003',true),
('e3000000-0000-4000-8000-000000000004','e2000000-0000-4000-8000-000000000001','e3000000-0000-4000-8000-000000000003','Direct child','e1000000-0000-4000-8000-000000000001',true),
('e3000000-0000-4000-8000-000000000005','e2000000-0000-4000-8000-000000000001',null,'Private mention target','e1000000-0000-4000-8000-000000000001',true),
('e3000000-0000-4000-8000-000000000010','e2000000-0000-4000-8000-000000000001',null,'Member owned root','e1000000-0000-4000-8000-000000000002',true),
('e3000000-0000-4000-8000-000000000011','e2000000-0000-4000-8000-000000000001','e3000000-0000-4000-8000-000000000010','Inherited member child','e1000000-0000-4000-8000-000000000002',false),
('e3000000-0000-4000-8000-000000000012','e2000000-0000-4000-8000-000000000001','e3000000-0000-4000-8000-000000000010','Restricted other owner','e1000000-0000-4000-8000-000000000003',true);
insert into public.page_grants(page_id,workspace_id,user_id,role) values('e3000000-0000-4000-8000-000000000004','e2000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000002','viewer');
select set_config('request.jwt.claims','{"sub":"e1000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select set_config('sharing.preview',public.configure_page_sharing('e3000000-0000-4000-8000-000000000001',0,true,'viewer','[]',null)::text,true);
select ok((current_setting('sharing.preview')::jsonb->>'requiresConfirmation')::boolean,'workspace default first produces a non-mutating access preview');
select is(public.get_page_sharing('e3000000-0000-4000-8000-000000000001')->'workspaceRole','null'::jsonb,'preview does not change the default');
reset role;
insert into public.page_grants(page_id,workspace_id,user_id,role) values('e3000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000002','editor');
set local role authenticated;
select throws_ok($$select public.configure_page_sharing('e3000000-0000-4000-8000-000000000001',0,true,'viewer','[]',null,true,current_setting('sharing.preview')::jsonb->>'previewToken')$$,'40001',null,'a changed current ACL invalidates the preview receipt');
select set_config('sharing.preview',public.configure_page_sharing('e3000000-0000-4000-8000-000000000001',0,true,'viewer','[]',null)::text,true);
select ok(not(public.configure_page_sharing('e3000000-0000-4000-8000-000000000001',0,true,'viewer','[]',null,true,current_setting('sharing.preview')::jsonb->>'previewToken')->>'requiresConfirmation')::boolean,'fresh receipt atomically applies the ACL patch');
select throws_ok($$select public.configure_page_sharing('e3000000-0000-4000-8000-000000000001',0)$$,'40001',null,'stale page revision cannot overwrite sharing');
select throws_ok($$select public.configure_page_sharing('e3000000-0000-4000-8000-000000000001',1,true,null,'[{"userId":"e1000000-0000-4000-8000-000000000005","role":"viewer"}]')$$,'42501',null,'a grant cannot cross workspace membership');
select ok(public.list_page_sharing_targets('e3000000-0000-4000-8000-000000000001')::text not like '%@%','member target labels never include source email');
select ok(not(public.get_page_sharing('e3000000-0000-4000-8000-000000000001') ? 'parent_id'),'sharing metadata excludes physical ancestry');
reset role;
select set_config('request.jwt.claims','{"sub":"e1000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select is(public.get_page_role('e3000000-0000-4000-8000-000000000002'),'viewer','workspace default is inherited by an unrestricted child');
select is((select count(*)::integer from public.list_page_breadcrumbs('e3000000-0000-4000-8000-000000000002')),2,'default role is also reflected in authorized breadcrumbs');
select is((select count(*)::integer from public.list_page_breadcrumbs('e3000000-0000-4000-8000-000000000004')),1,'a directly shared child never leaks its hidden parent');
select throws_ok($$select public.get_page_sharing('e3000000-0000-4000-8000-000000000001')$$,'42501',null,'viewer cannot inspect sharing management metadata');
select throws_ok($$update public.page_grants set role='owner' where user_id=auth.uid()$$,'42501',null,'client cannot bypass sharing RPC with raw grant mutation');
select set_config('sharing.memberpreview',public.configure_page_sharing('e3000000-0000-4000-8000-000000000010',0,true,'commenter','[]')::text,true);
select ok(not(public.configure_page_sharing('e3000000-0000-4000-8000-000000000010',0,true,'commenter','[]',null,true,current_setting('sharing.memberpreview')::jsonb->>'previewToken')->>'requiresConfirmation')::boolean,'unchanged restricted descendants do not require an unrelated owner capability');
select set_config('sharing.transfer',public.configure_page_sharing('e3000000-0000-4000-8000-000000000010',1,true,'commenter','[]','e1000000-0000-4000-8000-000000000003')::text,true);
select ok((public.configure_page_sharing('e3000000-0000-4000-8000-000000000010',1,true,'commenter','[]','e1000000-0000-4000-8000-000000000003',true,current_setting('sharing.transfer')::jsonb->>'previewToken')->>'accessChanged')::boolean,'ownership transfer commits even when its caller loses management');
select throws_ok($$select public.get_page_sharing('e3000000-0000-4000-8000-000000000010')$$,'42501',null,'former owner cannot read sharing metadata after transfer');
reset role;
select is((select capability from private.subtree_acl(array['e3000000-0000-4000-8000-000000000002'::uuid],null,null,false) where user_id='e1000000-0000-4000-8000-000000000002'),1,'move ACL matrix includes inherited workspace default');
select set_config('request.jwt.claims','{"sub":"e1000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
set local role authenticated;
select is(public.get_page_role('e3000000-0000-4000-8000-000000000012'),null,'restricted boundary stops the workspace default');
reset role;
insert into public.document_heads(page_id,workspace_id,projection) values('e3000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001',
'{"schemaVersion":1,"text":"private-index-only","references":["e3000000-0000-4000-8000-000000000005"],"files":[],"blocks":[{"id":"initial","type":"paragraph","parentId":null,"position":"a","attributes":{},"content":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Published writing"},{"type":"pageMention","attrs":{"pageId":"e3000000-0000-4000-8000-000000000005"}}]}]}}]}');
insert into public.page_files(id,workspace_id,page_id,object_path,original_name,mime_type,expected_size,actual_size,sha256,status,uploaded_by,finalized_at,purpose) values
('e4000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001','e3000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001/e3000000-0000-4000-8000-000000000001/e4000000-0000-4000-8000-000000000001','cover.png','image/png',1,1,repeat('a',64),'ready','e1000000-0000-4000-8000-000000000001',now(),'cover'),
('e4000000-0000-4000-8000-000000000002','e2000000-0000-4000-8000-000000000001','e3000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001/e3000000-0000-4000-8000-000000000001/e4000000-0000-4000-8000-000000000002','unreferenced.bin','application/octet-stream',1,1,repeat('b',64),'ready','e1000000-0000-4000-8000-000000000001',now(),'block');
update public.pages set cover_file_id='e4000000-0000-4000-8000-000000000001' where id='e3000000-0000-4000-8000-000000000001';
select set_config('request.jwt.claims','{"sub":"e1000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select set_config('sharing.source',public.configure_page_publication('e3000000-0000-4000-8000-000000000001',1,true)->'publication'->>'token',true);
select ok(current_setting('sharing.source')~'^[0-9a-f]{64}$','publication uses an opaque 32-byte token');
select throws_ok($$select public.configure_page_publication('e3000000-0000-4000-8000-000000000001',1,false)$$,'40001',null,'publication edits also use page revision CAS');
reset role;
set local role anon;
select ok(public.read_page_publication(current_setting('sharing.source'))->'content'->'blocks'->0->'content'::text is not null,'anonymous reader receives safe structured content');
select ok(public.read_page_publication(current_setting('sharing.source'))::text not like '%private-index-only%' and public.read_page_publication(current_setting('sharing.source'))::text not like '%Private mention target%','index mirrors and private target titles are absent');
select ok(public.read_page_publication(current_setting('sharing.source'))::text not like '%e3000000-0000-4000-8000-000000000005%','unpublished mention target identity is removed, not just its label');
select throws_ok($$select * from public.page_publications$$,'42501',null,'anonymous clients cannot enumerate publication tokens');
select throws_ok($$select public.verify_public_file(current_setting('sharing.source'),'e4000000-0000-4000-8000-000000000001')$$,'42501',null,'public file authorization is server-only');
reset role;
select ok(public.verify_public_file(current_setting('sharing.source'),'e4000000-0000-4000-8000-000000000001'),'current ready cover is public through its page token');
select ok(not public.verify_public_file(current_setting('sharing.source'),'e4000000-0000-4000-8000-000000000002'),'ready but unreferenced file remains private');
set local role authenticated;
select set_config('sharing.target',public.configure_page_publication('e3000000-0000-4000-8000-000000000005',0,true)->'publication'->>'token',true);
select is(public.read_page_publication(current_setting('sharing.source'))->'content'->'blocks'->0->'content'->'content'->0->'content'->1->'attrs'->>'title','Private mention target','published mention resolves its current title');
select public.configure_page_publication('e3000000-0000-4000-8000-000000000005',1,false);
select ok(public.read_page_publication(current_setting('sharing.source'))::text not like '%Private mention target%','revoking target removes a formerly resolved label on the next source read');
select set_config('sharing.base',public.create_database('e2000000-0000-4000-8000-000000000001',null,'Public base','e5000000-0000-4000-8000-000000000001')::text,true);
select set_config('sharing.db',current_setting('sharing.base')::jsonb->>'id',true);
select set_config('sharing.dbpage',current_setting('sharing.base')::jsonb->>'pageId',true);
select set_config('sharing.record',public.add_database_record(current_setting('sharing.db')::uuid,'Public record','e5000000-0000-4000-8000-000000000002')->>'pageId',true);
select set_config('sharing.relationtarget',public.add_database_record(current_setting('sharing.db')::uuid,'Relation target','e5000000-0000-4000-8000-000000000003')->>'pageId',true);
select set_config('sharing.person',public.put_database_property(current_setting('sharing.db')::uuid,null,'People','person','{}',0)->>'id',true);
select set_config('sharing.relation',public.put_database_property(current_setting('sharing.db')::uuid,null,'Relation','relation',jsonb_build_object('targetDatabaseId',current_setting('sharing.db')),0)->>'id',true);
select set_config('sharing.secret',public.put_database_property(current_setting('sharing.db')::uuid,null,'Unpublished field','text','{}',0)->>'id',true);
select set_config('sharing.select',public.put_database_property(current_setting('sharing.db')::uuid,null,'Status','select','{"options":[{"id":"e6000000-0000-4000-8000-000000000001","label":"Published option","color":"indigo"},{"id":"e6000000-0000-4000-8000-000000000002","label":"Private unused option","color":"copper"}]}',0)->>'id',true);
select public.put_database_cell(current_setting('sharing.db')::uuid,current_setting('sharing.record')::uuid,current_setting('sharing.person')::uuid,'["e1000000-0000-4000-8000-000000000002"]',0);
select public.put_database_cell(current_setting('sharing.db')::uuid,current_setting('sharing.record')::uuid,current_setting('sharing.relation')::uuid,jsonb_build_array(current_setting('sharing.relationtarget')),0);
select public.put_database_cell(current_setting('sharing.db')::uuid,current_setting('sharing.record')::uuid,current_setting('sharing.secret')::uuid,'"Do not publish this value"',0);
select public.put_database_cell(current_setting('sharing.db')::uuid,current_setting('sharing.record')::uuid,current_setting('sharing.select')::uuid,'"e6000000-0000-4000-8000-000000000001"',0);
reset role;
insert into public.page_files(id,workspace_id,page_id,object_path,original_name,mime_type,expected_size,actual_size,sha256,status,uploaded_by,finalized_at,purpose)
values('e4000000-0000-4000-8000-000000000003','e2000000-0000-4000-8000-000000000001',current_setting('sharing.record')::uuid,
  'e2000000-0000-4000-8000-000000000001/'||current_setting('sharing.record')||'/e4000000-0000-4000-8000-000000000003','row.png','image/png',1,1,repeat('c',64),'ready','e1000000-0000-4000-8000-000000000001',now(),'cover');
update public.pages set cover_file_id='e4000000-0000-4000-8000-000000000003' where id=current_setting('sharing.record')::uuid;
set local role authenticated;
select set_config('sharing.basetoken',public.configure_page_publication(current_setting('sharing.dbpage')::uuid,0,true,array[current_setting('sharing.person')::uuid,current_setting('sharing.relation')::uuid,current_setting('sharing.select')::uuid])->'publication'->>'token',true);
select is(jsonb_array_length(public.read_page_publication(current_setting('sharing.basetoken'))->'database'->'rows'),0,'publishing a database does not publish its records implicitly');
reset role;
select ok(not public.verify_public_file(current_setting('sharing.basetoken'),'e4000000-0000-4000-8000-000000000003'),'private record cover is not authorized through a public database');
set local role authenticated;
select public.configure_page_publication(current_setting('sharing.record')::uuid,0,true);
select is(jsonb_array_length(public.read_page_publication(current_setting('sharing.basetoken'))->'database'->'rows'),1,'only a separately published record enters the public view');
select ok(public.read_page_publication(current_setting('sharing.basetoken'))::text not like '%Unpublished field%' and public.read_page_publication(current_setting('sharing.basetoken'))::text not like '%Do not publish%','unselected properties and values are excluded');
select ok(public.read_page_publication(current_setting('sharing.basetoken'))::text like '%Published option%' and public.read_page_publication(current_setting('sharing.basetoken'))::text not like '%Private unused option%','public select options reveal only labels used by the public result');
select ok(public.read_page_publication(current_setting('sharing.basetoken'))->'database'->'rows'->0->'values'->current_setting('sharing.person')='["Membro"]'::jsonb,'person values have no emails, names or account identities');
select is(public.read_page_publication(current_setting('sharing.basetoken'))->'database'->'rows'->0->'values'->current_setting('sharing.relation'),'[]'::jsonb,'private relation destination is not exposed');
select public.configure_page_publication(current_setting('sharing.relationtarget')::uuid,0,true);
select ok(public.read_page_publication(current_setting('sharing.basetoken'))::text like '%Relation target%','explicitly published relation destination is available');
select public.configure_page_publication(current_setting('sharing.relationtarget')::uuid,1,false);
select ok(public.read_page_publication(current_setting('sharing.basetoken'))::text not like '%Relation target%','relation labels are reauthorized after target revocation');
reset role;
select ok(public.verify_public_file(current_setting('sharing.basetoken'),'e4000000-0000-4000-8000-000000000003'),'explicitly public record cover is authorized through its public database');
update public.document_heads set projection=jsonb_set(projection,'{blocks}',(projection->'blocks')||jsonb_build_array(jsonb_build_object('id','db-inline','type','databaseRef','parentId',null,'position','z','attributes',jsonb_build_object('databaseId',current_setting('sharing.db'),'viewId','e6000000-0000-4000-8000-000000000003'),'content',jsonb_build_object('type','doc','content','[]'::jsonb)))) where page_id='e3000000-0000-4000-8000-000000000001';
set local role authenticated;
select ok(public.read_page_publication(current_setting('sharing.source'))->'content'->'blocks'->1->'attributes' ? 'token','explicitly published inline database includes its current public link');
select ok(not(public.read_page_publication(current_setting('sharing.source'))->'content'->'blocks'->1->'attributes' ? 'viewId'),'public inline database excludes private view configuration identity');
select public.configure_page_publication(current_setting('sharing.record')::uuid,1,false);
reset role;
select ok(not public.verify_public_file(current_setting('sharing.basetoken'),'e4000000-0000-4000-8000-000000000003'),'revoking a record immediately removes cover access through its database');
set local role authenticated;
select public.configure_page_publication('e3000000-0000-4000-8000-000000000001',2,true,'{}',true);
select ok(public.read_page_publication(current_setting('sharing.source')) is null,'rotating the public link immediately invalidates the previous token');
select set_config('sharing.source',public.get_page_sharing('e3000000-0000-4000-8000-000000000001')->'publication'->>'token',true);
reset role;
update public.document_heads set projection=jsonb_set(projection,'{text}',to_jsonb(repeat('x',1048577))) where page_id='e3000000-0000-4000-8000-000000000001';
set local role anon;
select throws_ok($$select public.read_page_publication(current_setting('sharing.source'))$$,'54000',null,'oversize public content fails explicitly without silent truncation');
reset role;
update public.document_heads set projection=jsonb_set(projection,'{text}','"restored"') where page_id='e3000000-0000-4000-8000-000000000001';
update public.workspace_members set role='owner' where workspace_id='e2000000-0000-4000-8000-000000000001' and user_id='e1000000-0000-4000-8000-000000000004';
delete from public.workspace_members where workspace_id='e2000000-0000-4000-8000-000000000001' and user_id='e1000000-0000-4000-8000-000000000001';
set local role anon;
select ok(public.read_page_publication(current_setting('sharing.source')) is null,'owner membership removal invalidates public reads immediately');
reset role;
select ok(not public.verify_public_file(current_setting('sharing.source'),'e4000000-0000-4000-8000-000000000001'),'owner membership removal also invalidates public file reads');
select is((select count(*)::integer from pg_class where relrowsecurity and relname in ('page_publications','sharing_audit')),2,'publication and audit tables enable RLS');
select ok(not exists(select 1 from information_schema.columns where table_schema='public' and table_name='sharing_audit' and column_name in ('token','body','email','payload')),'audit stores metadata without tokens, message bodies or email');
select * from finish();
rollback;
