# Phase 15 Sub-Plan — Analysis Compute Lane

**Status:** Slices 1-2 implemented for Tier B banner-extension recompute. Slice 3 / Tier A single-table derivations is the next compute-lane product slice.

**Purpose:** define the compute-lane architecture for Phase 15 so the analysis surface can extend a completed run without mutating the original run or re-litigating banner work that is already settled.

This document records the implemented Slice 1 backend/API/worker boundary and the implemented Slice 2 analysis-workspace handoff. The current compute lane supports one appended banner group at a time and creates a child run without mutating the parent run.

---

## Current state

The base analysis surface remains read-only with respect to settled parent-run artifacts, but the analysis workspace now has a separate analysis-triggered compute lane for Tier B banner extensions.

- `src/app/api/runs/[runId]/analysis/route.ts` streams grounded answers over settled run artifacts.
- `src/lib/analysis/grounding.ts` reads:
  - `results/tables.json`
  - `enrichment/12-questionid-final.json`
  - `planning/20-banner-plan.json`
  - `planning/21-crosstab-plan.json`
- Stage 20 is the banner-planning step:
  - `BannerAgent` extracts groups and cuts from an uploaded banner document
  - `BannerGenerateAgent` generates groups and cuts when the banner route falls back
  - output is `planning/20-banner-plan.json`
- Stage 21 is the crosstab-validation step:
  - `CrosstabAgentV2` validates banner groups against the dataset
  - output is `planning/21-crosstab-plan.json`
- The worker runtime knows how to do:
  - full pipeline runs
  - review resumes
  - analysis-triggered banner-extension child runs

Slices 1-2 added:

- `analysisComputeJobs` lifecycle persistence
- optional child-run lineage on `runs`
- preflight and confirm API routes under `/api/runs/[runId]/analysis/compute/...`
- `AnalysisBannerExtensionAgent` for drafting one appended banner group
- single-group validation through the existing `CrosstabAgentV2` `processGroupV2` seam
- frozen fingerprinted job artifacts
- an analysis-extension worker payload and worker dispatch path
- a child-run executor that hydrates parent artifacts, merges the frozen appended group, runs compute/finalization under the child run id, and posts durable status messages back to the originating analysis session
- a sanitized read-only `analysisComputeJobs.listForSession` query for the analysis workspace
- explicit in-chat compute controls separate from normal assistant turns
- proposal, clarification, queued/running, complete, failed, cancelled, and expired job cards
- persisted cancel/reject through the compute-job API
- refresh-safe resume from the parent analysis session
- a completed-run handoff that creates or reuses a child-run analysis session
- internal-only raw compute-job reads for API routes; browser-visible compute-job state goes through the sanitized read model

---

## Where we need to be

For Tier B, the target workflow is:

1. User asks in analysis for a new cut across the dataset.
2. Analysis asks whether this is:
   - a table-only request
   - or a full rerun / banner extension
3. For a full rerun, analysis stays in chat and runs a **preflight**.
4. Preflight inspects:
   - the parent run's stage 20 banner plan
   - the parent run's stage 21 crosstab plan
   - the parent run's question/variable context
5. Preflight drafts **one appended banner group**.
6. Preflight immediately validates **only that one appended group** with the same single-group validation logic stage 21 uses.
7. Analysis shows the user the exact proposed group and cuts it found.
8. The user confirms yes or no in chat.
9. After final confirmation, backend creates a child run and moves into pipeline-in-progress.
10. The child run reuses the parent run's settled planning artifacts for all previously approved groups and appends the confirmed new group.
11. The child run recomputes outputs under a new run id. The original run remains unchanged.

The critical property is: **what the user aligned on in chat is what the child run actually consumes**.

---

## Why we chose this architecture

### 1. It preserves the good UX without weakening the trust model

The user should be able to stay in the chat window while the system finds the proposed cuts, shows them, and gets confirmation. That is a better experience than immediately kicking them into pipeline progress or a separate review screen.

But chat should not be the place where final dataset numbers are invented or where finished artifacts are patched in place. Backend compute still owns the actual rerun.

### 2. It avoids re-litigating settled groups

This is the main architectural decision.

We do **not** want a child run to hand the entire extended banner back to `CrosstabAgentV2` and let it revisit previously approved groups. That creates exactly the hesitation we surfaced in design: the user aligns on one new group in chat, but the rerun could quietly reinterpret old cuts.

Instead:

- the parent run's existing stage 20 and stage 21 outputs are treated as settled
- only the appended group is drafted and validated during preflight
- the child run consumes the parent run's settled planning plus the frozen appended group

### 3. The repo already has the seam we need

`CrosstabAgentV2` is not all-or-nothing. The code already exposes `processGroupV2`, which validates a single group. That is the right seam for preflight.

So Slice 1 should not be framed as:

- "run stage 20 and 21 again in miniature"

It should be framed as:

- "draft one stage-20 group"
- "run the exact stage-21 single-group validator on that group"
- "freeze the result for the child run"

### 4. Final stat letters belong to the child run, not the chat

The chat can lock:

- the appended group
- the cuts inside that group
- the validated expressions

The chat should **not** promise final stat letters as immutable, because letters are a function of the final rerun output universe. The child run should produce the final letters and final output layout.

### 5. We should not reopen the old HITL flow by default

If preflight returns a clean, user-confirmed appended group, that chat confirmation is the practical HITL for Slice 1.

The old review UI should only be a fallback for unstable cases, such as:

- policy fallback
- unresolved ambiguity
- low-confidence mappings the user did not resolve in chat

Default path:

- clean preflight + user confirms -> no extra review stop

Fallback path:

- messy preflight -> require review before compute

---

## Implementation slices

### Slice 1 — Tier B full-group extension with frozen preflight

**Status:** implemented at the backend/API/worker boundary.

Slice 1 established the durable compute-lane foundation. It intentionally stops short of a polished end-user analysis workspace flow; that user-facing handoff is Slice 2.

### Scope

Slice 1 supports:

- full rerun / banner extension requests
- one appended banner group at a time
- backend preflight followed by child-run recompute
- durable status breadcrumbs posted into the originating analysis session

Slice 1 does **not** support:

- single-table derivations
- arbitrary multi-group recomputes
- editing old settled groups
- free-form "design me a whole new banner" workflows
- polished in-chat confirmation controls or derived-run status cards

### Implemented workflow

#### A. Preflight route

Implemented in `src/app/api/runs/[runId]/analysis/compute/preflight/route.ts`.

The route:

- requires Convex auth
- applies the high-tier route rate limit
- validates run/session ids
- verifies org ownership of run, project, and analysis session
- requires the parent run to be `success` or `partial`
- loads grounded parent context and parent planning artifacts
- runs the analysis banner-extension preflight
- persists an `analysisComputeJobs` record
- posts a durable assistant message back into the originating analysis session

#### B. Preflight service

Implemented across:

- `src/agents/AnalysisBannerExtensionAgent.ts`
- `src/lib/analysis/computeLane/preflight.ts`
- `src/lib/analysis/computeLane/artifactLoader.ts`
- `src/lib/analysis/computeLane/fingerprint.ts`
- `src/lib/analysis/computeLane/reviewFlags.ts`

Preflight loads from the parent run:

- `planning/20-banner-plan.json`
- `planning/21-crosstab-plan.json`
- `enrichment/12-questionid-final.json`
- question context from the existing analysis grounding path
- required parent R2 artifact keys for later recompute

Preflight then:

- drafts exactly one appended stage 20 banner group
- rejects duplicate group names against the parent banner plan
- validates only that appended group through `processGroupV2`
- evaluates both draft confidence and crosstab validation confidence
- flags policy fallback, placeholder expressions, and low-confidence mappings
- creates a fingerprint from the parent run id, parent artifact keys, request text, frozen banner group, and frozen validated group

#### C. Frozen artifacts

Slice 1 persists two frozen artifacts on the compute job:

1. **Appended stage 20 group**
   - `groupName`
   - `columns[]`
   - each column's `name`
   - each column's `original`

2. **Appended stage 21 validated group**
   - the validated expressions for the same group
   - confidence / uncertainty fields
   - expression type metadata
   - review/clarification flags

The child run consumes these frozen artifacts directly.

#### D. Confirmation route

Implemented in `src/app/api/runs/[runId]/analysis/compute/jobs/[jobId]/confirm/route.ts`.

The route:

- requires Convex auth
- applies the high-tier route rate limit
- validates run/job ids
- verifies org ownership and parent/job lineage
- requires the parent run to still be `success` or `partial`
- blocks jobs that require clarification or review
- validates the frozen stage 20 and stage 21 artifacts against their schemas
- verifies all required parent artifacts before creating a child run
- recomputes the fingerprint from current parent artifact keys and frozen job artifacts
- rejects confirmation if parent artifacts changed after preflight
- atomically creates and queues the child run through `confirmAndEnqueueAnalysisChild`
- treats repeated confirmation as idempotent
- posts a durable queued message into the originating analysis session

The route does **not** call the pipeline directly. It only enqueues a worker run.

#### E. Child-run execution

Implemented in:

- `src/lib/api/analysisExtensionCompletion.ts`
- `src/lib/worker/runClaimedRun.ts`
- `src/lib/worker/buildExecutionPayload.ts`
- `src/lib/worker/types.ts`
- `convex/runExecutionValidators.ts`

The worker:

- reuses the parent run's settled stage 20 banner plan for all old groups
- appends the frozen new stage 20 group
- reuses the parent run's settled stage 21 crosstab plan for all old groups
- appends the frozen new validated stage 21 group
- skips rerunning banner discovery for old groups
- skips rerunning crosstab validation for old groups
- continues into compute and finalization
- updates the analysis compute job status
- updates the child run status and result
- uploads child-run outputs under the child run id
- posts success, cancellation, or failure breadcrumbs into the originating analysis session

This is the key guarantee of Slice 1.

#### F. Child-run cancellation

Slice 1 includes Convex-backed cancellation checks through `src/lib/analysis/computeLane/cancellation.ts`.

The analysis-extension executor checks cancellation:

- before expensive phases
- after parent artifact hydration
- after planning merge
- before and after compute
- before and after post-processing
- before final status writes

That prevents a worker process from continuing to compute and overwrite a cancelled child run.

### Persistence shape

Slice 1 added:

- `analysisComputeJobs`
- optional `runs.origin`
- optional `runs.parentRunId`
- optional `runs.analysisComputeJobId`
- optional `runs.lineageKind`
- `analysisExtension` on the worker execution payload validator

The new run fields are optional, so the schema remains compatible with existing production run documents.

### Review policy

Default:

- no extra review stop if preflight is clean and the user confirms

Fallback:

- if preflight is unstable, persist `needs_clarification` / review flags and block confirmation

Current blocking signals include:

- the draft agent asks for clarification
- draft proposal confidence is below the banner threshold
- any validated cut falls below the crosstab review threshold
- any validated expression is a placeholder
- policy fallback is detected

Clarification resolution remains a Slice 2/UI concern. Slice 1 correctly blocks unsafe jobs rather than attempting an incomplete review flow.

### Slice 1 acceptance status

Complete for the backend/API/worker boundary:

- preflight can produce and persist one frozen appended group
- single-group validation uses the existing stage 21 seam
- confirmation is fingerprint-guarded against parent artifact drift
- confirmation is idempotent and atomically creates/queues only one child run
- child runs carry lineage to the parent run and compute job
- parent run artifacts are not mutated
- old stage 20/21 groups are reused without revalidation
- the child run computes under a new run id
- originating analysis sessions receive durable status breadcrumbs
- cancellation is checked across worker phases

Post-audit hardening completed for Slice 1:

- confirmation now creates and queues the child run atomically instead of creating a child before claiming the job
- repeated confirmation returns the existing child run instead of enqueueing duplicate children
- cancellation checks now query Convex during the worker path rather than relying only on in-process abort state
- confirmation recomputes the preflight fingerprint against current parent artifact keys before enqueue
- draft-agent confidence contributes to review/clarification blocking

Not included in Slice 1:

- polished analysis workspace controls
- interactive clarification resolution
- child-run progress cards in the chat UI
- derived-run history/discovery UI
- export-package polish beyond the normal child-run output artifacts

---

### Slice 2 — Analysis workspace handoff and child-run resume

**Status:** implemented.

Slice 2 makes the Slice 1 backend lane feel native inside the analysis workspace. Compute-job cards are now authoritative for UI state; Slice 1 assistant breadcrumbs remain in the transcript as historical context and are not parsed for state.

### Implemented Slice 2 scope

Slice 2 includes:

- in-chat banner-extension preflight controls
- a proposed-group confirmation UI
- blocked/clarification UI for unsafe preflight jobs
- derived-run queued/running/complete status inside the analysis workspace
- a clear "continue in derived run" handoff when the child run is ready
- old-session resume behavior that makes prior compute jobs visible when the user reopens the parent analysis session
- persisted cancel/reject for proposed, blocked, queued, and running jobs
- parent/child artifact-expiration handling in the read model and API routes

Slice 2 does not include:

- multi-group banner extension
- old-group editing
- single-table derivations
- derived artifact history beyond what is needed to resume the current job
- a second review system separate from the existing job review flags
- typed natural-language confirmation
- clarification repair against the same job

### Implemented UX states

The analysis workspace supports these states for a banner-extension request:

1. **Eligible parent run**
   - parent run is `success` or `partial`
   - analysis session belongs to the run/project/org
   - compute action is offered as a separate composer action, not as normal chat send

2. **Preflight running**
   - user sees that TabulateAI is inspecting the settled run and drafting one appended group
   - composer should prevent accidental duplicate submits for the same request

3. **Proposal ready**
   - show group name
   - show each proposed cut
   - show human-readable summaries first
   - keep raw executable expressions behind a details toggle
   - show confidence/review warnings when present
   - provide explicit confirm and cancel/reject actions

4. **Needs clarification / review**
   - show the blocking reason from `reviewFlags.reasons`
   - do not allow confirm
   - let the user revise the request and rerun preflight
   - preserve the old blocked job for audit/history

5. **Queued / running**
   - show that a derived run has been queued
   - show child run progress, stage, and message when available
   - subscribe to child run status through the compute-job read model
   - keep the user in the parent analysis chat until outputs are ready

6. **Complete**
   - show that the derived run is ready
   - provide a prominent "continue in derived run" action
   - create or reuse a child-run analysis session before navigation
   - explain that the new run is derived from the original and includes the confirmed appended group

7. **Failed / cancelled / expired**
   - show failure or cancellation state from the job/run
   - provide a retry path that reruns preflight instead of blindly reusing stale artifacts

### Frontend/API integration

Slice 2 calls the existing Slice 1 routes:

- `POST /api/runs/[runId]/analysis/compute/preflight`
  - body: `sessionId`, `requestText`
  - returns: `jobId`, `status`, and a sanitized `job` view
  - also persists the user's compute request as a normal user message when preflight succeeds
  - does not return raw frozen groups, validated artifacts, R2 keys, or parent output maps

- `POST /api/runs/[runId]/analysis/compute/jobs/[jobId]/confirm`
  - body: `fingerprint`
  - returns: `childRunId`, `projectId`, `analysisUrl`
  - rejects terminal jobs before any existing-child idempotency shortcut
  - rejects expired parent artifacts with `410`

- `POST /api/runs/[runId]/analysis/compute/jobs/[jobId]/cancel`
  - cancels proposed / blocked jobs directly
  - requests child-run cancellation for queued / running jobs
  - is idempotent for terminal jobs

The UI treats `fingerprint` as an opaque confirmation token. It does not recompute or inspect the fingerprint client-side. Raw compute-job documents are not public Convex API; confirm/cancel routes read full jobs through internal queries, while the browser subscribes only to `listForSession`.

### Data subscription

Implemented:

- `analysisComputeJobs.listForSession({ orgId, sessionId, parentRunId })`

The query is read-only, org-scoped, and returns a sanitized client view rather than raw job documents. It includes proposed cut summaries, blocking review flags, an opaque confirm token only when confirmation is allowed, child-run progress/status, and the first active child-run analysis session id when available. It does not expose R2 keys, full parent artifact maps, or raw frozen job objects.

The session resume view uses this query to reconstruct:

- latest proposed or blocked job
- queued/running child run status
- completed child run link
- failed/cancelled state
- expired proposal or child-run state when parent or child artifacts are no longer available

This is the durable answer to the "resume from a previous chat session" requirement. The Slice 1 assistant breadcrumbs are useful, but Slice 2 should not rely only on message text parsing.

### Component-level implementation

Implemented across:

- `src/components/analysis/AnalysisWorkspace.tsx`
- `src/components/analysis/AnalysisThread.tsx`
- `src/components/analysis/PromptComposer.tsx`
- `src/components/analysis/AnalysisComputeJobCard.tsx`
- `src/lib/analysis/computeLane/jobView.ts`

The UI remains deliberately small:

- a banner-extension proposal card
- confirm/reject controls
- job status/progress display
- completed derived-run handoff

No broad history dashboard was added. The parent-session resume path surfaces jobs attached to the selected analysis session.

### Slice 2 acceptance status

Complete:

- a user can initiate a one-group banner-extension preflight from the analysis workspace
- the proposed group/cuts are shown in a structured confirmation UI
- unsafe preflight jobs are blocked with clear reasons
- confirm calls the existing confirmation route with the stored fingerprint
- duplicate clicks do not create confusing UI state
- queued/running/completed/failed/cancelled states are visible after page refresh
- reopening the original parent analysis session shows enough status to continue or understand what happened
- completed jobs link cleanly into the derived child run analysis page
- no frontend path mutates parent artifacts or bypasses the worker queue
- cancel/reject is persisted through an authenticated API route
- compute requests use a separate composer action and do not rely on assistant intent detection
- raw compute-job lookup is internal-only
- preflight returns a sanitized job view and keeps executable expressions out of transcript breadcrumbs
- cancel is idempotent against stale job state when the child run is already terminal
- confirm rejects terminal jobs before returning an existing child run
- unauthenticated compute route calls return `401 Unauthorized`
- expired parent/child artifact state is represented as `expired` in job cards

Post-audit hardening completed for Slice 2:

- `analysisComputeJobs.getById` moved from public query to internal query
- compute preflight/confirm/cancel routes now handle `AuthenticationError`
- preflight response no longer exposes frozen preflight artifacts
- proposal breadcrumbs no longer print raw expressions; detailed expressions remain available only through the job card details toggle
- cancellation checks child-run terminal state before mutating the child run
- confirm validates job status before the existing-child idempotency path
- read model derives `expired` for unconfirmed jobs whose parent artifacts expired and completed child runs whose artifacts expired

### Slice 2 tests

Added focused coverage around:

- sanitized compute-job projection
- internal-only raw compute-job lookup
- route-level auth failures returning `401`
- confirm-token exposure only for confirmable jobs
- child-run status/session projection
- parent/child artifact-expiration projection
- proposed, blocked, queued/running, complete, failed, cancelled, and expired card rendering
- timeline merge between chat messages and compute-job cards
- cancel route behavior for proposed, queued/running, wrong-parent, and terminal jobs
- existing confirm route fingerprint/idempotency regression
- confirm rejection for terminal jobs with an attached child run
- preflight sanitized response and transcript breadcrumb behavior
- explicit composer action rendering for derived-run creation

Run before merge:

- targeted component tests for the analysis workspace additions
- targeted route/query tests for any new Convex queries
- `npm run lint`
- `npx tsc --noEmit`

---

### Slice 3 — Tier A single-table derivations

After Tier B is stable, add the smaller-scope compute lane.

Focus:

- one table or a very small related set
- appended cuts, NETs, or derived views
- persistent derived artifacts with clear lineage
- no mutation of the canonical run results
- reusing the explicit alignment / freeze / backend-compute pattern established by Slices 1-2

This slice should reuse the same overall philosophy as Slice 1:

- align in chat
- freeze the derived artifact inputs before compute
- backend compute owns the actual result

---

### Slice 4 — Discovery, history, and broader extension workflows

After both lanes exist, broaden the surface.

Possible focus areas:

- clarification repair against the existing job
- typed confirmation after an unambiguous active proposal
- re-discovery of prior derivations within a run
- history of analysis-triggered compute jobs
- richer follow-up flows after recompute
- broader multi-group extension workflows if real usage supports them
- old-group editing if real usage supports it
- structured compute message parts if breadcrumbs need richer transcript integration

This slice should remain usage-driven. It is intentionally deferred.

---

## Practical takeaway

The architecture is now:

- chat is responsible for **alignment**
- preflight is responsible for **freezing the appended group**
- the child run is responsible for **compute and final output**

That is the cleanest way to keep the user experience strong while ensuring the rerun does not reinterpret work that the previous run already settled.
