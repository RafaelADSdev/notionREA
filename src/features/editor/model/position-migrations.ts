import * as Y from "yjs";
import { z } from "zod";

// Public @tiptap/y-tiptap 3.0.10 PositionMigration/store/write contracts.
export const POSITION_MIGRATION_PREFIX = "__tiptap_position_migrations:root:block-content:";
const migrationNamespace = "__tiptap_position_migrations";
const canonicalMapRoots = new Set(["meta", "blocks", "placements", "removed", "attrs", "identities"]);
const maxRecords = 10000;
const maxMetadataBytes = 1024 * 1024;
const maxSourceRange = 8 * 1024 * 1024;
const maxAggregateSourceRange = 4 * maxSourceRange;
const unsigned = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const client = unsigned.max(0xffffffff);
const identity = z.strictObject({ client, clock: unsigned });
const boundary = z.enum(["start", "end"]);
const source = z.strictObject({
  client,
  clock: unsigned,
  length: unsigned.min(1).max(maxSourceRange),
  boundary: boundary.optional(),
});
const target = z.strictObject({
  client,
  clock: unsigned,
  type: identity.nullable(),
  tname: z.string().max(94).optional(),
  assoc: z.union([z.literal(-1), z.literal(0)]).optional(),
  boundary: boundary.optional(),
});
const migrationSchema = z.strictObject({
  version: z.literal(1),
  client,
  clock: unsigned,
  seen: z.array(z.tuple([client, unsigned])).max(maxRecords),
  transfers: z.array(z.strictObject({ source, target: target.nullable() })).max(maxRecords),
});

/** Check root container kinds before any getter materializes an untyped decoded root. */
export function validateRootContainers(document: Y.Doc): void {
  const isMapRoot = (name: string) => canonicalMapRoots.has(name) || name.startsWith(migrationNamespace);
  for (const [name, shared] of document.share) {
    if (
      isMapRoot(name) &&
      (shared instanceof Y.Array || shared instanceof Y.Text || shared instanceof Y.XmlFragment)
    )
      throw new Error("Canonical map root has a different shared type");
    if (
      name.startsWith("block-content:") &&
      (shared instanceof Y.Map || shared instanceof Y.Array || shared instanceof Y.Text)
    )
      throw new Error("Canonical text fragment has a different shared type");
  }
  // A decoded root has no concrete shared-type tag until getMap is called.
  // DecodeUpdate exposes root-name strings not reflected in Item.parent's installed declarations.
  for (const item of Y.decodeUpdate(Y.encodeStateAsUpdate(document)).structs) {
    if (!(item instanceof Y.Item)) continue;
    const parent: unknown = item.parent;
    if (typeof parent !== "string") continue;
    if (isMapRoot(parent) && item.parentSub === null)
      throw new Error("Canonical map roots cannot contain list payloads");
    if (parent.startsWith("block-content:") && item.parentSub !== null)
      throw new Error("Canonical text fragments cannot contain map payloads");
  }
}

/** Validate only the public binding metadata namespace; content roots are validated by its caller. */
export function validatePositionMigrations(document: Y.Doc, blockIds: ReadonlySet<string>): void {
  validateRootContainers(document);
  let records = 0;
  let bytes = 0;
  let sourceRange = 0;
  const encoder = new TextEncoder();
  for (const name of document.share.keys()) {
    if (!name.startsWith(migrationNamespace)) continue;
    const blockId = name.slice(POSITION_MIGRATION_PREFIX.length);
    if (
      !name.startsWith(POSITION_MIGRATION_PREFIX) ||
      !/^[a-zA-Z0-9_-]{1,80}$/.test(blockId) ||
      !blockIds.has(blockId)
    )
      throw new Error("Unknown position migration root");
    // getMap also materializes the public map type after decoding a Yjs update.
    // It rejects an existing root whose shared type is not a map.
    const store = document.getMap<unknown>(name);
    if (!(store instanceof Y.Map) || store.size > maxRecords)
      throw new Error("Invalid position migration store");
    records += 1 + store.size;
    bytes += encoder.encode(name).byteLength;
    for (const [key, value] of store) {
      if (!/^(0|[1-9][0-9]{0,9}):(0|[1-9][0-9]{0,15})$/.test(key))
        throw new Error("Invalid position migration identity");
      const migration = migrationSchema.parse(value);
      if (key !== `${migration.client}:${migration.clock}`)
        throw new Error("Position migration identity mismatch");
      records += migration.seen.length + migration.transfers.length;
      bytes += encoder.encode(key).byteLength + encoder.encode(JSON.stringify(migration)).byteLength;
      for (const transfer of migration.transfers) {
        const { source, target } = transfer;
        if (source.length - 1 > Number.MAX_SAFE_INTEGER - source.clock)
          throw new Error("Position migration source range overflow");
        if (target) {
          if (target.tname !== undefined && target.tname !== `block-content:${blockId}`)
            throw new Error("Cross-fragment position migration target");
          if (source.length - 1 > Number.MAX_SAFE_INTEGER - target.clock)
            throw new Error("Position migration target range overflow");
        }
        sourceRange += source.length;
      }
      if (sourceRange > maxAggregateSourceRange) throw new Error("Position migration range budget exceeded");
      if (records > maxRecords || bytes > maxMetadataBytes)
        throw new Error("Position migration metadata budget exceeded");
    }
    if (records > maxRecords || bytes > maxMetadataBytes)
      throw new Error("Position migration metadata budget exceeded");
  }
}
