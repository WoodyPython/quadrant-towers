// Persisted Mulberry32: mixed output avoids correlations in small shuffle ranges.
// This is replay randomness, not a cryptographic generator; the seed stays private.
export function randomUint32(cursor: { rngState: number }): number {
  cursor.rngState = (cursor.rngState + 0x6d2b79f5) >>> 0;
  let value = cursor.rngState;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return (value ^ (value >>> 14)) >>> 0;
}
export function randomIndex(
  cursor: { rngState: number },
  length: number,
): number {
  if (!Number.isInteger(length) || length < 1 || length > 0x100000000)
    throw new Error('Invalid random range');
  // Rejection sampling avoids modulo bias, including Town Hall placement.
  const limit = Math.floor(0x100000000 / length) * length;
  let value: number;
  do {
    value = randomUint32(cursor);
  } while (value >= limit);
  return value % length;
}
export function shuffle<T>(
  cursor: { rngState: number },
  values: readonly T[],
): T[] {
  const copy = [...values];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = randomIndex(cursor, i + 1);
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}
export function weighted<T>(
  cursor: { rngState: number },
  entries: { value: T; weight: number }[],
): T | undefined {
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
  if (total <= 0) return undefined;
  let roll = (randomUint32(cursor) / 0x100000000) * total;
  for (const entry of entries) {
    roll -= entry.weight;
    if (roll < 0) return entry.value;
  }
  return entries.at(-1)?.value;
}
