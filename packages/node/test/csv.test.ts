import { describe, expect, it } from "vitest";
import { UNSUPPORTED_CAPABILITY } from "@openportfolio/domain";
import { balancesFromCsv, createCsvAdapter, mapColumns, parseCsv, parseNumber } from "../src/adapters/csv.ts";

describe("reading a CSV a broker actually exports", () => {
  it("keeps a comma that lives inside a quoted company name", () => {
    const rows = parseCsv('Symbol,Name,Qty\nBRK.B,"Berkshire Hathaway, Inc.",3\n');
    expect(rows[1]).toEqual(["BRK.B", "Berkshire Hathaway, Inc.", "3"]);
  });

  it("reads a doubled quote as one literal quote", () => {
    expect(parseCsv('a\n"say ""hi"""\n')[1]).toEqual(['say "hi"']);
  });

  // A European export is semicolon-separated. Counting delimiters over the
  // whole file lets a comma inside a company name outvote the real separator,
  // so only the header line is counted.
  it("picks the semicolon a European locale writes", () => {
    const rows = parseCsv('Symbol;Quantity;Price\nASML;2;"Veldhoven, NL"\n');
    expect(rows[0]).toEqual(["Symbol", "Quantity", "Price"]);
    expect(rows[1]).toEqual(["ASML", "2", "Veldhoven, NL"]);
  });

  it("survives CRLF and a byte order mark", () => {
    const rows = parseCsv("﻿Symbol,Qty\r\nNVDA,4\r\n");
    expect(rows[0]).toEqual(["Symbol", "Qty"]);
    expect(rows[1]).toEqual(["NVDA", "4"]);
  });

  it("drops the empty row a trailing newline leaves behind", () => {
    expect(parseCsv("Symbol,Qty\nNVDA,4\n\n")).toHaveLength(2);
  });
});

describe("matching columns by name", () => {
  it("accepts whatever the broker called it", () => {
    const columns = mapColumns(["Instrument Code", "No. of Shares", "Market Value", "Ccy"]);
    expect(columns.symbol).toBe(0);
    expect(columns.qty).toBe(1);
    expect(columns.value).toBe(2);
    expect(columns.currency).toBe(3);
  });

  // Guessing by position on an unknown export is how a cost basis becomes a
  // price. An unmatched field is absent instead.
  it("leaves a field it cannot name unmatched rather than guessing a position", () => {
    expect(mapColumns(["Symbol", "Qty", "Something Unlabelled"]).price).toBeUndefined();
  });
});

describe("reading a number the way a spreadsheet wrote it", () => {
  it("strips thousands separators and a currency symbol", () => {
    expect(parseNumber("$1,234.56")).toBeCloseTo(1234.56, 6);
    expect(parseNumber("£12,000")).toBe(12000);
  });

  it("reads a European decimal comma", () => {
    expect(parseNumber("1.234,56")).toBeCloseTo(1234.56, 6);
    expect(parseNumber("1234,56")).toBeCloseTo(1234.56, 6);
  });

  // The bug this pins: a lone comma read as a decimal point turns twelve
  // thousand into twelve, and the row still looks like a number.
  it("reads a lone comma with three digits behind it as a thousands separator", () => {
    expect(parseNumber("12,000")).toBe(12000);
    expect(parseNumber("1,234,567")).toBe(1234567);
  });

  it("reads parentheses as negative", () => {
    expect(parseNumber("(250.00)")).toBe(-250);
  });

  // Returning NaN here puts a NaN in the net worth, which is far harder to
  // trace back than a row that is named and skipped.
  it("returns null rather than NaN for something that is not a number", () => {
    expect(parseNumber("")).toBeNull();
    expect(parseNumber("n/a")).toBeNull();
  });
});

describe("turning a statement into balances", () => {
  const STATEMENT = [
    "Symbol,Quantity,Price,Currency,Market Value,Book Cost,Asset Class",
    'NVDA,10,"218.92",USD,"2,189.20","1,500.00",equity',
    "VWRL.L,25,138.24,GBP,3456.00,3000.00,etf",
    "Subtotal,,,,5645.20,,",
  ].join("\n");

  it("reads the rows and carries the cost basis into a P&L", () => {
    const { balances } = balancesFromCsv(STATEMENT);
    expect(balances).toHaveLength(2);
    expect(balances[0]).toMatchObject({ symbol: "NVDA", qty: 10, currency: "USD", assetClass: "equity" });
    expect(balances[0].valueLocal).toBeCloseTo(2189.2, 6);
    expect(balances[0].pnl).toBeCloseTo(689.2, 6);
    expect(balances[1].assetClass).toBe("etf");
  });

  // Statements carry subtotal and cash-summary lines. Admitting one as a
  // position with qty 0 puts a row in the book that nobody can explain.
  it("skips a subtotal line and says which line it skipped", () => {
    const { skipped } = balancesFromCsv(STATEMENT);
    expect(skipped).toEqual([{ line: 4, reason: '"Subtotal": no quantity' }]);
  });

  it("believes the broker's own total over quantity times price", () => {
    // 10 x 218.92 is 2189.20, but a broker that rounds its own total is the
    // one holding the position.
    const { balances } = balancesFromCsv("Symbol,Qty,Price,Market Value\nNVDA,10,218.92,2189.15");
    expect(balances[0].valueLocal).toBeCloseTo(2189.15, 6);
  });

  it("derives a price when the export only totalled the position", () => {
    const { balances } = balancesFromCsv("Symbol,Qty,Market Value\nNVDA,10,2189.20");
    expect(balances[0].lastPrice).toBeCloseTo(218.92, 6);
  });

  // The class decides which quote source reprices the row, so it is taken from
  // the file or from the configured default and never inferred from a name.
  it("falls back to the configured class rather than guessing one", () => {
    const { balances } = balancesFromCsv("Symbol,Qty,Price\nWORKPLACE-DC,1,42000", {
      defaultAssetClass: "other",
      defaultCurrency: "GBP",
    });
    expect(balances[0]).toMatchObject({ assetClass: "other", currency: "GBP" });
  });

  it("names the column it could not find instead of returning nothing", () => {
    expect(() => balancesFromCsv("Ticker,Price\nNVDA,218")).toThrow(/no quantity column/);
  });
});

describe("the CSV adapter", () => {
  const adapter = createCsvAdapter({ dir: "/definitely/not/a/directory" });

  it("names the file it wanted rather than reporting an empty account", async () => {
    await expect(adapter.readBalances({ accountKey: "isa" })).rejects.toThrow(/no isa\.csv/);
  });

  // A statement is a snapshot of what was held, not a price feed. Its prices
  // ride on the balance rows and the worker reprices them from a live source.
  it("refuses to be used as a quote source", async () => {
    await expect(adapter.readQuote({ symbol: "NVDA" })).rejects.toMatchObject({ code: UNSUPPORTED_CAPABILITY });
  });
});
