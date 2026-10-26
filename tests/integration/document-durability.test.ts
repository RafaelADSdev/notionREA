// @vitest-environment node
import { createHash, randomUUID } from "node:crypto";
import type { Client } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { StablePage } from "../../src/features/editor/model/stable-page";
import { connectLocalDatabase, localDatabaseUrl } from "./local-database";

type Fixture = {
  workspaceId: string;
  pageId: string;
  ownerId: string;
  editorId: string;
  requestId: string;
  name: string;
  emails: string[];
};
type Replica = { document: Y.Doc; page: StablePage; actor: string };
type Head = {
  revision: string;
  snapshot: Buffer;
  projection: { text: string; order: string[] };
  compacted_through: string;
};
type Update = { revision: string; payload: Buffer | null; operation_id: string };
type Candidate = { snapshot: Uint8Array; projection: { text: string; order: string[] } };
let admin: Client;
let firstWriter: Client;
let secondWriter: Client;
let reader: Client;
const fixtures: Fixture[] = [];
const replicas: Replica[] = [];
const connections: Client[] = [];

function replica(snapshot: Uint8Array | undefined, actor: string): Replica {
  const document = new Y.Doc();
  if (snapshot) Y.applyUpdate(document, snapshot);
  const page = new StablePage(document, actor);
  const result = { document, page, actor };
  replicas.push(result);
  return result;
}

function textNode(peer: Replica): Y.XmlText {
  const paragraph = peer.page.fragment("subject").get(0);
  if (!(paragraph instanceof Y.XmlElement)) throw new Error("Fixture paragraph missing");
  const text = paragraph.get(0);
  if (!(text instanceof Y.XmlText)) throw new Error("Fixture text missing");
  return text;
}

function append(peer: Replica, value: string): void {
  peer.document.transact(() => {
    const text = textNode(peer);
    text.insert(text.length, value);
  }, peer.actor);
}

function candidate(base: Uint8Array, update?: Uint8Array): Candidate {
  const peer = replica(base, "server-validation");
  if (update) Y.applyUpdate(peer.document, update);
  peer.page.validate();
  return {
    snapshot: Y.encodeStateAsUpdate(peer.document),
    projection: {
      text: textNode(peer).toString(),
      order: peer.page.visibleChildren().map((block) => block.id),
    },
  };
}

async function createFixture(): Promise<Fixture> {
  const ownerId = randomUUID();
  const editorId = randomUUID();
  const requestId = randomUUID();
  const fixture = {
    workspaceId: randomUUID(),
    pageId: randomUUID(),
    ownerId,
    editorId,
    requestId,
    name: `Durability fixture ${requestId}`,
    emails: [`durability-${ownerId}@example.test`, `durability-${editorId}@example.test`],
  };
  await admin.query("begin");
  try {
    await admin.query(
      "insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values ($1,$2,now(),'{}','{}',now(),now()),($3,$4,now(),'{}','{}',now(),now())",
      [ownerId, fixture.emails[0], editorId, fixture.emails[1]],
    );
    await admin.query("insert into public.workspaces(id,name,created_by,request_id) values ($1,$2,$3,$4)", [
      fixture.workspaceId,
      fixture.name,
      ownerId,
      requestId,
    ]);
    await admin.query(
      "insert into public.workspace_members(workspace_id,user_id,role) values ($1,$2,'owner'),($1,$3,'member')",
      [fixture.workspaceId, ownerId, editorId],
    );
    await admin.query(
      "insert into public.pages(id,workspace_id,title,owner_id) values ($1,$2,'Durability fixture',$3)",
      [fixture.pageId, fixture.workspaceId, ownerId],
    );
    await admin.query(
      "insert into public.page_grants(page_id,workspace_id,user_id,role) values ($1,$2,$3,'editor')",
      [fixture.pageId, fixture.workspaceId, editorId],
    );
    await admin.query("commit");
  } catch (error) {
    await admin.query("rollback");
    throw error;
  }
  fixtures.push(fixture);
  return fixture;
}

async function commit(
  client: Client,
  fixture: Fixture,
  actorId: string,
  revision: number,
  operationId: string,
  update: Uint8Array,
  state: Candidate,
): Promise<number> {
  const result = await client.query<{ revision: string }>(
    "select public.commit_document($1,$2,$3,$4,$5,$6,$7,$8::jsonb) as revision",
    [
      fixture.pageId,
      actorId,
      revision,
      operationId,
      Buffer.from(update),
      createHash("sha256").update(update).digest("hex"),
      Buffer.from(state.snapshot),
      JSON.stringify(state.projection),
    ],
  );
  const accepted = result.rows[0];
  if (!accepted) throw new Error("Commit did not return a revision");
  return Number(accepted.revision);
}

async function head(client: Client, fixture: Fixture): Promise<Head> {
  const result = await client.query<Head>(
    "select revision,snapshot,projection,compacted_through from public.document_heads where page_id=$1",
    [fixture.pageId],
  );
  const current = result.rows[0];
  if (!current) throw new Error("Expected an authorized durable document head");
  return current;
}

async function actAs(userId: string): Promise<void> {
  await reader.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ sub: userId, role: "authenticated" }),
  ]);
}

async function seed(fixture: Fixture): Promise<Head> {
  const peer = replica(undefined, "seed");
  peer.page.createBlock({ id: "first", type: "paragraph", parentId: null, position: "a" });
  peer.page.createBlock({ id: "subject", type: "paragraph", parentId: null, position: "m" });
  peer.page.createBlock({ id: "last", type: "paragraph", parentId: null, position: "z" });
  const paragraph = new Y.XmlElement("paragraph");
  paragraph.insert(0, [new Y.XmlText("Beta")]);
  peer.page.fragment("subject").insert(0, [paragraph]);
  const snapshot = Y.encodeStateAsUpdate(peer.document);
  await commit(firstWriter, fixture, fixture.ownerId, 0, randomUUID(), snapshot, candidate(snapshot));
  return head(firstWriter, fixture);
}

beforeAll(async () => {
  const connectionString = localDatabaseUrl();
  const connect = async () => {
    const client = await connectLocalDatabase(connectionString);
    connections.push(client);
    return client;
  };
  [admin, firstWriter, secondWriter, reader] = await Promise.all([
    connect(),
    connect(),
    connect(),
    connect(),
  ]);
  await Promise.all([
    firstWriter.query("set role service_role"),
    secondWriter.query("set role service_role"),
    reader.query("set role authenticated"),
  ]);
}, 30_000);

afterEach(async () => {
  await reader.query("rollback");
  for (const peer of replicas.splice(0)) {
    peer.page.destroy();
    peer.document.destroy();
  }
  for (const fixture of fixtures.splice(0)) {
    const ownership = await admin.query(
      "select id from public.workspaces where id=$1 and created_by=$2 and request_id=$3 and name=$4",
      [fixture.workspaceId, fixture.ownerId, fixture.requestId, fixture.name],
    );
    if (ownership.rowCount !== 1)
      throw new Error("Fixture cleanup refused: workspace ownership marker changed");
    await admin.query(
      "delete from public.workspaces where id=$1 and created_by=$2 and request_id=$3 and name=$4",
      [fixture.workspaceId, fixture.ownerId, fixture.requestId, fixture.name],
    );
    await admin.query("delete from auth.users where id=any($1::uuid[]) and email=any($2::text[])", [
      [fixture.ownerId, fixture.editorId],
      fixture.emails,
    ]);
  }
});

afterAll(async () => {
  await Promise.all(connections.map((client) => client.end()));
});

describe("real local Postgres document durability", () => {
  it("retries a stale concurrent commit by merging its real Yjs update into the fresh durable head", async () => {
    const fixture = await createFixture();
    const initial = await seed(fixture);
    const moving = replica(initial.snapshot, "moving-peer");
    const editing = replica(initial.snapshot, "editing-peer");
    const baseVector = Y.encodeStateVector(moving.document);
    moving.page.moveBlock("subject", null, "zz");
    append(editing, "-remote");
    const changes = [
      Y.encodeStateAsUpdate(moving.document, baseVector),
      Y.encodeStateAsUpdate(editing.document, baseVector),
    ] as const;
    const operations = [randomUUID(), randomUUID()] as const;
    const outcomes = await Promise.allSettled([
      commit(
        firstWriter,
        fixture,
        fixture.ownerId,
        1,
        operations[0],
        changes[0],
        candidate(initial.snapshot, changes[0]),
      ),
      commit(
        secondWriter,
        fixture,
        fixture.editorId,
        1,
        operations[1],
        changes[1],
        candidate(initial.snapshot, changes[1]),
      ),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    const failedIndex = outcomes.findIndex((outcome) => outcome.status === "rejected");
    const rejected = outcomes[failedIndex];
    expect(rejected?.status).toBe("rejected");
    if (rejected?.status !== "rejected") throw new Error("Expected one concurrent CAS conflict");
    expect(rejected.reason).toMatchObject({ code: "40001" });
    const missingUpdate = changes[failedIndex];
    const missingOperation = operations[failedIndex];
    if (!missingUpdate || !missingOperation) throw new Error("Missing retry identity");
    const fresh = await head(firstWriter, fixture);
    expect(Number(fresh.revision)).toBe(2);
    const merged = candidate(fresh.snapshot, missingUpdate);
    const actor = failedIndex === 0 ? fixture.ownerId : fixture.editorId;
    expect(await commit(secondWriter, fixture, actor, 2, missingOperation, missingUpdate, merged)).toBe(3);
    const durable = await head(firstWriter, fixture);
    const reloaded = replica(durable.snapshot, "reloaded");
    expect(textNode(reloaded).toString()).toBe("Beta-remote");
    expect(reloaded.page.visibleChildren().map((block) => block.id)).toEqual(["first", "last", "subject"]);
    expect(durable.projection).toEqual({ text: "Beta-remote", order: ["first", "last", "subject"] });
    Y.applyUpdate(moving.document, durable.snapshot);
    Y.applyUpdate(editing.document, durable.snapshot);
    expect(moving.page.visibleChildren()).toEqual(editing.page.visibleChildren());
    expect(textNode(moving).toString()).toBe(textNode(editing).toString());
  });

  it("survives a lost acknowledgement and retries the same operation after payload compaction", async () => {
    const fixture = await createFixture();
    const initial = await seed(fixture);
    const peer = replica(initial.snapshot, "author");
    const vector = Y.encodeStateVector(peer.document);
    append(peer, "-accepted");
    const update = Y.encodeStateAsUpdate(peer.document, vector);
    const state = candidate(initial.snapshot, update);
    const operation = randomUUID();
    await commit(firstWriter, fixture, fixture.editorId, 1, operation, update, state);
    expect(await commit(secondWriter, fixture, fixture.editorId, 1, operation, update, state)).toBe(2);
    await firstWriter.query("select public.compact_document($1,$2,$3)", [
      fixture.pageId,
      2,
      Buffer.from(state.snapshot),
    ]);
    expect(await commit(secondWriter, fixture, fixture.editorId, 1, operation, update, state)).toBe(2);
    const receipts = await firstWriter.query<{ total: string; payloads: string }>(
      "select count(*) as total,count(payload) as payloads from public.document_updates where page_id=$1",
      [fixture.pageId],
    );
    expect(receipts.rows[0]).toEqual({ total: "2", payloads: "0" });
    const durable = await head(firstWriter, fixture);
    expect(Number(durable.revision)).toBe(2);
    expect(textNode(replica(durable.snapshot, "reloaded")).toString()).toBe("Beta-accepted");
    const changed = new Uint8Array([1, 2, 3]);
    await expect(
      commit(secondWriter, fixture, fixture.editorId, 2, operation, changed, state),
    ).rejects.toMatchObject({ code: "22023" });
  });

  it("catches up from durable updates without notifications and falls back to the head after compaction", async () => {
    const fixture = await createFixture();
    const initial = await seed(fixture);
    const author = replica(initial.snapshot, "author");
    const vector = Y.encodeStateVector(author.document);
    append(author, "-missed");
    let update = Y.encodeStateAsUpdate(author.document, vector);
    await commit(
      firstWriter,
      fixture,
      fixture.ownerId,
      1,
      randomUUID(),
      update,
      candidate(initial.snapshot, update),
    );
    const second = await head(firstWriter, fixture);
    const secondVector = Y.encodeStateVector(author.document);
    author.page.moveBlock("subject", null, "zz");
    update = Y.encodeStateAsUpdate(author.document, secondVector);
    await commit(
      firstWriter,
      fixture,
      fixture.ownerId,
      2,
      randomUUID(),
      update,
      candidate(second.snapshot, update),
    );
    await actAs(fixture.editorId);
    const missed = await reader.query<Update>(
      "select revision,payload,operation_id from public.document_updates where page_id=$1 and revision>$2 order by revision",
      [fixture.pageId, 1],
    );
    const stale = replica(initial.snapshot, "missed-notifications");
    for (const row of missed.rows) {
      if (!row.payload) throw new Error("Unexpected compacted tail");
      Y.applyUpdate(stale.document, row.payload);
    }
    expect(textNode(stale).toString()).toBe("Beta-missed");
    expect(stale.page.visibleChildren().map((block) => block.id)).toEqual(["first", "last", "subject"]);
    const durable = await head(firstWriter, fixture);
    await secondWriter.query("select public.compact_document($1,$2,$3)", [
      fixture.pageId,
      3,
      durable.snapshot,
    ]);
    const checkpoint = await head(reader, fixture);
    expect(Number(checkpoint.compacted_through)).toBe(3);
    const fallback = replica(checkpoint.snapshot, "checkpoint-fallback");
    expect(textNode(fallback).toString()).toBe("Beta-missed");
    expect(fallback.page.visibleChildren()).toEqual(stale.page.visibleChildren());
  });

  it("keeps bootstrap consistent while another session compacts and commits a newer revision", async () => {
    const fixture = await createFixture();
    const initial = await seed(fixture);
    await actAs(fixture.editorId);
    await reader.query("begin isolation level repeatable read");
    const bootstrap = await head(reader, fixture);
    await firstWriter.query("select public.compact_document($1,$2,$3)", [
      fixture.pageId,
      1,
      initial.snapshot,
    ]);
    const author = replica(initial.snapshot, "concurrent-author");
    const vector = Y.encodeStateVector(author.document);
    append(author, "-during-bootstrap");
    const update = Y.encodeStateAsUpdate(author.document, vector);
    await commit(
      secondWriter,
      fixture,
      fixture.ownerId,
      1,
      randomUUID(),
      update,
      candidate(initial.snapshot, update),
    );
    const sameSnapshot = await head(reader, fixture);
    expect(Number(sameSnapshot.revision)).toBe(1);
    const historicalTail = await reader.query<Update>(
      "select revision,payload,operation_id from public.document_updates where page_id=$1 and revision>$2 order by revision",
      [fixture.pageId, 0],
    );
    expect(historicalTail.rows).toHaveLength(1);
    expect(historicalTail.rows[0]?.payload).not.toBeNull();
    await reader.query("commit");
    const bootstrapped = replica(bootstrap.snapshot, "bootstrapped");
    const catchup = await reader.query<Update>(
      "select revision,payload,operation_id from public.document_updates where page_id=$1 and revision>$2 order by revision",
      [fixture.pageId, bootstrap.revision],
    );
    expect(catchup.rows).toHaveLength(1);
    for (const row of catchup.rows) {
      if (!row.payload) throw new Error("Unexpected gap after bootstrap");
      Y.applyUpdate(bootstrapped.document, row.payload);
    }
    expect(textNode(bootstrapped).toString()).toBe("Beta-during-bootstrap");
    expect(Number((await head(reader, fixture)).revision)).toBe(2);
  });

  it("rechecks current ACL for durable reads and privileged writes after the actor is revoked", async () => {
    const fixture = await createFixture();
    const initial = await seed(fixture);
    await actAs(fixture.editorId);
    await reader.query("begin");
    expect(Number((await head(reader, fixture)).revision)).toBe(1);
    await admin.query("delete from public.workspace_members where workspace_id=$1 and user_id=$2", [
      fixture.workspaceId,
      fixture.editorId,
    ]);
    const denied = await reader.query("select page_id from public.document_heads where page_id=$1", [
      fixture.pageId,
    ]);
    expect(denied.rows).toHaveLength(0);
    const deniedTail = await reader.query("select revision from public.document_updates where page_id=$1", [
      fixture.pageId,
    ]);
    expect(deniedTail.rows).toHaveLength(0);
    const peer = replica(initial.snapshot, "revoked");
    const vector = Y.encodeStateVector(peer.document);
    append(peer, "-unauthorized");
    const update = Y.encodeStateAsUpdate(peer.document, vector);
    await expect(
      commit(
        firstWriter,
        fixture,
        fixture.editorId,
        1,
        randomUUID(),
        update,
        candidate(initial.snapshot, update),
      ),
    ).rejects.toMatchObject({ code: "42501" });
    expect(Number((await head(firstWriter, fixture)).revision)).toBe(1);
    await reader.query("commit");
  });
});
