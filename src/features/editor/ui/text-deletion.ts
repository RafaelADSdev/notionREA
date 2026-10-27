import { TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

const deletionTypes = new Set([
  "deleteContentBackward",
  "deleteContentForward",
  "deleteWordBackward",
  "deleteWordForward",
  "deleteSoftLineBackward",
  "deleteSoftLineForward",
  "deleteHardLineBackward",
  "deleteHardLineForward",
]);

/** Commit the browser's Unicode/word-aware range before native DOM mutation. */
export function handleTextDeletion(view: EditorView, event: InputEvent): boolean {
  if (
    !view.editable ||
    view.composing ||
    event.isComposing ||
    !event.cancelable ||
    event.defaultPrevented ||
    !deletionTypes.has(event.inputType) ||
    typeof event.getTargetRanges !== "function"
  )
    return false;
  const ranges = event.getTargetRanges();
  if (ranges.length !== 1) return false;
  const range = ranges[0];
  if (!range || !view.dom.contains(range.startContainer) || !view.dom.contains(range.endContainer))
    return false;
  let from: number, to: number;
  try {
    from = view.posAtDOM(range.startContainer, range.startOffset);
    to = view.posAtDOM(range.endContainer, range.endOffset);
  } catch {
    return false;
  }
  // Structural merges remain the outer editor's responsibility.
  if (from >= to || !view.state.doc.resolve(from).sameParent(view.state.doc.resolve(to))) return false;
  const transaction = view.state.tr.delete(from, to);
  transaction.setSelection(TextSelection.near(transaction.doc.resolve(from)));
  event.preventDefault();
  view.dispatch(transaction.scrollIntoView());
  return true;
}
