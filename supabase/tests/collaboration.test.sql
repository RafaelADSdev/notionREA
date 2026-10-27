begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
select has_function('public','renew_page_presence',array['uuid','uuid'],'presence renew RPC exists');
insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select ('c1000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'collaboration-'||n||'@example.test',now(),'{}',
  case when n=2 then '{"display_name":"Editor visível"}'::jsonb else '{}'::jsonb end,now(),now() from generate_series(1,5) n;
insert into public.workspaces(id,name,created_by) values
('c2000000-0000-4000-8000-000000000001','Collaboration A','c1000000-0000-4000-8000-000000000001'),
('c2000000-0000-4000-8000-000000000002','Collaboration B','c1000000-0000-4000-8000-000000000005');
insert into public.workspace_members(workspace_id,user_id,role)
select 'c2000000-0000-4000-8000-000000000001',('c1000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,case when n=1 then 'owner' else 'member' end from generate_series(1,4) n;
insert into public.workspace_members(workspace_id,user_id,role) values('c2000000-0000-4000-8000-000000000002','c1000000-0000-4000-8000-000000000005','owner');
insert into public.pages(id,workspace_id,parent_id,title,owner_id,restricted) values
('c3000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001',null,'Shared root','c1000000-0000-4000-8000-000000000001',true),
('c3000000-0000-4000-8000-000000000002','c2000000-0000-4000-8000-000000000001','c3000000-0000-4000-8000-000000000001','Shared child','c1000000-0000-4000-8000-000000000001',false),
('c3000000-0000-4000-8000-000000000003','c2000000-0000-4000-8000-000000000002',null,'Foreign','c1000000-0000-4000-8000-000000000005',true);
insert into public.page_grants(page_id,workspace_id,user_id,role)
select 'c3000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001',('c1000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  case n when 2 then 'editor' when 3 then 'commenter' else 'viewer' end from generate_series(2,4) n;
insert into public.document_heads(page_id,workspace_id,projection) values('c3000000-0000-4000-8000-000000000002','c2000000-0000-4000-8000-000000000001','{"schemaVersion":1,"blocks":[{"id":"note"}]}');
select is((select count(*)::integer from pg_class where relrowsecurity and relname in('comment_threads','comments','page_presence_epochs','page_presence_leases','collaboration_windows')),5,'all collaboration tables enable RLS');
select set_config('request.jwt.claims','{"sub":"c1000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
set local role authenticated;
select set_config('collab.thread',public.create_comment_thread('c3000000-0000-4000-8000-000000000002','Comentário <script> literal','note','{"type":"relative","start":"AQAB","end":"AQAC"}','c4000000-0000-4000-8000-000000000001')::text,true);
select is(public.create_comment_thread('c3000000-0000-4000-8000-000000000002','Comentário <script> literal','note','{"type":"relative","start":"AQAB","end":"AQAC"}','c4000000-0000-4000-8000-000000000001'),current_setting('collab.thread')::uuid,'lost-ACK thread retry preserves identity');
select is((public.list_comment_threads('c3000000-0000-4000-8000-000000000002')->'threads'->0->>'anchorAvailable')::boolean,true,'block-relative thread resolves only its stable block identity');
select is(public.edit_comment(current_setting('collab.thread')::uuid,'Comentário editado',0),1::bigint,'commenter edits own comment with CAS');
select throws_ok($$select public.edit_comment(current_setting('collab.thread')::uuid,'stale',0)$$,'40001',null,'stale comment edit cannot overwrite');
select is(public.resolve_comment_thread(current_setting('collab.thread')::uuid,true,0),1::bigint,'commenter may resolve a conversation they authored');
select throws_ok($$select public.add_comment(current_setting('collab.thread')::uuid,repeat('x',8193))$$,'22023',null,'comment UTF-8 body is bounded');
select throws_ok($$select public.create_comment_thread('c3000000-0000-4000-8000-000000000002','Bad anchor','note','{"type":"relative","start":"AQAB","end":"AQAC","html":"x"}')$$,'22023',null,'anchor JSON rejects unrecognized fields');
select throws_ok($$insert into public.comments(id,workspace_id,page_id,thread_id,author_id,body,request_hash) values(gen_random_uuid(),'c2000000-0000-4000-8000-000000000001','c3000000-0000-4000-8000-000000000002',current_setting('collab.thread')::uuid,auth.uid(),'Bypass',repeat('a',64))$$,'42501',null,'commenter cannot bypass authorized mutation RPCs');
select throws_ok($$delete from public.comment_threads where id=current_setting('collab.thread')::uuid$$,'42501',null,'direct thread deletion is denied');
reset role;
select set_config('request.jwt.claims','{"sub":"c1000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select is(public.resolve_comment_thread(current_setting('collab.thread')::uuid,false,1),2::bigint,'editor may reopen another author thread');
select throws_ok($$select public.edit_comment(current_setting('collab.thread')::uuid,'not mine',1)$$,'42501',null,'editor cannot rewrite another author comment');
select set_config('collab.reply',public.add_comment(current_setting('collab.thread')::uuid,'Minha resposta','c4000000-0000-4000-8000-000000000002')::text,true);
select public.delete_comment(current_setting('collab.reply')::uuid,0);
select is(public.add_comment(current_setting('collab.thread')::uuid,'Minha resposta','c4000000-0000-4000-8000-000000000002'),current_setting('collab.reply')::uuid,'retry of an already removed reply does not create a new identity');
select is(jsonb_array_length(public.list_thread_comments(current_setting('collab.thread')::uuid)->'comments'),1,'removed reply text is absent after an idempotent retry');
select set_config('collab.lease',public.renew_page_presence('c3000000-0000-4000-8000-000000000002','c5000000-0000-4000-8000-000000000001')::text,true);
select ok((current_setting('collab.lease')::jsonb->>'expiresAt')::timestamptz>clock_timestamp() and (current_setting('collab.lease')::jsonb->>'expiresAt')::timestamptz<=clock_timestamp()+interval '30 seconds','presence lease expires within thirty seconds');
select is(current_setting('collab.lease')::jsonb->'participants'->0->>'label','Editor visível','presence label is a safe display name without email');
select ok(private.page_presence_allowed('page-presence:c3000000-0000-4000-8000-000000000002:'||(current_setting('collab.lease')::jsonb->>'epoch'),auth.uid()),'current lease authorizes the exact epoch topic');
select ok(not private.page_presence_allowed('page-presence:c3000000-0000-4000-8000-000000000002:9999999999999999999',auth.uid()),'an arbitrary epoch is denied without unsafe numeric casts');
select throws_ok($$select * from private.page_presence_leases$$,'42501',null,'clients cannot read private presence bookkeeping');
select throws_ok($$update private.collaboration_windows set attempts=1$$,'42501',null,'clients cannot reset rate counters');
reset role;
update private.page_presence_leases set expires_at=clock_timestamp()-interval '1 second' where participant_id='c5000000-0000-4000-8000-000000000001';
set local role authenticated;
select ok(not private.page_presence_allowed('page-presence:c3000000-0000-4000-8000-000000000002:'||(current_setting('collab.lease')::jsonb->>'epoch'),auth.uid()),'expired leases no longer authorize a channel');
select public.renew_page_presence('c3000000-0000-4000-8000-000000000002','c5000000-0000-4000-8000-000000000001');
reset role;
update public.page_grants set role='viewer' where page_id='c3000000-0000-4000-8000-000000000001' and user_id='c1000000-0000-4000-8000-000000000002';
select is((select count(*)::integer from private.page_presence_leases where workspace_id='c2000000-0000-4000-8000-000000000001'),0,'ancestor grant changes invalidate descendant presence leases');
select ok((select epoch from private.page_presence_epochs where workspace_id='c2000000-0000-4000-8000-000000000001')>(current_setting('collab.lease')::jsonb->>'epoch')::bigint,'ACL mutation advances the workspace channel epoch');
set local role authenticated;
select throws_ok($$select public.add_comment(current_setting('collab.thread')::uuid,'Denied after downgrade')$$,'42501',null,'viewer cannot comment after current ACL downgrade');
reset role;
delete from public.page_grants where page_id='c3000000-0000-4000-8000-000000000001' and user_id='c1000000-0000-4000-8000-000000000002';
set local role authenticated;
select throws_ok($$select public.renew_page_presence('c3000000-0000-4000-8000-000000000002','c5000000-0000-4000-8000-000000000001')$$,'42501',null,'revoked participant cannot renew into the current epoch');
select throws_ok($$select public.list_thread_comments(current_setting('collab.thread')::uuid)$$,'42501',null,'revoked connected participant cannot fetch comment content');
reset role;
select set_config('request.jwt.claims','{"sub":"c1000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
set local role authenticated;
select is(jsonb_array_length(public.list_comment_threads('c3000000-0000-4000-8000-000000000002')->'threads'),1,'viewer can read authorized conversations');
select throws_ok($$select public.resolve_comment_thread(current_setting('collab.thread')::uuid,true,2)$$,'42501',null,'viewer cannot resolve a thread');
select public.renew_page_presence('c3000000-0000-4000-8000-000000000002','c5000000-0000-4000-8000-000000000004');
reset role;
update public.document_heads set projection='{"schemaVersion":1,"blocks":[]}' where page_id='c3000000-0000-4000-8000-000000000002';
set local role authenticated;
select is((public.list_comment_threads('c3000000-0000-4000-8000-000000000002')->'threads'->0->>'anchorAvailable')::boolean,false,'removing a block retains the thread without reassigning its anchor');
reset role;
delete from public.workspace_members where workspace_id='c2000000-0000-4000-8000-000000000001' and user_id='c1000000-0000-4000-8000-000000000004';
select is((select count(*)::integer from private.page_presence_leases where workspace_id='c2000000-0000-4000-8000-000000000001'),0,'membership deletion including cascaded grants invalidates every lease safely');
select is((select count(*)::integer from public.comments where thread_id=current_setting('collab.thread')::uuid and deleted_at is null),1,'membership revocation preserves historical comments');
select set_config('request.jwt.claims','{"sub":"c1000000-0000-4000-8000-000000000005","role":"authenticated"}',true);
set local role authenticated;
select is((select count(*)::integer from public.comments),0,'foreign workspace members cannot read comments through Data API');
select throws_ok($$select public.list_comment_threads('c3000000-0000-4000-8000-000000000002')$$,'42501',null,'foreign workspace cannot enumerate threads');
reset role;
select throws_ok($$insert into public.comments(id,workspace_id,page_id,thread_id,author_id,body,request_hash) values(gen_random_uuid(),'c2000000-0000-4000-8000-000000000002','c3000000-0000-4000-8000-000000000003',current_setting('collab.thread')::uuid,'c1000000-0000-4000-8000-000000000005','Cross-workspace',repeat('a',64))$$,'23503',null,'composite thread keys reject cross-workspace writes even for maintenance');
select ok(not has_function_privilege('anon','public.renew_page_presence(uuid,uuid)','execute'),'anonymous callers cannot renew presence');
select ok(not has_function_privilege('anon','public.create_comment_thread(uuid,text,text,jsonb,uuid)','execute'),'anonymous callers cannot create conversations');
select ok(not exists(select 1 from pg_policy where polrelid='realtime.messages'::regclass and polcmd='a' and pg_get_expr(polwithcheck,polrelid) not like '%presence%'),'Realtime has no client Broadcast INSERT policy');
select lives_ok($$delete from public.workspaces where id='c2000000-0000-4000-8000-000000000002'$$,'workspace deletion cascades do not recreate invalid epoch scopes');
select set_config('request.jwt.claims','{"sub":"c1000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select set_config('collab.large',public.create_comment_thread('c3000000-0000-4000-8000-000000000002','Large thread')::text,true);
do $$ begin
  for n in 1..51 loop perform public.add_comment(current_setting('collab.large')::uuid,repeat('x',8192)); end loop;
  for n in 1..51 loop perform public.create_comment_thread('c3000000-0000-4000-8000-000000000002',repeat('x',8192)); end loop;
end; $$;
select set_config('collab.comments',public.list_thread_comments(current_setting('collab.large')::uuid)::text,true);
select is(jsonb_array_length(current_setting('collab.comments')::jsonb->'comments'),50,'comment pages are capped at fifty entries');
select is(jsonb_array_length(public.list_thread_comments(current_setting('collab.large')::uuid,(current_setting('collab.comments')::jsonb->'nextCursor'->>'createdAt')::timestamptz,(current_setting('collab.comments')::jsonb->'nextCursor'->>'id')::uuid)->'comments'),2,'comment keyset cursor reaches the remainder without losing replies');
select set_config('collab.threads',public.list_comment_threads('c3000000-0000-4000-8000-000000000002')::text,true);
select ok(jsonb_array_length(current_setting('collab.threads')::jsonb->'threads')=50 and octet_length(current_setting('collab.threads'))<1048576,'thread previews stay below one MiB with fifty maximum-size bodies');
select is(jsonb_array_length(public.list_comment_threads('c3000000-0000-4000-8000-000000000002',(current_setting('collab.threads')::jsonb->'nextCursor'->>'createdAt')::timestamptz,(current_setting('collab.threads')::jsonb->'nextCursor'->>'id')::uuid)->'threads'),3,'thread keyset cursor preserves all remaining conversations');
reset role;
select set_config('request.jwt.claims','{"sub":"c1000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.resolve_comment_thread(current_setting('collab.large')::uuid,true,0)$$,'42501',null,'commenter cannot resolve another author conversation');
reset role;
delete from public.workspace_members where workspace_id='c2000000-0000-4000-8000-000000000001' and user_id='c1000000-0000-4000-8000-000000000003';
select is((select body from public.comments where id=current_setting('collab.thread')::uuid),'Comentário editado','removing a comment author preserves their accepted text');
update public.comments set body=repeat(chr(1),8192) where author_id='c1000000-0000-4000-8000-000000000001' and deleted_at is null;
select set_config('request.jwt.claims','{"sub":"c1000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select set_config('collab.escaped',public.list_thread_comments(current_setting('collab.large')::uuid)::text,true);
select ok(jsonb_array_length(current_setting('collab.escaped')::jsonb->'comments') between 1 and 49 and octet_length(current_setting('collab.escaped'))<=1048576 and current_setting('collab.escaped')::jsonb->'nextCursor'<>'null','JSON escape expansion obeys the byte budget and preserves continuation');
do $$ begin for n in 1..8 loop perform public.renew_page_presence('c3000000-0000-4000-8000-000000000002',('c5000000-0000-4000-8000-'||lpad((n+10)::text,12,'0'))::uuid); end loop; end; $$;
select throws_ok($$select public.renew_page_presence('c3000000-0000-4000-8000-000000000002','c5000000-0000-4000-8000-000000000019')$$,'54000',null,'one actor cannot retain more than eight active presence leases');
reset role;
update private.page_presence_leases set expires_at=clock_timestamp()-interval '1 second' where participant_id='c5000000-0000-4000-8000-000000000011';
set local role authenticated;
select lives_ok($$select public.renew_page_presence('c3000000-0000-4000-8000-000000000002','c5000000-0000-4000-8000-000000000019')$$,'expired own leases are pruned before accepting a new participant');
reset role;
insert into private.collaboration_windows(workspace_id,actor_id,action,window_start,attempts)
select 'c2000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','comment',date_trunc('minute',clock_timestamp())+n*interval '1 minute',120 from generate_series(0,1) n
on conflict(workspace_id,actor_id,action,window_start) do update set attempts=120;
set local role authenticated;
select throws_ok($$select public.edit_comment(current_setting('collab.large')::uuid,'Rate exceeded',0)$$,'54000',null,'comment mutation quota blocks further accepted writes');
reset role;
select ok(not exists(select 1 from unnest(array['public.comment_threads','public.comments','private.page_presence_epochs','private.page_presence_leases','private.collaboration_windows']) t where has_table_privilege('authenticated',t,'INSERT,UPDATE,DELETE')),'no collaboration table grants clients a direct mutation path');
select lives_ok($$delete from public.workspaces where id='c2000000-0000-4000-8000-000000000001'$$,'workspace cascade safely removes comment and presence scopes together');
select * from finish();
rollback;
