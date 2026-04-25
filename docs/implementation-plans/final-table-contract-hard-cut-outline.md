# Final Table Contract Hard Cut

**Purpose:** make `results/tables.json` the single final-table contract for analysis, citations, and downstream export consumers so every surface projects from the same ordered, row-semantic-aware artifact.

## Current State

The hard cut itself is implemented. The main contract decisions are settled:

- `results/tables.json` is the intended final-table artifact.
- ordered `columns`, ordered `rows`, and ordered `rows[].cells` are the contract shape.
- stable cell identity is `tableId + rowKey + cutKey`.
- analysis grounding, rendered analysis tables, and citation flows have already been moved onto the settled contract.
- downstream cleanup work landed and stale `getTableCard` helper language was removed from the live analysis workflow.

This document is now mainly a **post-implementation bug-tracking outline**, not an active slice plan.

## What The Hard Cut Already Achieved

- post-R final table materialization exists in `src/lib/v3/runtime/finalTableContract.ts`
- post-R finalization/validation exists in `src/lib/v3/runtime/postV3Processing.ts`
- analysis grounding uses the settled `searchRunCatalog` -> `fetchTable` -> optional render marker -> `confirmCitation` workflow
- rendered analysis tables preserve contract row order and row-level formatting semantics
- Q / WinCross / export readers were moved toward the final contract instead of legacy compatibility branches

## Where We Actually Are Now

The remaining work is not “finish the hard cut design.” It is **stabilize the hard cut after implementation**.

The current failures are showing up because some runs still reach downstream consumers with a raw or partially finalized `results/tables*.json` artifact even though Q and WinCross now expect the settled final contract.

## Confirmed Bug Stack

### 1. Final-table materialization can still fail upstream

We traced a real failing run where the post-R final-contract pass failed before `results/tables.json` was upgraded into the settled `columns` / `rows` / `cells` shape.

Confirmed issue:

- `src/lib/v3/runtime/finalTableContract.ts` is still reading the stage-22 compute artifact using a stale shape assumption in at least one path.
- The persisted compute artifact on disk is top-level `tables` / `cuts`, while the final-table builder still expects `computePackage.rScriptInput?.tables` / `computePackage.rScriptInput?.cuts`.
- That mismatch breaks final-contract row construction for the derived demo banner path and leaves the raw tables artifact in place.

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

Primary target:

- make `src/lib/v3/runtime/finalTableContract.ts` read the actual persisted stage-22 compute artifact shape used by the live pipeline

Expected result:

- successful runs produce finalized `results/tables.json` (and weighted variants where relevant) in the settled contract shape before downstream consumers ever see them

### Priority 2 — Separate pipeline statuses and error labeling

Primary target:

- stop describing post-R finalization failures as `"R Execution"` failures

Expected result:

- a run can truthfully report that R succeeded while also showing that final-contract materialization failed
- downstream debugging becomes much clearer

### Priority 3 — Tighten export readiness around `resultsTables`

Primary target:

- validate the `resultsTables` input artifact as part of export readiness / manifest integrity, not only inside the export service

Expected result:

- bad final-table artifacts are blocked earlier
- Q / WinCross stop being the first place we discover contract failure

### Priority 4 — Add end-to-end regression coverage for the settled contract

Primary target:

- add deterministic coverage that exercises the real path from post-R finalization through export-readiness and export-consumer parsing

Expected result:

- we prove the hard cut works on real artifact flow, not only in isolated helper tests

## Working Diagnosis

The hard cut is conceptually right and the settled contract should remain in place. The current problem is that some live runs are not reliably making it all the way onto that contract before downstream consumers read the artifact.

So the current phase is:

1. fix upstream finalization
2. cleanly separate status labeling
3. tighten readiness validation
4. re-run end-to-end verification for Q and WinCross

## Done Means

We can treat the hard cut as fully stabilized when all of the following are true:

- successful runs reliably materialize `results/tables.json` into the settled final contract
- the pipeline distinguishes R success from post-R finalization success
- export readiness fails closed when `resultsTables` is not in final-contract shape
- Q and WinCross succeed on fresh runs without relying on legacy compatibility behavior
