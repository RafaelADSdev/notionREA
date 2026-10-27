import { afterEach, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import { acquireInterchangeSlot } from "../../src/features/interchange/server/repository";
import { boundedInterchangeStream } from "../../src/features/interchange/server/streams";

afterEach(() => vi.useRealTimers());
it("limits admission to two active and eight queued and transfers a released slot once", async () => {
  vi.useFakeTimers();
  const first = await acquireInterchangeSlot(),
    second = await acquireInterchangeSlot();
  const queued = Array.from({ length: 8 }, () => acquireInterchangeSlot());
  await expect(acquireInterchangeSlot()).rejects.toMatchObject({ status: 503 });
  first();
  first();
  const next = await queued[0];
  next?.();
  for (let index = 1; index < queued.length; index++) {
    const release = await queued[index];
    release?.();
  }
  second();
  const available = await acquireInterchangeSlot();
  available();
  expect(vi.getTimerCount()).toBe(0);
});
it("closes a timed-out export immediately but retains its slot until the pending load settles", async () => {
  vi.useFakeTimers();
  const release = vi.fn();
  let finish: ((value: Uint8Array) => void) | undefined;
  const stream = boundedInterchangeStream(
    () =>
      new Promise<Uint8Array>((resolve) => {
        finish = resolve;
      }),
    release,
  );
  const reader = stream.getReader();
  const read = reader.read();
  const failed = expect(read).rejects.toThrow("Export download unavailable");
  await vi.advanceTimersByTimeAsync(60000);
  await failed;
  expect(release).not.toHaveBeenCalled();
  finish?.(new Uint8Array([1]));
  await vi.waitFor(() => expect(release).toHaveBeenCalledTimes(1));
  expect(release).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});
it.each(["cancel", "timeout"] as const)(
  "retains both admission slots during %s until the underlying loads settle",
  async (mode) => {
    vi.useFakeTimers();
    const first = await acquireInterchangeSlot(),
      second = await acquireInterchangeSlot();
    const finish: (() => void)[] = [];
    let activeLoads = 0;
    const start = (release: () => void) => {
      const stream = boundedInterchangeStream(
        () =>
          new Promise<Uint8Array>((resolve) => {
            activeLoads++;
            finish.push(() => {
              activeLoads--;
              resolve(new Uint8Array([1]));
            });
          }),
        release,
      );
      const reader = stream.getReader();
      return { reader, reading: reader.read() };
    };
    const streams = [start(first), start(second)];
    await Promise.resolve();
    expect(activeLoads).toBe(2);
    const closed = streams.map(({ reader, reading }) =>
      mode === "cancel" ? reader.cancel() : expect(reading).rejects.toThrow("Export download unavailable"),
    );
    if (mode === "timeout") await vi.advanceTimersByTimeAsync(60000);
    await Promise.all(closed);
    let admitted = false;
    const queued = acquireInterchangeSlot().then((release) => {
      admitted = true;
      return release;
    });
    await Promise.resolve();
    expect(admitted).toBe(false);
    expect(activeLoads).toBe(2);
    finish[0]?.();
    const third = await queued;
    expect(activeLoads).toBe(1);
    expect(admitted).toBe(true);
    third();
    finish[1]?.();
    await Promise.resolve();
    const available = await acquireInterchangeSlot();
    available();
    expect(activeLoads).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  },
);
it("clears deadline and releases exactly once on completion, cancellation and load failure", async () => {
  vi.useFakeTimers();
  for (const mode of ["complete", "cancel", "error"]) {
    const release = vi.fn();
    const stream = boundedInterchangeStream(async () => {
      if (mode === "error") throw Error("Private source details");
      return null;
    }, release);
    const reader = stream.getReader();
    if (mode === "cancel") await reader.cancel();
    else if (mode === "error") await expect(reader.read()).rejects.toThrow("Export download unavailable");
    else expect((await reader.read()).done).toBe(true);
    expect(release).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  }
});
