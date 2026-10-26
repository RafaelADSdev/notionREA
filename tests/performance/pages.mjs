import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { connectLocalDatabase, localDatabaseUrl } from "../integration/local-database.ts";

const database = localDatabaseUrl();
const admin = await connectLocalDatabase(database);
const reader = await connectLocalDatabase(database);
const owner = randomUUID(),
  workspace = randomUUID(),
  member = randomUUID();
const email = `performance-${owner}@example.test`;
try {
  await admin.query(
    "insert into auth.users(id,email,email_confirmed_at,created_at,updated_at) values($1,$2,now(),now(),now())",
    [owner, email],
  );
  await admin.query(
    "insert into public.workspaces(id,name,created_by) values($1,'Page performance fixture',$2)",
    [workspace, owner],
  );
  await admin.query("insert into public.workspace_members(workspace_id,user_id,role) values($1,$2,'owner')", [
    workspace,
    owner,
  ]);
  await admin.query(
    "insert into auth.users(id,email,email_confirmed_at,created_at,updated_at) values($1,$2,now(),now(),now())",
    [member, `performance-${member}@example.test`],
  );
  await admin.query(
    "insert into public.workspace_members(workspace_id,user_id,role) values($1,$2,'member')",
    [workspace, member],
  );
  await admin.query(
    "insert into public.pages(workspace_id,owner_id,created_by,title) select $1,$2,$2,case when n%199=0 then 'Órbita pesquisa de materiais '||n else 'Caderno de campo '||n end from generate_series(1,10000) n",
    [workspace, owner],
  );
  await reader.query("set role authenticated");
  await reader.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ sub: owner, role: "authenticated" }),
  ]);
  const results = [];
  async function measure(scenario, sql, args, expectedCount) {
    await reader.query(sql, args);
    const samples = [];
    for (let i = 0; i < 20; i++) {
      const start = performance.now();
      const result = await reader.query(sql, args);
      if (result.rows.length > 51 || (expectedCount !== undefined && result.rows.length !== expectedCount))
        throw Error("Unexpected authorized lookahead page");
      samples.push(performance.now() - start);
    }
    samples.sort((a, b) => a - b);
    results.push({
      scenario,
      samples: 20,
      p95Ms: Math.round(samples[18] * 10) / 10,
      maxMs: Math.round(samples[19] * 10) / 10,
    });
  }
  for (const term of ["orbita", "campo", ""]) {
    await measure(
      `owner/${term || "recent"}`,
      "select id from public.search_pages($1,$2)",
      [workspace, term],
      term === "orbita" ? 50 : 51,
    );
  }
  await measure("owner/10000-roots", "select id from public.list_page_children($1)", [workspace], 51);
  const {
    rows: [root],
  } = await admin.query("select id from public.pages where workspace_id=$1 order by id limit 1", [workspace]);
  await admin.query(
    "with numbered as (select id,row_number() over(order by id) as n from public.pages where workspace_id=$1 and id<>$2) update public.pages p set parent_id=$2,restricted=(n.n%11=0) from numbered n where p.id=n.id",
    [workspace, root.id],
  );
  await admin.query(
    "insert into public.page_grants(workspace_id,page_id,user_id,role) values($1,$2,$3,'viewer')",
    [workspace, root.id, member],
  );
  await reader.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ sub: member, role: "authenticated" }),
  ]);
  for (const term of ["orbita", "campo", ""]) {
    await measure(
      `member/${term || "recent"}`,
      "select id from public.search_pages($1,$2)",
      [workspace, term],
      term === "orbita" ? undefined : 51,
    );
  }
  await measure(
    "member/inherited-children",
    "select id from public.list_page_children($1,$2)",
    [workspace, root.id],
    51,
  );
  // Inspect only IDs returned to the authenticated member, without changing its claims.
  const memberIds = await reader.query("select id from public.search_pages($1,'campo')", [workspace]);
  const forbidden = await admin.query(
    "select count(*)::integer as count from public.pages where id=any($1::uuid[]) and restricted and id<>$2",
    [memberIds.rows.map((row) => row.id), root.id],
  );
  if (forbidden.rows[0].count) throw Error("Restricted descendants leaked into search");
  console.info(
    JSON.stringify({
      fixturePages: 10000,
      transport: "loopback Postgres, warm cache, no throttling",
      results,
    }),
  );
  if (results.some((result) => result.p95Ms > 500)) process.exitCode = 1;
} finally {
  await admin.query(
    "delete from public.workspaces where id=$1 and created_by=$2 and name='Page performance fixture'",
    [workspace, owner],
  );
  await admin.query("delete from auth.users where id=$1 and email=$2", [owner, email]);
  await admin.query("delete from auth.users where id=$1 and email=$2", [
    member,
    `performance-${member}@example.test`,
  ]);
  await Promise.all([reader.end(), admin.end()]);
}
