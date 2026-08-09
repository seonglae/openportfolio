// Display formatting. Kept out of the components so it can be tested without a
// DOM, and so every table renders a number the same way.

const PERCENT = 100;
const PERCENT_PLACES = 1;
const BRIER_PLACES = 3;
// Currencies with no minor unit. Rendering "₩91,547,896.00" is not more precise,
// it is just wrong about what a won is.
const ZERO_DECIMAL_CURRENCIES = ["KRW", "JPY", "VND", "CLP", "ISK"];

export function formatMoney(value: number, currency: string): string {
  if (!Number.isFinite(value)) return "-";
  const upper = currency.toUpperCase();
  let places = 2;
  if (ZERO_DECIMAL_CURRENCIES.includes(upper)) places = 0;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: upper,
      minimumFractionDigits: places,
      maximumFractionDigits: places,
    }).format(value);
  } catch {
    // An unknown or made-up currency code throws rather than degrading, and a
    // manual account can hold one.
    return `${value.toFixed(places)} ${upper}`;
  }
}

// Instrument Serif ships no currency glyph, so "£" or "₩" falls back to Georgia
// mid-run. Georgia's symbol ink overruns its advance width and touches the first
// digit, and a font fallback has no kerning pair to correct that. Handing the
// parts back lets the one place that sets money in the display face space the
// symbol itself; every other figure is set in a font that has the glyph.
// A locale that puts the symbol last needs no gap, so it stays unsplit.
export function splitMoney(value: number, currency: string): { symbol: string; rest: string } {
  const text = formatMoney(value, currency);
  try {
    const parts = new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency.toUpperCase(),
    }).formatToParts(value);
    const first = parts[0];
    if (first !== undefined && first.type === "currency" && text.startsWith(first.value)) {
      return { symbol: first.value, rest: text.slice(first.value.length) };
    }
  } catch {
    return { symbol: "", rest: text };
  }
  return { symbol: "", rest: text };
}

export function formatQty(value: number): string {
  if (!Number.isFinite(value)) return "-";
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 8 }).format(value);
}

export function formatPercent(fraction: number | null): string {
  if (fraction === null || !Number.isFinite(fraction)) return "-";
  return `${(fraction * PERCENT).toFixed(PERCENT_PLACES)}%`;
}

export function formatBrier(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "not scored yet";
  return value.toFixed(BRIER_PLACES);
}

export function formatDate(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10);
}

// "in 3 days" / "6 days ago", for a queue where the interesting column is how
// long something has been waiting.
const MS_PER_DAY = 86_400_000;

export function formatRelativeDays(epochMs: number, now: number): string {
  const days = Math.round((epochMs - now) / MS_PER_DAY);
  if (days === 0) return "today";
  if (days > 0) return `in ${days}d`;
  return `${-days}d ago`;
}
