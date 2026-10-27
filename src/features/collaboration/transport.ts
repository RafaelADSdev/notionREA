import { createBrowserClient } from "@supabase/ssr";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/lib/supabase/database.types";
import { leaseSchema, type PresenceLease, type PresencePayload } from "./protocol";

export type RevisionEvent =
  | { kind: "subscribed" | "ready" | "failed" }
  | { kind: "revision"; payload: unknown };
export type PresenceConnection = { close: () => void; track: (payload: PresencePayload) => Promise<void> };
export type CollaborationTransport = {
  revisions: (pageId: string, onEvent: (event: RevisionEvent) => void) => () => void;
  presence: (
    topic: string,
    key: string,
    onState: (state: Record<string, unknown[]>) => void,
  ) => PresenceConnection;
  renew: (pageId: string, participantId: string, signal: AbortSignal) => Promise<PresenceLease>;
};
export class PresenceDenied extends Error {}

export function createCollaborationTransport(): CollaborationTransport {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Realtime configuration unavailable");
  let expiresAt = 0;
  let accessToken = "";
  let authenticating: Promise<void> | null = null;
  const authenticate = async () => {
    if (expiresAt > Date.now() / 1000 + 30) return;
    if (!authenticating)
      authenticating = (async () => {
        const response = await fetch("/api/realtime/session", {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
          signal: AbortSignal.timeout(5000),
        });
        if ([401, 403].includes(response.status)) throw new PresenceDenied();
        if (!response.ok) throw new Error("Realtime authentication unavailable");
        const value = z
          .strictObject({ accessToken: z.string().min(1).max(8192), expiresAt: z.number().int().positive() })
          .parse(await response.json());
        accessToken = value.accessToken;
        expiresAt = value.expiresAt;
      })().finally(() => {
        authenticating = null;
      });
    return authenticating;
  };
  const client = createBrowserClient<Database>(url, key, {
    isSingleton: false,
    accessToken: async () => {
      await authenticate();
      return accessToken;
    },
  });
  const remove = (channel: RealtimeChannel) => {
    void client.removeChannel(channel);
  };
  return {
    revisions(pageId, onEvent) {
      let channel: RealtimeChannel | null = null;
      let closed = false;
      void authenticate()
        .then(async () => {
          await client.realtime.setAuth(accessToken);
          if (closed) return;
          channel = client
            .channel(`page:${pageId}`, {
              config: { private: true, broadcast: { replication_ready: true }, presence: { enabled: false } },
            })
            .on("broadcast", { event: "revision" }, (event) =>
              onEvent({ kind: "revision", payload: event.payload }),
            )
            .on("system", {}, (event) => {
              if (
                event.extension === "system" &&
                event.status === "ok" &&
                event.message === "Replication connection established"
              )
                onEvent({ kind: "ready" });
            })
            .subscribe((status) => {
              if (status === "SUBSCRIBED") onEvent({ kind: "subscribed" });
              else if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) onEvent({ kind: "failed" });
            });
        })
        .catch(() => {
          if (!closed) onEvent({ kind: "failed" });
        });
      return () => {
        closed = true;
        if (channel) remove(channel);
      };
    },
    presence(topic, participantId, onState) {
      let joined = false;
      let current: PresencePayload | null = null;
      let channel: RealtimeChannel | null = null;
      let closed = false;
      void authenticate()
        .then(async () => {
          await client.realtime.setAuth(accessToken);
          if (closed) return;
          const active = client
            .channel(topic, {
              config: { private: true, presence: { key: participantId, enabled: true } },
            })
            .on("presence", { event: "sync" }, () => onState(active.presenceState()))
            .subscribe((status) => {
              joined = status === "SUBSCRIBED";
              if (joined && current) void active.track(current);
              if (!joined) onState({});
            });
          channel = active;
        })
        .catch(() => {
          if (!closed) onState({});
        });
      return {
        close: () => {
          joined = false;
          closed = true;
          current = null;
          if (channel) remove(channel);
        },
        async track(payload) {
          current = payload;
          if (joined && channel) await channel.track(payload);
        },
      };
    },
    async renew(pageId, participantId, signal) {
      await authenticate();
      const response = await fetch(`/api/pages/${encodeURIComponent(pageId)}/presence`, {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ participantId }),
      });
      if ([401, 403, 404].includes(response.status)) throw new PresenceDenied();
      if (!response.ok) throw new Error("Presence unavailable");
      const text = await response.text();
      if (text.length > 65_536) throw new Error("Invalid presence response");
      return leaseSchema.parse(JSON.parse(text));
    },
  };
}
