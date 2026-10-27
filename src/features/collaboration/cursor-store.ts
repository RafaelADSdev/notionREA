import type * as Y from "yjs";
import type { Participant } from "./protocol";

class CursorStore {
  private participants: readonly Participant[] = [];
  private readonly listeners = new Set<() => void>();
  readonly get = () => this.participants;
  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  set(participants: readonly Participant[]): void {
    if (JSON.stringify(participants) === JSON.stringify(this.participants)) return;
    this.participants = participants;
    for (const listener of this.listeners) listener();
  }
}
const stores = new WeakMap<Y.Doc, CursorStore>();
export function cursorStore(document: Y.Doc): CursorStore {
  let store = stores.get(document);
  if (!store) {
    store = new CursorStore();
    stores.set(document, store);
  }
  return store;
}
