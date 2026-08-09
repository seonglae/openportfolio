import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { formatDate, formatRelativeDays } from "../lib/format.ts";

// The queue that exists because "wait for the print, then decide" evaporates
// the moment it is said out loud. Overdue rows are listed first and marked,
// since the whole failure mode is a decision quietly never revisited.
export function DecisionsView() {
  const open = useQuery(api.decisions.list, { status: "open" });
  const overdue = useQuery(api.decisions.overdue, {});
  const catalysts = useQuery(api.catalysts.upcoming, { windowDays: 60 });

  if (!open) return <p className="muted">loading</p>;

  const now = Date.now();
  const overdueKeys = new Set((overdue ?? []).map((row) => row.key));
  const rows = [...open].sort((a, b) => {
    const aLate = overdueKeys.has(a.key);
    const bLate = overdueKeys.has(b.key);
    if (aLate !== bLate) return aLate ? -1 : 1;
    return (a.dueAt ?? Number.MAX_SAFE_INTEGER) - (b.dueAt ?? Number.MAX_SAFE_INTEGER);
  });

  return (
    <section>
      <div className="headline">
        <span className="total">{rows.length}</span>
        <span className="muted">open decisions · {overdueKeys.size} past their date</span>
      </div>

      <table>
        <thead>
          <tr>
            <th>Decision</th>
            <th>Trigger</th>
            <th className="num">Due</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className={overdueKeys.has(row.key) ? "late" : ""}>
              <td>
                <strong>{row.title}</strong>
                {row.detail && <div className="muted">{row.detail}</div>}
              </td>
              <td>{row.triggerCondition}</td>
              <td className="num">{row.dueAt === undefined ? "no date" : formatRelativeDays(row.dueAt, now)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <p className="muted">Nothing deferred.</p>}

      <h2>Catalysts ahead</h2>
      <table>
        <thead>
          <tr>
            <th>Event</th>
            <th>Assets</th>
            <th className="num">Date</th>
          </tr>
        </thead>
        <tbody>
          {(catalysts ?? []).map((row) => (
            <tr key={row.key}>
              <td>{row.title}</td>
              <td>{row.assets.join(", ")}</td>
              <td className="num">{formatDate(row.at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {(catalysts ?? []).length === 0 && <p className="muted">No dated events in the next 60 days.</p>}
    </section>
  );
}
