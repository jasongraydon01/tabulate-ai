# Final Table Contract Hard Cut

**Purpose:** make `results/tables.json` the single final-table contract for analysis, citations, and downstream export consumers so every surface projects from the same ordered, row-semantic-aware artifact.

## Current State

The hard cut itself is implemented and the stabilization pass is now complete. The main contract decisions are settled:

- `results/tables.json` is the intended final-table artifact.
- ordered `columns`, ordered `rows`, and ordered `rows[].cells` are the contract shape.
- stable cell identity is `tableId + rowKey + cutKey`.
- analysis grounding, rendered analysis tables, and citation flows have already been moved onto the settled contract.
- downstream cleanup work landed and stale `getTableCard` helper language was removed from the live analysis workflow.

This document is now mainly a **completion/status record**, not an active slice plan.

### Stabilization Status

- **Slice 1 complete on `dev`**: upstream final-table materialization now consumes the settled stage-22 compute shape directly.
- `src/lib/v3/runtime/postV3Processing.ts` finalizes `results/tables*.json` from the in-memory compute input used to generate the R script instead of re-reading `compute/22-compute-package.json` with a stale nested-shape assumption.
- `src/lib/v3/runtime/finalTableContract.ts` now reads the actual top-level `tables` / `cuts` contract used by stage 22.
- deterministic regression coverage now includes both the derived demo-banner path and dual weighted/unweighted finalization.
- **Slice 2 complete on `dev`**: post-R processing now distinguishes `R execution`, `final table contract materialization`, and `Excel export` as separate outcomes.
- the live pipeline now uses a dedicated `finalizing_tables` stage between `executing_r` and export-contract work.
- runs no longer describe final-table materialization failures as `"R Execution"` failures.
- export-contract assembly is skipped when final-table materialization fails, so later stages no longer mask that failure.
- **Slice 3 complete on `dev`**: export readiness now validates the exact resolved `resultsTables` artifact against the final contract schema and fails closed when that artifact is missing or invalid.
- the Phase 1 export manifest now includes the resolved `resultsTables` input in local artifact integrity checks, so tampering or stale raw-table artifacts invalidate readiness before Q / WinCross generation.
- local demo Q / WinCross generation now respects the same fail-closed readiness gate instead of letting serializer paths be the first strict consumer.
- **Slice 4 complete on `dev`**: the settled contract has now been validated on the real run path, not only helper seams.
- deterministic regression coverage now spans post-R finalization -> export readiness -> fresh Q/WinCross consumer parsing and generation.
- live end-to-end validation has now passed for:
  - pipeline execution through review-resume
  - Excel download
  - Q export generation
  - WinCross export generation
  - analysis session usage on the completed run
- the final E2E pass also closed three follow-up issues that surfaced only in live flow:
  - durable review-resume recovery now derives local output paths from `datasetName + pipelineId + outputs base` instead of trusting persisted absolute paths
  - final-table materialization now normalizes R `"NA"` stat placeholders in mean-table results to `null` before strict final-contract validation
  - simplified-base tables now reject/strip AI-introduced legacy base-disclosure prose in `userNote`, and WinCross no longer treats `userNote` as export-authoritative base-contract input

## What The Hard Cut Already Achieved

- post-R final table materialization exists in `src/lib/v3/runtime/finalTableContract.ts`
- post-R finalization/validation exists in `src/lib/v3/runtime/postV3Processing.ts`
- analysis grounding uses the settled `searchRunCatalog` -> `fetchTable` -> optional render marker -> `confirmCitation` workflow
- rendered analysis tables preserve contract row order and row-level formatting semantics
- Q / WinCross / export readers were moved toward the final contract instead of legacy compatibility branches

## Where We Actually Are Now

The remaining work is no longer “finish stabilization after implementation.” That work has now been completed on `dev`.

The hard cut is implemented, downstream consumers are aligned to the settled contract, and the run/export/analysis path has now been validated end to end.

## Confirmed Bug Stack

### 1. Upstream final-table materialization mismatch was real and is now fixed

We traced a real failing run where the post-R final-contract pass failed before `results/tables.json` was upgraded into the settled `columns` / `rows` / `cells` shape.

What was fixed:

- `src/lib/v3/runtime/finalTableContract.ts` no longer expects `computePackage.rScriptInput?.tables` / `computePackage.rScriptInput?.cuts`.
- the final-table builder now reads the settled top-level stage-22 `tables` / `cuts` shape directly.
- the shared post-R path now finalizes raw `results/tables*.json` from the same compute input that generated the R script.
- regression coverage now protects the derived demo banner path and weighted/unweighted finalization.

### 2. R success was being conflated with post-R contract finalization and is now fixed

This was an important labeling problem:

- R execution can succeed and still produce useful raw table data.
- post-R final table contract materialization can fail afterward.
- the old pipeline path recorded that failure under the `"R Execution"` stage and continued in a way that made the state hard to reason about.

What now exists conceptually in the pipeline:

- `R succeeded/failed`
- `final table contract succeeded/failed`
- `Excel succeeded/failed`
- `export contract ready/not ready`

Those are separate states and the system now carries that distinction through shared post-processing, summaries, and worker status handling.

### 3. Export readiness used to be too optimistic and is now fixed

The export-manifest/readiness layer now fails closed on an invalid final tables artifact.

What was fixed:

- the Phase 1 export manifest now validates `artifactPaths.inputs.resultsTables` against the settled final contract schema.
- readiness now records an explicit `invalid_results_tables_contract` failure when that artifact is raw, stale, or otherwise invalid.
- the resolved `resultsTables` path now participates in local integrity checks, so checksum drift on the real export input invalidates readiness.
- local demo export generation now gates on the same readiness result instead of attempting best-effort serialization.

### 4. Q and WinCross are surfacing the upstream contract break

The current Q / WinCross failures are symptoms of the upstream artifact problem, not the primary root cause.

What is happening:

- Q and WinCross now correctly parse `resultsTables` as the final contract.
- if they are handed a raw `results/tables.json` artifact without `columns` / `rows`, they fail immediately.
- that failure is useful signal, but the deeper bug lives earlier in finalization and readiness.

### 5. Weighted-path metadata still needs explicit end-to-end verification

We already fixed one export metadata path issue on `dev` so dual-output runs point `artifactPaths.inputs.resultsTables` at the weighted final artifact instead of the stale base path.

That fix was necessary, but it is not the current root cause for the failing unweighted run we inspected. The main blocker remains upstream finalization.

## Final Validation Outcome

The hard cut can now be treated as operationally validated on `dev`.

What is now true:

1. successful runs materialize `results/tables*.json` into the settled final contract before downstream consumers read those artifacts
2. the pipeline distinguishes `R execution`, `final table contract materialization`, and `Excel export` as separate states
3. export readiness fails closed when `resultsTables` is missing or invalid
4. Q and WinCross consume the finalized artifact on fresh runs
5. review-resume uses the same downstream seam and has now been proven on a live resumed run
6. the analysis surface works on the completed run after the same artifact chain is produced

## Done Means

We can now treat the hard cut as fully stabilized when all of the following are true, and they have now been satisfied on `dev`:

- successful runs reliably materialize `results/tables.json` into the settled final contract
- the pipeline distinguishes R success from post-R finalization success
- export readiness fails closed when `resultsTables` is not in final-contract shape
- Q and WinCross succeed on fresh runs without relying on legacy compatibility behavior
