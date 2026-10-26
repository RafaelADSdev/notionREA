begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
select has_table('public','page_files','private file metadata exists');
select ok((select relrowsecurity from pg_class where oid='public.page_files'::regclass),'file metadata has RLS');
select is((select public from storage.buckets where id='page-assets'),false,'asset bucket stays private');
select is((select file_size_limit from storage.buckets where id='page-assets'),26214400::bigint,'bucket caps upload bytes');

insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('71000000-0000-4000-8000-000000000001','file-owner@example.test',now(),'{}','{}',now(),now()),
('71000000-0000-4000-8000-000000000002','file-editor@example.test',now(),'{}','{}',now(),now()),
('71000000-0000-4000-8000-000000000003','file-viewer@example.test',now(),'{}','{}',now(),now()),
('71000000-0000-4000-8000-000000000004','file-outsider@example.test',now(),'{}','{}',now(),now()),
('71000000-0000-4000-8000-000000000005','file-commenter@example.test',now(),'{}','{}',now(),now());
insert into public.workspaces(id,name,created_by) values
('72000000-0000-4000-8000-000000000001','Files A','71000000-0000-4000-8000-000000000001'),
('72000000-0000-4000-8000-000000000002','Files B','71000000-0000-4000-8000-000000000004');
insert into public.workspace_members(workspace_id,user_id,role) values
('72000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001','owner'),
('72000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000002','member'),
('72000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000003','member'),
('72000000-0000-4000-8000-000000000002','71000000-0000-4000-8000-000000000004','owner'),
('72000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000005','member');
insert into public.pages(id,workspace_id,owner_id,title) values
('73000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001','Image page'),
('73000000-0000-4000-8000-000000000002','72000000-0000-4000-8000-000000000002','71000000-0000-4000-8000-000000000004','Foreign page');
insert into public.page_grants(page_id,workspace_id,user_id,role) values
('73000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000002','editor'),
('73000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000003','viewer'),
('73000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000005','commenter');
insert into public.page_files(id,workspace_id,page_id,object_path,original_name,mime_type,expected_size,uploaded_by) values
('74000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000001','73000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000001/73000000-0000-4000-8000-000000000001/74000000-0000-4000-8000-000000000001','Cover.png','image/png',24,'71000000-0000-4000-8000-000000000002'),
('74000000-0000-4000-8000-000000000002','72000000-0000-4000-8000-000000000002','73000000-0000-4000-8000-000000000002','72000000-0000-4000-8000-000000000002/73000000-0000-4000-8000-000000000002/74000000-0000-4000-8000-000000000002','Foreign.png','image/png',24,'71000000-0000-4000-8000-000000000004');
select throws_ok($$update public.page_files set status='ready',finalized_at=now() where id='74000000-0000-4000-8000-000000000001'$$,'23514',null,'ready state requires a verified size and digest');
select throws_ok($$insert into public.page_files(workspace_id,page_id,object_path,original_name,mime_type,expected_size,uploaded_by) values('72000000-0000-4000-8000-000000000002','73000000-0000-4000-8000-000000000001','bad','a.png','image/png',24,'71000000-0000-4000-8000-000000000002')$$,'23514',null,'untrusted object paths cannot cross scopes');
select ok(not has_table_privilege('authenticated','public.page_files','INSERT'),'metadata direct insert denied');
select ok(not has_table_privilege('authenticated','public.page_files','UPDATE'),'metadata direct update denied');
select ok(not has_table_privilege('authenticated','public.page_files','DELETE'),'metadata direct delete denied');
select set_config('request.jwt.claims','{"sub":"71000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select is((select count(*)::integer from public.page_files),1,'uploader reads own authorized staging metadata');
select lives_ok($$select public.prepare_page_file('73000000-0000-4000-8000-000000000001','Prepared.png','image/png',24)$$,'editor prepares a scoped upload');
select is((select count(*)::integer from public.page_files where original_name='Prepared.png' and object_path=workspace_id::text||'/'||page_id::text||'/'||id::text),1,'preparation assigns an opaque canonical path');
select throws_ok($$select public.prepare_page_file('73000000-0000-4000-8000-000000000001','Cover.png','image/svg+xml',24)$$,'22023',null,'SVG is never accepted by cover preparation');
select throws_ok($$select public.prepare_page_file('73000000-0000-4000-8000-000000000001','../Cover.png','image/png',24)$$,'22023',null,'path-bearing names rejected');
select throws_ok($$select public.prepare_page_file('73000000-0000-4000-8000-000000000001','Cover.png','image/png',26214401)$$,'22023',null,'oversized declarations rejected');
select throws_ok($$select public.prepare_page_file('73000000-0000-4000-8000-000000000002','Cover.png','image/png',24)$$,'42501',null,'foreign workspace cannot prepare upload');
select throws_ok($$select public.finalize_page_cover('74000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000002',0,24,repeat('a',64))$$,'42501',null,'browser cannot call privileged finalization');
select lives_ok($$insert into storage.objects(bucket_id,name,metadata) values('page-assets','72000000-0000-4000-8000-000000000001/73000000-0000-4000-8000-000000000001/74000000-0000-4000-8000-000000000001','{"size":24}')$$,'uploader can create only the prepared object');
select throws_ok($$insert into storage.objects(bucket_id,name,metadata) values('page-assets','invented/unscoped/path','{"size":24}')$$,'42501',null,'unprepared storage paths are denied');
select throws_ok($$insert into storage.objects(bucket_id,name,metadata) values('page-assets','72000000-0000-4000-8000-000000000002/73000000-0000-4000-8000-000000000002/74000000-0000-4000-8000-000000000002','{"size":24}')$$,'42501',null,'foreign prepared objects are denied');
select set_config('storage.operation','object.get_authenticated',true);
select is((select count(*)::integer from storage.objects where bucket_id='page-assets'),0,'staging bytes cannot be read through public Storage API');
reset role;
set local role service_role;
select throws_ok($$select public.finalize_page_cover('74000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000003',0,24,repeat('a',64))$$,'42501',null,'privileged finalization reauthorizes the actual actor');
select throws_ok($$select public.finalize_page_cover('74000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000002',99,24,repeat('a',64))$$,'40001',null,'stale cover revision fails atomically');
select throws_ok($$select public.finalize_page_cover('74000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000002',0,25,repeat('a',64))$$,'22023',null,'verified length must match declaration');
select is(public.finalize_page_cover('74000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000002',0,24,repeat('a',64)),1::bigint,'verified object attaches with metadata CAS');
select is(public.finalize_page_cover('74000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000002',0,24,repeat('a',64)),1::bigint,'lost finalization ACK is idempotent while the same cover remains attached');
reset role;
select is((select status from public.page_files where id='74000000-0000-4000-8000-000000000001'),'ready','file becomes ready atomically');
select is((select cover_file_id from public.pages where id='73000000-0000-4000-8000-000000000001'),'74000000-0000-4000-8000-000000000001'::uuid,'cover references the verified file');
select throws_ok($$update public.pages set cover_file_id='74000000-0000-4000-8000-000000000001' where id='73000000-0000-4000-8000-000000000002'$$,'23503',null,'cover cannot reference another page or workspace');
select set_config('request.jwt.claims','{"sub":"71000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
set local role authenticated;
select is((select count(*)::integer from public.page_files),1,'viewer reads only ready authorized metadata');
select is((select count(*)::integer from storage.objects where bucket_id='page-assets'),1,'viewer reads ready bytes using authenticated GET operation');
select set_config('storage.operation','object.sign',true);
select is((select count(*)::integer from storage.objects where bucket_id='page-assets'),0,'long-lived signed downloads cannot bypass future ACL checks');
select set_config('storage.operation','object.list',true);
select is((select count(*)::integer from storage.objects where bucket_id='page-assets'),0,'storage listing cannot reveal private paths');
select throws_ok($$select public.prepare_page_file('73000000-0000-4000-8000-000000000001','Cover.png','image/png',24)$$,'42501',null,'viewer cannot upload');
select throws_ok($$select public.clear_page_cover('73000000-0000-4000-8000-000000000001',1)$$,'42501',null,'viewer cannot remove a cover');
reset role;
delete from public.page_grants where page_id='73000000-0000-4000-8000-000000000001' and user_id='71000000-0000-4000-8000-000000000003';
set local role authenticated;
select set_config('storage.operation','object.get_authenticated',true);
select is((select count(*)::integer from public.page_files),0,'revoked viewer loses metadata without refreshing JWT');
select is((select count(*)::integer from storage.objects where bucket_id='page-assets'),0,'revoked viewer loses bytes without refreshing JWT');
reset role;
select set_config('request.jwt.claims','{"sub":"71000000-0000-4000-8000-000000000005","role":"authenticated"}',true);
set local role authenticated;
select is((select count(*)::integer from public.page_files),1,'commenter reads authorized ready metadata');
select is((select count(*)::integer from storage.objects where bucket_id='page-assets'),1,'commenter reads only authorized ready bytes');
select throws_ok($$select public.prepare_page_file('73000000-0000-4000-8000-000000000001','Cover.png','image/png',24)$$,'42501',null,'commenter cannot upload');
reset role;
select set_config('request.jwt.claims','{"sub":"71000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
with changed as (update storage.objects set metadata='{"size":1}' where bucket_id='page-assets' returning id)
  select is((select count(*)::integer from changed),0,'ready bytes cannot be overwritten by uploader');
select throws_ok($$delete from storage.objects where bucket_id='page-assets'$$,'42501',null,'direct object deletion is denied by the Storage boundary');
select throws_ok($$select public.clear_page_cover('73000000-0000-4000-8000-000000000001',0)$$,'40001',null,'removal rejects a stale revision');
select is(public.clear_page_cover('73000000-0000-4000-8000-000000000001',1),2::bigint,'editor removes cover without deleting content');
reset role;
insert into public.page_files(id,workspace_id,page_id,object_path,original_name,mime_type,expected_size,uploaded_by,created_at)
  select md5('pending-file-'||n)::uuid,'72000000-0000-4000-8000-000000000001','73000000-0000-4000-8000-000000000001',
  '72000000-0000-4000-8000-000000000001/73000000-0000-4000-8000-000000000001/'||md5('pending-file-'||n)::uuid::text,
  'Pending.png','image/png',24,'71000000-0000-4000-8000-000000000002',now() from generate_series(1,9) n;
set local role authenticated;
select throws_ok($$select public.prepare_page_file('73000000-0000-4000-8000-000000000001','Over-quota.png','image/png',24)$$,'54000',null,'pending upload quota is enforced in the shared database');
reset role;
update public.page_files set created_at=now()-interval '2 hours' where id=md5('pending-file-1')::uuid;
set local role authenticated;
select is(private.can_upload_page_object('72000000-0000-4000-8000-000000000001/73000000-0000-4000-8000-000000000001/'||md5('pending-file-1')::uuid::text,'71000000-0000-4000-8000-000000000002'),false,'expired staging cannot issue a fresh upload capability');
reset role;
set local role service_role;
select throws_ok($$select public.finalize_page_cover(md5('pending-file-1')::uuid,'71000000-0000-4000-8000-000000000002',2,24,repeat('a',64))$$,'22023',null,'expired staging cannot be finalized even by privileged path');
reset role;
update public.pages set deleted_at=now() where id='73000000-0000-4000-8000-000000000001';
set local role authenticated;
select is((select count(*)::integer from public.page_files),0,'trash hides ready and staging metadata');
select is((select count(*)::integer from storage.objects where bucket_id='page-assets'),0,'trash hides stored content');
reset role;
select set_config('request.jwt.claims','{}',true);
set local role anon;
select throws_ok('select * from public.page_files','42501',null,'anonymous metadata reads are denied');
select throws_ok($$select public.prepare_page_file('73000000-0000-4000-8000-000000000001','Cover.png','image/png',24)$$,'42501',null,'anonymous upload preparation denied');
reset role;
select * from finish();
rollback;
