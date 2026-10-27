import "server-only";
import { z } from "zod";
import { pageDetailSchema } from "@/features/pages/model/validation";
import { cursorSchema, defaultPropertyValue, parseCursor, parsePropertyValue, parseView } from "../model";
import { uuidSchema } from "../model/properties";
import type { DatabaseData, DatabaseReference, DatabaseRow } from "../types";
import { databaseClient } from "./client";
import {
  checkDatabaseError,
  type DatabaseMetadata,
  DatabaseRequestError,
  decodeCursor,
  decodeRecordCursor,
  encodeCursor,
  parseMetadata,
  parseRow,
  parseServer,
  querySchema,
  referenceListInput,
  referenceSchema,
  revisionSchema,
  toJson,
} from "./validation";

type Client = Awaited<ReturnType<typeof databaseClient>>;
export async function databaseMetadata(client: Client, databaseId: string) {
  const result = await client.rpc("get_database_metadata", { p_database_id: uuidSchema.parse(databaseId) });
  checkDatabaseError(result.error);
  const value = parseServer(() => parseMetadata(result.data));
  if (value.id !== databaseId.toLowerCase()) throw new DatabaseRequestError(503);
  return value;
}
const listCursor = z.strictObject({
  version: z.literal(1),
  scope: uuidSchema,
  query: z.string().max(500),
  afterId: uuidSchema,
});
function afterReference(cursor: string | null | undefined, scope: string, query: string): string | undefined {
  if (!cursor) return;
  const value = listCursor.parse(decodeCursor(cursor));
  if (value.scope !== scope || value.query !== query) throw new DatabaseRequestError(400);
  return value.afterId;
}
function referencePage(items: DatabaseReference[], scope: string, query: string) {
  const shown = items.slice(0, 50);
  const last = shown.at(-1);
  return {
    items: shown,
    nextCursor:
      items.length > 50 && last ? encodeCursor({ version: 1, scope, query, afterId: last.id }) : null,
  };
}
export async function listDatabases(workspaceId: string, input: unknown = {}) {
  const scope = uuidSchema.parse(workspaceId);
  const values = referenceListInput.parse(input);
  const after = afterReference(values.cursor, scope, values.query);
  const client = await databaseClient();
  const result = await client.rpc("list_databases", {
    p_workspace_id: scope,
    p_query: values.query,
    ...(after ? { p_after_id: after } : {}),
  });
  checkDatabaseError(result.error);
  const rows = parseServer(() =>
    z
      .array(z.strictObject({ id: uuidSchema, pageId: uuidSchema, title: z.string().max(500) }))
      .max(51)
      .parse(result.data),
  );
  return referencePage(
    rows.map((row) => ({ id: row.id, label: row.title })),
    scope,
    values.query,
  );
}
export async function findDatabaseReferences(databaseId: string, input: unknown = {}) {
  const scope = uuidSchema.parse(databaseId);
  const values = referenceListInput.parse(input);
  const after = afterReference(values.cursor, scope, values.query);
  const client = await databaseClient();
  const result = await client.rpc("find_database_references", {
    p_database_id: scope,
    p_query: values.query,
    ...(after ? { p_after_id: after } : {}),
  });
  checkDatabaseError(result.error);
  const rows = parseServer(() => z.array(referenceSchema).max(51).parse(result.data));
  return referencePage(rows, scope, values.query);
}
export async function listDatabasePeople(databaseId: string, input: unknown = {}) {
  const scope = uuidSchema.parse(databaseId);
  const values = z.strictObject({ cursor: z.string().max(512).nullable().optional() }).parse(input);
  const after = afterReference(values.cursor, scope, "people");
  const client = await databaseClient();
  const result = await client.rpc("database_people", {
    p_database_id: scope,
    ...(after ? { p_after_id: after } : {}),
  });
  checkDatabaseError(result.error);
  const rows = parseServer(() => z.array(referenceSchema).max(51).parse(result.data));
  return referencePage(rows, scope, "people");
}
const queryResult = z.strictObject({
  rows: z.array(z.unknown()).max(50),
  nextCursor: cursorSchema.nullable(),
  queryKey: z.string().regex(/^[a-f0-9]{64}$/),
  revision: revisionSchema,
  viewId: uuidSchema,
});

export async function loadDatabase(databaseId: string, input: unknown = {}): Promise<DatabaseData> {
  const id = uuidSchema.parse(databaseId);
  const query = querySchema.parse(input);
  const client = await databaseClient();
  const metadata = await databaseMetadata(client, id);
  const saved =
    metadata.views.find((view) => view.id === query.viewId) ?? (query.viewId ? undefined : metadata.views[0]);
  if (!saved) throw new DatabaseRequestError(400);
  const view = parseView(
    {
      id: saved.id,
      name: saved.name,
      type: saved.type,
      visibleProperties: saved.visibleProperties,
      sorts: query.sorts ?? saved.sorts,
      filter: Object.hasOwn(query, "filter") ? query.filter : saved.filter,
      groupBy: Object.hasOwn(query, "groupBy") ? query.groupBy : saved.groupBy,
      datePropertyId: saved.datePropertyId,
    },
    metadata.properties,
  );
  const cursor = query.cursor ? decodeRecordCursor(query.cursor) : null;
  if (cursor) {
    try {
      parseCursor(cursor, {
        viewId: view.id,
        revision: metadata.revision,
        queryKey: cursor.queryKey,
        sorts: view.sorts,
        properties: metadata.properties,
      });
    } catch {
      throw new DatabaseRequestError(409);
    }
  }
  const [result, pageResult, peopleResult, databasesResult] = await Promise.all([
    client.rpc("query_database_records", {
      p_database_id: id,
      p_view_id: view.id,
      ...(Object.hasOwn(query, "filter") ? { p_filter: toJson(view.filter), p_use_filter: true } : {}),
      ...(query.sorts ? { p_sorts: toJson(view.sorts) } : {}),
      ...(Object.hasOwn(query, "groupBy")
        ? { ...(view.groupBy ? { p_group_by: view.groupBy } : {}), p_use_group: true }
        : {}),
      ...(cursor ? { p_cursor: toJson(cursor) } : {}),
      ...(query.month ? { p_month: query.month } : {}),
    }),
    client.rpc("get_page_metadata", { p_workspace_id: metadata.workspaceId, p_page_id: metadata.pageId }),
    client.rpc("database_people", { p_database_id: id }),
    client.rpc("list_databases", { p_workspace_id: metadata.workspaceId, p_query: "" }),
  ]);
  for (const response of [result, pageResult, peopleResult, databasesResult])
    checkDatabaseError(response.error);
  const projected = parseServer(() => queryResult.parse(result.data));
  if (projected.revision !== metadata.revision || projected.viewId !== view.id)
    throw new DatabaseRequestError(409);
  const rows = parseServer(() => projected.rows.map((row) => parseRow(row, metadata.properties)));
  const page = parseServer(() => pageDetailSchema.parse(pageResult.data));
  if (page.id !== metadata.pageId || page.workspace_id !== metadata.workspaceId)
    throw new DatabaseRequestError(503);
  const people = parseServer(() => z.array(referenceSchema).max(51).parse(peopleResult.data)).slice(0, 50);
  const databases = parseServer(() =>
    z
      .array(z.strictObject({ id: uuidSchema, pageId: uuidSchema, title: z.string().max(500) }))
      .max(51)
      .parse(databasesResult.data),
  )
    .slice(0, 50)
    .map(({ id, title }) => ({ id, label: title }));
  const labels = await databaseReferences(client, metadata, rows, people);
  return {
    id,
    workspaceId: metadata.workspaceId,
    pageId: metadata.pageId,
    title: page.title,
    revision: projected.revision,
    editable: metadata.role === "owner" || metadata.role === "editor",
    properties: metadata.properties,
    views: metadata.views,
    templates: metadata.templates,
    viewId: view.id,
    rows,
    nextCursor: projected.nextCursor ? encodeCursor(projected.nextCursor) : null,
    ...labels,
    databases,
  };
}

async function databaseReferences(
  client: Client,
  metadata: DatabaseMetadata,
  rows: readonly DatabaseRow[],
  initialPeople: DatabaseReference[],
) {
  const people = [...initialPeople];
  const relationIds = new Map<string, Set<string>>();
  const personIds = new Set<string>();
  for (const property of metadata.properties)
    if (property.type === "relation" || property.type === "person")
      for (const row of rows) {
        const value = row.values[property.id];
        if (!Array.isArray(value)) continue;
        if (property.type === "person") for (const id of value) personIds.add(id);
        else {
          const ids = relationIds.get(property.config.targetDatabaseId) ?? new Set<string>();
          for (const id of value) ids.add(id);
          relationIds.set(property.config.targetDatabaseId, ids);
        }
      }
  const references: DatabaseReference[] = [];
  for (const [target, selected] of relationIds) {
    const ids = [...selected];
    for (let start = 0; start < ids.length; start += 100) {
      const resolved = await client.rpc("resolve_database_references", {
        p_database_id: target,
        p_record_ids: ids.slice(start, start + 100),
      });
      if (resolved.error?.code === "42501") continue;
      checkDatabaseError(resolved.error);
      references.push(...parseServer(() => z.array(referenceSchema).max(100).parse(resolved.data)));
    }
  }
  const missingPeople = [...personIds].filter((id) => !people.some((person) => person.id === id));
  for (let start = 0; start < missingPeople.length; start += 100) {
    const resolved = await client.rpc("database_people", {
      p_database_id: metadata.id,
      p_user_ids: missingPeople.slice(start, start + 100),
    });
    checkDatabaseError(resolved.error);
    people.push(...parseServer(() => z.array(referenceSchema).max(100).parse(resolved.data)));
  }
  return { people, references };
}

/** A record's ordering revision differs from its page-title and individual-cell revisions. */
export async function loadDatabaseRecord(
  databaseId: string,
  pageId: string,
): Promise<{ data: DatabaseData; row: DatabaseRow }> {
  const id = uuidSchema.parse(databaseId),
    recordId = uuidSchema.parse(pageId);
  const data = await loadDatabase(id);
  const client = await databaseClient();
  const [membership, metadataResult, timesResult, role] = await Promise.all([
    client
      .from("database_records")
      .select("page_id,position,revision,is_template")
      .eq("database_id", id)
      .eq("page_id", recordId)
      .maybeSingle(),
    client.rpc("get_page_metadata", { p_workspace_id: data.workspaceId, p_page_id: recordId }),
    client
      .from("pages")
      .select("created_at,updated_at")
      .eq("id", recordId)
      .eq("workspace_id", data.workspaceId)
      .maybeSingle(),
    client.rpc("get_page_role", { p_page_id: recordId }),
  ]);
  for (const result of [membership, metadataResult, timesResult, role]) checkDatabaseError(result.error);
  if (!membership.data || !timesResult.data || role.data === null) throw new DatabaseRequestError(403);
  const member = membership.data,
    times = timesResult.data;
  const page = parseServer(() => pageDetailSchema.parse(metadataResult.data));
  if (page.id !== recordId || page.workspace_id !== data.workspaceId) throw new DatabaseRequestError(503);
  const values: DatabaseRow["values"] = {},
    cellRevisions: DatabaseRow["cellRevisions"] = {};
  for (const property of data.properties) {
    values[property.id] =
      property.type === "title"
        ? page.title
        : property.type === "createdTime"
          ? timesResult.data.created_at
          : property.type === "editedTime"
            ? timesResult.data.updated_at
            : defaultPropertyValue(property);
    cellRevisions[property.id] = property.type === "title" ? page.revision : 0;
  }
  let bytes = 0;
  const cellSchema = z.strictObject({
    property_id: uuidSchema,
    value: z.unknown(),
    revision: revisionSchema,
  });
  for (let offset = 0; ; offset += 500) {
    const result = await client
      .from("database_cells")
      .select("property_id,value,revision")
      .eq("database_id", id)
      .eq("page_id", recordId)
      .order("property_id")
      .range(offset, offset + 499);
    checkDatabaseError(result.error);
    const cells = parseServer(() => z.array(cellSchema).max(500).parse(result.data));
    for (const cell of cells) {
      const property = data.properties.find((property) => property.id === cell.property_id);
      if (!property) throw new DatabaseRequestError(409);
      bytes += Buffer.byteLength(JSON.stringify(cell.value), "utf8");
      if (bytes > 262144) throw new DatabaseRequestError(503);
      values[property.id] = parseServer(() => parsePropertyValue(property, cell.value));
      cellRevisions[property.id] = cell.revision;
    }
    if (cells.length < 500) break;
  }
  const row = parseServer(() =>
    parseRow(
      {
        id: recordId,
        title: page.title,
        position: member.position,
        revision: member.revision,
        values,
        cellRevisions,
        createdAt: times.created_at,
        editedAt: times.updated_at,
        coverFileId: page.cover_file_id,
      },
      data.properties,
    ),
  );
  const metadata = await databaseMetadata(client, id);
  if (metadata.revision !== data.revision) throw new DatabaseRequestError(409);
  const labels = await databaseReferences(client, metadata, [row], data.people);
  return {
    data: {
      ...data,
      ...labels,
      editable: data.editable && (role.data === "owner" || role.data === "editor"),
      rows: [],
      nextCursor: null,
    },
    row,
  };
}
