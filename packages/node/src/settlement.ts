import {
  type ResolutionTarget,
  type ResolutionEvidence,
  type Resolution,
  validateEvidence,
} from "@openportfolio/domain";
import type { AdapterRegistry } from "./adapters/registry.ts";

export type DueForecast = {
  id: string;
  subject: string;
  probability: number;
  dueAt: number;
  resolutionTarget?: ResolutionTarget;
};
type SettlementInput = { forecastId: string; observedValue: number; evidence: ResolutionEvidence; note: string };
type Registry = AdapterRegistry;

export async function settleHistoricalForecasts(
  registry: Registry,
  due: readonly DueForecast[],
  settle: (input: SettlementInput) => Promise<Resolution>,
  onPending: (forecast: DueForecast, reason: string) => void,
  now = Date.now(),
) {
  const settled = [];
  for (const forecast of due) {
    const target = forecast.resolutionTarget;
    if (!target || !registry.has(target.venue)) {
      onPending(forecast, "no supported resolution target");
      continue;
    }
    const adapter = registry.get(target.venue);
    if (!adapter.readHistoricalQuote) {
      onPending(forecast, "venue does not support historical observations");
      continue;
    }
    try {
      const quote = await adapter.readHistoricalQuote({ target, dueAt: forecast.dueAt });
      validateEvidence(target, quote.evidence, forecast.dueAt, now);
      const result = await settle({
        forecastId: forecast.id,
        observedValue: quote.price,
        evidence: quote.evidence,
        note: "historical adapter observation under the preregistered policy",
      });
      settled.push({ subject: forecast.subject, probability: forecast.probability, ...result });
    } catch (error) {
      onPending(forecast, String(error));
    }
  }
  return settled;
}

export type DuePage = { page: DueForecast[]; isDone: boolean; continueCursor: string };
export async function drainHistoricalForecasts(
  registry: Registry,
  loadPage: (cursor: string | null, now: number) => Promise<DuePage>,
  settle: (input: SettlementInput) => Promise<Resolution>,
  onPending: (forecast: DueForecast, reason: string) => void,
  now = Date.now(),
) {
  let cursor: string | null = null;
  const settled = [];
  while (true) {
    const result = await loadPage(cursor, now);
    settled.push(...(await settleHistoricalForecasts(registry, result.page, settle, onPending, now)));
    if (result.isDone) return settled;
    if (!result.continueCursor || result.continueCursor === cursor)
      throw new Error("historical forecast cursor did not advance");
    cursor = result.continueCursor;
  }
}

// The due calls only a reader can settle: prose, ticker-only and unsupported
// targets alike. Filtering on the symbol instead left ticker-only calls with
// no worker and no reader, open for good.
export function needsReading<T extends { requiresHistoricalEvidence: boolean }>(due: readonly T[]): T[] {
  return due.filter((row) => !row.requiresHistoricalEvidence);
}
