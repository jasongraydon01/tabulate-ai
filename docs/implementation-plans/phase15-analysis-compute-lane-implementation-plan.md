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

Add smaller compute-backed derivations for a single table or a small related set of tables. This is the required next slice for requests where the user or agent is not asking for a whole derived run, but for an added cut, NET, or derived view on one table or a small table cluster.

Required scope:

- add one cut, NET, or derived view to one table or a small table cluster
- let the agent distinguish: full crosstab-set banner extension → Tier B derived run; table-specific or few-table request → Tier A path
- when the scope is ambiguous, ask whether the user wants a full-set derived run or a table-specific derivation
- persist a derived artifact with lineage to source run, source table, derivation type, requested-by user, and frozen inputs
- keep output separate from canonical parent-run artifacts
- reuse the Slice 1/2 pattern: align in chat, freeze input, compute server-side, render from persisted result

Key design decision before implementation:

- Should Tier A produce child runs, sibling analysis artifacts, or a separate `analysisDerivedArtifacts` table? This should be decided before writing schema.

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
