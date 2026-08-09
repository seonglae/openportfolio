// Calendar math on YYYY-MM-DD strings, done through UTC epochs so a DST shift
// can never move a day. The string is treated as an abstract calendar date, not
// an instant, so this never reads the ambient timezone and gives the same
// answer everywhere. Deciding WHICH day is "today" belongs to the caller: a
// market's session date and the operator's local date disagree for most of the
// day at UTC+9.

const ISO_DATE_LENGTH = 10;
const MS_PER_DAY = 86_400_000;
const MONTHS_PER_YEAR = 12;

export function dayKey(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, ISO_DATE_LENGTH);
}

export function dateParts(dateStr: string): [number, number, number] {
  const [y, m, d] = dateStr.split("-").map(Number);
  return [y, m, d];
}

export function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateParts(dateStr);
  // Date.UTC normalises overflow, so d + n crossing a month or year end needs
  // no branching here.
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, ISO_DATE_LENGTH);
}

export function addMonths(dateStr: string, n: number): string {
  const [y, m, d] = dateParts(dateStr);
  const total = y * MONTHS_PER_YEAR + (m - 1) + n;
  const year = Math.floor(total / MONTHS_PER_YEAR);
  const month = total - year * MONTHS_PER_YEAR;
  return new Date(Date.UTC(year, month, d)).toISOString().slice(0, ISO_DATE_LENGTH);
}

export function daysBetween(fromDateStr: string, toDateStr: string): number {
  const [fy, fm, fd] = dateParts(fromDateStr);
  const [ty, tm, td] = dateParts(toDateStr);
  return (Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / MS_PER_DAY;
}
