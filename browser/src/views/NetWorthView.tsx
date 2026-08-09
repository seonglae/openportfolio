import { useQuery } from "convex/react";
import { weight } from "@openportfolio/core";
import { api } from "../../../convex/_generated/api";
import { formatDate, formatMoney, formatPercent, formatQty, splitMoney } from "../lib/format.ts";

// Pillar one: the scattered accounts as one number, and then immediately the
// breakdown, because a single number with no attribution is a number nobody
// trusts.
export function NetWorthView() {
  const totals = useQuery(api.netWorth.current, {});
  const accounts = useQuery(api.accounts.list, {});
  const balances = useQuery(api.balances.list, {});
  const history = useQuery(api.netWorth.history, { limit: 30 });

  if (!totals) return <p className="text-ink-3">loading</p>;

  const currency = totals.baseCurrency;
  const headline = splitMoney(totals.totalBase, currency);
  const venueOf = new Map((accounts ?? []).map((account) => [account.accountKey, account.venue]));
  const positions = [...(balances ?? [])].sort((a, b) => b.valueBase - a.valueBase);

  return (
    <section>
      <div className="headline">
        <span className="headline-figure">
          <span className="sym">{headline.symbol}</span>
          {headline.rest}
        </span>
        <span className="text-ink-3">
          {totals.accountCount} accounts · {history?.length ?? 0} snapshots
        </span>
      </div>

      <h2 className="section-title">By venue</h2>
      <table className="sheet glass-strong">
        <thead>
          <tr>
            <th>Venue</th>
            <th className="num">Value</th>
            <th className="num">Share</th>
          </tr>
        </thead>
        <tbody>
          {totals.byVenue.map((row) => (
            <tr key={row.venue}>
              <td>{row.venue}</td>
              <td className="num">{formatMoney(row.valueBase, currency)}</td>
              <td className="num">{formatPercent(weight(row.valueBase, totals.totalBase))}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 className="section-title">By asset class</h2>
      <table className="sheet glass-strong">
        <thead>
          <tr>
            <th>Class</th>
            <th className="num">Value</th>
            <th className="num">Share</th>
          </tr>
        </thead>
        <tbody>
          {totals.byAssetClass.map((row) => (
            <tr key={row.assetClass}>
              <td>{row.assetClass}</td>
              <td className="num">{formatMoney(row.valueBase, currency)}</td>
              <td className="num">{formatPercent(weight(row.valueBase, totals.totalBase))}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 className="section-title">Positions</h2>
      <table className="sheet glass-strong">
        <thead>
          <tr>
            <th>Symbol</th>
            <th>Account</th>
            <th>Venue</th>
            <th className="num">Qty</th>
            <th className="num">Price</th>
            <th className="num">Value</th>
            <th className="num">As of</th>
          </tr>
        </thead>
        <tbody>
          {positions.map((row) => (
            <tr key={`${row.accountKey}:${row.symbol}`}>
              <td>{row.symbol}</td>
              <td>{row.accountKey}</td>
              <td>{venueOf.get(row.accountKey) ?? "unlinked"}</td>
              <td className="num">{formatQty(row.qty)}</td>
              <td className="num">{row.lastPrice === undefined ? "-" : formatMoney(row.lastPrice, row.currency)}</td>
              <td className="num">{formatMoney(row.valueBase, currency)}</td>
              <td className="num">{formatDate(row.asOf)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {positions.length === 0 && <p className="text-ink-3">No positions yet. Link an account and run the sync worker.</p>}
    </section>
  );
}
