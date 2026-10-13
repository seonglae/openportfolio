import type { InvestorType } from "./enums.ts";

export type FlowMeasurement = "net_buying" | "net_position_change";
type Flow = {
  investorType: InvestorType;
  source: string;
  turnoverValue?: number;
  openInterestContracts?: number;
  measurement?: FlowMeasurement;
};
const LEGACY_COT: Partial<Record<InvestorType, InvestorType>> = {
  retail: "non_reportable",
  institution: "non_commercial",
  other: "commercial",
};

// Read-time migration leaves historical source rows intact. Previously COT
// open interest occupied the turnover field, and its classes used KRX labels.
export function normalizeFlow<T extends Flow>(row: T) {
  if (row.source === "CFTC COT") {
    return {
      ...row,
      investorType: LEGACY_COT[row.investorType] ?? row.investorType,
      openInterestContracts: row.openInterestContracts ?? row.turnoverValue,
      turnoverValue: undefined,
      measurement: "net_position_change" as const,
    };
  }
  return { ...row, measurement: row.measurement ?? "net_buying" };
}
