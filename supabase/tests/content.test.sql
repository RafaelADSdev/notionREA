begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();
select has_function('public','get_document_manifest',array['uuid'],'authorized document manifest RPC exists');
select has_function('public','read_document_chunk',array['uuid','bigint','integer'],'bounded document chunk RPC exists');
select has_function('public','commit_content_document',array['uuid','uuid','bigint','uuid','bytea','text','bytea','jsonb'],'validated content commit RPC exists');
select has_function('public','resolve_page_mentions',array['uuid','uuid[]'],'authorized mention projection RPC exists');
select has_function('public','list_page_backlinks',array['uuid','uuid'],'authorized backlinks RPC exists');
select has_table('public','page_backlinks','derived backlinks table exists');
select has_table('public','page_search_chunks','bounded derived search chunks table exists');
select has_table('private','document_request_windows','durable early-validation attempts table exists');
select has_function('public','reserve_document_validation',array['uuid','uuid'],'early CPU quota reservation RPC exists');
insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select ('81000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'content-'||n||'@example.test',
  case when n=7 then null else now() end,'{}','{}',now(),now() from generate_series(1,7) n;
insert into public.workspaces(id,name,created_by) values
('82000000-0000-4000-8000-000000000001','Content A','81000000-0000-4000-8000-000000000001'),
('82000000-0000-4000-8000-000000000002','Content B','81000000-0000-4000-8000-000000000006');
insert into public.workspace_members(workspace_id,user_id,role)
select '82000000-0000-4000-8000-000000000001',('81000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  case when n=1 then 'owner' else 'member' end from generate_series(1,7) n where n not in(5,6);
insert into public.workspace_members values('82000000-0000-4000-8000-000000000002','81000000-0000-4000-8000-000000000006','owner',now());
insert into public.pages(id,workspace_id,title,owner_id,restricted)
select ('83000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  case when n=4 then '82000000-0000-4000-8000-000000000002'::uuid else '82000000-0000-4000-8000-000000000001'::uuid end,
  case n when 1 then 'Documento título' when 2 then 'Alvo autorizado' when 3 then 'Segredo invisível'
    when 4 then 'Outro workspace' when 5 then 'Origem oculta' else 'Documento '||n end,
  case when n=4 then '81000000-0000-4000-8000-000000000006'::uuid else '81000000-0000-4000-8000-000000000001'::uuid end,true
  from generate_series(1,9) n;
insert into public.page_grants(page_id,workspace_id,user_id,role)
select ('83000000-0000-4000-8000-'||lpad(p::text,12,'0'))::uuid,'82000000-0000-4000-8000-000000000001',
  ('81000000-0000-4000-8000-'||lpad(u::text,12,'0'))::uuid,case u when 2 then 'editor' when 3 then 'viewer' when 4 then 'commenter' else 'editor' end
  from unnest(array[1,2,6,7,8]) p cross join unnest(array[2,3,4,7]) u;
insert into public.document_heads(page_id,workspace_id,revision,snapshot,projection) values
('83000000-0000-4000-8000-000000000006','82000000-0000-4000-8000-000000000001',1,decode(repeat('ab',600000),'hex'),'{"schemaVersion":1}'),
('83000000-0000-4000-8000-000000000007','82000000-0000-4000-8000-000000000001',3,'\x01','{"schemaVersion":99}'),
('83000000-0000-4000-8000-000000000008','82000000-0000-4000-8000-000000000001',2,'\x01','{}');
insert into public.page_files(id,workspace_id,page_id,object_path,original_name,mime_type,expected_size,actual_size,sha256,status,uploaded_by,finalized_at)
select ('84000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  case when n=4 then '82000000-0000-4000-8000-000000000002'::uuid else '82000000-0000-4000-8000-000000000001'::uuid end,
  case n when 3 then '83000000-0000-4000-8000-000000000002'::uuid when 4 then '83000000-0000-4000-8000-000000000004'::uuid else '83000000-0000-4000-8000-000000000001'::uuid end,
  (case when n=4 then '82000000-0000-4000-8000-000000000002/83000000-0000-4000-8000-000000000004/' when n=3 then '82000000-0000-4000-8000-000000000001/83000000-0000-4000-8000-000000000002/' else '82000000-0000-4000-8000-000000000001/83000000-0000-4000-8000-000000000001/' end)||('84000000-0000-4000-8000-'||lpad(n::text,12,'0')),
  'Original.png','image/png',24,case when n=2 then null else 24 end,case when n=2 then null else repeat('a',64) end,
  case when n=2 then 'staging' else 'ready' end,'81000000-0000-4000-8000-000000000001',case when n=2 then null else now() end
  from generate_series(1,4) n;

-- These are deliberately fake byte fixtures: the HTTP worker tests validate real
-- Yjs bytes. SQL proves atomic persistence and ACL without decoding client data.
create function pg_temp.content_commit(p_expected bigint,p_op integer,p_text text default 'coração organizing',
  p_refs jsonb default '["83000000-0000-4000-8000-000000000002"]',p_files jsonb default '["84000000-0000-4000-8000-000000000001"]',
  p_actor uuid default '81000000-0000-4000-8000-000000000002',p_page uuid default '83000000-0000-4000-8000-000000000001',p_payload bytea default '\x01')
returns bigint language sql as $$
  select public.commit_content_document(p_page,p_actor,p_expected,md5('content-op-'||p_op)::uuid,p_payload,
    encode(extensions.digest(p_payload,'sha256'),'hex'),'\x010203',
    jsonb_build_object('schemaVersion',1,'text',p_text,'references',p_refs,'files',p_files,'blocks','[]'::jsonb));
$$;

select ok((select relrowsecurity from pg_class where oid='public.page_backlinks'::regclass),'backlinks has RLS');
select ok((select relrowsecurity from pg_class where oid='public.page_search_chunks'::regclass),'search chunks has RLS');
select ok((select relrowsecurity from pg_class where oid='private.document_request_windows'::regclass),'early-validation attempts has RLS');
select throws_ok($$insert into public.page_backlinks values('82000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000004',1)$$,'23503',null,'backlinks cannot cross workspace through a target');
select throws_ok($$insert into public.page_backlinks values('82000000-0000-4000-8000-000000000002','83000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000004',1)$$,'23503',null,'backlinks cannot cross workspace through a source');
select set_config('request.jwt.claims','{"sub":"81000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select results_eq($$select * from public.get_document_manifest('83000000-0000-4000-8000-000000000001')$$,$$select 0::bigint,0,1$$,'empty document has an explicit version-one bootstrap manifest');
select is(public.read_document_chunk('83000000-0000-4000-8000-000000000001',0),'\x'::bytea,'empty document has no invented bytes');
select is((select schema_version from public.get_document_manifest('83000000-0000-4000-8000-000000000007')),99,'future schema remains visible as unsupported version');
select is((select schema_version from public.get_document_manifest('83000000-0000-4000-8000-000000000008')),-1,'legacy unknown projection never becomes version one');
select is((select byte_length from public.get_document_manifest('83000000-0000-4000-8000-000000000006')),600000,'manifest reports durable byte length');
select is(octet_length(public.read_document_chunk('83000000-0000-4000-8000-000000000006',1)),524288,'first chunk is bounded to512 KiB');
select is(octet_length(public.read_document_chunk('83000000-0000-4000-8000-000000000006',1,524288)),75712,'last chunk contains only remaining bytes');
select is(octet_length(public.read_document_chunk('83000000-0000-4000-8000-000000000006',1,8388608)),0,'aligned upper byte boundary returns no extra bytes');
select throws_ok($$select public.read_document_chunk('83000000-0000-4000-8000-000000000006',0)$$,'40001',null,'chunk reads reject stale revisions');
select throws_ok($$select public.read_document_chunk('83000000-0000-4000-8000-000000000006',null)$$,'40001',null,'chunk reads require a revision');
select throws_ok($$select public.read_document_chunk('83000000-0000-4000-8000-000000000006',1,1)$$,'22023',null,'unaligned chunk offset is rejected');
select throws_ok($$select public.read_document_chunk('83000000-0000-4000-8000-000000000006',1,-524288)$$,'22023',null,'negative chunk offset is rejected');
select throws_ok($$select public.read_document_chunk('83000000-0000-4000-8000-000000000006',1,8912896)$$,'22023',null,'chunk offset beyond8 MiB is rejected');
select throws_ok($$select public.read_document_chunk('83000000-0000-4000-8000-000000000006',1,null)$$,'22023',null,'null chunk offset is rejected');
select throws_ok($$select public.get_document_manifest('83000000-0000-4000-8000-000000000003')$$,'42501',null,'manifest cannot reveal a private document');
select throws_ok($$select public.read_document_chunk('83000000-0000-4000-8000-000000000004',0)$$,'42501',null,'chunks cannot reveal another workspace');
select throws_ok($$select search_vector from public.page_search_chunks$$,'42501',null,'body vectors have no direct client column privilege');
select throws_ok($$insert into public.page_search_chunks values('83000000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000001',0,1,''::tsvector)$$,'42501',null,'authenticated search chunk INSERT denied');
select throws_ok($$update public.page_search_chunks set source_revision=99$$,'42501',null,'authenticated search chunk UPDATE denied');
select throws_ok($$delete from public.page_search_chunks$$,'42501',null,'authenticated search chunk DELETE denied');
select throws_ok($$select parent_id from public.pages$$,'42501',null,'content migration preserves physical parent protection');
select throws_ok($$select pg_temp.content_commit(0,1)$$,'42501',null,'browser editor cannot invoke privileged content commit');
select throws_ok($$select public.reserve_document_validation('83000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000002')$$,'42501',null,'browser cannot invoke early privileged reservation');
select throws_ok('select * from private.document_request_windows','42501',null,'authenticated attempt window SELECT denied');
select throws_ok('insert into private.document_request_windows default values','42501',null,'authenticated attempt window INSERT denied');
select throws_ok('update private.document_request_windows set attempts=1','42501',null,'authenticated attempt window UPDATE denied');
select throws_ok('delete from private.document_request_windows','42501',null,'authenticated attempt window DELETE denied');
select is((select count(*)::integer from public.resolve_page_mentions('82000000-0000-4000-8000-000000000001',array['83000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000002','83000000-0000-4000-8000-000000000003','83000000-0000-4000-8000-000000000004']::uuid[])),2,'mentions return only current authorized labels in the requested workspace');
select is((select count(*)::integer from public.resolve_page_mentions('82000000-0000-4000-8000-000000000002',array['83000000-0000-4000-8000-000000000004']::uuid[])),0,'mention IDs do not bypass workspace membership');
select is((select count(*)::integer from public.resolve_page_mentions('82000000-0000-4000-8000-000000000001','{}'::uuid[])),0,'empty mention list is valid');
select throws_ok($$select * from public.resolve_page_mentions('82000000-0000-4000-8000-000000000001',array_fill('83000000-0000-4000-8000-000000000001'::uuid,array[101]))$$,'22023',null,'mention requests cap IDs before authorization queries');
select throws_ok($$select * from public.resolve_page_mentions('82000000-0000-4000-8000-000000000001',null)$$,'22023',null,'null mention arrays rejected');
select throws_ok($$select * from public.resolve_page_mentions('82000000-0000-4000-8000-000000000001',array[null]::uuid[])$$,'22023',null,'null mention IDs rejected');
select throws_ok($$select * from public.resolve_page_mentions('82000000-0000-4000-8000-000000000001',array[['83000000-0000-4000-8000-000000000001'::uuid]])$$,'22023',null,'multidimensional mention arrays rejected');
reset role;
set local role service_role;
select lives_ok($$select public.reserve_document_validation('83000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000002')$$,'current editor reserves bounded validation budget');
select lives_ok($$select public.reserve_document_validation('83000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001')$$,'current owner reserves bounded validation budget');
select throws_ok($$select public.reserve_document_validation('83000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000003')$$,'42501',null,'viewer cannot reserve validation budget');
select throws_ok($$select public.reserve_document_validation('83000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000004')$$,'42501',null,'commenter cannot reserve validation budget');
select throws_ok($$select public.reserve_document_validation('83000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000005')$$,'42501',null,'nonmember cannot reserve validation budget');
select throws_ok($$select public.reserve_document_validation('83000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000006')$$,'42501',null,'foreign owner cannot reserve validation budget');
select throws_ok($$select public.reserve_document_validation('83000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000007')$$,'42501',null,'unconfirmed editor cannot reserve validation budget');
select is(pg_temp.content_commit(0,1),1::bigint,'editor persists accepted content with projection and ready file');
select is(pg_temp.content_commit(0,1),1::bigint,'duplicate operation returns its durable receipt');
select throws_ok($$select pg_temp.content_commit(0,2)$$,'40001',null,'stale CAS cannot overwrite content');
select throws_ok($$select pg_temp.content_commit(1,1,p_payload=>'\x02')$$,'22023',null,'same operation with different bytes is rejected');
select throws_ok($$select pg_temp.content_commit(1,1,p_actor=>'81000000-0000-4000-8000-000000000001')$$,'22023',null,'same operation cannot be replayed by another actor');
select throws_ok($$select pg_temp.content_commit(1,2,p_actor=>'81000000-0000-4000-8000-000000000003')$$,'42501',null,'viewer cannot commit through privileged path');
select throws_ok($$select pg_temp.content_commit(1,2,p_actor=>'81000000-0000-4000-8000-000000000004')$$,'42501',null,'commenter cannot commit through privileged path');
select throws_ok($$select pg_temp.content_commit(1,2,p_actor=>'81000000-0000-4000-8000-000000000005')$$,'42501',null,'nonmember cannot commit through privileged path');
select throws_ok($$select pg_temp.content_commit(1,2,p_actor=>'81000000-0000-4000-8000-000000000006')$$,'42501',null,'other workspace owner cannot commit');
select throws_ok($$select pg_temp.content_commit(1,2,p_actor=>'81000000-0000-4000-8000-000000000007')$$,'42501',null,'unconfirmed actor cannot commit even with an editor grant');
select throws_ok($$select pg_temp.content_commit(1,2,p_refs=>'["83000000-0000-4000-8000-000000000003"]')$$,'42501',null,'new private reference is denied');
select throws_ok($$select pg_temp.content_commit(1,2,p_refs=>'["83000000-0000-4000-8000-000000000004"]')$$,'42501',null,'new foreign workspace reference is denied');
select throws_ok($$select pg_temp.content_commit(1,2,p_refs=>'["83000000-0000-4000-8000-000000000099"]')$$,'42501',null,'new missing page reference is denied');
select throws_ok($$select pg_temp.content_commit(1,2,p_refs=>'["not-a-uuid"]')$$,'22023',null,'malformed page reference is rejected before UUID cast');
select throws_ok($$select pg_temp.content_commit(1,2,p_refs=>'[null]')$$,'22023',null,'null page reference rejected');
select throws_ok($$select pg_temp.content_commit(1,2,p_refs=>'{}')$$,'22023',null,'references must be an array');
select throws_ok($$select pg_temp.content_commit(1,2,p_refs=>to_jsonb(array_fill('83000000-0000-4000-8000-000000000002'::text,array[10001])))$$,'22023',null,'reference arrays are bounded');
select throws_ok($$select pg_temp.content_commit(1,2,p_files=>'["84000000-0000-4000-8000-000000000002"]')$$,'42501',null,'staging files cannot enter content');
select throws_ok($$select pg_temp.content_commit(1,2,p_files=>'["84000000-0000-4000-8000-000000000003"]')$$,'42501',null,'ready file from another page cannot enter content');
select throws_ok($$select pg_temp.content_commit(1,2,p_files=>'["84000000-0000-4000-8000-000000000004"]')$$,'42501',null,'ready foreign workspace file cannot enter content');
select throws_ok($$select pg_temp.content_commit(1,2,p_files=>'["not-a-uuid"]')$$,'22023',null,'malformed file UUID rejected');
select is(pg_temp.content_commit(0,99,p_actor=>'81000000-0000-4000-8000-000000000001',p_page=>'83000000-0000-4000-8000-000000000009',p_refs=>'[]',p_files=>'[]'),1::bigint,'owner can commit content');
select lives_ok($$insert into public.page_backlinks values('82000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000009','83000000-0000-4000-8000-000000000002',1)$$,'service can insert derived backlink rows');
select lives_ok($$update public.page_backlinks set source_revision=2 where source_page_id='83000000-0000-4000-8000-000000000009'$$,'service can update derived backlink rows');
select lives_ok($$delete from public.page_backlinks where source_page_id='83000000-0000-4000-8000-000000000009'$$,'service can delete derived backlink rows');
reset role;
select is((select count(*)::integer from public.document_updates where page_id='83000000-0000-4000-8000-000000000001'),1,'rejected operations leave no receipts');
select is((select source_revision from public.page_backlinks where source_page_id='83000000-0000-4000-8000-000000000001'),1::bigint,'backlink revision matches accepted content');
select is((select revision from public.document_heads where page_id='83000000-0000-4000-8000-000000000001'),1::bigint,'failed commits preserve durable head');
select set_config('request.jwt.claims','{"sub":"81000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
set local role authenticated;
select is((select revision from public.get_document_manifest('83000000-0000-4000-8000-000000000001')),1::bigint,'viewer reads accepted manifest');
select is((select count(*)::integer from public.page_backlinks),1,'viewer reads a backlink only with both page grants');
select is((select count(*)::integer from public.list_page_backlinks('83000000-0000-4000-8000-000000000002')),1,'viewer sees authorized incoming source');
select is((select count(*)::integer from public.search_pages('82000000-0000-4000-8000-000000000001','coracao')),1,'body FTS normalizes Portuguese accents');
select is((select count(*)::integer from public.search_pages('82000000-0000-4000-8000-000000000001','organize')),1,'body FTS includes English stemming');
select is((select count(*)::integer from public.search_pages('82000000-0000-4000-8000-000000000001','documento coracao')),1,'AND search spans title and body without losing words');
select is((select count(*)::integer from public.page_search_chunks),1,'viewer sees only authorized chunk metadata');
select throws_ok($$insert into public.page_backlinks values('82000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000002',1)$$,'42501',null,'authenticated direct backlink insert denied');
select throws_ok($$update public.page_backlinks set source_revision=99$$,'42501',null,'authenticated direct backlink update denied');
select throws_ok($$delete from public.page_backlinks$$,'42501',null,'authenticated direct backlink delete denied');
reset role;
delete from public.page_grants where page_id='83000000-0000-4000-8000-000000000002' and user_id='81000000-0000-4000-8000-000000000002';
set local role service_role;
select is(pg_temp.content_commit(1,2,p_text=>'coração running'),2::bigint,'existing opaque reference remains editable after destination becomes private');
select is(pg_temp.content_commit(0,1,p_text=>'outdated rewind'),1::bigint,'old receipt replay after a newer revision returns original revision');
reset role;
select is((select revision from public.document_heads where page_id='83000000-0000-4000-8000-000000000001'),2::bigint,'old retry never rewinds canonical revision');
select is((select projection->>'text' from public.document_heads where page_id='83000000-0000-4000-8000-000000000001'),'coração running','old retry never rewinds projection');
select is((select source_revision from public.page_backlinks where source_page_id='83000000-0000-4000-8000-000000000001'),2::bigint,'old retry never rewinds backlink revision');
select set_config('request.jwt.claims','{"sub":"81000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select is((select count(*)::integer from public.page_backlinks),0,'source access alone cannot read a now-private target backlink');
select throws_ok($$select * from public.list_page_backlinks('83000000-0000-4000-8000-000000000002')$$,'42501',null,'backlinks RPC reauthorizes target');
select is((select count(*)::integer from public.resolve_page_mentions('82000000-0000-4000-8000-000000000001',array['83000000-0000-4000-8000-000000000002']::uuid[])),0,'retained opaque reference does not resolve private label');
select is((select count(*)::integer from public.search_pages('82000000-0000-4000-8000-000000000001','run')),1,'new accepted body is searchable');
select is((select count(*)::integer from public.search_pages('82000000-0000-4000-8000-000000000001','outdated')),0,'old ACK retry cannot rewind body search');
reset role;

-- Visibility is checked at each read, including existing sessions and deleted
-- ancestors. A retained mention is an identity, never cached private text.
insert into public.page_backlinks values('82000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000005','83000000-0000-4000-8000-000000000002',1);
select set_config('request.jwt.claims','{"sub":"81000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
set local role authenticated;
select is((select count(*)::integer from public.page_backlinks),1,'target access cannot expose a hidden source backlink');
select is((select count(*)::integer from public.list_page_backlinks('83000000-0000-4000-8000-000000000002')),1,'backlinks RPC filters hidden source labels');
reset role;
select set_config('request.jwt.claims','{"sub":"81000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
set local role authenticated;
select is((select count(*)::integer from public.page_backlinks),1,'commenter reads only both-authorized backlinks');
select is(octet_length(public.read_document_chunk('83000000-0000-4000-8000-000000000001',2)),3,'commenter may read current canonical chunks');
reset role;
select set_config('request.jwt.claims','{"sub":"81000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select is((select count(*)::integer from public.page_backlinks),2,'workspace owner administers both backlink sources');
reset role;
update public.pages set title='Título atualizado' where id='83000000-0000-4000-8000-000000000001';
select set_config('request.jwt.claims','{"sub":"81000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
set local role authenticated;
select is((select count(*)::integer from public.search_pages('82000000-0000-4000-8000-000000000001','run')),1,'title reindex retains accepted body vector');
select is((select title from public.resolve_page_mentions('82000000-0000-4000-8000-000000000001',array['83000000-0000-4000-8000-000000000001']::uuid[])),'Título atualizado','mention label follows authorized current title');
reset role;
delete from public.page_grants where page_id='83000000-0000-4000-8000-000000000001' and user_id='81000000-0000-4000-8000-000000000003';
set local role authenticated;
select throws_ok($$select public.read_document_chunk('83000000-0000-4000-8000-000000000001',2)$$,'42501',null,'chunk reauthorizes after grant revocation without a refreshed JWT');
select is((select count(*)::integer from public.page_backlinks),0,'backlink RLS reauthorizes source immediately');
select is((select count(*)::integer from public.search_pages('82000000-0000-4000-8000-000000000001','run')),0,'body search cannot leak revoked source');
select is((select count(*)::integer from public.page_search_chunks),0,'chunk RLS reauthorizes source immediately');
reset role;
select set_config('request.jwt.claims','{"sub":"81000000-0000-4000-8000-000000000005","role":"authenticated"}',true);
set local role authenticated;
select is((select count(*)::integer from public.page_backlinks),0,'nonmember cannot read backlink rows');
select throws_ok($$select public.get_document_manifest('83000000-0000-4000-8000-000000000001')$$,'42501',null,'nonmember cannot read manifest');
reset role;
select set_config('request.jwt.claims','{"sub":"81000000-0000-4000-8000-000000000006","role":"authenticated"}',true);
set local role authenticated;
select is((select count(*)::integer from public.page_backlinks),0,'owner in another workspace cannot read backlink rows');
select is((select count(*)::integer from public.page_search_chunks),0,'other workspace cannot read chunk metadata');
select throws_ok($$select * from public.list_page_backlinks('83000000-0000-4000-8000-000000000002')$$,'42501',null,'other workspace owner cannot resolve incoming private labels');
reset role;
select set_config('request.jwt.claims','{"sub":"81000000-0000-4000-8000-000000000007","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.get_document_manifest('83000000-0000-4000-8000-000000000001')$$,'28000',null,'manifest requires confirmed authentication');
select throws_ok($$select * from public.resolve_page_mentions('82000000-0000-4000-8000-000000000001','{}'::uuid[])$$,'28000',null,'mention projection requires confirmed authentication');
reset role;
select set_config('request.jwt.claims','{}',true);
set local role anon;
select throws_ok('select * from public.page_backlinks','42501',null,'anonymous backlink SELECT denied');
select throws_ok('insert into public.page_backlinks default values','42501',null,'anonymous backlink INSERT denied');
select throws_ok('update public.page_backlinks set source_revision=99','42501',null,'anonymous backlink UPDATE denied');
select throws_ok('delete from public.page_backlinks','42501',null,'anonymous backlink DELETE denied');
select throws_ok('select page_id from public.page_search_chunks','42501',null,'anonymous search chunk SELECT denied');
select throws_ok('insert into public.page_search_chunks default values','42501',null,'anonymous search chunk INSERT denied');
select throws_ok('update public.page_search_chunks set source_revision=99','42501',null,'anonymous search chunk UPDATE denied');
select throws_ok('delete from public.page_search_chunks','42501',null,'anonymous search chunk DELETE denied');
select throws_ok('select * from private.document_request_windows','42501',null,'anonymous attempt window SELECT denied');
select throws_ok('insert into private.document_request_windows default values','42501',null,'anonymous attempt window INSERT denied');
select throws_ok('update private.document_request_windows set attempts=1','42501',null,'anonymous attempt window UPDATE denied');
select throws_ok('delete from private.document_request_windows','42501',null,'anonymous attempt window DELETE denied');
select throws_ok($$select public.reserve_document_validation('83000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000002')$$,'42501',null,'anonymous reservation RPC denied');
select throws_ok($$select public.get_document_manifest('83000000-0000-4000-8000-000000000001')$$,'42501',null,'anonymous manifest RPC denied');
select throws_ok($$select public.read_document_chunk('83000000-0000-4000-8000-000000000001',2)$$,'42501',null,'anonymous chunk RPC denied');
select throws_ok($$select * from public.resolve_page_mentions('82000000-0000-4000-8000-000000000001','{}'::uuid[])$$,'42501',null,'anonymous mention RPC denied');
select throws_ok($$select * from public.list_page_backlinks('83000000-0000-4000-8000-000000000002')$$,'42501',null,'anonymous backlink RPC denied');
select throws_ok($$select pg_temp.content_commit(2,3)$$,'42501',null,'anonymous commit RPC denied');
reset role;

-- Manifest version reporting must tolerate unknown legacy data without casting
-- it to a supported version or throwing on its untrusted representation.
update public.document_heads set projection='{"schemaVersion":"future"}' where page_id='83000000-0000-4000-8000-000000000008';
select set_config('request.jwt.claims','{"sub":"81000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select is((select schema_version from public.get_document_manifest('83000000-0000-4000-8000-000000000008')),-1,'string schema values remain unknown');
reset role;
update public.document_heads set projection='{"schemaVersion":2147483648}' where page_id='83000000-0000-4000-8000-000000000008';
set local role authenticated;
select is((select schema_version from public.get_document_manifest('83000000-0000-4000-8000-000000000008')),-1,'out-of-range schema version is safely unknown');
reset role;

create function pg_temp.content_projection(p_projection jsonb) returns bigint language sql as $$
select public.commit_content_document('83000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000002',2,
  md5('invalid-projection')::uuid,'\x01',encode(extensions.digest('\x01'::bytea,'sha256'),'hex'),'\x01',p_projection);
$$;
set local role service_role;
select throws_ok($$select pg_temp.content_projection('{"schemaVersion":99,"text":"","references":[],"files":[],"blocks":[]}')$$,'22023',null,'commit rejects future projection version');
select throws_ok($$select pg_temp.content_projection('{"schemaVersion":"1","text":"","references":[],"files":[],"blocks":[]}')$$,'22023',null,'commit never coerces a string schema version');
select throws_ok($$select pg_temp.content_projection('{"schemaVersion":1,"text":null,"references":[],"files":[],"blocks":[]}')$$,'22023',null,'projection text is required');
select throws_ok($$select pg_temp.content_projection('{"schemaVersion":1,"text":"","references":{},"files":[],"blocks":[]}')$$,'22023',null,'projection reference shape is checked');
select throws_ok($$select pg_temp.content_projection(null)$$,'22023',null,'projection is required');
select throws_ok($$select pg_temp.content_projection('{}')$$,'22023',null,'missing projection fields are rejected');
reset role;

-- Keyset proof uses synthetic sources, not accepted update fixtures, so it does
-- not consume the actor quota that is tested separately below.
insert into public.pages(id,workspace_id,title,owner_id,restricted)
select md5('backlink-source-'||n)::uuid,'82000000-0000-4000-8000-000000000001','Fonte '||n,'81000000-0000-4000-8000-000000000001',true
  from generate_series(1,55) n;
insert into public.page_backlinks(workspace_id,source_page_id,target_page_id,source_revision)
select '82000000-0000-4000-8000-000000000001',md5('backlink-source-'||n)::uuid,'83000000-0000-4000-8000-000000000002',1 from generate_series(1,55) n;
select set_config('request.jwt.claims','{"sub":"81000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select is((select count(*)::integer from public.list_page_backlinks('83000000-0000-4000-8000-000000000002')),51,'backlink results use51-row lookahead');
select is((select count(*)::integer from public.list_page_backlinks('83000000-0000-4000-8000-000000000002',
  (select id from public.list_page_backlinks('83000000-0000-4000-8000-000000000002') order by id offset 49 limit 1))),7,'backlink cursor advances by source identity without duplicates');
reset role;

create temporary table content_large_fixture as select string_agg('lex'||lpad(n::text,8,'0'),' ' order by n) as body
  from generate_series(1,180000) n;
insert into public.pages(id,workspace_id,title,owner_id,restricted)
  values('83000000-0000-4000-8000-000000000010','82000000-0000-4000-8000-000000000001','giganticbodytoken','81000000-0000-4000-8000-000000000001',true);
select ok(octet_length(body)>2097152 and octet_length(body)<8388608,'high-distinct-token fixture is multi-MiB within the canonical8 MiB budget') from content_large_fixture;
select is(public.commit_content_document('83000000-0000-4000-8000-000000000010','81000000-0000-4000-8000-000000000001',0,
  md5('large-content')::uuid,'\x01',encode(extensions.digest('\x01'::bytea,'sha256'),'hex'),convert_to(body,'UTF8'),
  jsonb_build_object('schemaVersion',1,'text',body,'references','[]'::jsonb,'files','[]'::jsonb,'blocks','[]'::jsonb)),1::bigint,
  'multi-MiB body with180000 distinct lexemes saves and indexes atomically') from content_large_fixture;
select is((select count(*)::integer from public.page_search_chunks where page_id='83000000-0000-4000-8000-000000000010'),1800,'distinct lexemes occupy bounded100-lexeme chunks');
select ok((select bool_and(cardinality(tsvector_to_array(search_vector))<=100 and pg_column_size(search_vector)<1048576) from public.page_search_chunks),'every search chunk remains below PostgreSQL vector ceiling');
select set_config('request.jwt.claims','{"sub":"81000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select is((select byte_length from public.get_document_manifest('83000000-0000-4000-8000-000000000010')),(select octet_length(snapshot) from public.document_heads where page_id='83000000-0000-4000-8000-000000000010'),'large accepted snapshot retains every byte');
select is((select count(*)::integer from public.search_pages('82000000-0000-4000-8000-000000000001','lex00000001 lex00180000')),1,'AND search spans distant lexeme chunks');
select is((select count(*)::integer from public.search_pages('82000000-0000-4000-8000-000000000001','giganticbodytoken lex00180000')),1,'AND search spans large body and title');
select is((select count(*)::integer from public.search_pages('82000000-0000-4000-8000-000000000001','lex00000001 absentlexeme')),0,'cross-chunk search still requires every term');
select is((select rank from public.search_pages('82000000-0000-4000-8000-000000000001','giganticbodytoken')),4::real,'title hits receive higher weight than body hits');
select is((select rank from public.search_pages('82000000-0000-4000-8000-000000000001','lex00000001')),1::real,'body hit receives explicit body weight');
reset role;

insert into private.document_request_windows(workspace_id,actor_id,window_start,attempts) values
  ('82000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000002',date_trunc('minute',now())-interval '3 minutes',240),
  ('82000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000002',date_trunc('minute',now())-interval '2 minutes',240),
  ('82000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001',date_trunc('minute',now())-interval '3 minutes',12),
  ('82000000-0000-4000-8000-000000000002','81000000-0000-4000-8000-000000000006',date_trunc('minute',now())-interval '3 minutes',12);
set local role service_role;
select lives_ok($$select public.reserve_document_validation('83000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000002')$$,'new minute budget ignores and prunes stale windows');
select is((select count(*)::integer from private.document_request_windows where workspace_id='82000000-0000-4000-8000-000000000001' and actor_id='81000000-0000-4000-8000-000000000002' and window_start<date_trunc('minute',now())-interval '2 minutes'),0,'stale cleanup touches only own expired windows');
select is((select count(*)::integer from private.document_request_windows where attempts=12),2,'cleanup preserves other actors and workspaces');
update private.document_request_windows set attempts=239 where workspace_id='82000000-0000-4000-8000-000000000001' and actor_id='81000000-0000-4000-8000-000000000002' and window_start=date_trunc('minute',now());
select lives_ok($$select public.reserve_document_validation('83000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000002')$$,'240th attempt in current minute is allowed');
select throws_ok($$select public.reserve_document_validation('83000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000002')$$,'54000',null,'241st malformed or valid attempt cannot reach worker');
select is((select attempts from private.document_request_windows where workspace_id='82000000-0000-4000-8000-000000000001' and actor_id='81000000-0000-4000-8000-000000000002' and window_start=date_trunc('minute',now())),240,'rejected reservation never increments beyond its bound');
reset role;

-- UUID spelling does not change identity. Existing opaque references must still
-- permit edits after targets/files become unavailable, including case rewrites.
insert into public.pages(id,workspace_id,title,owner_id,restricted) values
('83000000-0000-4000-8000-000000000011','82000000-0000-4000-8000-000000000001','Case source','81000000-0000-4000-8000-000000000002',true),
('83abcdef-0000-4000-8000-0000000000ab','82000000-0000-4000-8000-000000000001','Case private destination','81000000-0000-4000-8000-000000000001',true);
insert into public.page_grants(page_id,workspace_id,user_id,role) values
('83abcdef-0000-4000-8000-0000000000ab','82000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000002','editor');
insert into public.page_files(id,workspace_id,page_id,object_path,original_name,mime_type,expected_size,actual_size,sha256,status,uploaded_by,finalized_at) values
('84abcdef-0000-4000-8000-0000000000ab','82000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000011',
 '82000000-0000-4000-8000-000000000001/83000000-0000-4000-8000-000000000011/84abcdef-0000-4000-8000-0000000000ab',
 'Case.png','image/png',24,24,repeat('b',64),'ready','81000000-0000-4000-8000-000000000002',now());
set local role service_role;
select is(pg_temp.content_commit(0,201,p_page=>'83000000-0000-4000-8000-000000000011',p_text=>'case identity',
  p_refs=>'["83ABCDEF-0000-4000-8000-0000000000AB"]',p_files=>'["84ABCDEF-0000-4000-8000-0000000000AB"]'),1::bigint,'authorized uppercase page/file UUIDs identify current resources');
reset role;
delete from public.page_grants where page_id='83abcdef-0000-4000-8000-0000000000ab' and user_id='81000000-0000-4000-8000-000000000002';
delete from public.page_files where id='84abcdef-0000-4000-8000-0000000000ab';
set local role service_role;
select is(pg_temp.content_commit(1,202,p_page=>'83000000-0000-4000-8000-000000000011',p_text=>'edited case identity',
  p_refs=>'["83abcdef-0000-4000-8000-0000000000ab"]',p_files=>'["84ABCDEF-0000-4000-8000-0000000000AB"]'),2::bigint,'case-only page UUID rewrite retains a now-private destination');
select is(pg_temp.content_commit(2,203,p_page=>'83000000-0000-4000-8000-000000000011',p_text=>'edited file identity',
  p_refs=>'["83abcdef-0000-4000-8000-0000000000ab"]',p_files=>'["84abcdef-0000-4000-8000-0000000000ab"]'),3::bigint,'case-only file UUID rewrite retains an unavailable existing file');
reset role;
select set_config('request.jwt.claims','{"sub":"81000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select is((select count(*)::integer from public.resolve_page_mentions('82000000-0000-4000-8000-000000000001',array['83abcdef-0000-4000-8000-0000000000ab']::uuid[])),0,'case-normalized retained identity does not expose a private label');
reset role;

insert into public.document_updates(page_id,workspace_id,revision,operation_id,actor_id,payload,payload_hash)
select '83000000-0000-4000-8000-000000000009','82000000-0000-4000-8000-000000000001',n+1,md5('quota-op-'||n)::uuid,
  '81000000-0000-4000-8000-000000000002','\x01',encode(extensions.digest('\x01'::bytea,'sha256'),'hex') from generate_series(1,235) n;
set local role service_role;
select throws_ok($$select pg_temp.content_commit(2,3)$$,'54000',null,'240 new operations per actor/workspace/minute is enforced durably');
select is(pg_temp.content_commit(0,1),1::bigint,'idempotent retry is free even after quota is exhausted');
reset role;
select is((select revision from public.document_heads where page_id='83000000-0000-4000-8000-000000000001'),2::bigint,'quota failure does not change durable head');
select is((select count(*)::integer from public.document_updates where actor_id='81000000-0000-4000-8000-000000000002'),240,'quota failure and retries add no receipts');
update public.pages set deleted_at=now() where id='83000000-0000-4000-8000-000000000001';
select set_config('request.jwt.claims','{"sub":"81000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.get_document_manifest('83000000-0000-4000-8000-000000000001')$$,'42501',null,'trash hides document manifest');
select is((select count(*)::integer from public.page_backlinks),0,'trash removes source backlinks from authorized projection');
reset role;
select * from finish();
rollback;
