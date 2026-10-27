// Vitest request primitives for direct Server Action/Route Handler calls.
// Production getLocale remains strict and always uses Next's request context.
import { beforeEach, vi } from "vitest";

const jar = vi.hoisted(() => new Map<string, string>());
export const requestCookies = jar;

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get(name: string) {
      const value = jar.get(name);
      return value === undefined ? undefined : { name, value };
    },
    getAll: () => [...jar].map(([name, value]) => ({ name, value })),
    set(name: string, value: string) {
      jar.set(name, value);
    },
    delete(name: string) {
      jar.delete(name);
    },
    has: (name: string) => jar.has(name),
  }),
}));

beforeEach(() => jar.clear());
