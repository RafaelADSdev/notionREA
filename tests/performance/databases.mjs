import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { connectLocalDatabase, localDatabaseUrl } from "../integration/local-database.ts";

const connection = localDatabaseUrl(); // Refuses anything except the isolated 55322 database.
const admin = await connectLocalDatabase(connection);
const reader = await connectLocalDatabase(connection);
const owner = randomUUID(), workspace = randomUUID(), numberProperty = randomUUID();
const email = `database-performance-${owner}@example.test`;
try {
  await admin.query("set statement_timeout='60s'");
  await admin.query("insert into auth.users(id,email,email_confirmed_at,created_at,updated_at) values($1,$2,now(),now(),now())", [owner,email]);
  await admin.query("insert into public.workspaces(id,name,created_by) values($1,'Database performance fixture',$2)",[workspace,owner]);
  await admin.query("insert into public.workspace_members(workspace_id,user_id,role) values($1,$2,'owner')",[workspace,owner]);
  await reader.query("set role authenticated");
  await reader.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:owner,role:"authenticated"})]);
  const created = await reader.query("select public.create_database($1,null,'Scale fixture',$2) as data",[workspace,randomUUID()]);
  const {id:databaseId,pageId} = created.rows[0].data;
  const viewId = (await admin.query("select id from public.database_views where database_id=$1",[databaseId])).rows[0].id;
  const titleProperty = (await admin.query("select id from public.database_properties where database_id=$1 and type='title'",[databaseId])).rows[0].id;
  await admin.query("insert into public.database_properties(id,workspace_id,database_id,name,type,position) values($1,$2,$3,'Quantity','number','W')",[numberProperty,workspace,databaseId]);
  for(let start=1;start<=50000;start+=1000){
  await admin.query(`with added as (
    insert into public.pages(workspace_id,parent_id,owner_id,created_by,title,position)
    select $1,$2,$3,$3,'Record '||lpad(n::text,5,'0'),lpad(to_hex(n*1024),16,'0')||'V' from generate_series($5::integer,$5::integer+999) n returning id,position
  ) insert into public.database_records(database_id,page_id,workspace_id,position) select $4,id,$1,position from added`,[workspace,pageId,owner,databaseId,start]);
  // Keep planner statistics representative while growing a fresh synthetic table scope.
  if(start===1||start%5000===1)await admin.query("analyze public.pages");
  }
  await admin.query(`insert into public.database_cells(database_id,page_id,property_id,workspace_id,value)
    select $1,r.page_id,$2,$3,to_jsonb((row_number() over(order by r.position collate "C"))::text) from public.database_records r where r.database_id=$1`,[databaseId,numberProperty,workspace]);
  await admin.query("analyze public.pages");
  await admin.query("analyze public.database_records");
  await admin.query("analyze public.database_cells");
  const sql = "select public.query_database_records($1,$2,$3,true,$4,$5) as data";
  const cases = [
    {name:"manual-first",filter:null,sorts:[]},
    {name:"title-descending",filter:null,sorts:[{propertyId:titleProperty,direction:"desc"}]},
    {name:"numeric-filter-sort",filter:{kind:"condition",propertyId:numberProperty,operator:"gte",value:"49000"},sorts:[{propertyId:numberProperty,direction:"asc"}]},
  ];
  const results=[];
  for(const scenario of cases){
    const args=[databaseId,viewId,scenario.filter,JSON.stringify(scenario.sorts),null];
    const first=(await reader.query(sql,args)).rows[0].data;
    if(first.rows.length!==50||!first.nextCursor)throw Error("Expected a bounded first page and keyset cursor");
    for(const [suffix,cursor] of [["first",null],["next",first.nextCursor]]){
      const samples=[];
      for(let i=0;i<12;i++){
        const start=performance.now();const result=(await reader.query(sql,[...args.slice(0,4),cursor])).rows[0].data;
        if(result.rows.length!==50||new Set(result.rows.map(row=>row.id)).size!==50)throw Error("Unexpected page size or duplicate record");
        if(cursor&&result.rows.some(row=>first.rows.some(previous=>previous.id===row.id)))throw Error("Keyset pagination repeated a record");
        samples.push(performance.now()-start);
      }
      samples.sort((a,b)=>a-b);
      results.push({scenario:`${scenario.name}/${suffix}`,samples:samples.length,p95Ms:Math.round(samples[11]*10)/10});
    }
  }
  console.info(JSON.stringify({fixtureRecords:50000,transport:"loopback PostgreSQL, authenticated owner, warm cache, no throttling",results}));
  if(results.some(result=>result.p95Ms>500))process.exitCode=1;
} finally {
  await admin.query("delete from public.workspaces where id=$1 and created_by=$2 and name='Database performance fixture'",[workspace,owner]);
  await admin.query("delete from auth.users where id=$1 and email=$2",[owner,email]);
  await Promise.all([reader.end(),admin.end()]);
}
