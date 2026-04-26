# Analysis Structured Parts Hard Cut

**Purpose:** move analysis rendering and citations onto explicit structured assistant parts so live analysis behavior no longer depends on marker text as the backend source of truth.

## Current State

### Done

- the final-table hard cut dependency is complete
- Slice 1 is complete at the backend contract seam
- Slice 2 is complete at the client consumer seam
- Slice 3 is complete at the native write-path seam
- analysis cell identity remains `tableId + rowKey + cutKey`
- `valueMode` is still not part of citation identity

### What is true now

- the analysis prompt and tool descriptions now teach a native structured-answer contract, finalized through `submitAnswer({ parts })`
- the active write path no longer relies on marker-bearing assistant prose for new turns
- `src/app/api/runs/[runId]/analysis/route.ts` now requires exactly one valid `submitAnswer({ parts })` and finalizes directly from submitted structured assistant parts
- fresh turns fail hard when `submitAnswer` is missing, malformed, cites unconfirmed cells, or renders unfetched / invalid focus targets
- the settled live route response continues to emit explicit structured client parts (`text` + `data-analysis-render` + `data-analysis-cite`)
- trust derives cited grounding from explicit `cite` parts
- grounded claim refs are cite-derived only; non-claim contextual support now persists separately as `contextEvidence`
- rendered evidence state (`anchorId`, `renderedInCurrentMessage`) comes only from explicit render parts, not from fetched tables alone
- persistence stores assistant `text` / `render` / `cite` parts explicitly in `analysisMessages.parts`
- `tool-fetchTable` artifacts still persist through `analysisArtifacts` unchanged
- `src/lib/analysis/messages.ts` replays persisted structured assistant parts directly into structured client parts
- active assistant-history shaping now derives prior-turn prose from structured/UI parts directly rather than generic marker stripping
- `src/lib/analysis/messages.ts` retains one intentional legacy read-time fallback for historical content-only assistant messages that still contain marker text
- `src/components/analysis/AnalysisMessage.tsx` renders from structured `render` / `cite` client parts rather than reconstructing inline tables and citations from prose markers
- `src/components/analysis/AnalysisMessage.tsx` keeps cite-derived grounded evidence separate from contextual support in distinct disclosures
- `AnalysisThread` snaps settled in-session messages back to the persisted canonical session shape so current-turn behavior and reload behavior converge
- unreferenced `tool-fetchTable` outputs do not auto-render inline; inline table rendering is explicit only
- shared anchor helpers back inline citations, evidence chips, and rendered table-cell anchors
- evidence links only target rendered table/cell anchors when the corresponding inline render actually exists in the message

So the hard cut now resolves cleanly for active writes:

1. prompt/orchestration is structured
2. route finalization is structured
3. trust is structured
4. persistence is structured
5. replay is structured
6. settled live client rendering is structured

The only legacy dependency left is deliberate historical replay compatibility:

- old persisted content-only assistant messages may still contain marker text
- that compatibility is isolated to one read-time seam
- marker parsing is no longer part of the active new-write path

## Settled Contract

New analysis writes end with:

- `text` parts for prose
- `render` parts for inline table cards
- `cite` parts for citation anchors
- `contextEvidence` metadata for non-claim contextual support
- existing retrieval `tool-*` parts unchanged
- existing `reasoning` parts unchanged

The active path does not require:

- parsing marker-bearing assistant prose
- validating render/cite marker syntax
- repairing malformed markers
- stripping invalid markers before persistence

The active path does require:

- exactly one valid `submitAnswer({ parts })`
- cite parts that reference same-turn `confirmCitation` cellIds only
- render parts that reference same-turn `fetchTable` results only
- render focus hints that match rows/groups actually present in that fetched table payload

## Success Criteria

### Slice 2 exit criteria

Slice 2 was complete when:

- assistant message structure is written and rendered as `text` / `render` / `cite`
- `groundingRefs` come from structured cite parts
- rendered evidence / anchors derive from explicit render parts only
- persistence writes structured assistant parts directly
- persisted replay and live current-turn rendering use the same structured client contract
- inline table rendering is explicit only; fetched-but-unrendered tables do not auto-appear
- evidence chips, rendered table anchors, and citation scroll targets use one shared anchor identity contract
- any remaining old-message compatibility is isolated to one read-time seam

### Full hard-cut completion

The hard cut is complete for active writes now that:

- the prompt no longer teaches marker grammar
- the route finalizes from structured assistant output instead of marker text
- marker validation / repair is no longer part of the active write path
- marker parsing is isolated to a narrow read-time compatibility seam for historical persisted messages only
