begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

insert into auth.users(id,email,email_confirmed_at,created_at,updated_at)
select ('fc100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'interchange-references-'||n||'@example.test',now(),now(),now()
from generate_series(1,2) n;
insert into public.workspaces(id,name,created_by)
select ('fc200000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'References '||n,'fc100000-0000-4000-8000-000000000001'
from generate_series(1,2) n;
insert into public.workspace_members(workspace_id,user_id,role)
select id,'fc100000-0000-4000-8000-000000000001','owner' from public.workspaces
where id in('fc200000-0000-4000-8000-000000000001','fc200000-0000-4000-8000-000000000002');
insert into public.workspace_members(workspace_id,user_id,role)
values('fc200000-0000-4000-8000-000000000001','fc100000-0000-4000-8000-000000000002','member');
insert into public.pages(id,workspace_id,title,owner_id,restricted)
select ('fc300000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
case when n=4 then 'fc200000-0000-4000-8000-000000000002'::uuid else 'fc200000-0000-4000-8000-000000000001'::uuid end,
'Reference page '||n,'fc100000-0000-4000-8000-000000000001',true from generate_series(1,4) n;
insert into public.databases(id,workspace_id,page_id) values
('fc400000-0000-4000-8000-000000000001','fc200000-0000-4000-8000-000000000001','fc300000-0000-4000-8000-000000000003'),
('fc400000-0000-4000-8000-000000000002','fc200000-0000-4000-8000-000000000002','fc300000-0000-4000-8000-000000000004');
insert into public.page_files(id,workspace_id,page_id,object_path,original_name,mime_type,expected_size,uploaded_by)
values('fc500000-0000-4000-8000-000000000001','fc200000-0000-4000-8000-000000000001','fc300000-0000-4000-8000-000000000001',
'fc200000-0000-4000-8000-000000000001/fc300000-0000-4000-8000-000000000001/fc500000-0000-4000-8000-000000000001',
'receipt.png','image/png',1,'fc100000-0000-4000-8000-000000000001');
insert into public.interchange_jobs(id,workspace_id,actor_id,request_id,request_hash,kind,state,root_page_id,parent_id,source_path,confirmed)
select ('fc600000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('fc200000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
'fc100000-0000-4000-8000-000000000001',('fc700000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,repeat('a',64),'export','complete',
case when n=1 then 'fc300000-0000-4000-8000-000000000001'::uuid else 'fc300000-0000-4000-8000-000000000004'::uuid end,
case when n=1 then 'fc300000-0000-4000-8000-000000000002'::uuid else null end,
'fc200000-0000-4000-8000-'||lpad(n::text,12,'0')||'/fc100000-0000-4000-8000-000000000001/fc600000-0000-4000-8000-'||lpad(n::text,12,'0')||'/source.zip',true
from generate_series(1,2) n;
insert into public.interchange_items(job_id,workspace_id,actor_id,key,index,kind,state,payload,page_id,source_page_id,database_id,file_id)
values('fc600000-0000-4000-8000-000000000001','fc200000-0000-4000-8000-000000000001','fc100000-0000-4000-8000-000000000001',
'receipt',0,'exportPage','done','{"receipt":"immutable"}','fc300000-0000-4000-8000-000000000002','fc300000-0000-4000-8000-000000000001',
'fc400000-0000-4000-8000-000000000001','fc500000-0000-4000-8000-000000000001'),
('fc600000-0000-4000-8000-000000000002','fc200000-0000-4000-8000-000000000002','fc100000-0000-4000-8000-000000000001',
'receipt',0,'exportPage','done','{"receipt":"control"}','fc300000-0000-4000-8000-000000000004','fc300000-0000-4000-8000-000000000004',
'fc400000-0000-4000-8000-000000000002',null);

create function pg_temp.replace_reference(p_table text,p_column text,p_value uuid) returns void language plpgsql as $$
begin
  if p_table='interchange_jobs' then
    execute format('update public.interchange_jobs set %I=$1 where id=$2',p_column) using p_value,'fc600000-0000-4000-8000-000000000001'::uuid;
  elsif p_table='interchange_items' then
    execute format('update public.interchange_items set %I=$1 where job_id=$2',p_column) using p_value,'fc600000-0000-4000-8000-000000000001'::uuid;
  else raise exception 'Invalid test table'; end if;
  -- This retroactively checks the same deferred constraints enforced at COMMIT.
  set constraints all immediate;
end;
$$;
create function pg_temp.delete_reference(p_kind text) returns void language plpgsql as $$
begin
  if p_kind='page' then delete from public.pages where id='fc300000-0000-4000-8000-000000000001';
  elsif p_kind='database' then delete from public.databases where id='fc400000-0000-4000-8000-000000000001';
  elsif p_kind='file' then delete from public.page_files where id='fc500000-0000-4000-8000-000000000001';
  else raise exception 'Invalid test reference'; end if;
  set constraints all immediate;
end;
$$;
create function pg_temp.delete_reference_workspace() returns void language plpgsql as $$
begin
  delete from public.workspaces where id='fc200000-0000-4000-8000-000000000001';
  set constraints all immediate;
end;
$$;

select is((select count(*)::integer from pg_constraint where conrelid in('public.interchange_jobs'::regclass,'public.interchange_items'::regclass)
and contype='f' and confrelid in('public.pages'::regclass,'public.databases'::regclass,'public.page_files'::regclass)
and condeferrable and condeferred and confdeltype='a'),6,'all six metadata references remain NO ACTION and become initially deferred');
select throws_ok($$select pg_temp.replace_reference('interchange_jobs','root_page_id','fc300000-0000-4000-8000-000000000099')$$,'23503',null,'orphaned source fails at the commit-equivalent constraint check');
select throws_ok($$select pg_temp.replace_reference('interchange_jobs','root_page_id','fc300000-0000-4000-8000-000000000004')$$,'23503',null,'source cannot cross workspace at commit');
select throws_ok($$select pg_temp.replace_reference('interchange_jobs','parent_id','fc300000-0000-4000-8000-000000000099')$$,'23503',null,'orphaned destination fails at commit');
select throws_ok($$select pg_temp.replace_reference('interchange_jobs','parent_id','fc300000-0000-4000-8000-000000000004')$$,'23503',null,'destination cannot cross workspace at commit');
select throws_ok($$select pg_temp.replace_reference('interchange_items','page_id','fc300000-0000-4000-8000-000000000099')$$,'23503',null,'orphaned item page fails at commit');
select throws_ok($$select pg_temp.replace_reference('interchange_items','page_id','fc300000-0000-4000-8000-000000000004')$$,'23503',null,'item page cannot cross workspace at commit');
select throws_ok($$select pg_temp.replace_reference('interchange_items','source_page_id','fc300000-0000-4000-8000-000000000099')$$,'23503',null,'orphaned item source fails at commit');
select throws_ok($$select pg_temp.replace_reference('interchange_items','source_page_id','fc300000-0000-4000-8000-000000000004')$$,'23503',null,'item source cannot cross workspace at commit');
select throws_ok($$select pg_temp.replace_reference('interchange_items','database_id','fc400000-0000-4000-8000-000000000099')$$,'23503',null,'orphaned item database fails at commit');
select throws_ok($$select pg_temp.replace_reference('interchange_items','database_id','fc400000-0000-4000-8000-000000000002')$$,'23503',null,'item database cannot cross workspace at commit');
select throws_ok($$select pg_temp.replace_reference('interchange_items','file_id','fc500000-0000-4000-8000-000000000099')$$,'23503',null,'orphaned item file fails at commit');
select throws_ok($$select pg_temp.delete_reference('page')$$,'23503',null,'deleting only the source cannot erase its retained receipt or export evidence');
select throws_ok($$select pg_temp.delete_reference('database')$$,'23503',null,'deleting only a referenced database retains the receipt constraint');
select throws_ok($$select pg_temp.delete_reference('file')$$,'23503',null,'deleting only a referenced file retains the receipt constraint');
select is((select payload->>'receipt' from public.interchange_items where job_id='fc600000-0000-4000-8000-000000000001'),'immutable','failed source deletion preserves its original receipt');

select set_config('request.jwt.claims','{"sub":"fc100000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.get_interchange_job('fc600000-0000-4000-8000-000000000001')$$,'42501',null,'deferred metadata constraints do not expose another actor job');
select throws_ok($$delete from public.interchange_items where job_id='fc600000-0000-4000-8000-000000000001'$$,'42501',null,'clients still cannot erase receipts directly');
reset role;

select lives_ok($$select pg_temp.delete_reference_workspace()$$,'deleting the entire workspace completes all cascade paths before checking metadata links');
select is((select count(*)::integer from public.interchange_jobs where workspace_id='fc200000-0000-4000-8000-000000000001'),0,'workspace deletion removes its jobs');
select is((select count(*)::integer from public.interchange_items where workspace_id='fc200000-0000-4000-8000-000000000001'),0,'workspace deletion removes its item receipts through their job');
select is((select count(*)::integer from public.pages where workspace_id='fc200000-0000-4000-8000-000000000001'),0,'workspace deletion removes all of its pages');
select is((select count(*)::integer from public.page_files where workspace_id='fc200000-0000-4000-8000-000000000001'),0,'workspace deletion removes its file metadata');
select is((select count(*)::integer from public.databases where workspace_id='fc200000-0000-4000-8000-000000000001'),0,'workspace deletion removes its databases');
select is((select count(*)::integer from public.interchange_items where workspace_id='fc200000-0000-4000-8000-000000000002'),1,'another workspace receipt remains intact');
select * from finish();
rollback;
