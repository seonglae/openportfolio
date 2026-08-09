// Money arithmetic. Every function here is pure and unit-agnostic: the caller
// decides what the number means, this decides only how it is rounded and
// combined.

// Two decimals is the display default. Anything that needs a different scale
// passes its own, because JPY and KRW have no minor unit and BTC has eight.
const DEFAULT_PLACES = 2;
const PERCENT = 100;

// Math.round breaks ties toward +Infinity, so -0.125 rounds to -0.12 while
// +0.125 rounds to +0.13. A loss and a gain of the same size would then not be
// symmetric, which is visible the moment a portfolio total is netted.
export function roundTo(value: number, places: number = DEFAULT_PLACES): number {
  if (!Number.isFinite(value)) return value;
  const factor = 10 ** places;
  const scaled = value * factor;
  if (scaled < 0) return -Math.round(-scaled) / factor;
  return Math.round(scaled) / factor;
}

// One rate, one direction, named so callsites cannot get the direction wrong:
// `rate` is how many units of the base currency one unit of the local currency
// buys. A rate of 1 is the identity, which is what a same-currency row passes.
export function toBaseCurrency(amountLocal: number, rate: number): number {
  return amountLocal * rate;
}

export function sumBy<T>(rows: readonly T[], pick: (row: T) => number): number {
  let total = 0;
  for (const row of rows) {
    const value = pick(row);
    if (Number.isFinite(value)) total += value;
  }
  return total;
}

// Returns null rather than Infinity when the base is zero. A position opened
// today has no percentage change, and rendering "Infinity%" is worse than
// rendering nothing.
export function percentChange(from: number, to: number): number | null {
  if (from === 0) return null;
  return ((to - from) / Math.abs(from)) * PERCENT;
}

// Weight of one part in a whole, as a fraction in [0, 1]. Zero total means no
// weights exist, not that every weight is zero, so this reports null.
export function weight(part: number, total: number): number | null {
  if (total === 0) return null;
  return part / total;
}
