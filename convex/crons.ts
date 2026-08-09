import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Every fifteen minutes, settle the calls whose horizon has passed and whose
// criterion the parser can handle. Anything it cannot observe stays open, which
// is why this is safe to run this often: the failure mode is a call waiting a
// quarter of an hour longer, not a call scored on a stale number.
crons.interval("resolve due forecasts", { minutes: 15 }, internal.forecasts.resolveDue, {});

export default crons;
