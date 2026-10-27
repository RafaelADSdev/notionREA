import { Extension } from "@tiptap/core";
import { type EditorState, Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { relativePositionToAbsolutePosition, ySyncPluginKey } from "@tiptap/y-tiptap";
import type * as Y from "yjs";
import { cursorStore } from "./cursor-store";
import { decodePosition } from "./protocol";

/** Remote positions are untrusted visual hints. They never dispatch content or selection changes. */
export function remoteCursors(document: Y.Doc, blockId: string) {
  const store = cursorStore(document);
  const key = new PluginKey<DecorationSet>(`bloco-remote-cursor-${blockId}`);
  const decorations = (state: EditorState): DecorationSet => {
    const sync = ySyncPluginKey.getState(state);
    if (!sync?.binding) return DecorationSet.empty;
    const fragment = document.getXmlFragment(`block-content:${blockId}`);
    const result: Decoration[] = [];
    for (const participant of store.get()) {
      const cursor = participant.cursor;
      if (!cursor || cursor.blockId !== blockId || participant.expiresAt <= Date.now()) continue;
      try {
        const anchor = decodePosition(cursor.anchor, blockId);
        const head = decodePosition(cursor.head, blockId);
        if (!anchor || !head) continue;
        const from = relativePositionToAbsolutePosition(document, fragment, anchor, sync.binding.mapping);
        const to = relativePositionToAbsolutePosition(document, fragment, head, sync.binding.mapping);
        if (
          from === null ||
          to === null ||
          from < 0 ||
          to < 0 ||
          from > state.doc.content.size ||
          to > state.doc.content.size
        )
          continue;
        if (from !== to)
          result.push(
            Decoration.inline(Math.min(from, to), Math.max(from, to), {
              class: "remote-cursor-selection",
              "data-participant-color": participant.color,
            }),
          );
        result.push(
          Decoration.widget(
            to,
            () => {
              const caret = window.document.createElement("span");
              caret.className = "remote-cursor";
              caret.dataset.participantColor = participant.color;
              caret.setAttribute("aria-hidden", "true");
              caret.contentEditable = "false";
              const label = window.document.createElement("span");
              label.className = "remote-cursor-label";
              label.textContent = participant.label;
              caret.append(label);
              return caret;
            },
            { key: participant.participantId, side: 1 },
          ),
        );
      } catch {
        /* Removed or unmapped anchors remain unavailable rather than moving to other text. */
      }
    }
    return DecorationSet.create(state.doc, result);
  };
  return Extension.create({
    name: "blocoRemoteCursors",
    addProseMirrorPlugins() {
      return [
        new Plugin<DecorationSet>({
          key,
          state: {
            init: (_config, state) => decorations(state),
            apply: (_tr, _old, _previous, state) => decorations(state),
          },
          props: { decorations: (state) => key.getState(state) ?? DecorationSet.empty },
          view(view) {
            const unsubscribe = store.subscribe(() => {
              if (!view.isDestroyed) view.dispatch(view.state.tr.setMeta(key, true));
            });
            return { destroy: unsubscribe };
          },
        }),
      ];
    },
  });
}
