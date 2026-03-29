import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval(
  "reconcile stale pipeline runs",
  { minutes: 5 },
  internal.runs.reconcileStaleRuns,
);

crons.interval(
  "mark expired runs for retention cleanup",
  { hours: 1 },
  internal.runs.markExpiredRuns,
);

export default crons;
