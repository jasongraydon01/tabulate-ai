# Final Table Contract Hard Cut

**Purpose:** make `results/tables.json` the single final-table contract for analysis, citations, and downstream export consumers so every surface projects from the same ordered, row-semantic-aware artifact.

## Current State

The hard cut itself is implemented. The main contract decisions are settled:

- `results/tables.json` is the intended final-table artifact.
- ordered `columns`, ordered `rows`, and ordered `rows[].cells` are the contract shape.
- stable cell identity is `tableId + rowKey + cutKey`.
- analysis grounding, rendered analysis tables, and citation flows have already been moved onto the settled contract.
- downstream cleanup work landed and stale `getTableCard` helper language was removed from the live analysis workflow.

This document is now mainly a **post-implementation stabilization tracker**, not an active slice plan.

### Stabilization Status

- **Slice 1 complete on `dev`**: upstream final-table materialization now consumes the settled stage-22 compute shape directly.
- `src/lib/v3/runtime/postV3Processing.ts` finalizes `results/tables*.json` from the in-memory compute input used to generate the R script instead of re-reading `compute/22-compute-package.json` with a stale nested-shape assumption.
- `src/lib/v3/runtime/finalTableContract.ts` now reads the actual top-level `tables` / `cuts` contract used by stage 22.
- deterministic regression coverage now includes both the derived demo-banner path and dual weighted/unweighted finalization.

## What The Hard Cut Already Achieved

- post-R final table materialization exists in `src/lib/v3/runtime/finalTableContract.ts`
- post-R finalization/validation exists in `src/lib/v3/runtime/postV3Processing.ts`
- analysis grounding uses the settled `searchRunCatalog` -> `fetchTable` -> optional render marker -> `confirmCitation` workflow
- rendered analysis tables preserve contract row order and row-level formatting semantics
- Q / WinCross / export readers were moved toward the final contract instead of legacy compatibility branches

## Where We Actually Are Now

The remaining work is not “finish the hard cut design.” It is **finish stabilization after implementation**.

The first upstream blocker is now addressed. The remaining work is mostly about making pipeline state and export readiness describe that contract truthfully and fail closed when it is not satisfied.

## Confirmed Bug Stack

### 1. Upstream final-table materialization mismatch was real and is now fixed

We traced a real failing run where the post-R final-contract pass failed before `results/tables.json` was upgraded into the settled `columns` / `rows` / `cells` shape.

What was fixed:

- `src/lib/v3/runtime/finalTableContract.ts` no longer expects `computePackage.rScriptInput?.tables` / `computePackage.rScriptInput?.cuts`.
- the final-table builder now reads the settled top-level stage-22 `tables` / `cuts` shape directly.
- the shared post-R path now finalizes raw `results/tables*.json` from the same compute input that generated the R script.
- regression coverage now protects the derived demo banner path and weighted/unweighted finalization.

### 2. R success is being conflated with post-R contract finalization

This is an important labeling problem:

- R execution can succeed and still produce useful raw table data.
- post-R final table contract materialization can fail afterward.
- the current pipeline path records that failure under the `"R Execution"` stage and continues in a way that makes the state hard to reason about.

What we want conceptually is:

- `R succeeded`
- `final table contract succeeded/failed`
- `export contract ready/not ready`

Those are separate states and the system should describe them separately.

### 3. Export readiness is too optimistic

The export-manifest/readiness layer currently does not fail closed on an invalid final tables artifact.

Confirmed issue:

- a run can still report as export-ready even when the exact `resultsTables` input that Q / WinCross will read does not conform to the final contract.
- that means the exporter becomes the first strict consumer to surface the problem instead of the pipeline/readiness layer catching it earlier.

### 4. Q and WinCross are surfacing the upstream contract break

The current Q / WinCross failures are symptoms of the upstream artifact problem, not the primary root cause.

What is happening:

- Q and WinCross now correctly parse `resultsTables` as the final contract.
- if they are handed a raw `results/tables.json` artifact without `columns` / `rows`, they fail immediately.
- that failure is useful signal, but the deeper bug lives earlier in finalization and readiness.

### 5. Weighted-path metadata still needs explicit end-to-end verification

We already fixed one export metadata path issue on `dev` so dual-output runs point `artifactPaths.inputs.resultsTables` at the weighted final artifact instead of the stale base path.

That fix was necessary, but it is not the current root cause for the failing unweighted run we inspected. The main blocker remains upstream finalization.

## Remaining Work

### Priority 1 — Fix upstream final-table materialization

Status:

- **Done on `dev`**

Delivered result:

- successful runs now materialize finalized `results/tables.json` (and weighted variants where relevant) from the settled stage-22 compute shape before downstream consumers read those artifacts

### Priority 2 — Separate pipeline statuses and error labeling

Primary target:

- stop describing post-R finalization failures as `"R Execution"` failures

Expected result:

- a run can truthfully report that R succeeded while also showing that final-contract materialization failed
- downstream debugging becomes much clearer

What is left at a high level:

- introduce an explicit post-R finalization success/failure state instead of collapsing it into `"R Execution"`
- make run summaries, persisted errors, and UI-facing status reflect `R success` vs `final-table contract success`

### Priority 3 — Tighten export readiness around `resultsTables`

Primary target:

- validate the `resultsTables` input artifact as part of export readiness / manifest integrity, not only inside the export service

Expected result:

- bad final-table artifacts are blocked earlier
- Q / WinCross stop being the first place we discover contract failure

What is left at a high level:

- make export readiness validate the exact `resultsTables` artifact against the final contract schema
- fail closed before Q / WinCross manifest generation if that artifact is missing or invalid

### Priority 4 — Add end-to-end regression coverage for the settled contract

Primary target:

- add deterministic coverage that exercises the real path from post-R finalization through export-readiness and export-consumer parsing

Expected result:

- we prove the hard cut works on real artifact flow, not only in isolated helper tests

What is left at a high level:

- add end-to-end coverage that spans post-R finalization, export readiness, and export-consumer parsing
- explicitly verify fresh Q and WinCross flows against finalized artifacts rather than helper-only fixtures

## Working Diagnosis

The hard cut is conceptually right and the settled contract should remain in place. The current problem is that some live runs are not reliably making it all the way onto that contract before downstream consumers read the artifact.

So the current phase is:

1. upstream finalization fixed
2. cleanly separate status labeling
3. tighten readiness validation
4. re-run end-to-end verification for Q and WinCross

## Done Means

We can treat the hard cut as fully stabilized when all of the following are true:

- successful runs reliably materialize `results/tables.json` into the settled final contract
- the pipeline distinguishes R success from post-R finalization success
- export readiness fails closed when `resultsTables` is not in final-contract shape
- Q and WinCross succeed on fresh runs without relying on legacy compatibility behavior
