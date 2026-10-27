import type { EditorSession } from "@/features/editor/client/editor-session";
import {
  CATCH_UP_MS,
  CURSOR_INTERVAL_MS,
  type Participant,
  PRESENCE_LEASE_MS,
  type PresenceLease,
  participantColor,
  participantsFromState,
  revisionSchema,
  type SharedCursor,
  validCursor,
} from "./protocol";
import { type CollaborationTransport, type PresenceConnection, PresenceDenied } from "./transport";

export type CollaborationSnapshot = {
  connection: "connecting" | "ready" | "catching-up" | "denied";
  presenceAvailable: boolean;
  participants: readonly Participant[];
};
export const EMPTY_COLLABORATION: CollaborationSnapshot = {
  connection: "connecting",
  presenceAvailable: false,
  participants: [],
};
type Session = Pick<EditorSession, "pageId" | "actor" | "getStatus" | "subscribeStatus" | "provider">;

/** Realtime is an invalidation hint. Every document read goes through the durable, authorized provider. */
export class PageCollaboration {
  private snapshot: CollaborationSnapshot = EMPTY_COLLABORATION;
  private readonly listeners = new Set<() => void>();
  private stopped = false;
  private closeRevision: (() => void) | null = null;
  private presence: PresenceConnection | null = null;
  private lease: PresenceLease | null = null;
  private state: Record<string, unknown[]> = {};
  private cursor: SharedCursor | null = null;
  private renewing = false;
  private reading = false;
  private ready = false;
  private attempts = 0;
  private generation = 0;
  private presenceGeneration = 0;
  private request: AbortController | null = null;
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private interval: ReturnType<typeof setInterval> | null = null;
  private expiry: ReturnType<typeof setInterval> | null = null;
  private unsubscribe: (() => void) | null = null;
  private lastCursor = -Infinity;
  private lastPresencePayload = "";
  private cursorTimer: ReturnType<typeof setTimeout> | null = null;
  private lastRead = -Infinity;
  private lastRoster = -Infinity;
  private rosterTimer: ReturnType<typeof setTimeout> | null = null;
  private readTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly session: Session,
    private readonly transport: CollaborationTransport,
  ) {}
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  readonly getSnapshot = (): CollaborationSnapshot => this.snapshot;
  private update(connection: CollaborationSnapshot["connection"] = this.snapshot.connection): void {
    if (this.stopped && connection !== "denied") return;
    const participants = this.lease
      ? participantsFromState(this.lease, this.state, this.session.actor, Date.now())
      : [];
    const presenceAvailable = this.lease !== null;
    if (
      connection === this.snapshot.connection &&
      presenceAvailable === this.snapshot.presenceAvailable &&
      JSON.stringify(participants) === JSON.stringify(this.snapshot.participants)
    )
      return;
    this.snapshot = { connection, presenceAvailable, participants };
    for (const listener of this.listeners) listener();
  }
  private later(callback: () => void, delay: number): ReturnType<typeof setTimeout> {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      if (!this.stopped) callback();
    }, delay);
    this.timers.add(timer);
    return timer;
  }
  private terminal(): boolean {
    return ["denied", "unsupported"].includes(this.session.getStatus());
  }
  start(): void {
    if (this.stopped || this.interval !== null) return;
    if (this.terminal()) {
      this.deny();
      return;
    }
    let previous = this.session.getStatus();
    this.unsubscribe = this.session.subscribeStatus(() => {
      const wasLoading = previous === "loading";
      previous = this.session.getStatus();
      if (this.terminal()) this.deny();
      else if (wasLoading && previous !== "loading") {
        this.catchUp();
        void this.renew();
      }
    });
    // Subscribe first; a fresh read on subscription closes the initial bootstrap window.
    this.joinRevision();
    void this.renew();
    this.interval = setInterval(() => {
      this.catchUp();
      void this.renew();
    }, CATCH_UP_MS);
    this.expiry = setInterval(() => {
      if (this.lease && Date.parse(this.lease.expiresAt) <= Date.now()) this.dropPresence();
      else this.update();
    }, 1_000);
  }
  private joinRevision(): void {
    if (this.stopped || this.terminal()) return;
    const generation = ++this.generation;
    this.closeRevision?.();
    this.closeRevision = null;
    this.ready = false;
    this.closeRevision = this.transport.revisions(this.session.pageId, (event) => {
      if (this.stopped || generation !== this.generation) return;
      if (event.kind === "revision") {
        const value = revisionSchema.safeParse(event.payload);
        if (value.success && value.data.revision > this.session.provider.revision) this.catchUp();
      } else if (event.kind === "ready") {
        this.ready = true;
        this.attempts = 0;
        this.update("ready");
        this.catchUp();
      } else if (event.kind === "subscribed") {
        this.update(this.ready ? "ready" : "catching-up");
        this.catchUp();
      } else {
        this.ready = false;
        this.update("catching-up");
      }
    });
    // SUBSCRIBED alone does not establish replication readiness (ADR-017).
    this.later(() => {
      if (generation !== this.generation || this.ready) return;
      if (++this.attempts < 3) this.joinRevision();
      else this.update("catching-up"); // Polling stays active after bounded handshakes.
    }, 5_000);
  }
  readonly catchUp = (): void => {
    if (this.stopped || this.terminal() || this.session.getStatus() === "loading") return;
    if (this.reading || this.readTimer !== null) return;
    const delay = Math.max(0, 500 - (Date.now() - this.lastRead));
    this.readTimer = this.later(() => {
      this.readTimer = null;
      this.reading = true;
      this.lastRead = Date.now();
      void this.session.provider
        .synchronize()
        .catch(() => undefined)
        .finally(() => {
          this.reading = false;
          if (this.terminal()) this.deny();
        });
    }, delay);
  };
  private dropPresence(): void {
    this.presenceGeneration++;
    this.presence?.close();
    this.presence = null;
    this.lease = null;
    this.state = {};
    this.lastPresencePayload = "";
    this.update();
  }
  private async renew(): Promise<void> {
    if (this.stopped || this.renewing || this.terminal() || this.session.getStatus() === "loading") return;
    this.renewing = true;
    this.lastRoster = Date.now();
    const request = new AbortController();
    this.request = request;
    const timeout = this.later(() => request.abort(), 5_000);
    try {
      const next = await this.transport.renew(this.session.pageId, this.session.actor, request.signal);
      if (this.stopped || request.signal.aborted) return;
      const remaining = Date.parse(next.expiresAt) - Date.now();
      if (remaining <= 0 || remaining > PRESENCE_LEASE_MS + 1_000) throw new Error("Invalid presence lease");
      if (!this.lease || next.epoch !== this.lease.epoch) {
        this.dropPresence();
        this.lease = next;
        const presenceGeneration = this.presenceGeneration;
        this.presence = this.transport.presence(
          `page-presence:${this.session.pageId}:${next.epoch}`,
          this.session.actor,
          (state) => {
            if (this.stopped || this.presenceGeneration !== presenceGeneration) return;
            this.state = state;
            this.update();
            if (
              Object.keys(state).some(
                (id) => !this.lease?.participants.some((person) => person.participantId === id),
              ) &&
              this.rosterTimer === null
            ) {
              this.rosterTimer = this.later(
                () => {
                  this.rosterTimer = null;
                  void this.renew();
                },
                Math.max(0, 1000 - (Date.now() - this.lastRoster)),
              );
            }
          },
        );
      } else this.lease = next;
      this.update();
      this.sendCursor();
    } catch (error) {
      if (!this.stopped) {
        this.dropPresence();
        if (error instanceof PresenceDenied) {
          // An access response is authoritative. Start the provider's own denial path
          // directly, since stopping this controller cancels scheduled catch-up work.
          void this.session.provider.synchronize().catch(() => undefined);
          this.deny();
        }
      }
    } finally {
      clearTimeout(timeout);
      this.timers.delete(timeout);
      if (this.request === request) this.request = null;
      this.renewing = false;
    }
  }
  readonly publishCursor = (value: SharedCursor | null): void => {
    if (this.stopped) return;
    const next = value === null ? null : validCursor(value);
    if (value !== null && !next) return;
    if (JSON.stringify(next) === JSON.stringify(this.cursor)) return;
    this.cursor = next;
    if (this.cursorTimer !== null) return;
    this.cursorTimer = this.later(
      () => {
        this.cursorTimer = null;
        this.sendCursor();
      },
      Math.max(0, CURSOR_INTERVAL_MS - (Date.now() - this.lastCursor)),
    );
  };
  private sendCursor(): void {
    if (!this.presence || !this.lease || Date.parse(this.lease.expiresAt) <= Date.now()) return;
    const payload = {
      participantId: this.session.actor,
      color: participantColor(this.session.actor),
      cursor: this.cursor,
    };
    const signature = JSON.stringify(payload);
    if (signature === this.lastPresencePayload) return;
    const delay = Math.max(0, CURSOR_INTERVAL_MS - (Date.now() - this.lastCursor));
    if (delay > 0) {
      if (this.cursorTimer === null)
        this.cursorTimer = this.later(() => {
          this.cursorTimer = null;
          this.sendCursor();
        }, delay);
      return;
    }
    this.lastCursor = Date.now();
    this.lastPresencePayload = signature;
    const generation = this.presenceGeneration;
    void this.presence.track(payload).catch(() => {
      if (!this.stopped && generation === this.presenceGeneration) this.dropPresence();
    });
  }
  private deny(): void {
    if (this.stopped) return;
    this.stop();
    this.update("denied");
  }
  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.generation++;
    this.request?.abort();
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.closeRevision?.();
    this.closeRevision = null;
    this.presence?.close();
    this.presence = null;
    this.lease = null;
    this.state = {};
    if (this.interval !== null) clearInterval(this.interval);
    if (this.expiry !== null) clearInterval(this.expiry);
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
  }
}
