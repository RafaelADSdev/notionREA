// @vitest-environment node
import { randomUUID } from "node:crypto";
import type { Client } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { connectLocalDatabase, localDatabaseUrl } from "./local-database";

type MoveResult = {
  moved: boolean;
  requires_confirmation: boolean;
  affected_pages: number;
  preview_hash: string | null;
};
type Fixture = {
  workspace: string;
  owner: string;
  editor: string;
  viewer: string;
  marker: string;
  pages: [string, string, string, string];
  emails: string[];
};
const connections: Client[] = [];
const fixtures: Fixture[] = [];
let admin: Client;
let first: Client;
let second: Client;
let observer: Client;

async function claims(client: Client, user: string) {
  await client.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ sub: user, role: "authenticated" }),
  ]);
}

async function fixture(): Promise<Fixture> {
  const owner = randomUUID(),
    editor = randomUUID(),
    viewer = randomUUID(),
    marker = randomUUID();
  const value: Fixture = {
    workspace: randomUUID(),
    owner,
    editor,
    viewer,
    marker,
    pages: [randomUUID(), randomUUID(), randomUUID(), randomUUID()],
    emails: [owner, editor, viewer].map((id) => `page-race-${id}@example.test`),
  };
  await admin.query("begin");
  try {
    for (const [index, id] of [owner, editor, viewer].entries()) {
      await admin.query(
        "insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values($1,$2,now(),'{}','{}',now(),now())",
        [id, value.emails[index]],
      );
    }
    await admin.query(
      "insert into public.workspaces(id,name,created_by,request_id) values($1,'Page concurrency fixture',$2,$3)",
      [value.workspace, owner, marker],
    );
    await admin.query(
      "insert into public.workspace_members(workspace_id,user_id,role) values($1,$2,'owner'),($1,$3,'member'),($1,$4,'member')",
      [value.workspace, owner, editor, viewer],
    );
    for (const [index, id] of value.pages.entries()) {
      await admin.query(
        "insert into public.pages(id,workspace_id,owner_id,title,position) values($1,$2,$3,$4,$5)",
        [id, value.workspace, owner, `Page ${index}`, ["A", "G", "M", "T"][index]],
      );
      await admin.query(
        "insert into public.page_grants(page_id,workspace_id,user_id,role) values($1,$2,$3,'editor')",
        [id, value.workspace, editor],
      );
    }
    await admin.query("commit");
  } catch (error) {
    await admin.query("rollback");
    throw error;
  }
  fixtures.push(value);
  await Promise.all([claims(first, owner), claims(second, owner)]);
  return value;
}

async function move(
  client: Client,
  page: string,
  parent: string | null,
  before: string | null,
  revision: number,
  accept = false,
  hash: string | null = null,
): Promise<MoveResult> {
  const response = await client.query<{ result: MoveResult }>(
    "select public.move_page($1,$2,$3,$4,$5,$6) as result",
    [page, parent, before, revision, accept, hash],
  );
  const result = response.rows[0]?.result;
  if (!result) throw new Error("Move returned no result");
  return result;
}

async function assertAcyclic(value: Fixture) {
  const response = await admin.query<{ id: string; parent_id: string | null }>(
    "select id,parent_id from public.pages where workspace_id=$1",
    [value.workspace],
  );
  const parents = new Map(response.rows.map((row) => [row.id, row.parent_id]));
  for (const row of response.rows) {
    const seen = new Set<string>();
    let id: string | null = row.id;
    while (id !== null) {
      expect(seen.has(id)).toBe(false);
      seen.add(id);
      id = parents.get(id) ?? null;
    }
  }
}

beforeAll(async () => {
  const connectionString = localDatabaseUrl();
  const clients = await Promise.all(
    Array.from({ length: 4 }, async () => {
      const client = await connectLocalDatabase(connectionString);
      connections.push(client);
      return client;
    }),
  );
  if (!clients[0] || !clients[1] || !clients[2] || !clients[3])
    throw new Error("Page race connections unavailable");
  [admin, first, second, observer] = [clients[0], clients[1], clients[2], clients[3]];
  await Promise.all([first.query("set role authenticated"), second.query("set role authenticated")]);
});

afterEach(async () => {
  await admin.query("rollback");
  await admin.query("reset role");
  for (const value of fixtures.splice(0)) {
    const match = await admin.query(
      "select id from public.workspaces where id=$1 and created_by=$2 and request_id=$3 and name='Page concurrency fixture'",
      [value.workspace, value.owner, value.marker],
    );
    if (match.rowCount !== 1) throw new Error("Page race fixture ownership changed; cleanup refused");
    await admin.query("delete from public.workspaces where id=$1 and created_by=$2 and request_id=$3", [
      value.workspace,
      value.owner,
      value.marker,
    ]);
    await admin.query("delete from auth.users where id=any($1::uuid[]) and email=any($2::text[])", [
      [value.owner, value.editor, value.viewer],
      value.emails,
    ]);
  }
});
afterAll(async () => {
  await Promise.all(connections.map((client) => client.end()));
});

describe("real concurrent page mutations", () => {
  it("accepts only one side of simultaneous opposite moves and leaves an acyclic tree", async () => {
    const value = await fixture();
    const [a, b] = value.pages;
    const outcomes = await Promise.allSettled([move(first, a, b, null, 0), move(second, b, a, null, 0)]);
    expect(outcomes.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((result) => result.status === "rejected")).toHaveLength(1);
    const rejected = outcomes.find((result) => result.status === "rejected");
    if (rejected?.status === "rejected") expect(rejected.reason).toMatchObject({ code: "23514" });
    await assertAcyclic(value);
  });

  it("allocates distinct fractional positions for simultaneous creations and same-interval moves", async () => {
    const value = await fixture();
    const [a, b, c, d] = value.pages;
    const createSequence = async (client: Client, offset: number) => {
      for (let index = 0; index < 4; index += 1) {
        await client.query("select public.create_page($1,$2,$3,$4)", [
          value.workspace,
          a,
          `Concurrent ${index + offset}`,
          randomUUID(),
        ]);
      }
    };
    await Promise.all([createSequence(first, 0), createSequence(second, 4)]);
    const created = await admin.query<{ id: string; position: string }>(
      'select id,position from public.pages where parent_id=$1 order by position collate "C",id',
      [a],
    );
    expect(created.rows).toHaveLength(8);
    expect(new Set(created.rows.map((row) => row.position)).size).toBe(8);
    const anchor = created.rows[0]?.id;
    if (!anchor) throw new Error("Concurrent children missing");
    const moved = await Promise.all([move(first, c, a, anchor, 0), move(second, d, a, anchor, 0)]);
    expect(moved.every((result) => result.moved)).toBe(true);
    const siblings = await admin.query<{ id: string; position: string }>(
      'select id,position from public.pages where parent_id=$1 order by position collate "C",id',
      [a],
    );
    expect(new Set(siblings.rows.map((row) => row.position)).size).toBe(10);
    expect(new Set(siblings.rows.slice(0, 2).map((row) => row.id))).toEqual(new Set([c, d]));
    const samePage = await Promise.allSettled([move(first, c, b, null, 1), move(second, c, null, null, 1)]);
    expect(samePage.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const stale = samePage.find((result) => result.status === "rejected");
    if (stale?.status === "rejected") expect(stale.reason).toMatchObject({ code: "40001" });
    await assertAcyclic(value);
  });

  it("rechecks membership after waiting on the workspace lock during revocation", async () => {
    const value = await fixture();
    const [a, , c] = value.pages;
    await claims(second, value.editor);
    const backend = await second.query<{ pid: number }>("select pg_backend_pid() as pid");
    const pid = backend.rows[0]?.pid;
    if (!pid) throw new Error("Synthetic editor backend missing");
    await admin.query("begin");
    await admin.query("select id from public.workspaces where id=$1 for update", [value.workspace]);
    await admin.query("select set_config('request.jwt.claims',$1,true)", [
      JSON.stringify({ sub: value.owner, role: "authenticated" }),
    ]);
    await admin.query("set local role authenticated");
    await admin.query("select public.remove_member($1,$2)", [value.workspace, value.editor]);
    const pending = move(second, c, a, null, 0).then(
      (result) => ({ result, error: null }),
      (error: unknown) => ({ result: null, error }),
    );
    try {
      await expect
        .poll(
          async () =>
            (
              await observer.query<{ wait_event_type: string | null }>(
                "select wait_event_type from pg_stat_activity where pid=$1",
                [pid],
              )
            ).rows[0]?.wait_event_type,
        )
        .toBe("Lock");
    } finally {
      await admin.query("commit");
    }
    const rejected = await pending;
    expect(rejected.error).toMatchObject({ code: "42501" });
    const unchanged = await admin.query<{ parent_id: string | null; revision: string }>(
      "select parent_id,revision from public.pages where id=$1",
      [c],
    );
    expect(unchanged.rows[0]).toEqual({ parent_id: null, revision: "0" });
  });

  it("rejects a stale ACL preview and requires renewed consent against the current capability matrix", async () => {
    const value = await fixture();
    const [a, b, c] = value.pages;
    await admin.query("update public.pages set parent_id=$1,restricted=false where id=$2", [a, c]);
    await admin.query(
      "insert into public.page_grants(page_id,workspace_id,user_id,role) values($1,$2,$3,'viewer')",
      [a, value.workspace, value.viewer],
    );
    const preview = await move(first, c, b, null, 0);
    expect(preview).toMatchObject({ moved: false, requires_confirmation: true });
    expect(preview.preview_hash).toMatch(/^[a-f0-9]{64}$/);
    await admin.query("begin");
    await admin.query("select id from public.workspaces where id=$1 for update", [value.workspace]);
    await admin.query("update public.page_grants set role='commenter' where page_id=$1 and user_id=$2", [
      a,
      value.viewer,
    ]);
    await admin.query("commit");
    await expect(move(second, c, b, null, 0, true, preview.preview_hash)).rejects.toMatchObject({
      code: "40001",
    });
    const fresh = await move(first, c, b, null, 0);
    expect(fresh.preview_hash).not.toBe(preview.preview_hash);
    expect(await move(second, c, b, null, 0, true, fresh.preview_hash)).toMatchObject({
      moved: true,
      requires_confirmation: false,
    });
    await assertAcyclic(value);
  });
});
