# Final Table Contract Hard Cut

**Purpose:** make `results/tables.json` the single final-table contract for analysis, citations, and downstream consumers so every surface projects from the same ordered, row-semantic-aware artifact.

## Current State

### Hard-cut status

- **Contract boundary is in place.**
  - `results/tables.json` now treats ordered `columns`, ordered `rows`, and ordered `rows[].cells` as the authoritative final contract.
  - Stable cell identity is now `tableId + rowKey + cutKey`.
  - Row-level display semantics are carried by `row.valueType` + `row.format`.

- **Post-R finalization is in place.**
  - `src/lib/v3/runtime/finalTableContract.ts` builds the final contract.
  - `src/lib/v3/runtime/postV3Processing.ts` finalizes and strict-validates `tables.json`, `tables-weighted.json`, and `tables-unweighted.json` after R execution.
  - Column ordering prefers compute-package cut order.
  - `mean_rows` tables preserve numeric display semantics in the final contract.
  - The derived demo banner table stays on a deterministic builder path.

- **Analysis has already moved partway onto the contract.**
  - `src/lib/analysis/grounding.ts` reads ordered row and column metadata from the final contract.
  - `fetchTable`, `confirmCitation`, and model markdown projection already use contract rows, cut keys, and row-level formatting.
  - Mixed percent and numeric rows already have deterministic regression coverage.

### Important naming clarification

- The model-facing tool is **`fetchTable`**.
- `getTableCard` is an **internal helper implementation** behind `fetchTable`.
- There is currently **no `getRenderTable` symbol** in the repo.
- If agents keep talking about `getTableCard`, that is stale internal/prompt language, not the actual tool workflow we want to preserve.

### What is already done

- final-table contract builder introduced
- post-R enrichment and validation introduced
- typed ordered `columns` / `rows` / `cells` added to results artifacts
- contract-driven row order and row semantics established in analysis grounding
- stable cell identity simplified to `tableId + rowKey + cutKey`

### What is not done yet

- complete removal of analysis-time compatibility/hydration logic
- complete cleanup of stale `getTableCard` wording in prompts, comments, and tests
- full rendered-table / citation alignment audit
- downstream consumer audit and cleanup

## Remaining Work

### Slice C — Analysis Grounding And Model Projection

**Goal:** make live analysis ingestion and model-facing projection contract-only.

This slice owns:

- removing analysis-time rebuilding / hydration as a normal path in `src/lib/analysis/grounding.ts`
- making `fetchTable` and `confirmCitation` rely on finalized contract data rather than compatibility recovery
- deciding whether live analysis still needs `valueMode` now that row-level display semantics are authoritative
- keeping model markdown projection aligned with contract row order, row semantics, and cut order
- making the slice language explicitly `fetchTable`-first rather than `getTableCard`-first

This slice does **not** own:

- `GroundedTableCard` UI behavior
- render markers and render-focus UX
- persisted replay cleanup
- broad downstream consumer cleanup

**Boundary rule:** Slice C is about the data/grounding path the model and citation logic consume, not the rendered card UX.

### Slice D — Rendered Analysis Tables And Citations

**Goal:** make rendered table cards and citation presentation align cleanly with the contract-driven grounding path.

This slice owns:

- `src/components/analysis/GroundedTableCard.tsx`
- compact and expanded rendered-table behavior
- render-marker focus behavior in `src/lib/analysis/renderAnchors.ts`
- end-to-end rendered alignment between table cards, displayed cell values, and citation anchors

This slice does **not** own:

- changing how live grounding loads tables
- rebuilding or hydrating incomplete contracts
- broad prompt/tool terminology cleanup

**Boundary rule:** Slice D is about what the user sees once a grounded table is already available.

### Slice E — Downstream Consumer Audit And Cleanup

**Goal:** remove stale abstractions and deliberately clean up the remaining consumers after C and D are settled.

This slice owns:

- audit of all other `results/tables.json` consumers
- cleanup of deprecated compatibility fields and replay shims
- cleanup of stale prompt/comment/test wording that still talks about `getTableCard`
- explicit confirmation in code comments and prompt language that the workflow is `fetchTable`, not a legacy helper concept

This slice is also the right place to:

- remove or rename obsolete helper concepts if they are no longer earning their keep
- clean up tests whose names still describe the old workflow
- do the final removal pass on compatibility branches introduced during the cut

**Boundary rule:** Slice E is cleanup, naming, audit, and removal work after the live behavior is correct.

## Specific Clarifications To Keep Us Aligned

### `fetchTable` vs `getTableCard`

The planning and prompt language should describe the workflow as:

1. `searchRunCatalog`
2. `fetchTable`
3. optional render marker
4. `confirmCitation`

It should **not** describe the workflow as “call `getTableCard`”.

### `getRenderTable`

There is no `getRenderTable` code path to migrate or deprecate right now.

If we want the codebase to stop surfacing similar stale ideas, the actual cleanup target is:

- stale `getTableCard` prompt language
- stale test names and comments
- any internal helper naming that causes agents to talk about the wrong abstraction

## Success Criteria For The Remaining Work

The hard cut is complete when all of the following are true:

- `results/tables.json` is the trusted final-table contract for downstream consumers
- analysis grounding does not normally reconstruct missing row/column contract data
- `fetchTable` markdown projection matches contract row order and row semantics
- rendered cards and confirmed citations show the same values the contract defines
- code and prompt language consistently describe the workflow as `fetchTable`
- stale compatibility branches and stale helper-language are removed intentionally, not left to drift
