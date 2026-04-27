# Phase 15 Sub-Plan — Analysis Compute Lane

**Status:** Tier B one-group banner-extension recompute is implemented, including native agent initiation. Tier A Bucket 1 row roll-ups and Bucket 2 selected-table cuts are now foundationally implemented end to end. The next product pass is Bucket 1/2 hardening, scope expansion, prompt optimization, and analysis-UI smoothness before starting Bucket 3 non-roll-up derived tables.

**Purpose:** give TabulateAI's analysis workspace a safe way to create computed follow-up outputs from a completed run without mutating the original run or reinterpreting settled pipeline decisions.

---

## Current State

The base analysis surface remains artifact-grounded and read-only. It answers from verified pipeline artifacts such as `results/tables.json`, `enrichment/12-questionid-final.json`, `planning/20-banner-plan.json`, and `planning/21-crosstab-plan.json`.

The compute lane is a separate path for analysis-triggered derived outputs. It currently supports one Tier B workflow and the first two Tier A table-scoped workflows.

- The user asks, or the analysis agent identifies, a clear request for a new banner group across the full tab set.
- The analysis workspace runs preflight against the completed parent run.
- Preflight drafts exactly one appended banner group and validates only that group.
- The user confirms from an in-chat proposal card.
- Backend creates a child run through the worker queue.
- The child run reuses the parent run's settled planning artifacts, appends the frozen group, recomputes outputs, and leaves the original tables in the parent run's table set unchanged.

For Tier B derived runs, the important guarantee is unchanged: **what the user confirms in chat is what the child run consumes.** For Tier A derived artifacts, the equivalent guarantee is: **what the user confirms in chat is the frozen backend-resolved spec the worker consumes.**

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

**Status:** Buckets 1 and 2 are implemented as the current table-scoped foundation. Bucket 1 supports artifact-safe row roll-ups. Bucket 2 supports selected-table cuts for one source table and one new cut group, with worker-queued compute, `computed_derivation` artifact creation, and same-session interpretation. Slice 3 remains open for Bucket 3 non-roll-up derived tables, but Bucket 3 should wait until the Bucket 1/2 contract and chat experience are smoother and less unnecessarily restrictive.

Add compute-backed derivations for one table or a small related set of tables. This is the required next slice for requests where the user or agent is not asking for a whole derived run, but for a table-level computed follow-up.

Implemented Bucket 1 path:

- `table_rollup_derivation` jobs share the `analysisComputeJobs` proposal/confirm/cancel lifecycle.
- The analysis agent has a `proposeRowRollup` tool that can create a proposal only after backend validation.
- Valid proposals render as derived-table proposal cards and remain button-confirmed.
- Confirmed jobs are worker-claimed, compute a `computed_derivation` analysis artifact, and do not create a child run or project default.
- Completed derived artifacts are available to grounding tools, and TabulateAI can continue the analysis loop by fetching and interpreting the computed table in the same conversation.
- Current scope is intentionally one selected source table.
- Frozen row-roll-up specs use schema version 2 with `derivationType: "row_rollup"`, source table metadata, user-facing output rows, and a backend-resolved compute plan.
- Workers reject legacy or malformed frozen specs before compute.
- Compute consumes backend-resolved source-row semantics, revalidates current row labels and canonical variable/filter metadata, and never uses agent-authored formulas.
- Unsupported but recognized shapes, including respondent-level any-of and metric row aggregation, return trace/tool feedback and do not create durable jobs.
- Derived roll-up rows suppress significance markers until the compute lane can reproduce pipeline-equivalent significance for derived rows.
- Zero-base displayed columns no longer block otherwise valid artifact-safe roll-ups.

Implemented Bucket 2 path:

- `selected_table_cut_derivation` jobs share the `analysisComputeJobs` proposal/confirm/cancel lifecycle.
- The analysis agent has a `proposeSelectedTableCut` tool in the alternative prompt path. The sparse tool input is `requestText`, `sourceTableId`, `groupName`, exact source `variable`, and public cut definitions.
- Backend validation owns source-table lookup, exact variable existence, cut validation through the existing crosstab validation path, and fingerprinting. The model does not author executable R formulas.
- Valid proposals render as derived-table proposal cards and remain button-confirmed.
- Confirmed jobs are worker-claimed, compute one selected canonical table with Total plus the new cut group, and persist a `computed_derivation` analysis artifact.
- Selected-table cut outputs do not create child runs or modify parent run artifacts.
- Significance markers are suppressed for selected-table cut derived artifacts in v1.

Product decisions for Slice 3:

- Treat Tier A as three ordered product buckets:
  1. **Table roll-ups.** Bucket 1 is complete for artifact-safe same-variable exclusive sums. A roll-up collapses selected existing rows into one row while preserving the table's analytical meaning. This includes top/middle/bottom boxes, positive/neutral/negative groups, and custom row groupings where rows are mutually exclusive and share a base. Multi-select "any of these rows" NETs and allocation/treatment group roll-ups are recognized but intentionally blocked until their safe compute mechanisms are implemented.
  2. **Selected-table cuts.** Bucket 2 is complete for one selected source table, one exact source variable, and one new cut group. A cut creates new respondent-group columns for the selected table without creating a child run across all tabs. The current contract intentionally rejects multi-variable overlapping cuts, multi-table requests, and multiple cut groups until those shapes have explicit validation/compute support.
  3. **Non-roll-up derived tables.** Do this third, but keep it squarely in V1. These are valuable flexible table-building workflows where the output answers a meaningfully new table question or assembles a new view, such as KPI side-by-side tables, tables built from rows across multiple questions, composites, intersections, or table-type transformations. This bucket needs more product design because the agent may need to search for variables/questions and plan the table shape, not just collapse rows already visible in one source table or add a cut to a known table.
- For roll-ups, the agent should operate semantically: source table, selected source rows, desired label, and the user's intent. Backend validation decides the compute mechanism. For single-response rows this may be an artifact-safe mutually exclusive sum. For multi-select rows it may need respondent-level "selected any of these rows" logic. For allocation or other average-style tables, it may need a table-preserving aggregation rule. The user should not need to know which mechanism applies.
- Do not fake roll-ups from displayed percentages when selected rows can overlap or when the table metric requires a respondent-level or table-specific aggregation rule.
- Before a proposal card exists, backend validation must classify the roll-up mechanism and prove it can compute values and significance correctly. If the mechanism is unsupported, the tool returns repair/clarification feedback and creates no job.
- Keep **selected-table cuts** as the Bucket 2 Tier A lane. Example: add region or company-size cuts to one selected table, not the full crosstab set.
- The current implementation supports one source table. Multi-table row roll-ups and multi-table selected cuts are desired follow-on workflows, but should wait until the one-table path has its compute-reuse, queued-state UI, prompt-guidance, and auto-continuation polish. When added, keep them constrained to a small set of related source tables with compatible semantics; broad “all tabs” requests remain Tier B derived-run proposals.
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

Near-term hardening before Bucket 3:

- Reduce unnecessary refusals in Buckets 1 and 2 by expanding the contracts only where the validation and worker-backed compute story stays explicit, deterministic, and easy to explain.
- Improve prompt guidance so the agent distinguishes existing cuts, one-table cuts, small selected-table sets, full-tab derived runs, row roll-ups, and not-yet-supported Bucket 3 shapes with less friction.
- Add small selected-table-set support for cuts once the same frozen-spec and lineage model can apply table-by-table without turning into a full-tab derived run.
- Add multi-table row roll-ups for small related table sets once compatible row semantics can be validated across the selected tables.
- Improve queued/running UI feedback, completion toasts, and same-session auto-continuation so table-scoped compute feels like a coherent chat workflow rather than a background system event.
- Revisit current hard no-go cases, including overlapping multi-variable cuts, and promote only the cases that can be represented cleanly in the sparse model-facing contract and backend-resolved spec.

Remaining product/implementation decisions before calling all of Slice 3 complete:

- Implement safe compute for respondent-level any-of NETs for multi-select rows if usage warrants it.
- Decide whether metric row aggregation belongs in roll-ups or in the non-roll-up derived-table/benchmark bucket.
- Decide what source respondent-level or metric-specific artifacts are required for multi-select and allocation-style row collapse. Do not fake this from displayed percentages when rows can overlap or when row values need table-specific aggregation.
- Keep unsupported derivations explicit: AND logic, composites, intersections, and table-type transformations should be routed to the non-roll-up derived-table bucket unless they fit the agreed roll-up contract.
- Design the non-roll-up derived-table workflow after roll-ups and selected-table cuts. This is V1 work, but it needs a separate planning layer because the agent may be building a new table shape rather than validating a straightforward row collapse.
- Continue using `analysisArtifacts`/`analysisComputeJobs` with lineage unless a separate `analysisDerivedArtifacts` table becomes necessary after the product shape expands.

## V1 Polish — Compute Reuse And Smoothness

This comes after the core Tier A Bucket 1 and Bucket 2 product paths are working, but before Bucket 3. It is part of making the compute lane feel production-smooth and reducing avoidable refusal without weakening the safety model.

Today, derived-run recompute is intentionally conservative: it reuses parent artifacts where the Slice 2 lane already freezes them, but it still re-enters more of the pipeline than the ideal steady-state path. In particular, follow-up compute can end up re-sending settled artifacts through agents such as loop semantics and recomputing work that should be cacheable once the parent run is known-good.

The first row-roll-up and selected-table-cut passes also exposed UX polish needs: while a table-level compute job is queued/running, the analysis workspace needs clearer progress feedback, and the automatic post-compute interpretation can feel delayed even when the worker eventually succeeds. Treat that as smoothness/reuse polish, not a blocker for the Bucket 1/2 compute contract.

Optimization goals:

- Reuse settled parent-run semantic decisions when the derived request does not change the underlying table/question structure.
- Avoid re-running agents whose inputs are unchanged by the derived request.
- Cache or fingerprint reusable compute inputs so identical or near-identical follow-up requests do not repeat expensive preparation work.
- Keep the same safety contract: frozen confirmed inputs, worker-queued execution, parent-run immutability, and deterministic backend-computed results.
- Treat reuse as an execution optimization only. It must not weaken validation for newly requested cuts, roll-ups, or derived table definitions.
- Improve queued/running derived-table UI states so users can see that table-level compute is still progressing.
- Smooth the auto-continuation path after `computed_derivation` artifact creation so the rendered table and interpretation appear promptly and predictably.
- After the one-table path feels smooth, design multi-table row roll-ups and multi-table selected cuts for small related table sets without weakening the current one-table validation contract.

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

Buckets 1 and 2 now provide the working table-scoped derivation foundation. The next real product work is a stabilization and expansion pass for those lanes: fewer unnecessary refusals, better prompt routing, better queued/running feedback, smoother auto-continuation, and carefully scoped multi-table support. Bucket 3 non-roll-up derived tables remains next after that foundation feels coherent enough to support another layer.
