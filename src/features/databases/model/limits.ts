/** Request budgets, not limits on the number of stored records in a database. */
export const DATABASE_MODEL_LIMITS = Object.freeze({
  schemaBytes: 256 * 1024,
  viewBytes: 64 * 1024,
  valueBytes: 32 * 1024,
  textLength: 16 * 1024,
  setSize: 100,
  filterDepth: 5,
  filterConditions: 50,
});

export function assertJsonBudget(value: unknown, maximum: number): void {
  const stack = [{ value, depth: 0 }];
  let bytes = 0;
  let nodes = 0;
  while (stack.length) {
    const item = stack.pop();
    if (!item || ++nodes > 10000 || item.depth > 16) throw new Error("Invalid database input");
    const current = item.value;
    if (current === null || typeof current === "boolean") bytes += 5;
    else if (typeof current === "number" && Number.isFinite(current)) bytes += String(current).length;
    else if (typeof current === "string") {
      if (current.length > maximum) throw new Error("Database input exceeds its budget");
      bytes += new TextEncoder().encode(JSON.stringify(current)).byteLength;
    } else if (Array.isArray(current)) {
      bytes += current.length + 2;
      for (const child of current) stack.push({ value: child, depth: item.depth + 1 });
    } else if (typeof current === "object" && Object.getPrototypeOf(current) === Object.prototype) {
      const entries = Object.entries(current);
      bytes += entries.length * 2 + 2;
      for (const [key, child] of entries) {
        stack.push({ value: key, depth: item.depth + 1 }, { value: child, depth: item.depth + 1 });
      }
    } else throw new Error("Invalid database input");
    if (bytes > maximum || stack.length > 10000) throw new Error("Database input exceeds its budget");
  }
}
