# Analysis Structured Parts Hard Cut

**Purpose:** move analysis rendering and citations onto explicit structured assistant parts so live analysis behavior no longer depends on marker text as the backend source of truth.

## Current State

### Done

- the final-table hard cut dependency is complete
- Slice 1 is complete at the backend contract seam
- analysis cell identity remains `tableId + rowKey + cutKey`
- `valueMode` is still not part of citation identity

### What is true now

- prompts and tool instructions still teach `[[render ...]]` and `[[cite ...]]`
- the route still accepts marker-bearing assistant text from the model
- `src/app/api/runs/[runId]/analysis/route.ts` now validates marker text, then converts it into ordered structured assistant parts
- trust now derives cited grounding from structured `cite` parts when finalizing the assistant message
- persistence now stores assistant `text` / `render` / `cite` parts explicitly in `analysisMessages.parts`
- `tool-fetchTable` artifacts still persist through `analysisArtifacts` unchanged
- `src/lib/analysis/messages.ts` now replays persisted structured assistant parts back into legacy marker-bearing text for the current renderer
- the live client stream is still text-first, and `src/components/analysis/AnalysisMessage.tsx` is still on the legacy marker-render path

So the backend hard cut is partly done:

1. route finalization is structured
2. trust is structured
3. persistence is structured
4. replay is temporarily translated back for the current UI

## Target State

New analysis writes should end with:

- `text` parts for prose
- `render` parts for inline table cards
- `cite` parts for citation anchors
- existing `tool-*` parts unchanged
- existing `reasoning` parts unchanged

The end state is complete when renderer, prompt, and live write paths all use that contract directly, without legacy marker translation in active code paths.

## Next Steps

### 2. Cut the renderer over

- update `src/components/analysis/AnalysisMessage.tsx` to render from structured `render` / `cite` parts
- remove the split prose-plus-marker reconstruction path
- keep old-message compatibility behind the replay/read seam only

### 3. Cut the prompt contract over

- remove marker grammar from the analysis prompt and tool descriptions
- stop teaching the model to emit `[[render ...]]` and `[[cite ...]]`
- have the route finalize directly from structured assistant output instead of marker text

### 4. Remove live marker dependencies

- remove marker-based validation and repair from the live structured path
- remove marker-based cite derivation fallback from current-turn writes once no longer needed
- keep, at most, a narrow read-time compatibility lane for older persisted messages

## Success Criteria

Successful when:

- assistant message structure is written and rendered as `text` / `render` / `cite`
- `groundingRefs` come from structured cite parts
- persistence writes structured assistant parts directly
- the prompt no longer teaches marker grammar
- marker parsing is no longer part of the active renderer or write path
