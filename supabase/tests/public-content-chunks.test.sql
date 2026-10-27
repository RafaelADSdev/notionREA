begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('fa100000-0000-4000-8000-000000000001','public-chunks@example.test',now(),'{}','{}',now(),now());
insert into public.workspaces(id,name,created_by)
values('fa200000-0000-4000-8000-000000000001','Chunks','fa100000-0000-4000-8000-000000000001');
insert into public.workspace_members(workspace_id,user_id,role)
values('fa200000-0000-4000-8000-000000000001','fa100000-0000-4000-8000-000000000001','owner');
insert into public.pages(id,workspace_id,title,owner_id,restricted)
values('fa300000-0000-4000-8000-000000000001','fa200000-0000-4000-8000-000000000001','Source','fa100000-0000-4000-8000-000000000001',true),
('fa300000-0000-4000-8000-000000000002','fa200000-0000-4000-8000-000000000001','Current target','fa100000-0000-4000-8000-000000000001',true),
('fa300000-0000-4000-8000-000000000003','fa200000-0000-4000-8000-000000000001','Secret target','fa100000-0000-4000-8000-000000000001',true);
insert into public.page_publications(page_id,workspace_id,token,created_by)
select id,workspace_id,case when title='Source' then repeat('a',64) else repeat('b',64) end,owner_id from public.pages
where id in ('fa300000-0000-4000-8000-000000000001','fa300000-0000-4000-8000-000000000002');
insert into public.document_heads(page_id,workspace_id,projection)
values('fa300000-0000-4000-8000-000000000001','fa200000-0000-4000-8000-000000000001',
'{"schemaVersion":1,"text":"Conteúdo indisponível","files":[],"references":["fa300000-0000-4000-8000-000000000002","fa300000-0000-4000-8000-000000000003"],"blocks":[{"id":"paragraph","type":"paragraph","parentId":null,"position":"U","attributes":{},"content":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Conteúdo indisponível"},{"type":"pageMention","attrs":{"pageId":"fa300000-0000-4000-8000-000000000003"}},{"type":"pageMention","attrs":{"pageId":"fa300000-0000-4000-8000-000000000002"}},{"type":"pageMention","attrs":{"pageId":"fa300000-0000-4000-8000-000000000002"}}]}]}}]}');
set local role anon;
select set_config('chunks.small',public.read_page_publication(repeat('a',64))::text,true);
select is(current_setting('chunks.small')::jsonb#>>'{content,blocks,0,content,content,0,content,0,text}','Conteúdo indisponível','authored text identical to a fallback is preserved literally');
select is(current_setting('chunks.small')::jsonb#>'{content,blocks,0,content,content,0,content,1}','{"type":"unavailable"}'::jsonb,'hidden reference uses a semantic marker without private identity');
select is(jsonb_array_length(current_setting('chunks.small')::jsonb#>'{content,references}'),1,'repeated mentions share one authorized current label');
select is(current_setting('chunks.small')::jsonb#>>'{content,references,0,title}','Current target','reference dictionary resolves current public title');
select ok(not(current_setting('chunks.small')::jsonb->'content' ? 'chunked'),'small publications keep a direct content DTO');
reset role;
update public.document_heads set projection=jsonb_set(jsonb_set(projection,'{text}',to_jsonb(repeat('a',4100000))),'{blocks,0,content,content,0,content,0,text}',to_jsonb(repeat('a',4100000)))
where page_id='fa300000-0000-4000-8000-000000000001';
select ok((select octet_length(projection::text) between 8000000 and 8388608 from public.document_heads where page_id='fa300000-0000-4000-8000-000000000001'),'fixture approaches the full canonical 8 MiB budget');
set local role anon;
select set_config('chunks.manifest',(public.read_page_publication(repeat('a',64))#>'{content,chunked}')::text,true);
select ok((current_setting('chunks.manifest')::jsonb->>'byteLength')::int>4000000,'large authorized content is represented by an exact-length manifest');
select is(octet_length(decode(public.read_public_content_chunk(repeat('a',64),current_setting('chunks.manifest')::jsonb->>'hash',0)->>'data','base64')),262144,'each ordinary transfer slice is exactly 256 KiB');
select is((select encode(extensions.digest(string_agg(decode(public.read_public_content_chunk(repeat('a',64),current_setting('chunks.manifest')::jsonb->>'hash',n)->>'data','base64'),''::bytea order by n),'sha256'),'hex')
from generate_series(0,(current_setting('chunks.manifest')::jsonb->>'chunks')::int-1) n),current_setting('chunks.manifest')::jsonb->>'hash','all ordered slices reassemble the complete manifest hash');
select throws_ok($$select public.read_public_content_chunk(repeat('a',64),repeat('c',64),0)$$,'40001',null,'a stale or mismatched projection hash cannot be mixed into a transfer');
select throws_ok($$select public.read_public_content_chunk(repeat('a',64),current_setting('chunks.manifest')::jsonb->>'hash',192)$$,'22023',null,'chunk indexes have an absolute derived bound');
reset role;
update public.pages set title='Renamed current target' where id='fa300000-0000-4000-8000-000000000002';
set local role anon;
select throws_ok($$select public.read_public_content_chunk(repeat('a',64),current_setting('chunks.manifest')::jsonb->>'hash',0)$$,'40001',null,'changing a referenced label invalidates the previous transfer hash');
reset role;
update public.page_publications set revoked_at=now() where page_id='fa300000-0000-4000-8000-000000000001';
set local role anon;
select is(public.read_public_content_chunk(repeat('a',64),current_setting('chunks.manifest')::jsonb->>'hash',0),null::jsonb,'revocation denies every subsequent chunk read immediately');
reset role;
select * from finish();
rollback;
