# Final Table Contract Hard-Cut Outline

**Purpose:** define the end-state contract for final computed tables so the analysis surface, citations, markdown projection, and other downstream consumers all read the same ordered, display-semantic-aware artifact.

**Status:** active hard-cut implementation outline. Slice A and Slice B are complete for the current hard-cut scope; Slice C is partially implemented; Slice D is partially implemented; Slice E remains open.

## Current implementation snapshot (April 24, 2026)

This outline started as a design/alignment document. It now also needs to reflect where the codebase actually stands after the first implementation wave.

### Current slice status

- **Slice group A — final contract definition:** complete for current hard-cut scope
  - `results/tables.json` now treats ordered `columns`, ordered `rows`, and ordered `rows[].cells` as the authoritative final-table contract.
  - Stable cell identity is now `tableId + rowKey + cutKey`, with row-level display semantics carried by `row.valueType` + `row.format`.
- **Slice group B — finalization builder:** complete for current scope
  - `src/lib/v3/runtime/finalTableContract.ts` exists as the contract builder.
  - `src/lib/v3/runtime/postV3Processing.ts` now hard-validates the finalized contract after R execution and applies the same shaping path to `tables.json`, `tables-weighted.json`, and `tables-unweighted.json`.
  - Column ordering now prefers compute-package cut order, and `mean_rows` tables preserve numeric display semantics in the final contract.
  - The special derived demo banner table (`_demo_banner_x_banner`) remains on a deterministic contract path instead of relying on analysis-time inference.
- **Slice group C — analysis grounding and model projection:** partially implemented
  - `src/lib/analysis/grounding.ts` now reads ordered row/column metadata from the final contract.
  - `fetchTable` / `getTableCard`, `confirmCitation`, and markdown projection have been moved closer to contract-driven behavior.
  - Some transitional resilience logic still exists because the analysis surface cannot hard-fail on a single malformed table.
- **Slice group D — rendered analysis tables and citations:** partially implemented
  - Rendered table cards and citations are closer to the final contract but are not fully reconciled end-to-end.
  - The current user experience still shows that some tables/tools can degrade or become unavailable even when the session itself remains usable.
- **Slice group E — downstream consumer audit and cleanup:** not complete
  - Downstream consumers have been touched opportunistically.
  - A deliberate audit / cleanup pass has not happened yet.

### What counts as “done so far”

The following should be treated as real progress, not just exploration:

- final-table contract builder introduced
- post-R enrichment path introduced
- typed `rows` / `columns` contract added to `results/tables.json`
- strict final-contract schema added for finalized results artifacts
- analysis grounding moved toward contract-driven row order and row semantics
- mixed numeric / percent row handling now has deterministic regression coverage

### What is explicitly **not** done yet

The following items remain outside the completed scope of this wave:

- complete removal of transitional analysis compatibility logic
- full rendered-table / citation / markdown alignment audit
- downstream consumer cleanup and removal of obsolete abstractions

### Working rule for the next implementation sessions

We are not waiting for every surrounding surface to be perfect before moving a slice forward. The practical rule is:

- complete the slice target as cleanly as possible
- run the tests that become possible once the slice works
- fix adjacent issues when they become relevant blockers
- avoid turning every adjacent bug into an unbounded side quest

## Why this document exists

The current system already has most of the information we need, but it is split across artifacts:

- `compute/22-compute-package.json` carries canonical row structure, ordering intent, and row semantics.
- `results/tables.json` carries final computed cell values, bases, and significance markers.
- Excel uses `results/tables.json` as an input, but analysis does not currently receive a sufficiently explicit final-table contract.

That split creates avoidable reconstruction work on the analysis surface:

- row order gets re-derived from row keys
- stat rows can be misclassified
- display semantics are treated as table-global instead of row-aware
- rendered table cells and cited values can drift from each other

The goal is not to copy Excel output or make analysis scrape workbooks. The goal is to make the final computed JSON contract explicit enough that Excel, analysis, citations, and model-facing markdown projection are all just projections over the same truth.

## Core decision

**Decision:** `results/tables.json` should become the final consumer contract.

That means:

- keep a single final computed artifact for downstream consumers
- enrich `results/tables.json` after R execution using canonical row metadata already present upstream
- remove analysis-side reconstruction heuristics rather than preserving them
- treat this as a hard cut, not a backward-compatibility layering exercise

We are not introducing a new parallel display artifact unless we discover a concrete reason that the final contract cannot live in `results/tables.json`.

## Design principles

### 1. Final artifact, not intermediate dump

`results/tables.json` should stop behaving like a thin R output dump and start behaving like the product's final table contract.

### 2. Ordered rows and columns are first-class

Consumers should never infer row or column order from object keys when the pipeline already knows the order.

### 3. Display semantics are row-aware

A single table can legitimately contain mixed row semantics:

- percentage rows
- count rows
- bases
- means / medians
- standard deviations
- standard errors

The contract must support that directly.

### 4. Analysis is a projection layer

The analysis surface should not reconstruct what the table "really is." It should render, cite, and summarize the final contract.

### 5. Hard cut over compatibility shims

We should prefer changing the contract cleanly and fixing affected consumers with typing and tests over preserving old abstractions that keep the system brittle.

## Target end state

Each table in `results/tables.json` should expose:

- ordered columns with explicit cut metadata
- ordered rows with explicit row metadata
- per-row display semantics
- final computed cells keyed in a way that does not require guessing

Conceptually, the final table contract should answer these questions without inference:

- In what order do rows render?
- In what order do columns render?
- Is this row a value row, net row, stat row, rank row, top-k row, or other row type?
- If it is a stat row, what statistic is it?
- How should this row's cells display: percent or plain number, and at what precision?
- What is the stable identity of a cited cell?

## Proposed shape direction

This is directionally the shape we are moving toward. It is intentionally illustrative rather than final schema text.

```ts
type ResultsTablesFinal = {
  metadata: {
    generatedAt: string
    tableCount: number
    cutCount: number
    significanceTest?: string
    significanceLevel?: number
    comparisonGroups?: string[]
    bannerGroups?: Array<{
      groupKey: string
      groupName: string
      columns: Array<{
        cutKey: string
        cutName: string
        statLetter: string | null
      }>
    }>
  }
  tables: Record<string, {
    tableId: string
    questionId: string
    questionText: string
    tableType: string
    surveySection: string | null
    baseText: string | null
    tableSubtitle: string | null
    userNote: string | null

    columns: Array<{
      cutKey: string
      cutName: string
      groupKey: string
      groupName: string | null
      statLetter: string | null
      baseN: number | null
      isTotal: boolean
      order: number
    }>

    rows: Array<{
      rowKey: string
      label: string
      rowKind: string
      statType: string | null
      indent: number
      isNet: boolean
      valueType: string
      format: {
        kind: "percent" | "number"
        decimals: number
      }
      cells: Array<{
        cutKey: string
        value: number | null
        metrics: {
          pct: number | null
          count: number | null
          n: number | null
          mean: number | null
          median: number | null
          stddev: number | null
          stderr: number | null
        }
        sigHigherThan: string[]
        sigVsTotal: "higher" | "lower" | null
      }>
    }>
  }>
}
```

This does not mean we must land every field in one slice. It means the direction of travel is toward an explicit final-table contract, not toward more implicit derivation.

## Surfaces affected

### 1. Post-R finalization

Primary file: `src/lib/v3/runtime/postV3Processing.ts`

This is the natural boundary to build the final contract because it already:

- reads R output
- rewrites `results/tables.json`
- produces downstream files from that output

This step should merge:

- computed values from `results/tables.json`
- canonical row semantics from `compute/22-compute-package.json`

into the enriched final `results/tables.json`.

### 2. Artifact schemas and typing

Primary file: `src/lib/exportData/inputArtifactSchemas.ts`

The schema for `ResultsTablesArtifactSchema` must stop being effectively "tableId + questionId + passthrough" and become a typed contract for:

- ordered columns
- ordered rows
- row display semantics
- cell structure

This is the contract enforcement point that should force affected consumers to update.

### 3. Analysis grounding tools

Primary file: `src/lib/analysis/grounding.ts`

Impacted tools:

- `searchRunCatalog`
- `getTableCard` / `fetchTable`
- `confirmCitation`
- markdown projection helpers used for model-facing fetched tables

Expected change:

- stop sorting row keys from object names
- stop using table-global display assumptions as the primary rule
- stop inferring stat rows from weak signals
- project directly from ordered rows and columns in the final contract

### 4. Rendered table cards

Primary file: `src/components/analysis/GroundedTableCard.tsx`

Expected change:

- compact view truncates rows, but does not hide stat rows just because they are stat rows
- expanded view renders all rows exactly as defined by the final contract
- mixed numeric and percent rows render correctly in one table

### 5. Citations and cell IDs

Primary files:

- `src/lib/analysis/types.ts`
- `src/lib/analysis/grounding.ts`
- `src/lib/analysis/renderAnchors.ts`
- `src/lib/analysis/messages.ts`

Expected change:

- citation should resolve against canonical row and column definitions
- cited display values must match rendered cells
- cell identity should be derived from the final contract, not from legacy display assumptions

One likely simplification is removing `valueMode` from cell identity if row-level display semantics become authoritative.

### 6. Model-facing markdown projection

Primary file: `src/lib/analysis/grounding.ts`

The markdown table passed back into the model via `fetchTable` is affected.

It should:

- preserve canonical row order
- preserve mixed row semantics
- avoid flattening everything into a table-global percent interpretation
- match what the user sees in the rendered table card closely enough that model reasoning and UI rendering do not diverge

This surface matters because the model often reasons over the fetched markdown before deciding what to cite or render.

### 7. Analysis prompt/tool mental model

Primary files:

- `src/lib/analysis/AnalysisAgent.ts`
- analysis prompt files

Prompt/tool guidance should reflect the new contract, not transitional concepts. If an old concept exists only to support the previous structure, it should be removed rather than re-explained.

### 8. Downstream consumers beyond analysis

Primary surfaces:

- Excel formatting
- Q export
- WinCross export
- table presentation rebuild services
- any review or local export paths reading `results/tables.json`

Even if these consumers continue to work with the new shape, they must be audited deliberately. The hard-cut goal means we should know which downstream paths are real consumers of `results/tables.json` and update them intentionally.

## What should be removed

This effort is not just additive. We should plan to remove the following categories of brittleness:

- row-order reconstruction from row-key sorting
- table-global display assumptions when rows are mixed
- stat-row hiding heuristics in rendered analysis tables
- prompt text that teaches legacy concepts no longer needed by the system
- compatibility branches that exist only to support the old final-table structure

## What should remain true

The following behavioral guarantees should remain true across the transition:

- analysis remains grounded only in verified pipeline artifacts
- the analysis surface does not query raw `.sav`
- citation links continue to resolve to specific cells
- rendered tables and cited numbers remain aligned
- table order and numeric semantics match the pipeline's intended output, not a UI-side guess

## Major open questions

These are design questions to settle before slice-level implementation plans.

### 1. Final cell structure

Do we want each row to contain:

- an array of cells in column order

or

- a map by `cutKey`

or

- both

The answer affects renderer simplicity, citation lookup, and JSON size.

### 2. Cell identity

Should stable cell identity be:

- `tableId + rowKey + cutKey`

or should it retain some notion of display mode/value mode

The row-aware contract argues strongly for the simpler identity.

### 3. Row display format vocabulary

We need a small, explicit vocabulary for row display semantics. Examples:

- `percent_0dp`
- `number_1dp`
- `number_2dp`

This should be explicit enough for rendering and citations without turning the artifact into UI-only styling metadata.

### 4. Column contract shape

Do we keep:

- `metadata.bannerGroups` plus per-table columns

or move fully to per-table ordered columns with optional cross-table metadata

Per-table columns are simpler for rendering and citations; global banner metadata is still useful for search and discovery.

### 5. Final contract source

If `22-compute-package.json` is the structural source and R output is the numeric source, we should decide whether the finalization merge is:

- a lightweight enrichment pass

or

- a more explicit contract-builder module

The latter may be cleaner if the shaping logic becomes non-trivial.

## Suggested rollout structure

This is not the slice plan itself. It is the intended grouping for future slice plans.

### Slice group A — final contract definition

- settle the target `results/tables.json` shape
- define typed schema
- define cell identity
- define row display semantics vocabulary

### Slice group B — finalization builder

- enrich `results/tables.json` after R
- use compute-package row semantics directly
- emit explicit ordered rows and columns

### Slice group C — analysis grounding and model projection

- refactor `fetchTable` / `confirmCitation`
- update markdown projection
- remove row reconstruction and table-global formatting assumptions

### Slice group D — rendered analysis tables and citations

- update `GroundedTableCard`
- update citation anchoring and rendering
- ensure compact and expanded views honor the new contract

### Slice group E — downstream consumer audit and cleanup

- update other `results/tables.json` consumers
- remove legacy branches and transitional prompt/tool language
- hard-cut obsolete abstractions

## Success criteria

This initiative is successful when all of the following are true:

- `results/tables.json` is the trusted final-table contract for downstream consumers
- analysis renders tables in exact artifact row order
- mixed numeric and percent rows display correctly in one table
- `confirmCitation` returns the same value the user sees in the rendered table
- the model-facing fetched markdown preserves the same semantics the UI renders
- obsolete compatibility logic has been removed rather than preserved

## Immediate next step

After alignment on this outline, create robust slice-by-slice implementation plans that explicitly cover:

- contract shape
- migration path within the codebase
- affected tests
- cleanup/removal work

The key constraint for those follow-on plans: each slice should move the system toward the hard-cut end state rather than layering more compatibility scaffolding onto the old shape.
