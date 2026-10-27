begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
select has_function('public','prepare_block_file',array['uuid','text','text','bigint','text'],'block file preparation exists');
select has_function('public','finalize_page_block_file',array['uuid','uuid','bigint','text','integer','integer'],'block file finalization exists');
select has_column('public','page_files','image_width','verified image width exists');
select has_function('public','reserve_page_file_validation',array['uuid','uuid'],'durable pre-download validation reservation exists');
select has_table('private','page_file_validation_windows','file attempt windows exist');
select ok((select relrowsecurity from pg_class where oid='public.page_files'::regclass),'block file metadata keeps RLS');
insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select ('91000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'block-file-'||n||'@example.test',
  case when n=6 then null else now() end,'{}','{}',now(),now() from generate_series(1,6)n;
insert into public.workspaces(id,name,created_by)values
('92000000-0000-4000-8000-000000000001','Block files A','91000000-0000-4000-8000-000000000001'),
('92000000-0000-4000-8000-000000000002','Block files B','91000000-0000-4000-8000-000000000004');
insert into public.workspace_members(workspace_id,user_id,role)
select '92000000-0000-4000-8000-000000000001',('91000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  case when n=1 then 'owner' else 'member' end from generate_series(1,6)n where n<>4;
insert into public.workspace_members values('92000000-0000-4000-8000-000000000002','91000000-0000-4000-8000-000000000004','owner',now());
insert into public.pages(id,workspace_id,owner_id,title)values
('93000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000001','Block media'),
('93000000-0000-4000-8000-000000000002','92000000-0000-4000-8000-000000000002','91000000-0000-4000-8000-000000000004','Foreign media');
insert into public.page_grants(page_id,workspace_id,user_id,role)
select '93000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001',('91000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  case n when 3 then 'viewer' when 5 then 'commenter' else 'editor' end from unnest(array[2,3,5,6])n;
insert into public.page_files(id,workspace_id,page_id,object_path,original_name,mime_type,expected_size,uploaded_by,purpose,created_at)
select ('94000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  case when n=4 then '92000000-0000-4000-8000-000000000002'::uuid else '92000000-0000-4000-8000-000000000001'::uuid end,
  case when n=4 then '93000000-0000-4000-8000-000000000002'::uuid else '93000000-0000-4000-8000-000000000001'::uuid end,
  case when n=4 then '92000000-0000-4000-8000-000000000002/93000000-0000-4000-8000-000000000002/' else '92000000-0000-4000-8000-000000000001/93000000-0000-4000-8000-000000000001/' end||('94000000-0000-4000-8000-'||lpad(n::text,12,'0')),
  'Original file',case when n=2 then 'application/octet-stream' else 'image/png' end,24,
  case when n=4 then '91000000-0000-4000-8000-000000000004'::uuid else '91000000-0000-4000-8000-000000000002'::uuid end,
  case when n=5 then 'cover' else 'block' end,case when n=3 then now()-interval '2 hours' else now() end from generate_series(1,5)n;
insert into storage.objects(bucket_id,name,metadata)select 'page-assets',object_path,'{"size":24}'::jsonb from public.page_files where id::text like '94000000-%';
insert into public.page_files(id,workspace_id,page_id,object_path,original_name,mime_type,expected_size,uploaded_by,purpose)
select ('94000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'92000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000001',
  '92000000-0000-4000-8000-000000000001/93000000-0000-4000-8000-000000000001/'||('94000000-0000-4000-8000-'||lpad(n::text,12,'0')),
  'Rate fixture','image/png',24,case when n=6 then '91000000-0000-4000-8000-000000000001'::uuid else '91000000-0000-4000-8000-000000000006'::uuid end,'block'
  from generate_series(6,7)n;
select throws_ok($$update public.page_files set image_width=1 where id='94000000-0000-4000-8000-000000000001'$$,'23514',null,'dimension pairs cannot be partially populated');
select throws_ok($$update public.page_files set image_width=6000,image_height=6000 where id='94000000-0000-4000-8000-000000000001'$$,'23514',null,'metadata enforces thirty megapixels');
select throws_ok($$update public.page_files set image_width=16385,image_height=1 where id='94000000-0000-4000-8000-000000000001'$$,'23514',null,'metadata enforces maximum dimension');
select set_config('request.jwt.claims','{"sub":"91000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select lives_ok($$select public.prepare_block_file('93000000-0000-4000-8000-000000000001','Image.png','image/png',24,'image')$$,'editor prepares an image block upload');
select lives_ok($$select public.prepare_block_file('93000000-0000-4000-8000-000000000001','Download.html','text/html',24,'file')$$,'generic attachment ignores the browser MIME declaration');
select is((select mime_type from public.page_files where original_name='Download.html'),'application/octet-stream','generic attachments are normalized to opaque downloads');
select is((select purpose from public.page_files where original_name='Image.png'),'block','new block uploads cannot mutate covers');
select throws_ok($$select public.prepare_block_file('93000000-0000-4000-8000-000000000001','Bad.svg','image/svg+xml',24,'image')$$,'22023',null,'image uploads reject SVG');
select throws_ok($$select public.prepare_block_file('93000000-0000-4000-8000-000000000001','../bad','image/png',24,'image')$$,'22023',null,'path-bearing attachment names are rejected');
select throws_ok($$select public.prepare_block_file('93000000-0000-4000-8000-000000000001','Huge','application/octet-stream',26214401,'file')$$,'22023',null,'attachments cap at25 MiB');
select throws_ok($$select public.prepare_block_file('93000000-0000-4000-8000-000000000001','Unknown','image/png',24,'other')$$,'22023',null,'unknown upload kinds rejected');
select throws_ok($$select public.prepare_block_file('93000000-0000-4000-8000-000000000002','Foreign','image/png',24,'image')$$,'42501',null,'foreign workspace preparation rejected');
select throws_ok($$select public.finalize_page_block_file('94000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000002',24,repeat('a',64),640,480)$$,'42501',null,'browser cannot call privileged block finalization');
select throws_ok($$update public.page_files set image_width=1,image_height=1$$,'42501',null,'client cannot forge dimensions');
reset role;
select ok((select relrowsecurity from pg_class where oid='private.page_file_validation_windows'::regclass),'file attempt windows have deny-client RLS');
select set_config('request.jwt.claims','{"sub":"91000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select throws_ok('select * from private.page_file_validation_windows','42501',null,'client cannot read rate windows');
select throws_ok('insert into private.page_file_validation_windows default values','42501',null,'client cannot insert rate windows');
select throws_ok('update private.page_file_validation_windows set attempts=1','42501',null,'client cannot update rate windows');
select throws_ok('delete from private.page_file_validation_windows','42501',null,'client cannot delete rate windows');
select throws_ok($$select public.reserve_page_file_validation('94000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000002')$$,'42501',null,'client cannot reserve privileged CPU budget');
reset role;
set local role service_role;
select lives_ok($$select public.reserve_page_file_validation('94000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000002')$$,'editor uploader may reserve before validation');
select lives_ok($$select public.reserve_page_file_validation('94000000-0000-4000-8000-000000000005','91000000-0000-4000-8000-000000000002')$$,'cover and block validations share durable budget');
select lives_ok($$select public.reserve_page_file_validation('94000000-0000-4000-8000-000000000006','91000000-0000-4000-8000-000000000001')$$,'owner uploader may reserve validation');
select throws_ok($$select public.reserve_page_file_validation('94000000-0000-4000-8000-000000000007','91000000-0000-4000-8000-000000000006')$$,'42501',null,'unconfirmed uploader with editor grant cannot reserve validation');
select is((select attempts from private.page_file_validation_windows where workspace_id='92000000-0000-4000-8000-000000000001' and actor_id='91000000-0000-4000-8000-000000000002'),2,'attempts count before any file has been accepted');
select throws_ok($$select public.reserve_page_file_validation('94000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000003')$$,'42501',null,'viewer cannot reserve file validation');
select throws_ok($$select public.reserve_page_file_validation('94000000-0000-4000-8000-000000000004','91000000-0000-4000-8000-000000000002')$$,'42501',null,'foreign file cannot reserve against another uploader');
select throws_ok($$select public.reserve_page_file_validation('94000000-0000-4000-8000-000000000003','91000000-0000-4000-8000-000000000002')$$,'22023',null,'expired staging cannot consume a new validation attempt');
insert into private.page_file_validation_windows(workspace_id,actor_id,window_start,attempts)values
('92000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000002',date_bin('10 minutes',now(),'2000-01-01 00:00:00+00'::timestamptz)-interval '30 minutes',30),
('92000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000001',date_bin('10 minutes',now(),'2000-01-01 00:00:00+00'::timestamptz)-interval '30 minutes',12),
('92000000-0000-4000-8000-000000000002','91000000-0000-4000-8000-000000000004',date_bin('10 minutes',now(),'2000-01-01 00:00:00+00'::timestamptz)-interval '30 minutes',12);
select lives_ok($$select public.reserve_page_file_validation('94000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000002')$$,'later bucket ignores stale attempts and cleans its own rows');
select is((select count(*)::integer from private.page_file_validation_windows where actor_id='91000000-0000-4000-8000-000000000002' and window_start<date_bin('10 minutes',now(),'2000-01-01 00:00:00+00'::timestamptz)-interval '20 minutes'),0,'old own windows pruned');
select is((select count(*)::integer from private.page_file_validation_windows where attempts=12),2,'cleanup preserves other actors and workspaces');
update private.page_file_validation_windows set attempts=29 where actor_id='91000000-0000-4000-8000-000000000002';
select lives_ok($$select public.reserve_page_file_validation('94000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000002')$$,'thirtieth attempt in ten minutes is allowed');
select throws_ok($$select public.reserve_page_file_validation('94000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000002')$$,'54000',null,'thirty-first attempt cannot reach file download');
reset role;
set local role service_role;
select is(public.finalize_page_cover('94000000-0000-4000-8000-000000000005','91000000-0000-4000-8000-000000000002',0,24,repeat('a',64)),1::bigint,'legacy cover contract remains compatible');
select throws_ok($$select public.finalize_page_block_file('94000000-0000-4000-8000-000000000005','91000000-0000-4000-8000-000000000002',24,repeat('a',64),640,480)$$,'42501',null,'block finalization refuses a cover');
select throws_ok($$select public.finalize_page_block_file('94000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000003',24,repeat('a',64),640,480)$$,'42501',null,'privileged path checks actual uploader and viewer role');
select throws_ok($$select public.finalize_page_block_file('94000000-0000-4000-8000-000000000004','91000000-0000-4000-8000-000000000002',24,repeat('a',64),640,480)$$,'42501',null,'privileged path denies foreign workspace files');
select throws_ok($$select public.finalize_page_block_file('94000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000002',25,repeat('a',64),640,480)$$,'22023',null,'actual byte count must match declaration');
select throws_ok($$select public.finalize_page_block_file('94000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000002',24,repeat('a',64))$$,'22023',null,'image block requires verified dimensions');
select throws_ok($$select public.finalize_page_block_file('94000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000002',24,repeat('a',64),6000,6000)$$,'22023',null,'oversized pixel canvas cannot finalize');
select throws_ok($$select public.finalize_page_block_file('94000000-0000-4000-8000-000000000002','91000000-0000-4000-8000-000000000002',24,repeat('a',64),1,1)$$,'22023',null,'generic files cannot pretend to have image dimensions');
select throws_ok($$select public.finalize_page_block_file('94000000-0000-4000-8000-000000000003','91000000-0000-4000-8000-000000000002',24,repeat('a',64),640,480)$$,'22023',null,'staging TTL applies to image blocks');
select is(public.finalize_page_block_file('94000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000002',24,repeat('a',64),640,480),'94000000-0000-4000-8000-000000000001'::uuid,'verified image becomes ready');
select is(public.finalize_page_block_file('94000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000002',24,repeat('a',64),640,480),'94000000-0000-4000-8000-000000000001'::uuid,'same verified retry is idempotent');
select throws_ok($$select public.finalize_page_block_file('94000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000002',24,repeat('b',64),640,480)$$,'22023',null,'ready file hash is immutable');
select throws_ok($$select public.finalize_page_block_file('94000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000002',24,repeat('a',64),641,480)$$,'22023',null,'ready dimensions are immutable');
select is(public.finalize_page_block_file('94000000-0000-4000-8000-000000000002','91000000-0000-4000-8000-000000000002',24,repeat('a',64)),'94000000-0000-4000-8000-000000000002'::uuid,'generic attachment finalizes without claimed type detection');
select lives_ok($$select public.reserve_page_file_validation('94000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000002')$$,'ready receipt retries stay free at exhausted quota');
select is((select attempts from private.page_file_validation_windows where actor_id='91000000-0000-4000-8000-000000000002'),30,'ready receipt does not add decoding attempts');
reset role;
select is((select revision from public.pages where id='93000000-0000-4000-8000-000000000001'),1::bigint,'block finalization does not change page metadata revision');
select is((select cover_file_id from public.pages where id='93000000-0000-4000-8000-000000000001'),'94000000-0000-4000-8000-000000000005'::uuid,'block finalization preserves the page cover');
select throws_ok($$update public.pages set cover_file_id='94000000-0000-4000-8000-000000000001' where id='93000000-0000-4000-8000-000000000001'$$,'23514',null,'block metadata cannot replace a cover through direct service mutation');
select set_config('request.jwt.claims','{"sub":"91000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
set local role authenticated;
select is((select count(*)::integer from public.page_files),3,'viewer reads only ready authorized cover/image/attachment metadata');
select is((select image_width from public.page_files where id='94000000-0000-4000-8000-000000000001'),640,'viewer receives verified dimensions');
select throws_ok($$select public.prepare_block_file('93000000-0000-4000-8000-000000000001','Denied','image/png',24,'image')$$,'42501',null,'viewer cannot prepare upload');
select set_config('storage.operation','object.sign',true);
select is((select count(*)::integer from storage.objects where bucket_id='page-assets'),0,'signed download capability remains denied');
select set_config('storage.operation','object.get_authenticated',true);
select is((select count(*)::integer from storage.objects where bucket_id='page-assets'),3,'authenticated Storage reads require current page access');
reset role;
delete from public.page_grants where page_id='93000000-0000-4000-8000-000000000001' and user_id='91000000-0000-4000-8000-000000000003';
set local role authenticated;
select is((select count(*)::integer from public.page_files),0,'revoked viewer loses metadata immediately');
select is((select count(*)::integer from storage.objects where bucket_id='page-assets'),0,'revoked viewer loses bytes immediately');
reset role;
select set_config('request.jwt.claims','{"sub":"91000000-0000-4000-8000-000000000005","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.prepare_block_file('93000000-0000-4000-8000-000000000001','Denied','image/png',24,'image')$$,'42501',null,'commenter cannot upload');
reset role;
select set_config('request.jwt.claims','{"sub":"91000000-0000-4000-8000-000000000006","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.prepare_block_file('93000000-0000-4000-8000-000000000001','Denied','image/png',24,'image')$$,'28000',null,'unconfirmed editor cannot prepare upload');
reset role;
select set_config('request.jwt.claims','{"sub":"91000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select lives_ok($$select public.prepare_block_file('93000000-0000-4000-8000-000000000001','Owned','image/png',24,'image')$$,'owner may prepare block upload');
reset role;
insert into public.page_files(id,workspace_id,page_id,object_path,original_name,mime_type,expected_size,uploaded_by)
select md5('block-quota-'||n)::uuid,'92000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000001',
  '92000000-0000-4000-8000-000000000001/93000000-0000-4000-8000-000000000001/'||md5('block-quota-'||n)::uuid::text,
  'Pending cover','image/png',24,'91000000-0000-4000-8000-000000000001' from generate_series(1,9)n;
set local role authenticated;
select throws_ok($$select public.prepare_block_file('93000000-0000-4000-8000-000000000001','Over quota','image/png',24,'image')$$,'54000',null,'cover and block uploads share pending quota');
reset role;
select set_config('request.jwt.claims','{}',true);
set local role anon;
select throws_ok($$select public.prepare_block_file('93000000-0000-4000-8000-000000000001','Denied','image/png',24,'image')$$,'42501',null,'anonymous upload preparation denied');
select throws_ok($$select public.finalize_page_block_file('94000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000002',24,repeat('a',64),640,480)$$,'42501',null,'anonymous finalization denied');
select throws_ok('select * from private.page_file_validation_windows','42501',null,'anonymous rate-window SELECT denied');
select throws_ok('insert into private.page_file_validation_windows default values','42501',null,'anonymous rate-window INSERT denied');
select throws_ok('update private.page_file_validation_windows set attempts=1','42501',null,'anonymous rate-window UPDATE denied');
select throws_ok('delete from private.page_file_validation_windows','42501',null,'anonymous rate-window DELETE denied');
select throws_ok($$select public.reserve_page_file_validation('94000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000002')$$,'42501',null,'anonymous reservation denied');
reset role;
select * from finish();
rollback;
