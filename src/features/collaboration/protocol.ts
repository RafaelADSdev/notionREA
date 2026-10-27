import * as Y from "yjs";
import { z } from "zod";

export const PRESENCE_LEASE_MS = 30_000;
export const CATCH_UP_MS = 10_000;
export const CURSOR_INTERVAL_MS = 1_000;
const identifier = z.union([z.uuid(), z.literal("initial")]);
const encoded = z
  .string()
  .min(4)
  .max(512)
  .regex(/^[A-Za-z0-9+/]+={0,2}$/);
export const cursorSchema = z.strictObject({ blockId: identifier, anchor: encoded, head: encoded });
export type SharedCursor = z.infer<typeof cursorSchema>;
export const revisionSchema = z.strictObject({
  revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  id: z.uuid().optional(),
});
export const leaseSchema = z.strictObject({
  epoch: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  expiresAt: z.iso.datetime({ offset: true }),
  participants: z
    .array(
      z.strictObject({
        participantId: z.uuid(),
        label: z.string().min(1).max(120),
        expiresAt: z.iso.datetime({ offset: true }),
      }),
    )
    .max(256),
});
export type PresenceLease = z.infer<typeof leaseSchema>;
export const presenceSchema = z.strictObject({
  participantId: z.uuid(),
  color: z.enum(["indigo", "copper", "green", "yellow"]),
  cursor: cursorSchema.nullable(),
  presence_ref: z.string().max(200).optional(),
});
export type PresencePayload = Omit<z.infer<typeof presenceSchema>, "presence_ref">;
export type Participant = {
  participantId: string;
  label: string;
  expiresAt: number;
  color: PresencePayload["color"];
  cursor: SharedCursor | null;
};
const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const encodePosition = (position: Y.RelativePosition) => toBase64(Y.encodeRelativePosition(position));

/** Only structural Yjs positions are accepted; canonical encoding rejects trailing payload bytes. */
export function decodePosition(value: string, blockId: string): Y.RelativePosition | null {
  try {
    if (!encoded.safeParse(value).success) return null;
    const position = Y.decodeRelativePosition(Uint8Array.from(atob(value), (c) => c.charCodeAt(0)));
    if (encodePosition(position) !== value) return null;
    if (position.tname !== null && position.tname !== `block-content:${blockId}`) return null;
    for (const item of [position.type, position.item])
      if (
        item &&
        (!Number.isSafeInteger(item.client) ||
          !Number.isSafeInteger(item.clock) ||
          item.client < 0 ||
          item.clock < 0)
      )
        return null;
    if (!Number.isSafeInteger(position.assoc) || Math.abs(position.assoc) > 1) return null;
    return position;
  } catch {
    return null;
  }
}
export function validCursor(value: unknown): SharedCursor | null {
  const result = cursorSchema.safeParse(value);
  if (!result.success) return null;
  const cursor = result.data;
  return decodePosition(cursor.anchor, cursor.blockId) && decodePosition(cursor.head, cursor.blockId)
    ? cursor
    : null;
}
export function encodeCursor(
  blockId: string,
  selection: { anchor: Y.RelativePosition; head: Y.RelativePosition },
): SharedCursor | null {
  return validCursor({
    blockId,
    anchor: encodePosition(selection.anchor),
    head: encodePosition(selection.head),
  });
}
export function participantColor(id: string): PresencePayload["color"] {
  const colors = ["indigo", "copper", "green", "yellow"] as const;
  return (
    colors[Array.from(id).reduce((sum, char) => sum + char.charCodeAt(0), 0) % colors.length] ?? "indigo"
  );
}
/** Labels and expiration come only from the authorized HTTP roster, never from a socket payload. */
export function participantsFromState(
  lease: PresenceLease,
  state: Record<string, unknown[]>,
  self: string,
  now: number,
): Participant[] {
  const result: Participant[] = [];
  for (const entry of lease.participants) {
    if (entry.participantId === self || Date.parse(entry.expiresAt) <= now) continue;
    const tracks = state[entry.participantId];
    if (!Array.isArray(tracks) || tracks.length > 10) continue;
    const track = tracks
      .map((value) => presenceSchema.safeParse(value))
      .findLast((value) => value.success && value.data.participantId === entry.participantId);
    if (!track?.success) continue;
    result.push({
      participantId: entry.participantId,
      label: entry.label,
      expiresAt: Date.parse(entry.expiresAt),
      color: participantColor(entry.participantId),
      cursor: validCursor(track.data.cursor),
    });
  }
  return result;
}
