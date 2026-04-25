# Analysis Structured Parts Hard Cut

**Purpose:** move analysis rendering and citations onto explicit structured assistant parts so `render` / `cite` behavior no longer depends on inline marker text inside prose.

## Current State

The upstream dependency is now done:

- the final-table hard cut is complete
- analysis cell identity is already settled in `src/lib/analysis/types.ts` as `tableId + rowKey + cutKey`
- `valueMode` is not part of citation identity

The analysis surface has **not** made the equivalent hard cut yet.

What is live today:

- prompts still teach `[[render ...]]` and `[[cite ...]]`
- `src/lib/analysis/AnalysisAgent.ts` tool descriptions still instruct the model to emit those markers
- `src/app/api/runs/[runId]/analysis/route.ts` is already the trust seam: it withholds streamed text, waits for the final assistant response, validates markers, optionally repairs once, rebuilds final text, emits final text + metadata, and persists the result
- `src/lib/analysis/renderAnchors.ts`, `citeAnchors.ts`, `markerRepair.ts`, and `claimCheck.ts` are still marker-driven
- `src/components/analysis/AnalysisMessage.tsx` still has a split rendering path because cite chips are reconstructed from text
- persistence already stores additive message parts in `analysisMessages.parts`, and `tool-fetchTable` artifacts already persist separately in `analysisArtifacts`

So the current state is:

1. tool parts are already first-class
2. the route already has a finalization seam
3. only the assistant-authored structural layer is still trapped inside text

## Target State

The live message contract should become:

- `text` parts for prose
- `render` parts for inline table rendering
- `cite` parts for citation anchors
- existing `tool-*` parts unchanged
- existing `reasoning` parts unchanged

Key rules:

- `render` resolves by `tableId` against fetched `tool-fetchTable` outputs
- later fetches for the same `tableId` still win
- `cite.cellIds` use the existing `buildAnalysisCellId()` format exactly
- `groundingRefs` come from structured `cite` parts, not regex over prose

## Recommended Approach

This should be a hard cut on the assistant-authored structure only.

What stays the same:

- real tool parts remain real tool parts
- `tool-fetchTable` artifact persistence stays as-is
- the route remains the place where assistant output is finalized

What changes:

- `render` / `cite` stop living inside text
- the route normalizes and validates structured assistant parts
- the renderer projects from structured parts instead of re-parsing prose
- legacy marker parsing moves to a narrow read-time compatibility shim only

## Roadmap

### 1. Finalize the structured part contract

- add explicit `render` and `cite` assistant parts
- keep `tool-*` and `reasoning` parts unchanged
- keep cite identity aligned to `tableId + rowKey + cutKey`

### 2. Convert the route trust seam

- update `src/app/api/runs/[runId]/analysis/route.ts` to finalize structured assistant parts instead of marker text
- validate `render` against fetched / known tables
- validate `cite` against confirmed cells from this turn
- derive `groundingRefs` from structured cite parts

This is the primary implementation seam.

### 3. Update persistence and replay

- persist `render` and `cite` parts directly
- keep `tool-fetchTable` artifact persistence unchanged
- add read-time translation in `src/lib/analysis/messages.ts` for older persisted marker messages

### 4. Simplify client rendering

- remove inline marker parsing from `src/components/analysis/AnalysisMessage.tsx`
- render prose through one markdown path
- render cards from `render` parts
- render chips from `cite` parts
- update evidence suppression and reveal logic to use structured parts

### 5. Rewrite the prompt contract

- remove marker grammar from `src/prompts/analysis/alternative.ts`
- keep `production.ts` aligned since it aliases the same prompt
- update `AnalysisAgent.ts` tool descriptions so they no longer teach inline markers

### 6. Remove live marker dependencies

- remove marker-based validation from live paths
- remove marker-based trust derivation
- remove the split cite rendering path
- keep only a narrow read-time compatibility layer for old messages

## What Should Stay Tight

The target is not a new two-system architecture.

After the cut:

- new writes use structured assistant parts only
- renderer, trust, and persistence write paths no longer parse marker text
- compatibility for old messages lives in one read-time seam, not across the app

## Success Criteria

Successful when:

- assistant message structure uses `render` / `cite` parts instead of inline markers
- `groundingRefs` derive from structured cite parts
- the chat UI has one prose rendering path
- persistence writes structured parts directly
- prompts no longer teach marker grammar
- marker parsing is gone from live render, trust, and write paths
