"use client";
import { useLayoutEffect } from "react";

/** WAI-ARIA permits a textbox to keep focus while controlling an active listbox option. */
export function useInlineMenuAria(
  owner: HTMLElement | undefined,
  listId: string,
  activeId: string | undefined,
): void {
  useLayoutEffect(() => {
    if (!owner) return;
    const values = {
      "aria-controls": listId,
      "aria-haspopup": "listbox",
      "aria-autocomplete": "list",
      "aria-activedescendant": activeId,
    };
    const previous = new Map(Object.keys(values).map((name) => [name, owner.getAttribute(name)]));
    for (const [name, value] of Object.entries(values)) {
      if (value) owner.setAttribute(name, value);
      else owner.removeAttribute(name);
    }
    return () => {
      for (const [name, value] of previous) {
        if (value !== null) owner.setAttribute(name, value);
        else owner.removeAttribute(name);
      }
    };
  }, [owner, listId, activeId]);
}
