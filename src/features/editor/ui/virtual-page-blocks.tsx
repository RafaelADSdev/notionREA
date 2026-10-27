"use client";
import {
  createContext,
  type ReactNode,
  type Ref,
  type RefCallback,
  useCallback,
  useContext,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useState,
  useSyncExternalStore,
} from "react";
import { flushSync } from "react-dom";
import {
  buildVirtualBlockIndex,
  protectedVirtualBlocks,
  type VirtualBlock,
  type VirtualBlockIndex,
  type VirtualBlockSegment,
  virtualBlockWindow,
  virtualSelectionIds,
  virtualVisibleOrder,
} from "../model/virtualization";

type Viewport = { top: number; height: number };
type Protection = {
  focused: string | null;
  composing: string | null;
  requested: string | null;
  dragging: string | null;
  selected: readonly string[];
  nativeSelection: readonly string[];
};
function ownerBlock(node: Node | null): string | null {
  return (
    (node instanceof Element ? node : node?.parentElement)?.closest<HTMLElement>("[data-editor-block]")
      ?.dataset.editorBlock ?? null
  );
}
function frameFor(id: string): HTMLElement | undefined {
  return [...document.querySelectorAll<HTMLElement>("[data-editor-block],[data-block-text]")].find(
    (frame) => frame.dataset.editorBlock === id || frame.dataset.blockText === id,
  );
}

/** Browser-only view state. It never reads or mutates Yjs content. */
class BlockViewportStore {
  index: VirtualBlockIndex;
  readonly collapsed = new Set<string>();
  private protection: Protection = {
    focused: null,
    composing: null,
    requested: null,
    dragging: null,
    selected: [],
    nativeSelection: [],
  };
  private pinned = new Set<string>();
  private heights = new Map<string, number>();
  private listeners = new Set<() => void>();
  private containers = new Map<string, HTMLElement>();
  private bounds = new Map<string, Viewport>();
  private rows = new Map<Element, string>();
  private rowElements = new Map<string, HTMLElement>();
  private observer: ResizeObserver | null = null;
  private version = 0;
  private scheduled: number | null = null;
  private source: readonly VirtualBlock[];
  private dragCursor: string | null = null;
  constructor(
    blocks: readonly VirtualBlock[],
    readonly pageId: string,
  ) {
    this.source = blocks;
    this.index = buildVirtualBlockIndex(blocks);
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  snapshot = () => this.version;
  private publish() {
    this.version++;
    for (const listener of this.listeners) listener();
  }
  private protect() {
    this.pinned = protectedVirtualBlocks(this.index, this.protection);
    this.publish();
  }
  get protectedIds(): ReadonlySet<string> {
    return this.pinned;
  }
  height = (id: string) => this.heights.get(id) ?? this.index.estimatedHeight(id);
  viewport = (key: string): Viewport => this.bounds.get(key) ?? { top: 0, height: 900 };
  visibleIds = () => virtualVisibleOrder(this.index, this.collapsed);
  update(blocks: readonly VirtualBlock[], selected: readonly string[], dragging: string | null) {
    let changed = false;
    if (blocks !== this.source) {
      const previous = this.index;
      this.source = blocks;
      this.index = buildVirtualBlockIndex(blocks);
      const invalid = new Set<string>();
      const invalidate = (start: string, index: VirtualBlockIndex) => {
        let id: string | null | undefined = start;
        while (id && !invalid.has(id)) {
          invalid.add(id);
          this.heights.delete(id);
          id = index.parents.get(id);
        }
      };
      for (const id of this.index.order) {
        if (
          previous.parents.get(id) !== this.index.parents.get(id) ||
          previous.types.get(id) !== this.index.types.get(id) ||
          (previous.children.get(id) ?? []).join("\0") !== (this.index.children.get(id) ?? []).join("\0")
        ) {
          invalidate(id, previous);
          // New ancestry may differ even after the old path was invalidated.
          this.heights.delete(id);
          const parent = this.index.parents.get(id);
          if (parent) invalidate(parent, this.index);
        }
      }
      changed = true;
      for (const id of this.heights.keys()) if (!this.index.parents.has(id)) this.heights.delete(id);
      for (const id of this.collapsed) if (!this.index.parents.has(id)) this.collapsed.delete(id);
    }
    if (selected.join("\0") !== this.protection.selected.join("\0")) {
      this.protection.selected = selected;
      changed = true;
    }
    if (dragging !== this.protection.dragging) {
      this.protection.dragging = dragging;
      this.dragCursor = dragging;
      changed = true;
    }
    if (changed) {
      this.protect();
      this.schedule();
    }
  }
  focus(id: string | null) {
    if (!id || !this.index.parents.has(id) || this.protection.focused === id) return;
    this.protection.focused = id;
    if (this.protection.requested === id) this.protection.requested = null;
    this.protect();
  }
  compose(id: string | null) {
    if (id !== this.protection.composing) {
      this.protection.composing = id;
      this.protect();
    }
  }
  captureSelection() {
    const selection = document.getSelection();
    const first = ownerBlock(selection?.anchorNode ?? null),
      last = ownerBlock(selection?.focusNode ?? null);
    if (!first || !last || !this.index.parents.has(first) || !this.index.parents.has(last)) return;
    const ids = selection?.isCollapsed ? [] : virtualSelectionIds(this.index, first, last, this.collapsed);
    if (ids.join("\0") !== this.protection.nativeSelection.join("\0")) {
      this.protection.nativeSelection = ids;
      this.protect();
    }
  }
  setCollapsed(id: string, value: boolean) {
    if (!this.index.parents.has(id) || this.collapsed.has(id) === value) return;
    if (value) this.collapsed.add(id);
    else this.collapsed.delete(id);
    this.publish();
    this.schedule();
  }
  reveal(id: string): boolean {
    if (!this.index.parents.has(id)) return false;
    let parent = this.index.parents.get(id);
    while (parent) {
      this.collapsed.delete(parent);
      parent = this.index.parents.get(parent);
    }
    this.protection.requested = id;
    this.protect();
    this.schedule();
    return true;
  }
  async revealAndScroll(id: string): Promise<boolean> {
    let revealed = false;
    flushSync(() => {
      revealed = this.reveal(id);
    });
    if (!revealed) return false;
    for (let frame = 0; frame < 3; frame++) {
      const element = frameFor(id);
      if (element) {
        element.scrollIntoView({ block: "nearest" });
        this.schedule();
        return true;
      }
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    return false;
  }
  advanceKeyboardDrag(direction: 1 | -1) {
    const id = this.dragCursor;
    if (!this.protection.dragging || !id) return;
    const siblings = this.index.children.get(this.index.parents.get(id) ?? null) ?? [];
    const target = siblings[siblings.indexOf(id) + direction];
    if (target) {
      this.dragCursor = target;
      void this.revealAndScroll(target);
    }
  }
  registerContainer(key: string, element: HTMLElement | null) {
    if (element) {
      this.containers.set(key, element);
      this.readBounds(key, element);
      this.schedule();
    } else {
      this.containers.delete(key);
      this.bounds.delete(key);
    }
  }
  private readBounds(key: string, element: HTMLElement): boolean {
    const rect = element.getBoundingClientRect();
    let start = 0,
      end = window.innerHeight;
    // The shell may scroll in its own region, rather than the document viewport.
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      if (!/(auto|scroll|hidden|clip)/.test(getComputedStyle(parent).overflowY)) continue;
      const bounds = parent.getBoundingClientRect();
      start = Math.max(start, bounds.top);
      end = Math.min(end, bounds.bottom);
    }
    const next = { top: start - rect.top, height: Math.max(0, end - start) },
      previous = this.bounds.get(key);
    if (previous && Math.abs(previous.top - next.top) < 1 && previous.height === next.height) return false;
    this.bounds.set(key, next);
    return true;
  }
  measure(id: string, element: HTMLElement | null) {
    const previous = this.rowElements.get(id);
    if (previous) {
      this.rows.delete(previous);
      this.observer?.unobserve(previous);
      this.rowElements.delete(id);
    }
    if (element) {
      this.rowElements.set(id, element);
      this.rows.set(element, id);
      this.observer?.observe(element);
      const height = element.getBoundingClientRect().height;
      if (height > 0 && Math.abs(this.height(id) - height) >= 1) {
        this.heights.set(id, height);
        this.schedule();
      }
    }
  }
  schedule = () => {
    if (this.scheduled !== null || typeof requestAnimationFrame !== "function") return;
    this.scheduled = requestAnimationFrame(() => {
      this.scheduled = null;
      for (const [key, element] of this.containers) this.readBounds(key, element);
      this.publish();
    });
  };
  connect() {
    if (typeof ResizeObserver !== "undefined") {
      this.observer = new ResizeObserver((entries) => {
        let changed = false;
        for (const entry of entries) {
          const id = this.rows.get(entry.target),
            height = entry.target.getBoundingClientRect().height;
          if (id && height > 0 && Math.abs(this.height(id) - height) >= 1) {
            this.heights.set(id, height);
            changed = true;
          }
        }
        if (changed) this.schedule();
      });
      for (const element of this.rows.keys()) this.observer.observe(element);
    }
    window.addEventListener("scroll", this.schedule, true);
    window.addEventListener("resize", this.schedule);
    this.schedule();
    return () => {
      window.removeEventListener("scroll", this.schedule, true);
      window.removeEventListener("resize", this.schedule);
      this.observer?.disconnect();
      this.observer = null;
      if (this.scheduled !== null) cancelAnimationFrame(this.scheduled);
      this.scheduled = null;
    };
  }
}

const VirtualizerContext = createContext<BlockViewportStore | null>(null);
export type VirtualBlockHandle = {
  reveal: (blockId: string) => Promise<boolean>;
  visibleIds: () => string[];
};
export function VirtualPageBlockProvider({
  blocks,
  pageId,
  pinnedIds = [],
  draggingId = null,
  children,
  ref,
}: {
  blocks: readonly VirtualBlock[];
  pageId: string;
  pinnedIds?: readonly string[];
  draggingId?: string | null;
  children?: ReactNode;
  ref?: Ref<VirtualBlockHandle>;
}) {
  const [store] = useState(() => new BlockViewportStore(blocks, pageId));
  useImperativeHandle(
    ref,
    () => ({ reveal: (id) => store.revealAndScroll(id), visibleIds: store.visibleIds }),
    [store],
  );
  useLayoutEffect(() => store.update(blocks, pinnedIds, draggingId), [store, blocks, pinnedIds, draggingId]);
  useEffect(() => {
    const disconnect = store.connect();
    const focus = (event: FocusEvent) =>
      store.focus(ownerBlock(event.target instanceof Node ? event.target : null));
    const startComposition = (event: CompositionEvent) =>
      store.compose(ownerBlock(event.target instanceof Node ? event.target : null));
    const endComposition = () => queueMicrotask(() => store.compose(null));
    const selection = () => store.captureSelection();
    const clipboard = () => flushSync(() => store.captureSelection());
    const reveal = (event: Event) => {
      if (!(event instanceof CustomEvent) || !event.detail || typeof event.detail !== "object") return;
      const detail: unknown = event.detail;
      if (
        detail &&
        typeof detail === "object" &&
        "pageId" in detail &&
        detail.pageId === pageId &&
        "blockId" in detail &&
        typeof detail.blockId === "string"
      )
        void store.revealAndScroll(detail.blockId);
    };
    const keyboard = (event: KeyboardEvent) => {
      if (
        event.isComposing ||
        event.keyCode === 229 ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.getModifierState("AltGraph")
      )
        return;
      if (event.key === "ArrowUp" || event.key === "ArrowDown")
        store.advanceKeyboardDrag(event.key === "ArrowDown" ? 1 : -1);
    };
    document.addEventListener("focusin", focus, true);
    document.addEventListener("compositionstart", startComposition, true);
    document.addEventListener("compositionend", endComposition, true);
    document.addEventListener("selectionchange", selection, true);
    document.addEventListener("copy", clipboard, true);
    document.addEventListener("cut", clipboard, true);
    document.addEventListener("keydown", keyboard, true);
    document.addEventListener("bloco:reveal-block", reveal);
    return () => {
      disconnect();
      document.removeEventListener("focusin", focus, true);
      document.removeEventListener("compositionstart", startComposition, true);
      document.removeEventListener("compositionend", endComposition, true);
      document.removeEventListener("selectionchange", selection, true);
      document.removeEventListener("copy", clipboard, true);
      document.removeEventListener("cut", clipboard, true);
      document.removeEventListener("keydown", keyboard, true);
      document.removeEventListener("bloco:reveal-block", reveal);
    };
  }, [store, pageId]);
  return <VirtualizerContext value={store}>{children}</VirtualizerContext>;
}

/** Read current model order at an action boundary; DOM order contains only mounted rows. */
export function useVirtualBlockOrder(): (() => string[]) | null {
  return useContext(VirtualizerContext)?.visibleIds ?? null;
}
export function useVirtualBlockCollapse(id: string): [boolean, (value: boolean) => void] {
  const store = useContext(VirtualizerContext),
    [local, setLocal] = useState(false);
  const subscribe = useCallback(
    (notify: () => void) => (store ? store.subscribe(notify) : () => {}),
    [store],
  );
  const snapshot = useCallback(() => (store ? store.collapsed.has(id) : local), [store, id, local]);
  const collapsed = useSyncExternalStore(subscribe, snapshot, () => false);
  const update = useCallback(
    (value: boolean) => {
      if (store) store.setCollapsed(id, value);
      else setLocal(value);
    },
    [store, id],
  );
  return [collapsed, update];
}

type RenderContext = { index: number; listIndex: number; size: number; measureRef: RefCallback<HTMLElement> };
type VirtualPageBlocksProps<T extends VirtualBlock> = {
  items: readonly T[];
  renderItem: (item: T, context: RenderContext) => ReactNode;
  as?: "div" | "ul" | "ol";
  className?: string;
  id?: string;
  disabled?: boolean;
  overscan?: number;
  /** Let the caller attach measureRef to its existing frame; this avoids extra wrappers. */
  measureRenderedElement?: boolean;
  renderSegments?: (
    segments: readonly VirtualBlockSegment[],
    item: (index: number) => ReactNode,
    measurements: { heightFor: (id: string) => number },
  ) => ReactNode;
};
function MeasuredVirtualItem({
  id,
  store,
  index,
  listIndex,
  size,
  ordinal,
  as,
  render,
  measured,
}: {
  id: string;
  store: BlockViewportStore | null;
  index: number;
  listIndex: number;
  size: number;
  ordinal: boolean;
  as: "div" | "li";
  render: (context: RenderContext) => ReactNode;
  measured: boolean;
}) {
  const measureRef = useCallback((element: HTMLElement | null) => store?.measure(id, element), [id, store]);
  const content = render({ index, listIndex, size, measureRef });
  if (measured) return content;
  return as === "li" ? (
    <li
      ref={measureRef}
      data-virtual-block={id}
      aria-posinset={index + 1}
      aria-setsize={size}
      value={ordinal ? index + 1 : undefined}
    >
      {content}
    </li>
  ) : (
    <div ref={measureRef} data-virtual-block={id}>
      {content}
    </div>
  );
}

/** Use for root siblings and each expanded subtree; columns themselves remain one layout. */
export function VirtualPageBlocks<T extends VirtualBlock>({
  items,
  renderItem,
  as = "div",
  className,
  id,
  disabled = false,
  overscan = 900,
  measureRenderedElement = false,
  renderSegments,
}: VirtualPageBlocksProps<T>) {
  const store = useContext(VirtualizerContext),
    key = useId();
  useSyncExternalStore(store?.subscribe ?? (() => () => {}), store?.snapshot ?? (() => 0), () => 0);
  const containerRef = useCallback(
    (element: HTMLElement | null) => store?.registerContainer(key, element),
    [store, key],
  );
  const viewport = store?.viewport(key) ?? { top: 0, height: 900 };
  const segments = virtualBlockWindow(
    items,
    { ...viewport, overscan },
    store?.height ?? (() => 48),
    store?.protectedIds ?? new Set(),
    !disabled && Boolean(store && store.index.size > 200),
  );
  const listIndices: number[] = [];
  for (let index = 0; index < items.length; index++)
    listIndices.push(
      index > 0 && items[index]?.type === items[index - 1]?.type ? (listIndices[index - 1] ?? 0) + 1 : 0,
    );
  const item = (index: number) => {
    const value = items[index];
    if (!value) return null;
    return (
      <MeasuredVirtualItem
        key={value.id}
        id={value.id}
        store={store}
        index={index}
        listIndex={listIndices[index] ?? 0}
        size={items.length}
        ordinal={as === "ol"}
        as={as === "div" ? "div" : "li"}
        measured={measureRenderedElement}
        render={(context) => renderItem(value, context)}
      />
    );
  };
  const contents = renderSegments
    ? renderSegments(segments, item, { heightFor: store?.height ?? (() => 48) })
    : segments.map((segment) => {
        if (segment.kind === "item") return item(segment.index);
        const key = `gap:${items[segment.first]?.id}:${items[segment.last]?.id}`;
        const style = { height: segment.height, pointerEvents: "none", userSelect: "none" } as const;
        return as === "div" ? (
          <div key={key} data-virtual-gap="" aria-hidden="true" style={style} />
        ) : (
          <li key={key} data-virtual-gap="" role="presentation" aria-hidden="true" style={style} />
        );
      });
  if (!items.length) return null;
  if (as === "ul")
    return (
      <ul ref={containerRef} className={className} id={id} data-virtual-list="">
        {contents}
      </ul>
    );
  if (as === "ol")
    return (
      <ol ref={containerRef} className={className} id={id} data-virtual-list="">
        {contents}
      </ol>
    );
  return (
    <div ref={containerRef} className={className} id={id} data-virtual-list="">
      {contents}
    </div>
  );
}
