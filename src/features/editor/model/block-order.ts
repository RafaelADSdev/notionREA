const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const validPosition = /^[0-9A-Za-z]{1,128}$/;

/** Matches the ordinal base62 interval used by private.position_between. */
export function between(lower: string | null, upper: string | null): string | null {
  if (
    (lower !== null && !validPosition.test(lower)) ||
    (upper !== null && !validPosition.test(upper)) ||
    (lower !== null && upper !== null && lower >= upper)
  )
    return null;
  let prefix = "";
  let limit = upper;
  for (let index = 0; index < 128; index++) {
    if (limit !== null && index >= limit.length) return null;
    const low = lower === null || index >= lower.length ? 0 : alphabet.indexOf(lower[index] ?? "");
    const high = limit === null ? 61 : alphabet.indexOf(limit[index] ?? "");
    if (high - low > 1) return prefix + alphabet[Math.floor((low + high) / 2)];
    prefix += alphabet[low];
    if (low < high) limit = null;
  }
  return null;
}

/** Fixed-width keys spaced by 1024, with the same trailing midpoint as SQL maintenance. */
export function rebalancePositions(count: number): string[] {
  if (!Number.isSafeInteger(count) || count < 0 || count > 10000)
    throw new Error("Invalid sibling position count");
  return Array.from({ length: count }, (_, index) => {
    let value = BigInt(index + 1) * 1024n;
    let key = "";
    for (let digit = 0; digit < 12; digit++) {
      key = alphabet[Number(value % 62n)] + key;
      value /= 62n;
    }
    if (value !== 0n) throw new Error("Sibling position capacity exceeded");
    return `${key}V`;
  });
}
