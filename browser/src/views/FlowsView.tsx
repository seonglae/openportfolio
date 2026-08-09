import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";

const WINDOW_DAYS = 30;
const RECENT_ROWS = 40;

// Pillar two. Price is the output of who was buying and who was made to sell,
// so the flow series sits next to the tape rather than under it.
export function FlowsView() {
  const [market, setMarket] = useState("KOSPI");
  const recent = useQuery(api.flows.list, { market });
  const net = useQuery(api.flows.netByInvestor, { market, days: WINDOW_DAYS });

  return (
    <section>
      <div className="headline">
        <input value={market} onChange={(e) => setMarket(e.target.value)} aria-label="market" />
        <span className="text-ink-3">
          net buying over the last {net?.sessions ?? 0} sessions{net?.currency ? ` (${net.currency})` : ""}
        </span>
      </div>

      <table className="sheet glass-strong">
        <thead>
          <tr>
            <th>Investor</th>
            <th className="num">Net bought</th>
          </tr>
        </thead>
        <tbody>
          {(net?.byInvestor ?? []).map((row) => (
            <tr key={row.investorType}>
              <td>{row.investorType}</td>
              <td className={row.netBuyValue < 0 ? "num text-loss" : "num"}>{row.netBuyValue.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {(net?.byInvestor ?? []).length === 0 && (
        <p className="text-ink-3">No flow recorded for {market}. Feed it with the record_flow tool or the MCP server.</p>
      )}

      <h2 className="section-title">Sessions</h2>
      <table className="sheet glass-strong">
        <thead>
          <tr>
            <th>Date</th>
            <th>Investor</th>
            <th className="num">Net</th>
            <th className="num">Turnover</th>
            <th>Source</th>
          </tr>
        </thead>
        <tbody>
          {(recent ?? []).slice(0, RECENT_ROWS).map((row) => (
            <tr key={row._id}>
              <td>{row.date}</td>
              <td>{row.investorType}</td>
              <td className={row.netBuyValue < 0 ? "num text-loss" : "num"}>{row.netBuyValue.toLocaleString()}</td>
              <td className="num">{row.turnoverValue?.toLocaleString() ?? "-"}</td>
              <td className="text-ink-3">{row.source}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
