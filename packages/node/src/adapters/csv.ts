// Statement adapter: a CSV exported from a broker.
//
// Every keyed adapter covers one firm. This one covers the rest of them,
// including the ones that will never have an API: a workplace pension portal, a
// small European broker, a bank that offers a download and nothing else. An
// export is a worse feed than an endpoint, and it is the only feed most
// accounts have, so leaving them out is what actually makes the number wrong.
//
// One file per account, named for the account key, in a directory the operator
// points at. A directory beats a path-per-account setting because adding an
// account is then dropping a file rather than editing a config.
//
// Columns are matched by name against the synonyms below, so an export usually
// works unedited. What is deliberately not inferred is the asset class: it
// decides which quote source reprices the row, and a wrong guess there prices a
// pension against whatever ticker its name collides with. Absent a column, the
// configured default applies and `other` is the value that means "leave the
// recorded price alone".

import { readFileSync, readdirSync } from "node:fs";
import { basename, extname, join } from "node:path";
import {
  type AdapterBalance,
  type AdapterQuote,
  type AssetClass,
  ASSET_CLASSES,
  type ReadBalancesRequest,
  type VenueAdapter,
  unsupportedCapability,
} from "@openportfolio/domain";

export const CSV_VENUE = "csv";

// Longest-lived shapes first: whichever header a broker chose, one of these
// usually matches after case and separators are stripped.
const COLUMNS = {
  symbol: ["symbol", "ticker", "instrument", "instrumentcode", "security", "stock", "isin", "name"],
  qty: ["qty", "quantity", "shares", "units", "position", "positionquantity", "holding", "noofshares"],
  price: ["price", "lastprice", "marketprice", "close", "currentprice", "priceper share", "priceper"],
  currency: ["currency", "ccy", "curr", "currencycode", "tradingcurrency"],
  value: ["value", "marketvalue", "currentvalue", "positionvalue", "totalvalue", "marketvaluebase"],
  costBasis: ["costbasis", "cost", "totalcost", "bookcost", "purchasevalue"],
  assetClass: ["assetclass", "asset", "type", "assettype", "securitytype", "category"],
} as const;

type ColumnKey = keyof typeof COLUMNS;

export type CsvOptions = {
  dir: string;
  // Applied to a row whose file has no asset-class column. `equity` suits a
  // broker export; a pension portal wants `other`.
  defaultAssetClass?: AssetClass;
  // Applied to a row whose file has no currency column.
  defaultCurrency?: string;
};

const DEFAULT_ASSET_CLASS: AssetClass = "equity";
const DEFAULT_CURRENCY = "USD";

// RFC 4180 with the two concessions a real export needs: a semicolon delimiter,
// which is what a European locale writes, and CRLF.
export function parseCsv(text: string): string[][] {
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const delimiter = pickDelimiter(body);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let index = 0;
  while (index < body.length) {
    const ch = body[index];
    if (quoted) {
      if (ch === '"') {
        // A doubled quote inside a quoted field is one literal quote.
        if (body[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }
        quoted = false;
        index += 1;
        continue;
      }
      field += ch;
      index += 1;
      continue;
    }
    if (ch === '"') {
      quoted = true;
      index += 1;
      continue;
    }
    if (ch === delimiter) {
      row.push(field);
      field = "";
      index += 1;
      continue;
    }
    if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && body[index + 1] === "\n") index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      index += 1;
      continue;
    }
    field += ch;
    index += 1;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // A trailing newline leaves one empty row, which is not a holding.
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

// Counted on the header line only. Counting the whole file lets a comma inside
// a quoted company name outvote the semicolons that actually separate columns.
function pickDelimiter(text: string): string {
  const header = text.split(/\r?\n/, 1)[0] ?? "";
  const semicolons = header.split(";").length;
  const commas = header.split(",").length;
  const tabs = header.split("\t").length;
  if (tabs > commas && tabs > semicolons) return "\t";
  if (semicolons > commas) return ";";
  return ",";
}

function normalise(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Which column index holds which field. Unmatched fields are absent rather than
// guessed at by position: a positional guess on an unknown export is how a cost
// basis becomes a price.
export function mapColumns(header: readonly string[]): Partial<Record<ColumnKey, number>> {
  const found: Partial<Record<ColumnKey, number>> = {};
  const cells = header.map(normalise);
  for (const [key, synonyms] of Object.entries(COLUMNS) as Array<[ColumnKey, readonly string[]]>) {
    for (const synonym of synonyms) {
      const at = cells.indexOf(normalise(synonym));
      if (at !== -1) {
        found[key] = at;
        break;
      }
    }
  }
  return found;
}

// Exports write numbers the way a spreadsheet displays them: thousands
// separators, a currency symbol, a negative in parentheses, and in a European
// locale a comma for the decimal point. Returning NaN from any of those puts a
// NaN in the net worth, which is far harder to trace than a row that is named
// and skipped.
export function parseNumber(raw: string): number | null {
  let text = raw.trim();
  if (!text) return null;
  let sign = 1;
  if (text.startsWith("(") && text.endsWith(")")) {
    sign = -1;
    text = text.slice(1, -1);
  }
  text = text.replace(/[^0-9.,\-+]/g, "");
  // "n/a" and "-" strip down to nothing or to a lone sign. Number("") is 0,
  // which would enter the book as a real zero-valued holding.
  if (!/[0-9]/.test(text)) return null;

  const lastComma = text.lastIndexOf(",");
  const lastDot = text.lastIndexOf(".");
  if (lastComma !== -1 && lastDot !== -1) {
    // Both present, so the later one is the decimal point and the other groups:
    // "1.234,56" is European, "1,234.56" is not.
    if (lastComma > lastDot) text = text.replace(/\./g, "").replace(",", ".");
    else text = text.replace(/,/g, "");
  } else if (lastComma !== -1) {
    // Only commas. One comma with exactly three digits behind it is a thousands
    // separator, and so is any string with more than one: "12,000" is twelve
    // thousand, not twelve. "1234,56" is a European decimal.
    //
    // "1,234" is genuinely ambiguous, and is read as one thousand two hundred
    // and thirty four. That is the reading every broker export in this
    // repository's test corpus intends, and a European file that means 1.234
    // almost always carries a decimal part that resolves it above.
    const digitsAfter = text.length - lastComma - 1;
    const commaCount = text.split(",").length - 1;
    if (commaCount === 1 && digitsAfter !== 3) text = text.replace(",", ".");
    else text = text.replace(/,/g, "");
  }
  const value = Number(text);
  if (!Number.isFinite(value)) return null;
  return sign * value;
}

function asAssetClass(raw: string | undefined, fallback: AssetClass): AssetClass {
  if (!raw) return fallback;
  const found = ASSET_CLASSES.find((cls) => cls === raw.trim().toLowerCase());
  if (found) return found;
  return fallback;
}

export type CsvRowProblem = { line: number; reason: string };
export type CsvParseResult = { balances: AdapterBalance[]; skipped: CsvRowProblem[] };

// A row missing a quantity is skipped and named. Statements carry subtotal and
// cash-summary lines that are not holdings, and treating one as a position with
// qty 0 would put a zero-value row in the book that nobody can explain.
export function balancesFromCsv(text: string, opts: Omit<CsvOptions, "dir"> = {}): CsvParseResult {
  const rows = parseCsv(text);
  if (rows.length < 2) return { balances: [], skipped: [] };
  const columns = mapColumns(rows[0]);
  const defaultClass = opts.defaultAssetClass ?? DEFAULT_ASSET_CLASS;
  const defaultCurrency = opts.defaultCurrency ?? DEFAULT_CURRENCY;
  if (columns.symbol === undefined) throw new Error("csv has no symbol column; looked for symbol/ticker/instrument");
  if (columns.qty === undefined) throw new Error("csv has no quantity column; looked for qty/quantity/shares/units");

  const balances: AdapterBalance[] = [];
  const skipped: CsvRowProblem[] = [];
  for (const [offset, cells] of rows.slice(1).entries()) {
    const line = offset + 2;
    const cell = (key: ColumnKey): string | undefined => {
      const at = columns[key];
      if (at === undefined) return undefined;
      return cells[at];
    };
    const symbol = (cell("symbol") ?? "").trim();
    if (!symbol) {
      skipped.push({ line, reason: "no symbol" });
      continue;
    }
    const qty = parseNumber(cell("qty") ?? "");
    if (qty === null) {
      skipped.push({ line, reason: `"${symbol}": no quantity` });
      continue;
    }
    const price = parseNumber(cell("price") ?? "");
    const value = parseNumber(cell("value") ?? "");
    // Either column alone is enough, and a statement that carries both is
    // believed on value: it is the number the broker itself totalled.
    let valueLocal: number;
    if (value !== null) valueLocal = value;
    else if (price !== null) valueLocal = qty * price;
    else {
      skipped.push({ line, reason: `"${symbol}": no price and no value` });
      continue;
    }
    const balance: AdapterBalance = {
      symbol,
      assetClass: asAssetClass(cell("assetClass"), defaultClass),
      qty,
      valueLocal,
      currency: (cell("currency") ?? defaultCurrency).trim().toUpperCase() || defaultCurrency,
    };
    if (price !== null) balance.lastPrice = price;
    else if (qty !== 0) balance.lastPrice = valueLocal / qty;
    const costBasis = parseNumber(cell("costBasis") ?? "");
    if (costBasis !== null) {
      balance.costBasis = costBasis;
      balance.pnl = valueLocal - costBasis;
    }
    balances.push(balance);
  }
  return { balances, skipped };
}

// <accountKey>.csv in the configured directory. Case is preserved so an account
// key that is itself mixed case still resolves.
export function statementPathFor(dir: string, accountKey: string): string | null {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (extname(entry).toLowerCase() !== ".csv") continue;
    if (basename(entry, extname(entry)) === accountKey) return join(dir, entry);
  }
  return null;
}

export function createCsvAdapter(opts: CsvOptions): VenueAdapter {
  async function readBalances(request: ReadBalancesRequest): Promise<AdapterBalance[]> {
    const path = statementPathFor(opts.dir, request.accountKey);
    // Throwing rather than returning [] for a missing file: an export that was
    // never dropped in reads as "you hold nothing" otherwise, and a position
    // that vanishes is worse than a sync that says which file it wanted.
    if (!path) throw new Error(`csv: no ${request.accountKey}.csv in ${opts.dir}`);
    const parsed = balancesFromCsv(readFileSync(path, "utf8"), opts);
    for (const problem of parsed.skipped) console.warn(`  ! ${basename(path)}:${problem.line} ${problem.reason}`);
    return parsed.balances;
  }

  async function readQuote(): Promise<AdapterQuote> {
    // A statement is a snapshot of what was held, not a price feed. Its prices
    // ride on the balance rows and the worker reprices them from a live source.
    throw unsupportedCapability(CSV_VENUE, "canReadQuotes");
  }

  return {
    venue: CSV_VENUE,
    kind: "brokerage",
    capabilities: { canReadBalances: true, canReadQuotes: false, canPlaceOrders: false },
    readBalances,
    readQuote,
  };
}
