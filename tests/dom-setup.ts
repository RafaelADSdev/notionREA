import { vi } from "vitest";

// jsdom has no scrolling layout engine; browser acceptance exercises real scrolling.
if (typeof HTMLElement !== "undefined" && typeof HTMLElement.prototype.scrollIntoView !== "function") {
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
}
