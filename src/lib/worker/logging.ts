import type {
  WorkerQueueDiagnosticsSnapshot,
  WorkerQueueRunDiagnostics,
} from './types';

function shortId(value: string): string {
  if (value.length <= 18) return value;
  return `${value.slice(0, 8)}...${value.slice(-6)}`;
}

function truncateMessage(value: string | undefined, maxLength = 80): string | null {
  if (!value) return null;
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}…`;
}

function formatAge(timestamp: number | undefined, now: number): string | null {
  if (!timestamp) return null;

  const ageMs = Math.max(0, now - timestamp);
  const ageSeconds = Math.floor(ageMs / 1000);

  if (ageSeconds < 60) return `${ageSeconds}s`;

  const ageMinutes = Math.floor(ageSeconds / 60);
  if (ageMinutes < 60) return `${ageMinutes}m`;

  const ageHours = Math.floor(ageMinutes / 60);
  if (ageHours < 48) return `${ageHours}h`;

  const ageDays = Math.floor(ageHours / 24);
  return `${ageDays}d`;
}

function formatCountMap(values: Record<string, number>): string {
  const entries = Object.entries(values).filter(([, count]) => count > 0);
  if (entries.length === 0) return 'none';
  return entries.map(([key, count]) => `${key}:${count}`).join(', ');
}

function formatRunDiagnostics(run: WorkerQueueRunDiagnostics, now: number): string {
  const parts = [
    `run=${shortId(run.runId)}`,
    `project=${shortId(run.projectId)}`,
    `status=${run.status}`,
    `exec=${run.executionState}`,
  ];

  if (run.queueClass) parts.push(`queue=${run.queueClass}`);
  if (run.stage) parts.push(`stage=${run.stage}`);
  if (typeof run.progress === 'number') parts.push(`progress=${Math.round(run.progress)}%`);
  if (typeof run.attemptCount === 'number') parts.push(`attempt=${run.attemptCount}`);
  if (run.workerId) parts.push(`worker=${run.workerId}`);

  const heartbeatAge = formatAge(run.heartbeatAt ?? run.lastHeartbeat, now);
  if (heartbeatAge) parts.push(`heartbeat=${heartbeatAge}`);

  const claimedAge = formatAge(run.claimedAt, now);
  if (claimedAge) parts.push(`claimed=${claimedAge}`);

  const createdAge = formatAge(run.createdAt, now);
  if (createdAge && !claimedAge) parts.push(`age=${createdAge}`);

  if (run.resumeFromStage) parts.push(`resumeFrom=${run.resumeFromStage}`);

  const message = truncateMessage(run.message);
  if (message) parts.push(`msg="${message}"`);

  return parts.join(' ');
}

function pushRunLines(
  lines: string[],
  label: string,
  runs: WorkerQueueRunDiagnostics[],
  now: number,
  maxLines = 3,
): void {
  for (const run of runs.slice(0, maxLines)) {
    lines.push(`[Worker] ${label}: ${formatRunDiagnostics(run, now)}`);
  }

  if (runs.length > maxLines) {
    lines.push(`[Worker] ${label}: +${runs.length - maxLines} more`);
  }
}

export function formatWorkerQueueSnapshotLog(
  snapshot: WorkerQueueDiagnosticsSnapshot,
  now = Date.now(),
): string[] {
  const lines: string[] = [];
  const activeStates = formatCountMap(snapshot.activeByClass);

  if (
    snapshot.queuedCount === 0
    && snapshot.activeCount === 0
    && snapshot.pendingReviewCount === 0
  ) {
    lines.push('[Worker] Waiting for runs. active=0 pendingReview=0 activeStates=none');
    return lines;
  }

  if (snapshot.queuedCount === 0) {
    lines.push(
      `[Worker] No claimable queued runs. active=${snapshot.activeCount} ` +
        `pendingReview=${snapshot.pendingReviewCount} activeStates=${activeStates}`,
    );
    pushRunLines(lines, 'Active', snapshot.activeRuns, now);
    pushRunLines(lines, 'Pending review', snapshot.pendingReviewRuns, now);
    return lines;
  }

  if (snapshot.eligibleCount === 0) {
    lines.push(
      `[Worker] Queued runs are blocked. queued=${snapshot.queuedCount} blocked=${snapshot.blockedCount} ` +
        `pendingReview=${snapshot.pendingReviewCount} orgLimit=${snapshot.blockedByOrgLimitCount} ` +
        `demoLimit=${snapshot.blockedByDemoLimitCount} activeStates=${activeStates}`,
    );
    pushRunLines(lines, 'Active', snapshot.activeRuns, now);
    pushRunLines(lines, 'Queued', snapshot.queuedRuns, now);
    pushRunLines(lines, 'Pending review', snapshot.pendingReviewRuns, now);
    return lines;
  }

  lines.push(
    `[Worker] Queue has pending work. queued=${snapshot.queuedCount} eligible=${snapshot.eligibleCount} ` +
      `pendingReview=${snapshot.pendingReviewCount} next=${snapshot.nextClaimableQueueClass} ` +
      `activeStates=${activeStates}`,
  );
  pushRunLines(lines, 'Active', snapshot.activeRuns, now);
  pushRunLines(lines, 'Queued', snapshot.queuedRuns, now);
  pushRunLines(lines, 'Pending review', snapshot.pendingReviewRuns, now);
  return lines;
}
