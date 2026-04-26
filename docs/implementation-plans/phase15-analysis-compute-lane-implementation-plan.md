# Phase 15 Sub-Plan — Analysis Compute Lane

**Status:** Design specified, not implemented.

**Goal:** add a safe compute lane to the Phase 15 analysis surface so users can request new cuts, NETs, and derived views without weakening the trust contract or mutating the processor-deliverable artifacts from the original run.

**Relationship to the main Phase 15 plan:** this is the implementation sub-plan for the analytical-layer items in [phase15-chat-with-your-data-v1-implementation-plan.md](/Users/jasongraydon01/tabulate-ai/docs/implementation-plans/phase15-chat-with-your-data-v1-implementation-plan.md). The main plan stays focused on surface-level scope; this document translates that scope into codebase-level decisions.

---

## What this must achieve

The analysis compute lane exists to let the analysis surface ask for new computed numbers while preserving the product's central promise:

- the assistant may propose a computation, but it does not invent dataset-specific numbers
- any new percentages, counts, means, or significance calls must come from backend compute
- the original run's `results/tables.json` remains immutable
- historical analysis messages keep pointing at the artifact set they cited at the time
- the analysis surface does not become a shadow pipeline with ad hoc behavior

There are two supported job classes:

1. **Tier A: `single_table_derivation`**
   One table, or a very small related set, with an added cut, NET, or derived view.

2. **Tier B: `banner_extension_recompute`**
   A run-level extension where a new banner cut is applied across the tab set.

---

## Recommendation

**Ship Tier B first.**

That recommendation is driven by the current codebase, not by abstract product preference:

- The existing worker queue and recovery model already know how to execute run-scoped work through `runs.enqueueForWorker`, `claimNextQueuedRun`, `runClaimedWorkerRun`, and the V3 compute boundary.
- `runComputePipeline` is already the clean reusable seam for planning/compute continuation.
- The current analysis persistence model (`analysisSessions`, `analysisMessages`, `analysisArtifacts`) does not yet have a first-class lineage model for persistent derived tables.
- Tier A has the better in-chat UX, but it introduces the harder problems first: artifact identity, citation lineage, and canonical-vs-derived table discovery.

The safe sequence is:

1. build the shared analysis compute job substrate
2. ship Tier B child-run recompute on top of that substrate
3. add Tier A derived-table persistence after lineage and citation rules are explicit

---

## Current code constraints

The implementation needs to respect the actual shape of the current system:

- `src/app/api/runs/[runId]/analysis/route.ts` is currently a grounded retrieval route, not a compute launcher.
- `src/lib/analysis/grounding.ts` reads run artifacts from R2 and assumes the run's artifact set is already settled.
- `analysisArtifacts` currently supports only `table_card` and `note`, with `sourceClass` values intended for v1 rendering, not durable compute lineage.
- `runs.executionPayload` and `convex/runExecutionValidators.ts` are still shaped around the upload-driven pipeline flow:
  - `sessionId`
  - `pipelineContext`
  - input file names
  - input R2 refs
  - optional `loopStatTestingMode`
- `runClaimedWorkerRun` currently dispatches either:
  - full pipeline execution via `runPipelineFromUpload`
  - review resume via `runQueuedReviewResume`

That means analysis compute should **not** be squeezed into the current payload format as a disguised upload run. It needs a small, explicit execution model of its own.

---

## Hard architectural decisions

### 1. Original run artifacts are immutable

Do not patch or rewrite the source run's `results/tables.json`.

- Tier A adds a sibling derived artifact on top of the source run
- Tier B creates a child run / run revision

This preserves provenance and avoids citation drift.

### 2. Analysis compute is backend-owned

The model can identify a useful extension and explain it, but the authoritative transition into compute happens in backend code after explicit user confirmation.

The analysis prompt should not be treated as the enforcement layer.

### 3. Tier B is a child run, not a mutated run

The recomputed tab set should live under a new `runId` with explicit lineage back to the parent run.

This lets:

- the original thread remain historically correct
- the child run receive normal progress, recovery, and artifact handling
- the resumed analysis session target the new run once artifacts are ready

### 4. Tier A needs first-class lineage, not just a rendered card

`analysisArtifacts` can continue to hold renderable table-card payloads, but it is not enough on its own to model durable computed derivations.

Tier A needs a persistent record that says:

- what was derived
- from which run
- from which source table(s)
- by which compute job
- where the computed artifact lives in R2

---

## Proposed persistent model

### A. New table: `analysisComputeJobs`

Purpose: track every analysis-triggered compute request, regardless of whether it becomes a child run or a derived artifact.

Recommended fields:

- `orgId`
- `projectId`
- `sourceRunId`
- `sessionId`
- `requestedBy`
- `jobType: 'single_table_derivation' | 'banner_extension_recompute'`
- `status: 'draft' | 'confirmed' | 'queued' | 'running' | 'success' | 'error' | 'cancelled'`
- `requestSummary`
- `requestPayload`
- `startedAt`
- `completedAt`
- `error`
- `resultKind: 'derived_artifact' | 'child_run' | null`
- `resultRunId`
- `resultDerivationId`

Why this table exists:

- chat needs its own durable request object
- not every job maps cleanly to a run
- Tier A and Tier B should share one lifecycle model

### B. New table: `analysisDerivations`

Purpose: persist Tier A lineage as a real analytical artifact, separate from UI table cards.

Recommended fields:

- `orgId`
- `projectId`
- `sourceRunId`
- `sessionId`
- `computeJobId`
- `derivationType: 'added_cut' | 'net' | 'derived_view'`
- `status: 'success' | 'error'`
- `title`
- `sourceTableIds`
- `sourceQuestionIds`
- `artifactPath`
- `manifestPath`
- `createdBy`
- `createdAt`

Notes:

- this is the durable analytical object
- `analysisArtifacts` remains the message/render surface
- a rendered table card for a derivation can reference `analysisDerivations` lineage

### C. Extend `runs` for child-run lineage

Tier B should use the existing `runs` table, but it needs optional lineage fields so a recompute run is legible in code and in the UI.

Recommended optional additions:

- `parentRunId`
- `runKind: 'standard' | 'analysis_extension'`
- `analysisComputeJobId`
- `analysisExtensionType: 'banner_extension_recompute' | null`

These fields should be optional so existing production rows remain valid.

### D. Extend `analysisArtifacts.sourceClass`

For render-time differentiation, add a new source class for computed analytical evidence.

Recommended addition:

- `'analysis_compute'`

This keeps the current simple split intact:

- `from_tabs`
- `analysis_compute`
- `assistant_synthesis`

---

## Execution model

### Tier B: child-run banner extension

### User flow

1. User asks in chat for a missing cut across the dataset.
2. Assistant explains the proposed banner extension.
3. User explicitly confirms.
4. Backend creates an `analysisComputeJobs` record.
5. Backend creates a child `runs` record with lineage to the source run.
6. Backend enqueues that child run for the worker.
7. UI leaves normal chat-answer flow and shows run-progress state.
8. When the child run succeeds, the analysis workspace reopens on the child run with a system message explaining that the extended tabs are ready.

### Why this should use child runs

The codebase already supports:

- run-scoped worker scheduling
- checkpoint/recovery
- artifact upload to per-run R2 paths
- analysis sessions keyed to a run

Using a child run reuses those primitives instead of inventing a partial pipeline execution model hidden inside analysis-only tables.

### Required backend work

#### 1. New analysis compute route

Recommended route:

- `POST /api/runs/[runId]/analysis/compute`

Responsibilities:

- `requireConvexAuth()`
- `applyRateLimit(..., 'high', 'analysis_compute')`
- verify org ownership of run + session
- validate job payload with Zod
- require an explicit confirmation token / flag from the client
- create the compute job record
- for Tier B, create a child run and enqueue it

#### 2. Child-run execution payload strategy

Do **not** pretend this is a new upload.

Instead, extend the worker execution model so an analysis extension run can carry explicit extension metadata. Two reasonable shapes:

- add optional `analysisExtension` to `executionPayload`
- or add a sibling execution payload validator specifically for analysis-extension runs

Recommended direction:

- extend `executionPayload` with an optional `analysisExtension` object
- keep it optional so upload-driven runs still validate

Recommended `analysisExtension` payload:

- `type: 'banner_extension_recompute'`
- `sourceRunId`
- `sourceSessionId`
- `bannerGroupsToAdd`
- `sourceArtifactRefs`

#### 3. Worker dispatch

Update `runClaimedWorkerRun` to dispatch a third execution path:

- upload pipeline
- review resume
- analysis extension run

Recommended new entry point:

- `src/lib/analysis/runAnalysisExtension.ts`

That module should:

- reconstruct the required source-run artifacts from R2
- reuse `questionid-final.json` and canonical tables from the source run
- rebuild planning artifacts as needed for the new banner extension
- continue through compute and post-processing
- upload a full, normal child-run artifact set under the child run's R2 prefix

### Reuse boundaries

Tier B should reuse, not fork:

- `src/lib/v3/runtime/compute/runComputePipeline.ts`
- existing post-processing / results finalization
- existing worker queue and `runs` lifecycle
- existing R2 per-run artifact conventions

It should **not** reuse:

- the full raw-ingestion path in `runPipelineFromUpload`
- the review-only assumptions in `runQueuedReviewResume`

This is a third path: run-level extension from settled upstream artifacts.

---

## Tier A: single-table derivation

### User flow

1. User asks for an added cut, NET, or derived view on one table.
2. Assistant explains what will be computed and what source table it is based on.
3. User explicitly confirms.
4. Backend creates an `analysisComputeJobs` record.
5. Backend executes a scoped compute job.
6. Successful output is persisted as an `analysisDerivations` record plus an artifact in R2.
7. The analysis thread receives a grounded render card and citation-capable derived evidence.

### Why Tier A is not just `analysisArtifacts`

`analysisArtifacts` is currently a session-scoped render object. That is useful for message replay, but insufficient for analytical lineage.

Tier A needs a persistent artifact identity that survives beyond one rendered message and can be rediscovered later.

### Execution path

Tier A should not create a child run at first.

Recommended execution model:

- create `analysisComputeJobs`
- execute a scoped backend compute path
- persist the derived artifact under the source run's `analysis/derivations/` namespace
- persist one `analysisDerivations` row
- optionally create an `analysisArtifacts` table card when the derivation is rendered in-chat

Recommended R2 path:

- `{orgId}/{projectId}/runs/{runId}/analysis/derivations/{derivationId}/manifest.json`
- `{orgId}/{projectId}/runs/{runId}/analysis/derivations/{derivationId}/results/derived-table.json`
- `{orgId}/{projectId}/runs/{runId}/analysis/derivations/{derivationId}/compute/*`

### Open implementation choice

Tier A can either:

- execute inside the existing worker queue
- or run through a narrower server-side job runner

Recommendation:

- keep the lifecycle in `analysisComputeJobs`
- but defer worker-queue integration until after Tier B ships

Reason:

- Tier A is not a normal run
- forcing it through `runs` too early creates unnecessary complexity

---

## Citation and provenance rules

### Source-of-truth rules

- Canonical run artifacts cite as they do today through `tableId + rowKey + cutKey`
- Tier A derived tables cite against the derived artifact's own stable identity, while carrying source-run and source-table lineage
- Tier B child-run tables cite against the child run's canonical results

### No citation drift

Historical messages on the source run stay tied to the source run.

Do not reinterpret old cite chips after a Tier B extension exists.

### Discovery rules

`searchRunCatalog` and `fetchTable` should remain source-run tools until compute-lane follow-on work adds controlled discovery of derived evidence.

Recommendation:

- Tier B first: no change needed to discovery semantics beyond switching to the child run once resumed
- Tier A later: add a dedicated discovery path for derivations rather than silently merging them into canonical run search

---

## UI/session behavior

### Tier B

- the active thread should show a system-level transition: "Requested banner extension is running"
- the workspace should be able to swap from message streaming into run-progress mode
- on success, create or reopen an analysis session on the child run
- prepend a system message describing:
  - what cut was added
  - that the new thread/run is derived from the original run

### Tier A

- the thread can remain in the same session
- when the compute completes, append a system or assistant message with the new grounded card
- the derivation should be visibly marked as analysis-added, not part of the original delivered tab book

---

## Security and safety requirements

- every compute route must start with `requireConvexAuth()`
- apply `high` tier rate limiting
- validate all analysis-compute payloads with Zod
- never let model text become R code directly
- any new R expressions must still pass existing sanitization / validation layers
- use `execFile()` only
- persist failures with structured error records, following the existing error persistence conventions
- keep org ownership checks on:
  - source run
  - child run
  - session
  - derivation records

---

## Implementation slices

### Slice A: child-run substrate for Tier B

- add `analysisComputeJobs`
- add optional lineage fields to `runs`
- add analysis-compute API route
- add analysis-extension execution payload support
- add worker dispatch path for analysis extension runs
- implement artifact reconstruction from source run + child-run finalize path
- implement analysis-session resume behavior for child runs

### Slice B: prompt + UI handshake for Tier B

- teach the assistant how to propose a banner extension without implying it has already happened
- require explicit user confirmation before compute starts
- add run-progress transition UI in the analysis workspace
- add child-run resume system messaging

### Slice C: Tier A lineage substrate

- add `analysisDerivations`
- add `analysis_compute` source class
- define derivation manifest contract and R2 paths
- add render-time support for derived evidence in the message layer

### Slice D: Tier A execution + discovery

- implement scoped compute runner for single-table derivations
- append grounded derived cards into the thread
- add controlled re-discovery of prior derivations within a run

---

## Testing expectations

At minimum:

- Convex tests or deterministic route tests for job creation and auth failures
- worker dispatch tests for the new analysis-extension path
- deterministic tests for source-run artifact reconstruction
- regression tests that old analysis citations do not drift after a child run is created
- message/render tests for derived artifact labeling once Tier A lands
- `npm run lint && npx tsc --noEmit`
- targeted Vitest coverage for any new route, persistence, or execution modules

---

## Explicit non-goals for this sub-plan

- no querying raw `.sav` from model-facing grounding tools
- no in-place rewrite of canonical run artifacts
- no merging analysis compute back into the normal processor-facing HITL flow
- no speculative generalized compute framework beyond the two job classes above

---

## Final recommendation

The safest implementation path is:

1. add a real `analysisComputeJobs` lifecycle
2. use it to ship Tier B as a child-run extension flow
3. only then add Tier A once derivation identity and citation lineage are explicit

That sequence is slower than an in-chat shortcut, but it is the one most consistent with the current TabulateAI architecture and the least likely to introduce subtle provenance bugs.
