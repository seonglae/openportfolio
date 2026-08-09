import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { formatBrier, formatDate, formatPercent } from "../lib/format.ts";

const BAR_WIDTH = 220;

// Pillar three: the record as measured rather than as remembered. The
// reliability diagram is deliberately the biggest thing on the page, because
// the mean Brier alone hides which direction the forecaster is wrong in.
export function RecordView() {
  const record = useQuery(api.forecasts.calibration, {});
  const forecasts = useQuery(api.forecasts.list, { limit: 50 });

  if (!record) return <p className="muted">loading</p>;

  return (
    <section>
      <div className="headline">
        <span className="total">{formatBrier(record.meanBrier)}</span>
        <span className="muted">
          mean Brier over {record.n} scored calls · coin flip is {record.randomBaseline} · calibration error{" "}
          {formatPercent(record.expectedCalibrationError)}
        </span>
      </div>

      <h2>Reliability</h2>
      <table>
        <thead>
          <tr>
            <th>Said</th>
            <th className="num">Calls</th>
            <th className="num">Happened</th>
            <th>Gap</th>
          </tr>
        </thead>
        <tbody>
          {record.buckets.map((bucket) => (
            <tr key={bucket.lower}>
              <td>
                {formatPercent(bucket.lower)} to {formatPercent(bucket.upper)}
              </td>
              <td className="num">{bucket.count}</td>
              <td className="num">{bucket.count === 0 ? "-" : formatPercent(bucket.observedRate)}</td>
              <td>
                <span className="bar" style={{ width: `${bucket.meanProbability * BAR_WIDTH}px` }} />
                <span className="bar observed" style={{ width: `${bucket.observedRate * BAR_WIDTH}px` }} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Calls</h2>
      <table>
        <thead>
          <tr>
            <th>Subject</th>
            <th>Criterion</th>
            <th className="num">Said</th>
            <th>Status</th>
            <th className="num">Brier</th>
            <th className="num">Due</th>
          </tr>
        </thead>
        <tbody>
          {(forecasts ?? []).map((row) => (
            <tr key={row._id}>
              <td>{row.subject}</td>
              <td className="mono">{row.resolutionCriterion}</td>
              <td className="num">{formatPercent(row.probability)}</td>
              <td>{row.status}</td>
              <td className="num">{formatBrier(row.brier ?? null)}</td>
              <td className="num">{formatDate(row.dueAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {(forecasts ?? []).length === 0 && (
        <p className="muted">No calls registered yet. Every claim worth making is worth scoring.</p>
      )}
    </section>
  );
}
