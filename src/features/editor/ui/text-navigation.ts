import { TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

export function synchronizeNativeSelection(view: EditorView): void {
  const selection = view.dom.ownerDocument.getSelection();
  if (
    !selection?.anchorNode ||
    !selection.focusNode ||
    !view.dom.contains(selection.anchorNode) ||
    !view.dom.contains(selection.focusNode)
  )
    return;
  try {
    const anchor = view.posAtDOM(selection.anchorNode, selection.anchorOffset);
    const head = view.posAtDOM(selection.focusNode, selection.focusOffset);
    if (anchor !== view.state.selection.anchor || head !== view.state.selection.head)
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, anchor, head)));
  } catch {
    // Detached nodes and selections outside inline text have no formatting target.
  }
}

/** Accept explicit native Home/End before PM's recent-focus reset protection. */
export function installTextNavigation(view: EditorView): () => void {
  const owner = view.dom.ownerDocument;
  let navigating = false;
  const accept = () => {
    if (!navigating) return;
    navigating = false;
    if (!view.isDestroyed && view.editable && !view.composing && view.hasFocus())
      synchronizeNativeSelection(view);
  };
  const keydown = (event: KeyboardEvent) => {
    if (
      !view.editable ||
      event.isComposing ||
      view.composing ||
      event.keyCode === 229 ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.getModifierState("AltGraph")
    ) {
      navigating = false;
      return;
    }
    // A following key may arrive before the queued selectionchange task.
    // Capture runs before ProseMirror's keydown handler flushes its observer.
    accept();
    navigating = event.key === "Home" || event.key === "End";
  };
  view.dom.addEventListener("keydown", keydown, true);
  view.dom.addEventListener("keyup", accept, true);
  owner.addEventListener("selectionchange", accept, true);
  return () => {
    view.dom.removeEventListener("keydown", keydown, true);
    view.dom.removeEventListener("keyup", accept, true);
    owner.removeEventListener("selectionchange", accept, true);
  };
}
