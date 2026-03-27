# Pipeline Worker Implementation Plan

## Summary
Move pipeline execution out of the web app process and into a dedicated worker service so deploys do not kill active TabulateAI runs. Add durable stage-boundary checkpoint persistence and stale-run recovery so interrupted runs can resume from the last safe checkpoint instead of restarting from scratch.

## Goal
After this work:

- web/API deploys do not terminate active runs
- pipeline execution lives in a dedicated worker process/service
- runs are claimed atomically and processed by only one worker
- worker heartbeats make stale/interrupted runs detectable
- interrupted runs can resume from the last persisted V3 checkpoint and artifacts
- review pause/resume continues to work through the same run record

## Scope
This plan covers:

- queueing and worker ownership
- durable stage-boundary checkpoint persistence
- stale-run recovery
- cancellation compatibility
- deploy-safe execution

This plan does not cover:

- full workflow-engine orchestration
- arbitrary retry of every sub-step
- advanced autoscaling strategies beyond safe basic claiming

## Current Status
Implementation status as of 2026-03-27:

- Phase 1 is complete: fresh launches are worker-owned
- Phase 2 is complete: durable stage-boundary recovery manifests persist to R2
- Phase 3 is complete: stale claimed/running runs are requeued and resume coarsely from the last durable boundary
- Phase 4 is complete: review submission is control-plane only and post-review continuation is worker-owned
- web/API is now the control plane, and the worker owns long-running execution

Implemented durable boundaries:

- after question-id chain
- after fork/join
- after review checkpoint creation
- after compute package creation

Important behavioral notes:

- web redeploys should not interrupt active runs because the web process no longer owns execution
- worker redeploys recover after the stale-lease threshold and resume from the last durable boundary when the recovery set is complete
- worker redeploys before the first durable boundary may restart from the top; that is expected under the coarse-resume model
- incomplete durable recovery sets fail explicitly instead of silently hanging or guessing

## Previous State
Before this work, the web app started long-running pipeline work directly from the launch route. For example:

- [`src/app/api/projects/launch/route.ts`](/Users/jasongraydon01/tabulate-ai/src/app/api/projects/launch/route.ts) kicks off `runPipelineFromUpload(...)` in-process
- [`src/lib/api/pipelineOrchestrator.ts`](/Users/jasongraydon01/tabulate-ai/src/lib/api/pipelineOrchestrator.ts) owns the long-running background pipeline path
- [`src/lib/v3/runtime/persistence.ts`](/Users/jasongraydon01/tabulate-ai/src/lib/v3/runtime/persistence.ts) writes `checkpoint.json` locally inside the run output directory

That meant a deploy could terminate the process that owned the run, and local disk alone was not sufficient for robust restart recovery.

## Target Architecture

### 1. Add explicit queue and lease state to runs
Extend the Convex `runs` model with worker execution metadata:

- `executionState`: `queued | claimed | running | pending_review | resuming | success | partial | error | cancelled`
- `workerId`
- `claimedAt`
- `heartbeatAt`
- `attemptCount`
- `resumeFromStage?`
- `lastDurableCheckpointAt?`
- `lastDurableCheckpointStage?`
- `recoveryStatus?`

Keep existing user-facing `status` fields. Use the new execution fields for worker ownership and queue behavior so UI status and execution control do not get tangled.

### 2. Web app enqueues, worker executes
Change launch and review routes so they do not execute the pipeline inline:

- `/api/projects/launch`
  - creates run
  - uploads initial input artifacts as today
  - marks run `queued`
  - returns immediately
- review completion route
  - persists review decision payload
  - marks run `queued` with `resumeFromStage`
  - worker picks it up

### 3. Dedicated worker service
Create a separate worker process/service:

- loop:
  - atomically claim one eligible run
  - start heartbeat timer
  - execute pipeline
  - clear heartbeat and finalize run state
- worker should use a stable `workerId`
- start with one run per worker process
- add concurrency later only if needed

### 4. Atomic claim plus stale-run recovery
Add Convex internal mutations/queries for:

- `claimNextQueuedRun(workerId)`
- `heartbeatRun(runId, workerId)`
- `releaseRun(runId, workerId, reason)`
- `requeueStaleRuns(staleBeforeMs)`

Rules:

- only claim runs in `queued`
- claim sets `workerId`, `claimedAt`, `heartbeatAt`, `executionState=claimed`
- stale runs are those in `claimed | running | resuming` with an old heartbeat
- stale runs are requeued for recovery instead of silently failing

### 5. Durable checkpoint persistence beyond local disk
Persist V3 checkpoint state and the artifacts needed for resume to R2 after major stage boundaries:

- after question-id chain
- after fork join
- after review checkpoint creation
- after compute chain if useful

Persist companion artifacts needed for resume:

- `questionid-final`
- canonical table artifacts
- planning artifacts
- compute inputs where needed
- source `.sav`
- survey / banner inputs where relevant

Store remote keys on the run record or in a dedicated recovery artifact object.

### 6. Resume model
Resume should be coarse, not micro-grained.

Supported resume points:

- before/after question-id chain
- after fork join
- after review checkpoint
- after compute chain if useful
- not inside a single agent call
- not inside R execution

Worker startup path:

- if run is fresh, start from the beginning
- if run has durable checkpoint metadata, load checkpoint/artifacts from R2 and continue from the next stage boundary
- if recovery artifacts are incomplete, fail cleanly with an actionable reason

### 7. Keep review flow aligned
Current review flow already persists state and some R2 artifacts. Unify that with the worker model:

- review-required runs become `pending_review`
- review submission does not resume inline in the API
- review submission marks run `queued` with review decisions attached
- worker resumes compute/post-processing from recovered checkpoint

### 8. Cancellation
Preserve end-to-end cancellation:

- cancellation route marks run `cancelRequested`
- worker heartbeat loop checks Convex cancel flag periodically
- existing `AbortSignal` propagation remains inside the process
- on worker restart, cancelled stale runs are not requeued

### 9. Deployment posture
Desired deploy behavior:

- web deploys: safe
- worker deploys: interrupted runs are requeued and resumed from last durable checkpoint
- optional graceful shutdown later:
  - worker stops claiming new runs
  - in-flight run continues until termination window or next restart

## Implementation Phases

## Phase 1: Queue and Worker Skeleton
- Status: complete
- add execution metadata to `runs`
- add Convex claim/heartbeat/requeue primitives
- refactor launch route to enqueue instead of running inline
- create worker entrypoint/service
- move `runPipelineFromUpload` invocation into the worker
- keep one worker / one run at a time

Exit criteria:

- new runs are processed only by the worker
- web deploys no longer kill execution because the web app is not executing runs

## Phase 2: Durable Checkpoint Persistence
- Status: complete
- define durable checkpoint manifest schema
- upload checkpoint and required artifacts to R2 at stage boundaries
- persist remote artifact refs on run result / execution metadata
- add helper to hydrate a local worker workspace from R2 before resume

Exit criteria:

- worker restart can reconstruct pipeline context from durable artifacts

## Phase 3: Recovery and Resume
- Status: complete
- add stale-run scanner on worker startup and on an interval
- requeue interrupted runs with recovery metadata
- resume from the last durable stage boundary
- fail explicitly when the checkpoint/artifact set is incomplete

Exit criteria:

- deploy/restart during an active run no longer forces a full restart from scratch in normal cases

## Phase 4: Review Path Integration
- Status: complete
- convert review submission to queue a resume job
- worker handles post-review continuation
- remove remaining inline long-running post-review execution from the request lifecycle

Exit criteria:

- all long-running pipeline execution paths are worker-owned

## Files and Areas Likely Touched

- `convex/schema.ts`
- `convex/runs.ts`
- `src/app/api/projects/launch/route.ts`
- `src/app/api/runs/[runId]/review/route.ts`
- `src/lib/api/pipelineOrchestrator.ts`
- `src/lib/api/reviewCompletion.ts`
- `src/lib/v3/runtime/persistence.ts`
- `src/lib/r2/R2FileManager.ts`
- `src/lib/abortStore.ts`
- new worker files, likely under:
  - `src/lib/worker/`
  - `scripts/worker.ts`
- deployment/runtime config for separate worker service

## Suggested Run Metadata Additions

- `executionState`
- `workerId`
- `claimedAt`
- `heartbeatAt`
- `attemptCount`
- `lastDurableCheckpointStage`
- `lastDurableCheckpointAt`
- `recoveryArtifacts`
- `resumeRequestedAt`
- `resumeSource`

## Testing Plan

### Deterministic tests
- claim mutation only returns one run to one worker
- stale-run requeue logic only requeues expired leases
- cancelled runs are not requeued
- launch route enqueues instead of executing inline
- review route enqueues resume instead of executing inline
- checkpoint manifest persistence writes expected artifact refs
- resume loader reconstructs run context from durable refs

### Integration-style tests
- worker claims queued run and updates heartbeat
- worker restart with stale claimed run leads to requeue and resume
- review-required run pauses, then review submission queues worker resume
- cancellation during worker execution marks run cancelled cleanly

### Operational validation status
- Confirmed: redeploying the web app during an active run does not interrupt the pipeline
- Confirmed: redeploying the worker causes stale-lease recovery and the run is reclaimed
- Expected behavior: if the worker is redeployed before the first durable boundary, the run may restart from the top
- Remaining validation focus: redeploy the worker after review submission while post-review compute/R execution is active, and confirm coarse resume from the review checkpoint / later durable boundary

### Validation commands
At minimum during implementation:

- targeted Vitest for queue/worker/recovery modules
- `npm run lint`
- `npx tsc --noEmit`

## Risks and Tradeoffs

- biggest risk is splitting responsibility incorrectly between web and worker
- second biggest risk is incomplete recovery artifacts, which would create false confidence about resume
- keep resume coarse and explicit to reduce complexity
- do not attempt “resume anywhere” semantics

## Remaining Work
Architecture work is complete. What remains before calling this fully validated in practice is narrow operational testing:

- redeploy the worker after review submission while compute / R execution is in progress
- confirm the run is reclaimed after the stale threshold and resumes from the latest durable boundary instead of restarting unnecessarily
- once that is confirmed, deployment behavior can be considered validated for the surfaces that motivated this project
