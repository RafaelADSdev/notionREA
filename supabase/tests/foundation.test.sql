begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

select ok(c.relrowsecurity, c.relname || ' has RLS') from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in ('workspaces','workspace_members','workspace_invites','pages','page_grants','document_heads','document_updates');
select is((select count(*)::integer from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname in ('workspaces','workspace_members','workspace_invites','pages','page_grants','document_heads','document_updates')), 7, 'all seven application tables exist');

insert into auth.users(id, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
('10000000-0000-4000-8000-000000000001','owner-a@example.test',now(),'{}','{}',now(),now()),
('10000000-0000-4000-8000-000000000002','owner-b@example.test',now(),'{}','{}',now(),now()),
('10000000-0000-4000-8000-000000000003','editor@example.test',now(),'{}','{}',now(),now()),
('10000000-0000-4000-8000-000000000004','commenter@example.test',now(),'{}','{}',now(),now()),
('10000000-0000-4000-8000-000000000005','viewer@example.test',now(),'{}','{}',now(),now()),
('10000000-0000-4000-8000-000000000006','unconfirmed@example.test',null,'{}','{}',now(),now()),
('10000000-0000-4000-8000-000000000007','recipient@example.test',now(),'{}','{}',now(),now()),
('10000000-0000-4000-8000-000000000008','outsider@example.test',now(),'{}','{}',now(),now());

insert into public.workspaces(id,name,created_by) values
('20000000-0000-4000-8000-000000000001','Workspace A','10000000-0000-4000-8000-000000000001'),
('20000000-0000-4000-8000-000000000002','Workspace B','10000000-0000-4000-8000-000000000002');
insert into public.workspace_members(workspace_id,user_id,role) values
('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','owner'),
('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','owner'),
('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003','member'),
('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000004','member'),
('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000005','member');

insert into public.pages(id,workspace_id,parent_id,title,position,owner_id,restricted,deleted_at) values
('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',null,'Shared root','a','10000000-0000-4000-8000-000000000001',true,null),
('30000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','Inherited','a','10000000-0000-4000-8000-000000000001',false,null),
('30000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','Restricted','b','10000000-0000-4000-8000-000000000001',true,null),
('30000000-0000-4000-8000-000000000004','20000000-0000-4000-8000-000000000001',null,'Private parent','b','10000000-0000-4000-8000-000000000001',true,null),
('30000000-0000-4000-8000-000000000005','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000004','Direct grant','a','10000000-0000-4000-8000-000000000001',true,null),
('30000000-0000-4000-8000-000000000006','20000000-0000-4000-8000-000000000001',null,'Deleted parent','c','10000000-0000-4000-8000-000000000001',true,now()),
('30000000-0000-4000-8000-000000000007','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000006','Hidden descendant','a','10000000-0000-4000-8000-000000000001',false,null),
('30000000-0000-4000-8000-000000000008','20000000-0000-4000-8000-000000000002',null,'Other workspace','a','10000000-0000-4000-8000-000000000002',true,null);

insert into public.page_grants(page_id,workspace_id,user_id,role) values
('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003','editor'),
('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000004','commenter'),
('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000005','viewer'),
('30000000-0000-4000-8000-000000000005','20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000005','viewer');

insert into public.document_heads(page_id,workspace_id,snapshot) values
('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','\x01'),
('30000000-0000-4000-8000-000000000008','20000000-0000-4000-8000-000000000002','\x02');
insert into public.workspace_invites(workspace_id,email,token_hash,created_by) values
('20000000-0000-4000-8000-000000000002','outsider@example.test',encode(digest('foreign-invite','sha256'),'hex'),'10000000-0000-4000-8000-000000000002');

select throws_ok($$insert into public.pages(workspace_id,parent_id,owner_id) values ('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000008','10000000-0000-4000-8000-000000000001')$$, '23503', null, 'a parent from another workspace is rejected');
select throws_ok($$insert into public.page_grants(page_id,workspace_id,user_id,role) values ('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','viewer')$$, '23503', null, 'a grant cannot cross workspaces');
select throws_ok($$update public.pages set parent_id='30000000-0000-4000-8000-000000000002' where id='30000000-0000-4000-8000-000000000001'$$, '23514', null, 'page ancestry cannot form a cycle');

select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select is((select count(*)::integer from public.workspaces),1,'owner sees only workspace A');
select is((select count(*)::integer from public.workspace_members),4,'owner sees its workspace members');
select is((select count(*)::integer from public.pages),5,'owner cannot read deleted ancestors/descendants or foreign pages');
select is((select count(*)::integer from public.document_heads),1,'owner reads only its accessible document head');
select is((select count(*)::integer from public.page_grants),4,'owner sees grants in its workspace');
select is((select count(*)::integer from public.workspace_invites),0,'owner does not see foreign invites');
select is((select count(*)::integer from public.list_workspace_members('20000000-0000-4000-8000-000000000001')),4,'owner lists members with minimum profile fields');
select is((select email from public.list_workspace_members('20000000-0000-4000-8000-000000000001') where user_id='10000000-0000-4000-8000-000000000003'),'editor@example.test','owner can identify a member by email');
select throws_ok($$select * from public.list_workspace_members('20000000-0000-4000-8000-000000000002')$$,'42501',null,'owner cannot list a different workspace');
select ok(public.create_workspace('A new workspace','40000000-0000-4000-8000-000000000001') is not null,'workspace RPC creates a workspace');
select is(public.create_workspace('A new workspace','40000000-0000-4000-8000-000000000001'),(select id from public.workspaces where request_id='40000000-0000-4000-8000-000000000001'),'workspace creation retry returns original identity');
select is((select count(*)::integer from public.workspace_members where workspace_id=(select id from public.workspaces where request_id='40000000-0000-4000-8000-000000000001') and role='owner'),1,'workspace creation atomically establishes one owner');
select throws_ok($$select public.create_workspace('Different input','40000000-0000-4000-8000-000000000001')$$,'22023',null,'workspace idempotency rejects changed input');
select throws_ok($$select public.remove_member('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001')$$,'23514',null,'last owner cannot leave');
select throws_ok($$select public.set_member_role('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','member')$$,'23514',null,'last owner cannot be demoted');
select lives_ok($$select public.set_member_role('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003','owner')$$,'owner can appoint a successor');
select lives_ok($$select public.set_member_role('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003','member')$$,'owner can demote another owner while preserving one');
select ok(public.create_invite('20000000-0000-4000-8000-000000000001','RECIPIENT@example.test',encode(digest(repeat('A',43),'sha256'),'hex')) is not null,'owner creates a normalized invite');
select is((select email from public.workspace_invites where email='recipient@example.test'),'recipient@example.test','invite email is normalized');
select ok((select expires_at = now() + interval '7 days' from public.workspace_invites where email='recipient@example.test'),'invite expires after seven days');
select ok(public.create_invite('20000000-0000-4000-8000-000000000001','recipient@example.test',encode(digest(repeat('B',43),'sha256'),'hex')) is not null,'reissuing an invite succeeds');
select is((select count(*)::integer from public.workspace_invites where email='recipient@example.test' and revoked_at is not null),1,'reissue revokes the earlier token');
select ok(public.create_invite('20000000-0000-4000-8000-000000000001','unconfirmed@example.test',encode(digest(repeat('C',43),'sha256'),'hex')) is not null,'owner can invite a future confirmed user');
reset role;

select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000005","role":"authenticated"}',true);
set local role authenticated;
select is((select count(*)::integer from public.pages),3,'viewer sees root, inherited child and direct child only');
select is((select count(*)::integer from public.pages where id='30000000-0000-4000-8000-000000000004'),0,'direct child grant does not reveal its parent');
select is((select count(*)::integer from public.pages where id='30000000-0000-4000-8000-000000000003'),0,'restricted child stops inherited access');
select is((select count(*)::integer from public.workspace_members),1,'member sees only its own membership');
select is((select count(*)::integer from public.workspace_invites),0,'member cannot inspect invitations');
select throws_ok($$select * from public.list_workspace_members('20000000-0000-4000-8000-000000000001')$$,'42501',null,'ordinary member cannot list other member emails');
select is((select count(*)::integer from public.page_grants),2,'viewer reads only its own visible grants');
select is((select count(*)::integer from public.document_heads),1,'viewer can read the granted document head');
select is((select count(*)::integer from public.document_updates),0,'no update history exists before a commit');
select throws_ok($$update public.workspace_members set role='owner' where user_id='10000000-0000-4000-8000-000000000005'$$,'42501',null,'member cannot self-promote through Data API');
select throws_ok($$select public.set_member_role('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000005','owner')$$,'42501',null,'member cannot self-promote through RPC');
select throws_ok($$select public.create_invite('20000000-0000-4000-8000-000000000001','outsider@example.test',repeat('a',64))$$,'42501',null,'member cannot issue invitations');
select throws_ok($$select public.commit_document('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000005',0,'50000000-0000-4000-8000-000000000001','\x01',encode(digest('\x01'::bytea,'sha256'),'hex'),'\x01','{}')$$,'42501',null,'viewer cannot invoke internal content RPC');
select throws_ok($$select public.compact_document('30000000-0000-4000-8000-000000000001',0,'\x01')$$,'42501',null,'viewer cannot invoke compaction');
reset role;

select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000006","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.accept_invite(repeat('C',43))$$,'28000',null,'unconfirmed account cannot accept an invite');
select throws_ok($$select public.create_workspace('Unconfirmed','40000000-0000-4000-8000-000000000006')$$,'28000',null,'unconfirmed account cannot create a workspace');
reset role;

select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000008","role":"authenticated"}',true);
set local role authenticated;
select is((select count(*)::integer from public.workspaces),0,'outsider sees no workspace');
select is((select count(*)::integer from public.pages),0,'outsider sees no page');
select is((select count(*)::integer from public.document_heads),0,'outsider sees no document head');
select throws_ok($$select public.accept_invite(repeat('B',43))$$,'P0001',null,'different confirmed email cannot accept invite');
reset role;

select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000007","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.accept_invite(repeat('A',43))$$,'P0001',null,'reissued token is unusable');
select is(public.accept_invite(repeat('B',43)),'20000000-0000-4000-8000-000000000001'::uuid,'matching confirmed account joins the workspace');
select is((select count(*)::integer from public.pages),0,'membership does not grant private pages');
select throws_ok($$select public.accept_invite(repeat('B',43))$$,'P0001',null,'invite is single-use');
reset role;

insert into public.workspace_invites(workspace_id,email,token_hash,expires_at,created_by) values
('20000000-0000-4000-8000-000000000001','recipient@example.test',encode(digest(repeat('D',43),'sha256'),'hex'),now()-interval '1 second','10000000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok($$select public.accept_invite(repeat('D',43))$$,'P0001',null,'expired invitation is unusable');
reset role;

select ok(has_function_privilege('service_role','public.commit_document(uuid,uuid,bigint,uuid,bytea,text,bytea,jsonb)','EXECUTE'),'service role can execute commit');
select ok(not has_function_privilege('authenticated','public.commit_document(uuid,uuid,bigint,uuid,bytea,text,bytea,jsonb)','EXECUTE'),'authenticated cannot execute commit');
select ok(not has_function_privilege('anon','public.create_workspace(text,uuid)','EXECUTE'),'anon cannot execute workspace mutations');
set local role service_role;
select is(public.commit_document('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003',0,'50000000-0000-4000-8000-000000000001','\x01',encode(digest('\x01'::bytea,'sha256'),'hex'),'\x0102','{"text":"First"}'),1::bigint,'editor commit atomically advances revision');
select is(public.commit_document('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003',0,'50000000-0000-4000-8000-000000000001','\x01',encode(digest('\x01'::bytea,'sha256'),'hex'),'\x0102','{"text":"First"}'),1::bigint,'lost ACK retry returns original revision');
select throws_ok($$select public.commit_document('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003',1,'50000000-0000-4000-8000-000000000001','\x02',encode(digest('\x02'::bytea,'sha256'),'hex'),'\x0203','{}')$$,'22023',null,'same operation ID with different payload is rejected');
select throws_ok($$select public.commit_document('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003',0,'50000000-0000-4000-8000-000000000002','\x02',encode(digest('\x02'::bytea,'sha256'),'hex'),'\x010203','{}')$$,'40001',null,'stale revision fails CAS');
select throws_ok($$select public.commit_document('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000004',1,'50000000-0000-4000-8000-000000000003','\x02',encode(digest('\x02'::bytea,'sha256'),'hex'),'\x010203','{}')$$,'42501',null,'commenter actor cannot commit through trusted server path');
select throws_ok($$select public.commit_document('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000005',1,'50000000-0000-4000-8000-000000000004','\x02',encode(digest('\x02'::bytea,'sha256'),'hex'),'\x010203','{}')$$,'42501',null,'viewer actor cannot commit through trusted server path');
select throws_ok($$select public.commit_document('30000000-0000-4000-8000-000000000008','10000000-0000-4000-8000-000000000003',0,'50000000-0000-4000-8000-000000000005','\x02',encode(digest('\x02'::bytea,'sha256'),'hex'),'\x02','{}')$$,'42501',null,'actor cannot commit to another workspace');
select throws_ok($$select public.compact_document('30000000-0000-4000-8000-000000000001',0,'\x0102')$$,'40001',null,'stale compaction cannot run');
select throws_ok($$select public.compact_document('30000000-0000-4000-8000-000000000001',1,'\x01')$$,'22023',null,'compaction refuses a mismatched snapshot');
select is(public.compact_document('30000000-0000-4000-8000-000000000001',1,'\x0102'),1::bigint,'compaction checkpoints durable snapshot');
select is(public.commit_document('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003',0,'50000000-0000-4000-8000-000000000001','\x01',encode(digest('\x01'::bytea,'sha256'),'hex'),'\x0102','{"text":"First"}'),1::bigint,'retry stays idempotent after payload compaction');
select is(public.commit_document('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003',1,'50000000-0000-4000-8000-000000000006','\x03',encode(digest('\x03'::bytea,'sha256'),'hex'),'\x010203','{"text":"Second"}'),2::bigint,'a later commit is retained beyond compacted checkpoint');
reset role;
select is((select revision from public.document_heads where page_id='30000000-0000-4000-8000-000000000001'),2::bigint,'head revision is durable');
select is((select projection->>'text' from public.document_heads where page_id='30000000-0000-4000-8000-000000000001'),'Second','projection is committed with revision');
select is((select compacted_through from public.document_heads where page_id='30000000-0000-4000-8000-000000000001'),1::bigint,'compaction watermark preserves later update');
select is((select count(*)::integer from public.document_updates where page_id='30000000-0000-4000-8000-000000000001'),2,'compaction retains operation receipts');
select is((select count(*)::integer from public.document_updates where page_id='30000000-0000-4000-8000-000000000001' and payload is null),1,'only covered update payload is compacted');

select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
set local role authenticated;
select is((select count(*)::integer from public.document_updates),2,'commenter reads authorized durable updates');
select throws_ok($$insert into public.document_updates(page_id,workspace_id,revision,operation_id,actor_id,payload,payload_hash) values ('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',3,gen_random_uuid(),'10000000-0000-4000-8000-000000000004','\x01',repeat('a',64))$$,'42501',null,'commenter cannot inject a raw update');
reset role;
delete from public.workspace_members where workspace_id='20000000-0000-4000-8000-000000000001' and user_id='10000000-0000-4000-8000-000000000004';
set local role authenticated;
select is((select count(*)::integer from public.workspaces),0,'revocation blocks workspace reads with existing JWT claims');
select is((select count(*)::integer from public.pages),0,'revocation blocks page reads with existing JWT claims');
select is((select count(*)::integer from public.document_updates),0,'revocation blocks durable updates with existing JWT claims');
reset role;
set local role service_role;
select throws_ok($$select public.commit_document('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000004',2,'50000000-0000-4000-8000-000000000007','\x04',encode(digest('\x04'::bytea,'sha256'),'hex'),'\x01020304','{}')$$,'42501',null,'privileged commit reauthorizes revoked actor');
reset role;

select ok(not has_table_privilege('authenticated', 'public.'||name, 'INSERT'),name || ': direct insert is denied')
from unnest(array['workspaces','workspace_members','workspace_invites','pages','page_grants','document_heads','document_updates']) name;
select ok(not has_table_privilege('authenticated', 'public.'||name, 'UPDATE'),name || ': direct update is denied')
from unnest(array['workspaces','workspace_members','workspace_invites','pages','page_grants','document_heads','document_updates']) name;
select ok(not has_table_privilege('authenticated', 'public.'||name, 'DELETE'),name || ': direct delete is denied')
from unnest(array['workspaces','workspace_members','workspace_invites','pages','page_grants','document_heads','document_updates']) name;

select set_config('request.jwt.claims','{}',true);
set local role anon;
select throws_ok(format('select * from public.%I', name),'42501',null,name || ': anonymous select is denied')
from unnest(array['workspaces','workspace_members','workspace_invites','pages','page_grants','document_heads','document_updates']) name;
reset role;

select ok(exists(select 1 from pg_policies where schemaname='realtime' and tablename='messages' and policyname='page_revision_receive' and cmd='SELECT'),'private revision channel has a read policy');
select ok(not exists(select 1 from pg_policies where schemaname='realtime' and tablename='messages' and policyname='page_revision_receive' and cmd='INSERT'),'revision policy never permits client broadcast');
insert into public.workspaces(id,name,created_by) values ('20000000-0000-4000-8000-000000000099','Maintenance cleanup','10000000-0000-4000-8000-000000000001');
insert into public.workspace_members(workspace_id,user_id,role) values ('20000000-0000-4000-8000-000000000099','10000000-0000-4000-8000-000000000001','owner');
select lives_ok($$delete from public.workspaces where id='20000000-0000-4000-8000-000000000099'$$,'privileged workspace deletion permits membership cascade');
insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  select md5('pagination-member-'||n)::uuid,'pagination-'||n||'@example.test',now(),'{}','{}',now(),now() from generate_series(1,60) n;
insert into public.workspaces(id,name,created_by) values ('20000000-0000-4000-8000-000000000098','Pagination fixture','10000000-0000-4000-8000-000000000001');
insert into public.workspace_members(workspace_id,user_id,role) values ('20000000-0000-4000-8000-000000000098','10000000-0000-4000-8000-000000000001','owner');
insert into public.workspace_members(workspace_id,user_id,role)
  select '20000000-0000-4000-8000-000000000098',md5('pagination-member-'||n)::uuid,'member' from generate_series(1,60) n;
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select is((select count(*)::integer from public.list_workspace_members('20000000-0000-4000-8000-000000000098')),51,'member listing is bounded to 50 plus lookahead');
select throws_ok($$select * from public.list_workspace_members('20000000-0000-4000-8000-000000000098',now(),null)$$,'22023',null,'member cursor requires its identity component');
select throws_ok($$select * from public.list_workspace_members('20000000-0000-4000-8000-000000000098',null,'10000000-0000-4000-8000-000000000001')$$,'22023',null,'member cursor requires its timestamp component');
with first_page as (select * from public.list_workspace_members('20000000-0000-4000-8000-000000000098') limit 50),
  cursor_row as (select created_at,user_id from first_page order by created_at desc,user_id desc limit 1),
  second_page as (select m.* from cursor_row c cross join lateral public.list_workspace_members('20000000-0000-4000-8000-000000000098',c.created_at,c.user_id) m),
  combined as (select user_id from first_page union all select user_id from second_page)
select is((select count(*)::integer from combined),61,'cursor retrieves every member across two pages');
with first_page as (select * from public.list_workspace_members('20000000-0000-4000-8000-000000000098') limit 50),
  cursor_row as (select created_at,user_id from first_page order by created_at desc,user_id desc limit 1),
  second_page as (select m.* from cursor_row c cross join lateral public.list_workspace_members('20000000-0000-4000-8000-000000000098',c.created_at,c.user_id) m),
  combined as (select user_id from first_page union all select user_id from second_page)
select is((select count(distinct user_id)::integer from combined),61,'cursor does not repeat members when timestamps tie');
reset role;
select * from finish();
rollback;
