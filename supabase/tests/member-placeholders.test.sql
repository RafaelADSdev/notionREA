begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('fb100000-0000-4000-8000-000000000001','member-label-one@example.test',now(),'{}','{"display_name":"Membro"}',now(),now()),
('fb100000-0000-4000-8000-000000000002','member-label-two@example.test',now(),'{}','{}',now(),now());
insert into public.workspaces(id,name,created_by) values('fb200000-0000-4000-8000-000000000001','Labels','fb100000-0000-4000-8000-000000000001');
insert into public.workspace_members(workspace_id,user_id,role)
values('fb200000-0000-4000-8000-000000000001','fb100000-0000-4000-8000-000000000001','owner'),
('fb200000-0000-4000-8000-000000000001','fb100000-0000-4000-8000-000000000002','member');
insert into public.pages(id,workspace_id,title,owner_id,restricted,workspace_role)
values('fb300000-0000-4000-8000-000000000001','fb200000-0000-4000-8000-000000000001','Labels','fb100000-0000-4000-8000-000000000001',true,'commenter');
select is(private.comment_label('{}'),'', 'absent comment name is a semantic empty value');
select is(private.comment_label('{"display_name":"Membro"}'),'Membro','authored Membro is preserved as a real name');
select is(private.comment_label('{"display_name":"hidden@example.test"}'),'','email metadata becomes semantic absence without email exposure');
select is(private.sharing_member_label('fb100000-0000-4000-8000-000000000001'),'Membro','sharing preserves an authored name equal to the former placeholder');
select is(private.sharing_member_label('fb100000-0000-4000-8000-000000000002'),'','sharing metadata leaves localization to the interface');
select set_config('request.jwt.claims','{"sub":"fb100000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select is(public.renew_page_presence('fb300000-0000-4000-8000-000000000001','fb400000-0000-4000-8000-000000000001')#>>'{participants,0,label}','Membro','presence preserves the actual authored name');
select public.create_comment_thread('fb300000-0000-4000-8000-000000000001','Authored words');
reset role;
select set_config('request.jwt.claims','{"sub":"fb100000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select is(public.renew_page_presence('fb300000-0000-4000-8000-000000000001','fb400000-0000-4000-8000-000000000002')#>>'{participants,1,label}','','presence represents an unnamed participant without a language-specific name');
select is(public.list_comment_threads('fb300000-0000-4000-8000-000000000001')#>>'{threads,0,authorLabel}','Membro','authorized comment list preserves authored labels');
select public.create_comment_thread('fb300000-0000-4000-8000-000000000001','Other authored words');
select is((select item->>'authorLabel' from jsonb_array_elements(public.list_comment_threads('fb300000-0000-4000-8000-000000000001')->'threads') item where item->>'authorId'='fb100000-0000-4000-8000-000000000002'),'','authorized list leaves only the absent name for client localization');
reset role;
select * from finish();
rollback;
