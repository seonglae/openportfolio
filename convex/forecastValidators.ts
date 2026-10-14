import { v } from "convex/values";
import { ASSET_CLASSES } from "@openportfolio/domain";
import { literals } from "./validators";

const identity = {
  assetId: v.string(),
  symbol: v.string(),
  assetClass: literals(ASSET_CLASSES),
  venue: v.string(),
  currency: v.string(),
  observationPolicy: v.optional(v.union(v.literal("exact"), v.literal("last_completed_minute"))),
  maxAgeMs: v.optional(v.number()),
  priceBasis: v.optional(v.literal("provider_close")),
  sessions: v.optional(v.literal("all")),
};
export const resolutionTarget = v.object(identity);
export const resolutionEvidence = v.object({
  ...identity,
  observedAt: v.number(),
  source: v.string(),
  retrievedAt: v.optional(v.number()),
  parsedResponseSha256: v.optional(v.string()),
});
