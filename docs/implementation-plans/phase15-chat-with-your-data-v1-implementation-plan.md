# Phase 15 V1 - Chat With Your Data

**Purpose:** run-scoped conversational analysis on verified pipeline artifacts. Live at `/projects/[projectId]/runs/[runId]/analysis`.

**Audit snapshot:** 2026-04-28. This document is now the single active Phase 15 tracker. The detailed UI and compute-lane sub-plans have been moved to the archive because they describe shipped implementation history more than remaining work:

- [Archived UI overhaul plan](/Users/jasongraydon01/tabulate-ai/docs/implementation-plans/archive/phase15-analysis-ui-overhaul-implementation-plan.md)
- [Archived compute-lane plan](/Users/jasongraydon01/tabulate-ai/docs/implementation-plans/archive/phase15-analysis-compute-lane-implementation-plan.md)

## Current State

TabulateAI's analysis workspace is live against completed runs. The agent reads verified run artifacts and session-scoped computed derivation artifacts; it does not query raw `.sav` data during ordinary chat turns.

Implemented foundation:

- Session create/list/delete, persistent messages, title generation, feedback, copy, edit/resend, follow-up chips, and run-aware discoverability.
- Strict structured-answer finalization through `submitAnswer({ parts })`.
- Grounding tools: `searchRunCatalog`, `fetchTable`, `getQuestionContext`, `listBannerCuts`, and `confirmCitation`.
- Inline table rendering through explicit `render` parts and citation chips through explicit `cite` parts.
- Same-turn citation confirmation: `cite` parts must reference `cellId`s returned by `confirmCitation` in that turn.
- Render validation: `render` parts must reference tables fetched in that turn and must use valid focus targets.
- Prompt caching and cache-aware metrics on the analysis surface.
- Per-turn success and error traces under the run's analysis trace path.
- UI overhaul slices 0-7: settled answer model, turn-scoped ordering, primitive-backed conversation shell, work disclosure, answer/footer polish, compute-card lifecycle, and component ownership cleanup.
- Tier B compute lane: one appended banner group across the full crosstab set, proposed in chat, confirmed by button, queued through the worker as a child run.
- Tier A Bucket 1: one-table row roll-ups for artifact-safe same-variable exclusive sums, persisted as `computed_derivation` artifacts.
- Tier A Bucket 2: one-table selected-table cuts for one new cut group, persisted as `computed_derivation` artifacts.
- Same-session continuation after completed table-scoped derivations, with fallback table-card posting if continuation fails.

## Trust Boundary

What is enforced today:

- New assistant turns must end in exactly one valid `submitAnswer({ parts })`.
- User-visible assistant prose outside `submitAnswer` fails the turn.
- Every structured `cite` part must reference a cell confirmed this turn.
- Every structured `render` part must reference a table fetched this turn.
- Rendered table cards and citation chips come from verified run artifacts or computed derivation artifacts.

What is not enforced today:

- The backend does not parse every final-answer sentence and prove that each quoted number equals the cited cell's `displayValue`, `pct`, `count`, `n`, or `mean`.
- The backend does not yet validate comparison language such as "higher," "stronger," or "statistically significant" against confirmed cell relationships.
- If finalization fails, the route fails the turn rather than giving the agent validation errors and a bounded chance to repair with more tool calls.

Product language should stay precise: TabulateAI withholds final answers until they pass an artifact-grounded, cell-confirmed, render-validated backend contract. Sentence-level numeric proof is future trust hardening.

## Remaining Work Of Substance

### 1. Cleanup Pass

**Status:** legacy replay/compatibility cleanup completed. One ownership audit remains as a closeout check.

Completed:

- Removed the remaining content-only marker replay fallback; content-only historical assistant messages now replay as plain text instead of being rehydrated into structured render/cite parts.
- Removed dead marker repair code and tests after confirming no live production import remained.
- Removed deprecated `requestedRowFilter` / `requestedCutFilter` compatibility fields from table-card types and grounding output.
- Removed legacy marker parse/serialize helpers from the structured-answer path.

Closeout check:

- Audit durable state ownership: structured assistant parts, rendered artifacts, citation/context evidence, traces, feedback/corrections, compute-job lineage, child-run outputs, and derived artifacts should each be intentionally Convex-only or intentionally written/exported to R2.

### 2. Product Copy And Trust Language

Review analysis-surface product copy so it accurately describes the current trust contract:

- TabulateAI answers from verified run artifacts and session-scoped computed derivation artifacts.
- Dataset-specific numbers require fetched table evidence and same-turn citation confirmation.
- Rendered table cards come from verified run artifacts or computed derivation artifacts.
- Do not imply sentence-level numeric proof or fully validated comparison language until the trust-hardening items below exist.

### 3. Trust Hardening

This is valuable, but it is not blocking the current MVP unless TabulateAI wants to market stronger "validated every sentence" claims.

- Add bounded post-finalization repair for invalid `submitAnswer`, unconfirmed cites, or invalid render focus.
- Add sentence-level numeric claim verification for percentages, counts, bases, and means.
- Later, validate comparison and significance language against confirmed cells and table metadata.
- Keep user-facing copy aligned with the current trust boundary until this exists.

## Explicitly Deferred

These should not block the Phase 15 MVP:

- Tier A Bucket 3 non-roll-up derived tables, including KPI side-by-side tables, tables assembled from rows across multiple questions, composites/intersections, table-type transformations, and benchmark-style or metric-derived views that need a new table shape
- multi-table row roll-ups
- multi-table selected cuts
- respondent-level any-of NETs for multi-select rows
- metric row aggregation
- multi-group banner extension
- editing existing banner groups
- banner redesign
- broad compute history/discovery outside the current chat timeline
- deep parent-artifact caching/fingerprinting for repeated compute requests
- promotion of derived outputs into delivery-grade run artifacts
- AI-generated follow-up hydration
- broader artifact architecture beyond `analysisArtifacts` and `analysisComputeJobs`

## Active Next Checklist

1. Review analysis-surface product copy so it describes the current trust contract accurately.
2. Run the durable state ownership closeout check.
3. Decide whether any trust-hardening item is required before closeout; otherwise keep it deferred.
4. Close out Phase 15 V1 with Bucket 3 explicitly deferred and the archived UI/compute sub-plans left as historical references.
