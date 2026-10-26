begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select ('61000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'pages-'||n||'@example.test',now(),'{}','{}',now(),now() from generate_series(1,7) n;
insert into public.workspaces(id,name,created_by) values
('62000000-0000-4000-8000-000000000001','Pages A','61000000-0000-4000-8000-000000000001'),
('62000000-0000-4000-8000-000000000002','Pages B','61000000-0000-4000-8000-000000000002');
insert into public.workspace_members(workspace_id,user_id,role)
select '62000000-0000-4000-8000-000000000001',('61000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  case when n=1 then 'owner' else 'member' end from generate_series(1,6) n where n<>2;
insert into public.workspace_members values('62000000-0000-4000-8000-000000000002','61000000-0000-4000-8000-000000000002','owner',now());
insert into public.pages(id,workspace_id,parent_id,title,position,owner_id,restricted) values
('63000000-0000-4000-8000-000000000001','62000000-0000-4000-8000-000000000001',null,'Origem pública autorizada','U','61000000-0000-4000-8000-000000000001',true),
('63000000-0000-4000-8000-000000000002','62000000-0000-4000-8000-000000000001',null,'Destino restrito','k','61000000-0000-4000-8000-000000000001',true),
('63000000-0000-4000-8000-000000000003','62000000-0000-4000-8000-000000000001','63000000-0000-4000-8000-000000000001','Café organização running','U','61000000-0000-4000-8000-000000000001',false),
('63000000-0000-4000-8000-000000000004','62000000-0000-4000-8000-000000000001','63000000-0000-4000-8000-000000000003','Segredo administrativo café','U','61000000-0000-4000-8000-000000000006',true),
('63000000-0000-4000-8000-000000000005','62000000-0000-4000-8000-000000000001','63000000-0000-4000-8000-000000000006','Acesso direto café','U','61000000-0000-4000-8000-000000000001',true),
('63000000-0000-4000-8000-000000000006','62000000-0000-4000-8000-000000000001',null,'Pai secreto café','z','61000000-0000-4000-8000-000000000001',true),
('63000000-0000-4000-8000-000000000007','62000000-0000-4000-8000-000000000002',null,'Foreign café','U','61000000-0000-4000-8000-000000000002',true),
('63000000-0000-4000-8000-000000000008','62000000-0000-4000-8000-000000000001','63000000-0000-4000-8000-000000000003','Earlier deleted café','k','61000000-0000-4000-8000-000000000001',false),
('63000000-0000-4000-8000-000000000009','62000000-0000-4000-8000-000000000001','63000000-0000-4000-8000-000000000008','Earlier deleted descendant','U','61000000-0000-4000-8000-000000000001',false);
update public.pages set deleted_at=now(),deleted_batch_id='64000000-0000-4000-8000-000000000001',deleted_parent_id=parent_id,deleted_position=position
  where id in('63000000-0000-4000-8000-000000000008','63000000-0000-4000-8000-000000000009');
insert into public.page_grants(page_id,workspace_id,user_id,role) values
('63000000-0000-4000-8000-000000000001','62000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000003','editor'),
('63000000-0000-4000-8000-000000000001','62000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000004','commenter'),
('63000000-0000-4000-8000-000000000001','62000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000005','viewer'),
('63000000-0000-4000-8000-000000000001','62000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000006','editor'),
('63000000-0000-4000-8000-000000000002','62000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000003','editor'),
('63000000-0000-4000-8000-000000000005','62000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000005','viewer');

select is((with actors as(select id from auth.users where id::text like '61000000-%'),
  expected as(select a.id as actor,p.id as page_id,case private.page_role(p.id,a.id)
    when 'owner' then 4 when 'editor' then 3 when 'commenter' then 2 when 'viewer' then 1 else null end as capability
    from actors a cross join public.pages p where p.workspace_id='62000000-0000-4000-8000-000000000001'),
  actual as(select a.id as actor,s.page_id,s.capability from actors a
    cross join lateral private.visible_page_scope('62000000-0000-4000-8000-000000000001',a.id) s)
  select count(*)::integer from expected e left join actual a using(actor,page_id) where e.capability is distinct from a.capability),0,
  'set-based visible scope matches page RLS for every role, inheritance boundary and direct grant');
select is((select count(*)::integer from private.visible_page_scope('62000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000007')),0,'set-based scope denies nonmembers');
insert into public.pages(id,workspace_id,parent_id,title,owner_id,restricted) values
('63000000-0000-4000-8000-000000000010','62000000-0000-4000-8000-000000000001','63000000-0000-4000-8000-000000000008','Live row below deleted ancestor','61000000-0000-4000-8000-000000000001',true);
insert into public.page_grants values('63000000-0000-4000-8000-000000000010','62000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000005','viewer');
select is((select count(*)::integer from private.visible_page_scope('62000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000005') where page_id='63000000-0000-4000-8000-000000000010'),0,'set-based scope rejects direct grants beneath deleted ancestors');
delete from public.pages where id='63000000-0000-4000-8000-000000000010';

select ok((select relrowsecurity from pg_class where oid='public.page_favorites'::regclass),'favorites has RLS');
select ok(private.position_between('A','B') collate "C">'A' and private.position_between('A','B') collate "C"<'B','fractional position lies in ordinal interval');
select ok(private.position_between(null,'0V') collate "C"<'0V','fractional position can precede leading zero');
select ok(private.position_between('z',null) collate "C">'z','fractional position extends maximal digit');
select throws_ok($$select private.position_between('a','a')$$,'54000',null,'equal legacy positions require rebalance');
select throws_ok($$select private.position_between(null,'0')$$,'54000',null,'exhausted prefix interval requires rebalance');
select throws_ok($$select private.position_between(repeat('z',128),null)$$,'54000',null,'positions remain bounded to128 characters');
do $$declare a text:=null; b text:='V'; k text; begin
  for n in 1..500 loop
    begin k:=private.position_between(a,b); exception when program_limit_exceeded then a:=null;b:='V';k:=private.position_between(a,b); end;
    if not((a is null or k collate "C">a collate "C") and k collate "C"<b collate "C") then raise exception 'Invalid interval'; end if;
    b:=k;
  end loop;
end$$;
select pass('500 adversarial prefix insertions preserve bounds or request explicit rebalance');

select set_config('request.jwt.claims','{"sub":"61000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
set local role authenticated;
select set_config('test.created',public.create_page('62000000-0000-4000-8000-000000000001','63000000-0000-4000-8000-000000000001','Created café','64000000-0000-4000-8000-000000000002')::text,true);
select is(public.create_page('62000000-0000-4000-8000-000000000001','63000000-0000-4000-8000-000000000001','Created café','64000000-0000-4000-8000-000000000002'),current_setting('test.created')::uuid,'create retry preserves page identity');
select throws_ok($$select public.create_page('62000000-0000-4000-8000-000000000001',null,'Different','64000000-0000-4000-8000-000000000002')$$,'22023',null,'create retry with changed input fails');
select is(public.get_page_role(current_setting('test.created')::uuid),'owner','new child remains owned by its creator');
select is(private.page_role(current_setting('test.created')::uuid,'61000000-0000-4000-8000-000000000005'),'viewer','new child inherits the parent viewer grant');
select is(private.page_role(current_setting('test.created')::uuid,'61000000-0000-4000-8000-000000000006'),'editor','new child inherits the parent editor grant');
select is(private.page_role(current_setting('test.created')::uuid,'61000000-0000-4000-8000-000000000004'),'commenter','new child inherits the parent commenter grant');
select is((select revision from public.pages where id=current_setting('test.created')::uuid),0::bigint,'metadata starts at revision zero');
select is(public.update_page(current_setting('test.created')::uuid,0,'{"title":"Renamed café","icon":"🌿"}'),1::bigint,'valid metadata patch increments revision');
select throws_ok($$select public.update_page(current_setting('test.created')::uuid,0,'{"title":"stale"}')$$,'40001',null,'stale metadata does not overwrite committed title');
select throws_ok($$select public.update_page(current_setting('test.created')::uuid,1,'{"restricted":false}')$$,'22023',null,'metadata patch cannot alter ACL');
select throws_ok($$select public.update_page(current_setting('test.created')::uuid,1,'{"title":null}')$$,'22023',null,'null title rejected');
select throws_ok($$select public.update_page(current_setting('test.created')::uuid,1,'{"icon":"<svg>"}')$$,'22023',null,'unsafe icon input rejected');
select throws_ok($$select public.update_page(current_setting('test.created')::uuid,1,jsonb_build_object('title',repeat('x',501)))$$,'22023',null,'long title rejected');
select throws_ok($$select public.create_page('62000000-0000-4000-8000-000000000002')$$,'42501',null,'creation in another workspace rejected');
select throws_ok($$select public.create_page('62000000-0000-4000-8000-000000000001','63000000-0000-4000-8000-000000000007')$$,'42501',null,'cross-workspace parent rejected');
select throws_ok($$select public.move_page('63000000-0000-4000-8000-000000000003','63000000-0000-4000-8000-000000000002',null,0,true)$$,'42501',null,'editor cannot change inherited access even with consent flag');
select throws_ok($$select public.move_page('63000000-0000-4000-8000-000000000003','63000000-0000-4000-8000-000000000004',null,0)$$,'23514',null,'move into a descendant rejected');
select throws_ok($$select public.remove_page('63000000-0000-4000-8000-000000000003',0)$$,'42501',null,'editor cannot remove a restricted descendant without permission');
select set_config('test.created_move_preview',public.move_page(current_setting('test.created')::uuid,'63000000-0000-4000-8000-000000000002',null,1)::text,true);
select ok((current_setting('test.created_move_preview')::jsonb->>'requires_confirmation')::boolean,'moving inherited new child previews changes to its parent grants');
select ok((public.move_page(current_setting('test.created')::uuid,'63000000-0000-4000-8000-000000000002',null,1,true,current_setting('test.created_move_preview')::jsonb->>'preview_hash')->>'moved')::boolean,'child owner can confirm changes to its inherited capabilities');
select is((public.get_page_metadata(current_setting('test.created')::uuid,'62000000-0000-4000-8000-000000000001')->>'parent_id')::uuid,'63000000-0000-4000-8000-000000000002'::uuid,'move persists chosen visible parent');
select throws_ok($$select public.move_page(current_setting('test.created')::uuid,null,null,1)$$,'40001',null,'move observes metadata CAS');
select is((select count(*)::integer from public.document_heads where page_id=current_setting('test.created')::uuid),0,'M2 does not persist a fake plaintext or Yjs document');
select throws_ok($$insert into public.pages(workspace_id,owner_id) values('62000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000003')$$,'42501',null,'direct page insert forbidden');
select throws_ok($$update public.pages set title='bypass' where id=current_setting('test.created')::uuid$$,'42501',null,'direct page metadata update forbidden');
select throws_ok($$delete from public.pages where id=current_setting('test.created')::uuid$$,'42501',null,'direct physical page delete forbidden');
reset role;

select set_config('request.jwt.claims','{"sub":"61000000-0000-4000-8000-000000000005","role":"authenticated"}',true);
set local role authenticated;
select is(public.get_page_role('63000000-0000-4000-8000-000000000003'),'viewer','viewer inherits through unrestricted edge');
select is(public.get_page_role('63000000-0000-4000-8000-000000000004'),null,'restricted child denies inherited viewer');
select throws_ok($$select * from private.visible_page_scope('62000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000001')$$,'42501',null,'clients cannot invoke scope helper with another identity');
select is((select count(*)::integer from public.list_page_breadcrumbs('63000000-0000-4000-8000-000000000005')),1,'direct child breadcrumb hides private parent');
select ok(exists(select 1 from public.list_page_children('62000000-0000-4000-8000-000000000001') where id='63000000-0000-4000-8000-000000000005'),'root navigation includes direct child behind hidden parent');
select is((select count(*)::integer from public.search_pages('62000000-0000-4000-8000-000000000001','cafe')),2,'unaccent search reveals only authorized pages');
select is((select count(*)::integer from public.search_pages('62000000-0000-4000-8000-000000000001','running')),1,'English token search supported');
select is((select count(*)::integer from public.search_pages('62000000-0000-4000-8000-000000000001','organizações')),1,'Portuguese stemming supported');
select is((select count(*)::integer from public.search_pages('62000000-0000-4000-8000-000000000002','cafe')),0,'search in foreign workspace yields no records');
select throws_ok($$select public.update_page('63000000-0000-4000-8000-000000000003',0,'{"title":"no"}')$$,'42501',null,'viewer cannot rename');
select throws_ok($$select public.remove_page('63000000-0000-4000-8000-000000000003',0)$$,'42501',null,'viewer cannot remove');
select throws_ok($$select public.move_page('63000000-0000-4000-8000-000000000003',null,null,0)$$,'42501',null,'viewer cannot move');
select throws_ok($$select public.create_page('62000000-0000-4000-8000-000000000001','63000000-0000-4000-8000-000000000001')$$,'42501',null,'viewer cannot create child under read-only parent');
select ok(public.toggle_page_favorite('63000000-0000-4000-8000-000000000003'),'viewer can favorite readable page');
select is((select count(*)::integer from public.page_favorites),1,'viewer reads own favorite');
select throws_ok($$insert into public.page_favorites values('62000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000005','63000000-0000-4000-8000-000000000005',now())$$,'42501',null,'direct favorite insertion forbidden');
select throws_ok($$update public.page_favorites set user_id='61000000-0000-4000-8000-000000000001'$$,'42501',null,'direct favorite reassignment forbidden');
select throws_ok($$delete from public.page_favorites$$,'42501',null,'direct favorite delete forbidden');
select throws_ok($$select public.toggle_page_favorite('63000000-0000-4000-8000-000000000004')$$,'42501',null,'favorite cannot discover restricted page');
select throws_ok($$select * from public.list_page_children('62000000-0000-4000-8000-000000000001',null,'a')$$,'22023',null,'children cursor fields must be paired');
select throws_ok($$select * from public.search_pages('62000000-0000-4000-8000-000000000001','cafe',1)$$,'22023',null,'rank cursor fields must be paired');
select throws_ok($$select * from public.search_pages('62000000-0000-4000-8000-000000000001','',null,'63000000-0000-4000-8000-000000000001')$$,'22023',null,'recent cursor fields must be paired');
select throws_ok($$select * from public.list_page_breadcrumbs('63000000-0000-4000-8000-000000000003',-2)$$,'22023',null,'negative breadcrumb cursor rejected');
reset role;

select set_config('request.jwt.claims','{"sub":"61000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select is((select count(*)::integer from public.page_favorites),0,'workspace owner cannot read another person favorite');
select set_config('test.preview',public.move_page('63000000-0000-4000-8000-000000000003','63000000-0000-4000-8000-000000000002',null,0)::text,true);
select ok((current_setting('test.preview')::jsonb->>'requires_confirmation')::boolean,'owner receives preview before access changes');
select is((public.get_page_metadata('63000000-0000-4000-8000-000000000003','62000000-0000-4000-8000-000000000001')->>'parent_id')::uuid,'63000000-0000-4000-8000-000000000001'::uuid,'preview does not mutate hierarchy');
select is((current_setting('test.preview')::jsonb->>'affected_pages')::integer,4,'authorized preview includes whole subtree and earlier tombstones');
select throws_ok($$select public.move_page('63000000-0000-4000-8000-000000000003','63000000-0000-4000-8000-000000000002',null,0,true)$$,'40001',null,'consent without preview hash rejected');
reset role;
insert into public.page_grants values('63000000-0000-4000-8000-000000000002','62000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000005','editor');
set local role authenticated;
select throws_ok($$select public.move_page('63000000-0000-4000-8000-000000000003','63000000-0000-4000-8000-000000000002',null,0,true,current_setting('test.preview')::jsonb->>'preview_hash')$$,'40001',null,'changed ACL invalidates stale preview');
select set_config('test.preview',public.move_page('63000000-0000-4000-8000-000000000003','63000000-0000-4000-8000-000000000002',null,0)::text,true);
select ok((public.move_page('63000000-0000-4000-8000-000000000003','63000000-0000-4000-8000-000000000002',null,0,true,current_setting('test.preview')::jsonb->>'preview_hash')->>'moved')::boolean,'fresh preview authorizes exact move');
select is((select revision from public.pages where id='63000000-0000-4000-8000-000000000003'),1::bigint,'successful move advances metadata revision once');
select throws_ok($$select public.move_page('63000000-0000-4000-8000-000000000003','63000000-0000-4000-8000-000000000007',null,1)$$,'42501',null,'foreign parent denied even for workspace owner');
select throws_ok($$select public.move_page('63000000-0000-4000-8000-000000000003',null,'63000000-0000-4000-8000-000000000004',1)$$,'42501',null,'anchor must belong to requested sibling scope');
select set_config('test.batch',public.remove_page('63000000-0000-4000-8000-000000000003',1)::text,true);
select is(public.get_page_role('63000000-0000-4000-8000-000000000003'),null,'deleted page inaccessible even to owner through normal read');
select is((select count(*)::integer from public.list_trash('62000000-0000-4000-8000-000000000001')),2,'trash lists operation roots including independent earlier deletion');
select is((select count(*)::integer from public.list_trash('62000000-0000-4000-8000-000000000001',null,'running')),1,'trash search finds deleted title');
select is((select count(*)::integer from public.list_trash('62000000-0000-4000-8000-000000000001',null,'Origem')),0,'trash search excludes active pages');
select is((select count(*)::integer from public.list_trash('62000000-0000-4000-8000-000000000001',null,'administrativo cafe')),1,'trash search finds authorized deleted descendant with unaccented terms');
select is((select count(*)::integer from public.list_trash('62000000-0000-4000-8000-000000000001',null,'foreign')),0,'trash search does not include foreign workspace');
select throws_ok($$select public.update_page('63000000-0000-4000-8000-000000000003',2,'{"title":"deleted"}')$$,'42501',null,'deleted page cannot be edited');
select is((select count(*)::integer from public.search_pages('62000000-0000-4000-8000-000000000001','running')),0,'deleted title absent from full-text search');
select is((select count(*)::integer from public.list_page_breadcrumbs('63000000-0000-4000-8000-000000000004')),0,'deleted descendant breadcrumbs do not reveal names');
reset role;
select set_config('request.jwt.claims','{"sub":"61000000-0000-4000-8000-000000000005","role":"authenticated"}',true);
set local role authenticated;
select is((select count(*)::integer from public.page_favorites),0,'favorite hidden throughout subtree deletion');
select is((select count(*)::integer from public.list_trash('62000000-0000-4000-8000-000000000001',null,'administrativo')),0,'trash search cannot reveal restricted descendant to another page editor');
select throws_ok($$select * from public.list_trash('62000000-0000-4000-8000-000000000001',null,repeat('x',501))$$,'22023',null,'trash search query size bounded');
reset role;
select set_config('request.jwt.claims','{"sub":"61000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select ok((public.restore_page('63000000-0000-4000-8000-000000000003',p_expected_revision=>2)->>'restored')::boolean,'restore recovers same-batch subtree');
reset role;
select is((select count(*)::integer from public.pages where id in('63000000-0000-4000-8000-000000000003','63000000-0000-4000-8000-000000000004') and deleted_at is null),2,'both pages deleted in latest batch restored');
select is((select count(*)::integer from public.pages where id in('63000000-0000-4000-8000-000000000008','63000000-0000-4000-8000-000000000009') and deleted_at is not null),2,'earlier independent deletion remains tombstoned');
select is((select deleted_batch_id from public.pages where id='63000000-0000-4000-8000-000000000008'),'64000000-0000-4000-8000-000000000001'::uuid,'independent batch identity preserved');

select set_config('request.jwt.claims','{"sub":"61000000-0000-4000-8000-000000000005","role":"authenticated"}',true);
set local role authenticated;
select is((select count(*)::integer from public.page_favorites),1,'favorite reappears after authorized restore');
select ok(not public.toggle_page_favorite('63000000-0000-4000-8000-000000000003'),'toggle removes own favorite');
reset role;

-- Delete the current parent separately; the child cannot return underneath a tombstone.
select set_config('request.jwt.claims','{"sub":"61000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select set_config('test.batch2',public.remove_page('63000000-0000-4000-8000-000000000002',0)::text,true);
select throws_ok($$select public.restore_page('63000000-0000-4000-8000-000000000003',p_expected_revision=>4)$$,'22023',null,'unavailable original parent requires explicit destination');
select set_config('test.restore_preview',public.restore_page('63000000-0000-4000-8000-000000000003',null,false,p_expected_revision=>4)::text,true);
select ok((current_setting('test.restore_preview')::jsonb->>'requires_confirmation')::boolean,'restoring to root previews effective access changes');
select throws_ok($$select public.restore_page('63000000-0000-4000-8000-000000000003',null,false,true,'stale',4)$$,'40001',null,'restore rejects stale ACL preview');
select ok((public.restore_page('63000000-0000-4000-8000-000000000003',null,false,true,current_setting('test.restore_preview')::jsonb->>'preview_hash',4)->>'restored')::boolean,'explicit root restore with bound consent succeeds');
select is(public.get_page_metadata('63000000-0000-4000-8000-000000000003','62000000-0000-4000-8000-000000000001')->>'parent_id',null,'explicit restore root respected');
reset role;

-- Legacy equal keys and an exhausted first key trigger serialized rebalance.
insert into public.pages(id,workspace_id,title,position,owner_id) values
('65000000-0000-4000-8000-000000000001','62000000-0000-4000-8000-000000000001','Equal A','0','61000000-0000-4000-8000-000000000001'),
('65000000-0000-4000-8000-000000000002','62000000-0000-4000-8000-000000000001','Equal B','0','61000000-0000-4000-8000-000000000001');
set local role authenticated;
select ok((public.move_page('65000000-0000-4000-8000-000000000002',null,'65000000-0000-4000-8000-000000000001',0)->>'moved')::boolean,'exhausted interval is rebalanced and move succeeds');
select is((select count(*)::integer-count(distinct position)::integer from public.list_page_children('62000000-0000-4000-8000-000000000001')),0,'active sibling keys unique after rebalance');
select ok((select position from public.pages where id='65000000-0000-4000-8000-000000000002') collate "C" < (select position from public.pages where id='65000000-0000-4000-8000-000000000001') collate "C",'requested relative order survives rebalance');
reset role;

insert into public.pages(id,workspace_id,parent_id,title,position,owner_id,restricted) values
('68000000-0000-4000-8000-000000000001','62000000-0000-4000-8000-000000000001',null,'Same ACL A','x1','61000000-0000-4000-8000-000000000001',true),
('68000000-0000-4000-8000-000000000002','62000000-0000-4000-8000-000000000001',null,'Same ACL B','x2','61000000-0000-4000-8000-000000000001',true),
('68000000-0000-4000-8000-000000000003','62000000-0000-4000-8000-000000000001','68000000-0000-4000-8000-000000000001','Editor move source','V','61000000-0000-4000-8000-000000000001',false),
('68000000-0000-4000-8000-000000000004','62000000-0000-4000-8000-000000000001','68000000-0000-4000-8000-000000000003','Hidden restricted child','V','61000000-0000-4000-8000-000000000006',true);
insert into public.page_grants(page_id,workspace_id,user_id,role)
select ('68000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'62000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000003','editor' from generate_series(1,2) n;
select set_config('request.jwt.claims','{"sub":"61000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
set local role authenticated;
select set_config('test.safe_move',public.move_page('68000000-0000-4000-8000-000000000003','68000000-0000-4000-8000-000000000002',null,0)::text,true);
select ok((current_setting('test.safe_move')::jsonb->>'moved')::boolean,'editor can move an inherited subtree when every member capability remains identical');
select is((current_setting('test.safe_move')::jsonb->>'affected_pages')::integer,1,'move result does not count hidden restricted descendant');
select is(public.get_page_role('68000000-0000-4000-8000-000000000004'),null,'safe editor move preserves restricted child invisibility');
reset role;

-- A removed membership cannot retain favorites or mutate a formerly owned page.
select set_config('request.jwt.claims','{"sub":"61000000-0000-4000-8000-000000000006","role":"authenticated"}',true);
set local role authenticated;
select ok(public.toggle_page_favorite('68000000-0000-4000-8000-000000000004'),'restricted child owner can create own favorite');
reset role;
delete from public.workspace_members where workspace_id='62000000-0000-4000-8000-000000000001' and user_id='61000000-0000-4000-8000-000000000006';
set local role authenticated;
select is((select count(*)::integer from public.page_favorites),0,'revoked membership cannot read its former favorites');
select is(public.get_page_role('68000000-0000-4000-8000-000000000004'),null,'page ownership does not bypass revoked membership');
select throws_ok($$select public.update_page('68000000-0000-4000-8000-000000000004',0,'{"title":"revoked"}')$$,'42501',null,'revoked page owner cannot edit metadata');
reset role;

-- Hidden ancestor regression: C is visible, B is hidden, A is visible.
insert into public.pages(id,workspace_id,parent_id,title,position,owner_id,restricted) values
('69000000-0000-4000-8000-000000000001','62000000-0000-4000-8000-000000000001',null,'Visible ancestor A','y1','61000000-0000-4000-8000-000000000001',true),
('69000000-0000-4000-8000-000000000002','62000000-0000-4000-8000-000000000001','69000000-0000-4000-8000-000000000001','Hidden ancestor B','V','61000000-0000-4000-8000-000000000001',true),
('69000000-0000-4000-8000-000000000003','62000000-0000-4000-8000-000000000001','69000000-0000-4000-8000-000000000002','Visible child C','U','61000000-0000-4000-8000-000000000001',true),
('69000000-0000-4000-8000-000000000004','62000000-0000-4000-8000-000000000001','69000000-0000-4000-8000-000000000002','Visible sibling D','k','61000000-0000-4000-8000-000000000001',true);
insert into public.page_grants(page_id,workspace_id,user_id,role) values
('69000000-0000-4000-8000-000000000001','62000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000005','viewer'),
('69000000-0000-4000-8000-000000000003','62000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000005','editor'),
('69000000-0000-4000-8000-000000000004','62000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000005','viewer');
select set_config('request.jwt.claims','{"sub":"61000000-0000-4000-8000-000000000005","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select parent_id from public.pages where id='69000000-0000-4000-8000-000000000003'$$,'42501',null,'raw Data API cannot read a hidden parent reference');
select throws_ok($$select deleted_parent_id from public.pages where id='69000000-0000-4000-8000-000000000003'$$,'42501',null,'raw Data API cannot read original deleted parent reference');
select throws_ok($$select request_hash from public.pages where id='69000000-0000-4000-8000-000000000003'$$,'42501',null,'raw Data API cannot read internal request metadata');
select is((select parent_id from public.list_page_children('62000000-0000-4000-8000-000000000001') where id='69000000-0000-4000-8000-000000000003'),null,'child listing masks hidden physical parent');
select is((select array_agg(depth order by depth) from public.list_page_breadcrumbs('69000000-0000-4000-8000-000000000003')),array[0,1],'breadcrumb ordinals do not expose hidden ancestry gaps');
-- Metadata projection and same-parent ordering use the hardened public contract.
select is(public.get_page_metadata('69000000-0000-4000-8000-000000000003','62000000-0000-4000-8000-000000000001')->>'parent_id',null,'page metadata masks hidden parent');
select is(public.get_page_metadata('69000000-0000-4000-8000-000000000002','62000000-0000-4000-8000-000000000001'),null,'metadata does not reveal hidden page');
select is(public.get_page_metadata('69000000-0000-4000-8000-000000000003','62000000-0000-4000-8000-000000000002'),null,'metadata requires matching authorized workspace');
select is((select array_agg(k order by k) from jsonb_object_keys(public.get_page_metadata('69000000-0000-4000-8000-000000000003','62000000-0000-4000-8000-000000000001')) k),
  array['cover_file_id','icon','id','parent_id','position','revision','title','workspace_id'],'metadata projection exposes only eight whitelisted keys');
select is((select array_agg(depth order by depth) from public.list_page_breadcrumbs('69000000-0000-4000-8000-000000000003',0)),array[1],'breadcrumb cursor uses visible ordinal');
select ok((public.move_page('69000000-0000-4000-8000-000000000003',p_before_id=>'69000000-0000-4000-8000-000000000004',p_expected_revision=>0,p_keep_parent=>true)->>'moved')::boolean,'same-parent reorder works without exposing the hidden parent');
select throws_ok($$select public.move_page('69000000-0000-4000-8000-000000000003',p_before_id=>'69000000-0000-4000-8000-000000000001',p_expected_revision=>1,p_keep_parent=>true)$$,'42501',null,'same-parent mode rejects anchor from a different physical parent');
reset role;
select is((select parent_id from public.pages where id='69000000-0000-4000-8000-000000000003'),'69000000-0000-4000-8000-000000000002'::uuid,'masked parent never becomes accidental root during drag');
select set_config('request.jwt.claims','{"sub":"61000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select public.remove_page('69000000-0000-4000-8000-000000000002',0);
reset role;
select set_config('request.jwt.claims','{"sub":"61000000-0000-4000-8000-000000000005","role":"authenticated"}',true);
set local role authenticated;
select ok(exists(select 1 from public.list_trash('62000000-0000-4000-8000-000000000001') where id='69000000-0000-4000-8000-000000000003'),'trash promotes directly administrable child when its batch parent is hidden');
select is((select parent_id from public.list_trash('62000000-0000-4000-8000-000000000001') where id='69000000-0000-4000-8000-000000000003'),null,'promoted trash child does not expose hidden parent');
reset role;

-- Deep hierarchy is built in one statement and navigated by a cursor, not a cap.
select set_config('request.jwt.claims','{"sub":"61000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
insert into public.pages(id,workspace_id,parent_id,title,position,owner_id,restricted)
select ('66000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'62000000-0000-4000-8000-000000000001',
  case when n=1 then null else ('66000000-0000-4000-8000-'||lpad((n-1)::text,12,'0'))::uuid end,
  'Deep '||n,'V','61000000-0000-4000-8000-000000000001',false from generate_series(1,1000) n;
set local role authenticated;
select is((select count(*)::integer from public.list_page_breadcrumbs('66000000-0000-4000-8000-000000001000')),51,'deep breadcrumbs bounded to51 rows');
select is((select max(depth) from public.list_page_breadcrumbs('66000000-0000-4000-8000-000000001000',950)),999,'cursor can reach thousandth ancestor without depth ceiling');
select throws_ok($$select public.move_page('66000000-0000-4000-8000-000000000001','66000000-0000-4000-8000-000000001000',null,0)$$,'23514',null,'thousand-level cycle detected');
reset role;

-- Pagination uses cursor tuples, preserving ordinal ties and recent timestamps.
insert into public.pages(id,workspace_id,title,position,owner_id)
select ('67000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'62000000-0000-4000-8000-000000000001',
  'Pagination café '||n,'P'||lpad(n::text,3,'0'),'61000000-0000-4000-8000-000000000001' from generate_series(1,65) n;
set local role authenticated;
select is((select count(*)::integer from public.search_pages('62000000-0000-4000-8000-000000000001','pagination')),51,'FTS response bounded to51');
select is((select count(*)::integer from public.search_pages('62000000-0000-4000-8000-000000000001','')),51,'recent response bounded to51');
select is((select count(*)::integer from public.list_page_children('62000000-0000-4000-8000-000000000001')),51,'children response bounded to51');
select is((with first_page as(select * from public.list_page_children('62000000-0000-4000-8000-000000000001') limit 50),
  anchor as(select * from first_page order by position collate "C" desc,id desc limit 1),
  second_page as(select s.* from anchor a cross join lateral public.list_page_children('62000000-0000-4000-8000-000000000001',null,a.position,a.id) s),
  all_pages as(select id from first_page union all select id from second_page)
  select count(*)::integer-count(distinct id)::integer from all_pages),0,'children cursor pages have no repeated identities');
select is((with first_page as(select * from public.search_pages('62000000-0000-4000-8000-000000000001','') limit 50),
  anchor as(select * from first_page order by updated_at,id desc limit 1),
  second_page as(select s.* from anchor a cross join lateral public.search_pages('62000000-0000-4000-8000-000000000001','',null,a.id,a.updated_at) s),
  all_pages as(select id from first_page union all select id from second_page)
  select count(*)::integer-count(distinct id)::integer from all_pages),0,'recent cursor pages have no repeated identities');
select is((with first_page as (select * from public.search_pages('62000000-0000-4000-8000-000000000001','pagination') limit 50),
  anchor as(select * from first_page order by rank,id desc limit 1),
  second_page as(select s.* from anchor a cross join lateral public.search_pages('62000000-0000-4000-8000-000000000001','pagination',a.rank,a.id) s)
  select count(distinct id)::integer from(select id from first_page union all select id from second_page) all_pages),65,'rank cursor returns all65 pages without skip or repeat');
select throws_ok($$select private.page_role_core('63000000-0000-4000-8000-000000000004','61000000-0000-4000-8000-000000000005',true)$$,'42501',null,'private lifecycle bypass helper not callable by clients');
select set_config('test.restore_race',public.create_page('62000000-0000-4000-8000-000000000001',null,'Restore race','64000000-0000-4000-8000-000000000003')::text,true);
select is(private.page_role(current_setting('test.restore_race')::uuid,'61000000-0000-4000-8000-000000000005'),null,'new root remains private by default');
select public.remove_page(current_setting('test.restore_race')::uuid,0);
select public.restore_page(current_setting('test.restore_race')::uuid,p_expected_revision=>1);
select public.update_page(current_setting('test.restore_race')::uuid,2,'{"title":"Changed after first restoration"}');
select public.remove_page(current_setting('test.restore_race')::uuid,3);
select throws_ok($$select public.restore_page(current_setting('test.restore_race')::uuid)$$,'40001',null,'restore without a revision is rejected');
select throws_ok($$select public.restore_page(current_setting('test.restore_race')::uuid,p_expected_revision=>1)$$,'40001',null,'stale restore form cannot revive a newer deletion batch');
select is(public.get_page_role(current_setting('test.restore_race')::uuid),null,'rejected stale restoration leaves newer tombstone unreadable');
select ok((public.restore_page(current_setting('test.restore_race')::uuid,p_expected_revision=>4)->>'restored')::boolean,'current revision can restore the newer deletion batch');
reset role;

select set_config('request.jwt.claims','{"sub":"61000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.update_page('63000000-0000-4000-8000-000000000001',0,'{"title":"no"}')$$,'42501',null,'commenter cannot edit metadata');
select is((select count(*)::integer from public.list_trash('62000000-0000-4000-8000-000000000001')),0,'commenter cannot list administrative trash');
select throws_ok($$select public.restore_page('63000000-0000-4000-8000-000000000002')$$,'42501',null,'commenter cannot restore');
reset role;

select set_config('request.jwt.claims','{"sub":"61000000-0000-4000-8000-000000000007","role":"authenticated"}',true);
set local role authenticated;
select is((select count(*)::integer from public.page_favorites),0,'outsider cannot read favorites');
select is(public.get_page_role('63000000-0000-4000-8000-000000000001'),null,'outsider role lookup returns no capability');
select is(public.get_page_role('69999999-0000-4000-8000-000000000001'),null,'missing role lookup has identical result');
select is((select count(*)::integer from public.list_page_children('62000000-0000-4000-8000-000000000001')),0,'outsider cannot list children');
select is((select count(*)::integer from public.list_trash('62000000-0000-4000-8000-000000000001')),0,'outsider cannot list trash');
select is((select count(*)::integer from public.search_pages('62000000-0000-4000-8000-000000000001','')),0,'outsider cannot list recent pages');
select throws_ok($$select public.toggle_page_favorite('63000000-0000-4000-8000-000000000001')$$,'42501',null,'outsider cannot favorite page');
reset role;
select throws_ok($$insert into public.page_favorites values('62000000-0000-4000-8000-000000000002','61000000-0000-4000-8000-000000000002','63000000-0000-4000-8000-000000000001',now())$$,'23503',null,'favorite compound FK rejects a page from another workspace');
update auth.users set email_confirmed_at=null where id='61000000-0000-4000-8000-000000000007';
set local role authenticated;
select throws_ok($$select public.get_page_role('63000000-0000-4000-8000-000000000001')$$,'28000',null,'role RPC requires confirmed identity');
reset role;
set local role anon;
select throws_ok($$select * from public.page_favorites$$,'42501',null,'anonymous favorite reads denied');
select throws_ok($$select public.get_page_role('63000000-0000-4000-8000-000000000001')$$,'42501',null,'anonymous role lookup denied');
select throws_ok($$select public.create_page('62000000-0000-4000-8000-000000000001')$$,'42501',null,'anonymous mutations denied');
select throws_ok($$insert into public.page_favorites values('62000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000001','63000000-0000-4000-8000-000000000001',now())$$,'42501',null,'anonymous favorite writes denied');
reset role;

select * from finish();
rollback;
