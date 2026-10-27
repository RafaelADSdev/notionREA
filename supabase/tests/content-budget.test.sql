begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

-- SQL fixtures prove this privileged persistence boundary; the browser proof
-- uses real validated Yjs/TipTap content with the same 5,000-block projection.
insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select ('fb100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'content-budget-'||n||'@example.test',now(),'{}','{}',now(),now()
from generate_series(1,2) n;
insert into public.workspaces(id,name,created_by)
values('fb200000-0000-4000-8000-000000000001','Canonical bytes','fb100000-0000-4000-8000-000000000001');
insert into public.workspace_members(workspace_id,user_id,role)
select 'fb200000-0000-4000-8000-000000000001',('fb100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
case when n=1 then 'owner' else 'member' end from generate_series(1,2) n;
insert into public.pages(id,workspace_id,title,owner_id,restricted)
values('fb300000-0000-4000-8000-000000000001','fb200000-0000-4000-8000-000000000001','Budget','fb100000-0000-4000-8000-000000000001',true);
insert into public.page_grants(page_id,workspace_id,user_id,role)
values('fb300000-0000-4000-8000-000000000001','fb200000-0000-4000-8000-000000000001','fb100000-0000-4000-8000-000000000002','viewer');
create temporary table budget_fixture(projection jsonb);
insert into budget_fixture
select jsonb_build_object('schemaVersion',1,'text',string_agg(body,E'\n' order by n),'references','[]'::jsonb,'files','[]'::jsonb,
  'blocks',jsonb_agg(jsonb_build_object('id','performance-block-'||lpad(n::text,5,'0'),'type','paragraph','parentId',null,
    'position',lpad(n::text,6,'0')||'U','attributes','{}'::jsonb,'content',jsonb_build_object('type','doc','content',
      jsonb_build_array(jsonb_build_object('type','paragraph','content',jsonb_build_array(jsonb_build_object('type','text','text',body)))))) order by n))
from (select n,rpad(lpad(n::text,5,'0')||':',730,'x') body from generate_series(0,4999) n) rows;
create function pg_temp.budget_commit(p_projection jsonb,p_expected bigint,p_operation integer,p_content boolean default true,
  p_actor uuid default 'fb100000-0000-4000-8000-000000000001') returns bigint language plpgsql as $$
begin
  if p_content then return public.commit_content_document('fb300000-0000-4000-8000-000000000001',p_actor,p_expected,
    md5('content-budget-'||p_operation)::uuid,'\x01',encode(extensions.digest('\x01'::bytea,'sha256'),'hex'),'\x01',p_projection); end if;
  return public.commit_document('fb300000-0000-4000-8000-000000000001',p_actor,p_expected,
    md5('content-budget-'||p_operation)::uuid,'\x01',encode(extensions.digest('\x01'::bytea,'sha256'),'hex'),'\x01',p_projection);
end;
$$;
select ok((select octet_length(projection::text)>8388608 from budget_fixture),'PostgreSQL separator whitespace exceeds 8 MiB for the valid 5,000-block fixture');
grant select on budget_fixture to service_role;
set local role service_role;
select lives_ok($$select pg_temp.budget_commit((select projection from budget_fixture),0,1)$$,
  'a validated compact 8 MiB projection is not rejected for PostgreSQL separator whitespace');
reset role;

-- Compact-byte cases: these follow the concrete old-boundary regression above.
select has_function('private','compact_json_bytes',array['jsonb'],'one private canonical byte meter is shared by all content guards');
select is((select private.compact_json_bytes(projection) from budget_fixture),8315065,'the 5,000-block fixture matches JSON.stringify UTF-8 bytes exactly');
select is(private.compact_json_bytes($json${"a":"  x  y \t\n \"quote\" \\ é 漢 😀 ","b":[1,-2,3.5,true,null,{"c":" a  b "}]}$json$::jsonb),
  octet_length($json${"a":"  x  y \t\n \"quote\" \\ é 漢 😀 ","b":[1,-2,3.5,true,null,{"c":" a  b "}]}$json$),
  'whitespace, escaped quotes, backslashes, Unicode and nested scalar values inside strings are preserved');
select is(private.compact_json_bytes('{ "n" : [1e3, -0, 0.25], "s" : " : , } ] " }'::jsonb),
  octet_length('{"n":[1000,0,0.25],"s":" : , } ] "}'),
  'nested numeric JSON representation and punctuation inside strings are counted without token loss');
select is(private.compact_json_bytes('null'::jsonb),4,'JSON null is a four-byte JSON value');
select is(private.compact_json_bytes(null),null::integer,'SQL null remains null for the existing input guards');
select ok((select provolatile='i' and proisstrict and proparallel='s' from pg_proc where oid='private.compact_json_bytes(jsonb)'::regprocedure),
  'the byte helper is immutable, strict and parallel safe');

create temporary table budget_boundary(projection jsonb);
insert into budget_boundary values(jsonb_build_object('payload',repeat('x',8388608-14)));
select is((select private.compact_json_bytes(projection) from budget_boundary),8388608,'the exact maximum is 8 MiB of canonical JSON bytes');
grant select on budget_boundary to service_role;
set local role service_role;
select lives_ok($$select pg_temp.budget_commit((select projection from budget_boundary),1,2,false)$$,'the underlying durable commit accepts exactly 8 MiB');
select throws_ok($$select pg_temp.budget_commit(jsonb_build_object('payload',repeat('x',8388608-13)),2,3,false)$$,
  '22023','Invalid document payload','the underlying durable commit rejects max plus one byte');
select throws_ok($$select pg_temp.budget_commit(jsonb_build_object('schemaVersion',1,'text',repeat('x',8388608),'references','[]'::jsonb,'files','[]'::jsonb,'blocks','[]'::jsonb),2,3)$$,
  '22023','Invalid document projection','the content commit retains the same 8 MiB ceiling and error code');
select is((select revision from public.document_heads where page_id='fb300000-0000-4000-8000-000000000001'),2::bigint,
  'rejected oversized writes do not advance the durable revision');
select throws_ok($$select pg_temp.budget_commit('{"schemaVersion":1,"text":"","references":[],"files":[],"blocks":[]}',2,3,true,'fb100000-0000-4000-8000-000000000002')$$,
  '42501','Document unavailable','a viewer still cannot commit through the privileged boundary');
reset role;

-- Public projections use the same canonical source budget, while the separate
-- sanitized response/chunk budgets and publication checks remain unchanged.
update budget_boundary set projection=jsonb_build_object('schemaVersion',1,'text','','references','[]'::jsonb,'files','[]'::jsonb,'blocks','[]'::jsonb);
update budget_boundary set projection=jsonb_set(projection,'{text}',to_jsonb(repeat('x',8388608-private.compact_json_bytes(projection))));
update public.document_heads set projection=(select projection from budget_boundary) where page_id='fb300000-0000-4000-8000-000000000001';
insert into public.page_publications(page_id,workspace_id,token,created_by)
values('fb300000-0000-4000-8000-000000000001','fb200000-0000-4000-8000-000000000001',repeat('d',64),'fb100000-0000-4000-8000-000000000001');
set local role anon;
select lives_ok($$select public.read_page_publication(repeat('d',64))$$,'an authorized public source at exactly 8 MiB survives PostgreSQL formatting overhead');
select throws_ok($$select public.commit_document(null,null,0,null,null,null,null,'{}')$$,'42501',null,'anonymous users cannot invoke the durable commit');
select throws_ok($$select private.compact_json_bytes('{}')$$,'42501',null,'anonymous users cannot invoke the private byte helper');
reset role;
update public.document_heads set projection=jsonb_set(projection,'{text}',to_jsonb(projection->>'text'||'x')) where page_id='fb300000-0000-4000-8000-000000000001';
set local role anon;
select throws_ok($$select public.read_page_publication(repeat('d',64))$$,'54000','Published page exceeds response limit','a public source one byte over the canonical limit still fails explicitly');
reset role;
select set_config('request.jwt.claims','{"sub":"fb100000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.commit_content_document(null,null,0,null,null,null,null,'{}')$$,'42501',null,'authenticated clients still cannot bypass server validation');
select throws_ok($$select private.compact_json_bytes('{}')$$,'42501',null,'authenticated users cannot invoke the private helper');
reset role;
select * from finish();
rollback;
