# Analysis Structured Parts Hard Cut

**Purpose:** move analysis rendering and citations onto explicit structured assistant parts so live analysis behavior no longer depends on marker text as the backend source of truth.

## Current State

### Done

- the final-table hard cut dependency is complete
- Slice 1 is complete at the backend contract seam
- Slice 2 is complete at the client consumer seam
- analysis cell identity remains `tableId + rowKey + cutKey`
- `valueMode` is still not part of citation identity

### What is true now

- prompts and tool instructions still teach `[[render ...]]` and `[[cite ...]]`
- the route still accepts marker-bearing assistant text from the model
- `src/app/api/runs/[runId]/analysis/route.ts` now validates marker text, then converts it into ordered structured assistant parts
- the settled live route response now emits explicit structured client parts (`text` + `data-analysis-render` + `data-analysis-cite`) instead of relying on marker-bearing assistant prose on the client
- trust now derives cited grounding from structured `cite` parts when finalizing the assistant message
- rendered evidence state (`anchorId`, `renderedInCurrentMessage`) now comes only from explicit render parts, not from fetched tables alone
- persistence now stores assistant `text` / `render` / `cite` parts explicitly in `analysisMessages.parts`
- `tool-fetchTable` artifacts still persist through `analysisArtifacts` unchanged
- `src/lib/analysis/messages.ts` now replays persisted structured assistant parts directly into structured client parts and keeps the legacy marker fallback in one read-time seam only, including content-only legacy assistant messages
- `src/components/analysis/AnalysisMessage.tsx` now renders from structured `render` / `cite` client parts instead of reconstructing inline tables and citations from marker text
- `AnalysisThread` now snaps settled in-session messages back to the persisted canonical session shape so current-turn behavior and reload behavior converge
- unreferenced `tool-fetchTable` outputs no longer auto-render inline; inline table rendering is explicit only
- shared anchor helpers now back inline citations, evidence chips, and rendered table-cell anchors
- evidence links only target rendered table/cell anchors when the corresponding inline render actually exists in the message

So Slice 2 now leaves the consumer side split cleanly:

1. route finalization is structured
2. trust is structured
3. persistence is structured
4. replay is structured
5. settled live client rendering is structured

The overall hard cut is still open because the write seam remains marker-backed:

- prompts and tool descriptions still teach marker grammar
- the model still emits marker-bearing prose
- the route still validates / repairs marker text before finalizing structured parts

## Target State

New analysis writes should end with:

- `text` parts for prose
- `render` parts for inline table cards
- `cite` parts for citation anchors
- existing `tool-*` parts unchanged
- existing `reasoning` parts unchanged

The remaining end state is complete when prompt and live write paths also stop depending on marker grammar, so no active path still needs marker validation, repair, or marker-only compatibility.

## Next Steps

### 3. Cut the prompt contract over

- remove marker grammar from the analysis prompt and tool descriptions
- stop teaching the model to emit `[[render ...]]` and `[[cite ...]]`
- have the route finalize directly from structured assistant output instead of marker text

### 4. Remove live marker dependencies

- remove marker-based validation and repair from the live structured path
- remove marker-based cite derivation fallback from current-turn writes once no longer needed
- keep, at most, a narrow read-time compatibility lane for older persisted messages

## Success Criteria

### Slice 2 exit criteria

Slice 2 is complete when:

- assistant message structure is written and rendered as `text` / `render` / `cite`
- `groundingRefs` come from structured cite parts
- rendered evidence / anchors derive from explicit render parts only
- persistence writes structured assistant parts directly
- persisted replay and live current-turn rendering use the same structured client contract
- inline table rendering is explicit only; fetched-but-unrendered tables do not auto-appear
- evidence chips, rendered table anchors, and citation scroll targets use one shared anchor identity contract
- any remaining old-message compatibility is isolated to one read-time seam

### Full hard-cut completion

The full hard cut is complete when:

- the prompt no longer teaches marker grammar
- marker parsing is no longer part of the active renderer or write path
