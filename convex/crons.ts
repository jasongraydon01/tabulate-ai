import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval(
  "reconcile stale pipeline runs",
  { minutes: 5 },
  internal.runs.reconcileStaleRuns,
);

export default crons;
