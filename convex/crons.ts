import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Compatibility queue sweep only. Historical resolution belongs to the
// tenant-scoped worker; balance rows cannot establish a past horizon price.
crons.interval("resolve due forecasts", { minutes: 15 }, internal.forecasts.resolveDue, {});

export default crons;
