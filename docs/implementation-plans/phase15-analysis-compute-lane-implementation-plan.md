# Phase 15 Sub-Plan — Analysis Compute Lane

**Status:** Tier B one-group banner-extension recompute is implemented, including native agent initiation. Slice 3, Tier A table-scoped derivations, is next.

**Purpose:** give TabulateAI's analysis workspace a safe way to create computed follow-up outputs from a completed run without mutating the original run or reinterpreting settled pipeline decisions.

---

## Current State

The base analysis surface remains artifact-grounded and read-only. It answers from verified pipeline artifacts such as `results/tables.json`, `enrichment/12-questionid-final.json`, `planning/20-banner-plan.json`, and `planning/21-crosstab-plan.json`.

The compute lane is a separate path for analysis-triggered derived outputs. Today it supports one Tier B workflow:

- The user asks, or the analysis agent identifies, a clear request for a new banner group across the full tab set.
- The analysis workspace runs preflight against the completed parent run.
- Preflight drafts exactly one appended banner group and validates only that group.
- The user confirms from an in-chat proposal card.
- Backend creates a child run through the worker queue.
- The child run reuses the parent run's settled planning artifacts, appends the frozen group, recomputes outputs, and leaves the original tables in the parent run's table set unchanged.

The important guarantee is unchanged: **what the user confirms in chat is what the child run consumes.**

---

## Architecture Rules

These rules are still binding for all remaining compute-lane work:

- **Parent runs are immutable.** Never patch `results/tables.json`, planning artifacts, or exported files in place.
- **Chat aligns; compute produces.** Chat can propose and confirm inputs. Backend compute owns final numbers, stat letters, and output artifacts.
- **Freeze before compute.** Any user-aligned compute request must persist a structured frozen input before a worker consumes it.
- **Do not re-litigate settled work.** For banner extension, old parent groups are reused as-is. Only the appended group is drafted/validated.
- **Worker queue only.** Analysis-triggered compute creates/queues a run; it does not call pipeline orchestrators directly from the web process.
- **Client-safe read models.** Browser code reads sanitized compute-job views only. Raw frozen artifacts, R2 keys, and parent output maps stay server-side.

---

## Implemented Slices

### Slice 1 — Tier B Backend Compute Lane

**Status:** implemented.

Slice 1 created the backend/API/worker foundation for one appended banner group.

Implemented:

- `analysisComputeJobs` persistence
- optional child-run lineage on `runs`
- `AnalysisBannerExtensionAgent` for drafting one appended group
- single-group validation through `CrosstabAgentV2` / `processGroupV2`
- frozen banner group + frozen validated group persisted on the job
- fingerprint guard against parent artifact drift
- atomic child-run creation and queueing via `confirmAndEnqueueAnalysisChild`
- analysis-extension worker payload and dispatch path
- child-run executor that hydrates parent artifacts, appends the frozen group, computes, finalizes, uploads, and reports status
- Convex-backed cancellation checks across worker phases

Not included in Slice 1:

- polished in-chat controls
- durable job-card resume
- derived-run handoff UX
- single-table derivations
- multi-group extension or old-group editing

### Slice 2 — Native Analysis Workspace Handoff

**Status:** implemented.

Slice 2 made the backend lane usable inside the analysis workspace.

Implemented:

- native `AnalysisAgent` tool for clear full-set derived-run proposals
- explicit plus-menu action for users who want to force proposal creation
- compute-job cards in the chat timeline
- proposal, clarification, queued, running, success, failed, cancelled, and expired states
- sanitized public `analysisComputeJobs.listForSession({ orgId, sessionId, parentRunId })`
- internal-only raw job reads for API routes
- safe preflight response shape with no raw frozen artifacts or R2 keys
- button-driven confirmation only
- persisted cancel/reject route
- refresh-safe state from Convex, not parsed assistant breadcrumbs
- completed-job handoff that creates or reuses a child-run analysis session
- expired parent/child artifact handling
- tool contract requiring explicit full-crosstab-set scope before native proposal creation
- prompt guidance requiring clarification when the request may be table-specific

Post-audit hardening completed:

- raw `analysisComputeJobs.getById` moved to `internalQuery`
- unauthenticated compute route calls return `401`
- preflight breadcrumbs no longer print executable expressions
- cancellation does not overwrite terminal child runs
- confirm rejects terminal jobs before existing-child idempotency
- native agent proposal output omits raw expressions, R2 keys, frozen artifacts, fingerprints, confirm tokens, and parent artifact maps
- Convex deploy typecheck passes with relative worker/compute-lane type imports

Verification run for Slice 2:

- `npx vitest run`
- targeted Slice 2 tests
- `npm run lint`
- `npx tsc --noEmit`
- `npx convex deploy --dry-run --typecheck=enable`

---

## Active Remaining Slice

### Slice 3 — Tier A Table-Scoped Derivations

**Status:** next.

Add compute-backed derivations for one table or a small related set of tables. This is the required next slice for requests where the user or agent is not asking for a whole derived run, but for a table-level computed follow-up.

Product decisions for Slice 3:

- Start with **answer-option roll-ups**. A user may ask to combine rows/options into a new view, such as top/middle/bottom boxes, positive/neutral/negative, or custom groupings that test whether separate rows become meaningful when rolled up.
- Keep **selected-table cuts** in scope for Tier A, but treat them as the second operation after the derived-artifact/result model is settled. Example: add region or company-size cuts to one table or a few selected tables, not the full crosstab set.
- The agent can select one or several source tables, but only a small table set. Broad “all tabs” requests remain Tier B derived-run proposals.
- If scope is ambiguous, the agent asks whether the user wants a full-set derived run or a table-specific derivation.
- Tier A should not create a new project default run by default. It should persist a separate derived analysis artifact with lineage to source run, source table(s), derivation type, requested-by user, and frozen inputs.
- The parent run's canonical artifacts remain unchanged.
- The agent aligns and proposes; backend compute produces the numbers. The agent never authors or hand-calculates the derived result.
- After compute completes, TabulateAI should continue the analysis loop with the derived table in context. The derived result should become grounded evidence for the analysis agent, and the agent should re-analyze it in the same conversation without requiring the user to manually ask a second time.

Expected flow:

1. User asks for a roll-up or table-scoped cut.
2. Agent identifies the source table(s), operation type, and proposed derivation.
3. Backend persists a frozen proposal and a safe client view.
4. User confirms with a button.
5. Worker/server-side compute produces a derived table artifact.
6. The UI renders the derived table card with clear lineage.
7. The analysis agent is re-entered or continued with the derived artifact in context, then explains what the new computed table shows.

This post-compute continuation is part of the product contract, not a cosmetic convenience. A Tier A request should feel like "compute this table-level follow-up and tell me what it means," while still keeping the computation itself deterministic and grounded.

Open implementation decision before schema work:

- Persist Tier A outputs in a new `analysisDerivedArtifacts` table, or extend `analysisArtifacts`/`analysisComputeJobs` with enough lineage and lifecycle state. The product behavior above should drive the schema choice.

## V1 Polish — Compute Reuse And Smoothness

This should come after the core Tier A product path is working, but it is still part of making the compute lane feel production-smooth.

Today, derived-run recompute is intentionally conservative: it reuses parent artifacts where the Slice 2 lane already freezes them, but it still re-enters more of the pipeline than the ideal steady-state path. In particular, follow-up compute can end up re-sending settled artifacts through agents such as loop semantics and recomputing work that should be cacheable once the parent run is known-good.

Optimization goals:

- Reuse settled parent-run semantic decisions when the derived request does not change the underlying table/question structure.
- Avoid re-running agents whose inputs are unchanged by the derived request.
- Cache or fingerprint reusable compute inputs so identical or near-identical follow-up requests do not repeat expensive preparation work.
- Keep the same safety contract: frozen confirmed inputs, worker-queued execution, parent-run immutability, and deterministic backend-computed results.
- Treat reuse as an execution optimization only. It must not weaken validation for newly requested cuts, roll-ups, or derived table definitions.

## Deferred / Not Required for V1 Readiness

These are usage-driven improvements, not blockers for the current production-ready Tier B lane or the next Tier A design:

- clarification repair against an existing blocked job instead of starting a revised request
- broader compute history and discovery beyond the current chat timeline and derived-run handoff
- multi-group banner extension, old-group editing, banner redesign, or promotion of derived outputs into delivery-grade artifacts
- richer structured compute message parts if Convex timeline ordering becomes insufficient

---

## Practical Takeaway

The compute lane now has a stable shape:

- chat is responsible for alignment
- preflight freezes the agreed input
- worker-backed compute produces final outputs
- parent runs stay immutable

The next real product work is not more Tier B plumbing. It is deciding and implementing the Tier A table-scoped derivation model for cases where the user wants a table-level computed follow-up rather than a whole derived run.
