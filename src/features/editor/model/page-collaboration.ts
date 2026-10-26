import Collaboration from "@tiptap/extension-collaboration";
import { Plugin } from "@tiptap/pm/state";
import { type RelativeSelection, ySyncPluginKey, yUndoPluginKey } from "@tiptap/y-tiptap";
import type { UndoManager } from "yjs";
import type { StablePage } from "./stable-page";

type StackItem = UndoManager["undoStack"][number];

const PageCollaboration = Collaboration.extend({
  addProseMirrorPlugins() {
    const manager = this.options.yUndoOptions?.undoManager;
    if (!manager) throw new Error("Page collaboration requires a page-owned undo manager");
    manager.trackedOrigins.add(ySyncPluginKey);
    return (this.parent?.() ?? []).map((plugin) => {
      if (plugin.spec.key !== yUndoPluginKey) return plugin;
      return new Plugin({
        ...plugin.spec,
        view(view) {
          const selections = new WeakMap<StackItem, RelativeSelection | null>();
          const onAdded = ({ stackItem }: { stackItem: StackItem }) => {
            selections.set(stackItem, yUndoPluginKey.getState(view.state)?.prevSel ?? null);
          };
          const onPopped = ({ stackItem }: { stackItem: StackItem }) => {
            const selection = selections.get(stackItem);
            const binding = ySyncPluginKey.getState(view.state)?.binding;
            if (binding && selection) binding.beforeTransactionSelection = selection;
          };
          manager.on("stack-item-added", onAdded);
          manager.on("stack-item-popped", onPopped);
          return {
            destroy() {
              // Views release their own selection listeners. Only the page owns history destruction.
              manager.off("stack-item-added", onAdded);
              manager.off("stack-item-popped", onPopped);
            },
          };
        },
      });
    });
  },
});

export function pageCollaboration(page: StablePage, blockId: string) {
  return PageCollaboration.configure({
    fragment: page.fragment(blockId),
    yUndoOptions: { undoManager: page.undoManager },
  });
}
