# Analysis Structured Parts Hard-Cut Outline

**Purpose:** define the end-state for how the analysis assistant emits structural metadata — render directives, citation anchors — so that text, rendering, citations, streaming, and persistence all operate on explicit structured parts rather than on markers embedded inside free-form prose.

**Status:** design outline for alignment before slice-by-slice implementation planning.

## Why this document exists

The analysis surface currently emits structural metadata as text-level markers inside assistant prose:

- `[[render tableId=X]]` directs the client to place a rendered table card inline.
- `[[cite cellIds=...]]` pins a quoted number to a specific cell and renders as a superscript chip.

Markers are parsed back out of the text stream at render time by text-position regex extractors in `renderAnchors.ts` and `citeAnchors.ts`. Validation and repair run on the same text strings in `markerRepair.ts` and `claimCheck.ts`. Persistence stores messages as `parts`, but markers live inside `text` parts as raw strings that must be re-parsed on every rehydration.

This pattern was pragmatic — it let us ship grounded rendering and inline citation quickly — but the cost is now visible across the system:

- The chat renderer has two divergent paths (Streamdown for non-cite text, ReactMarkdown-per-segment for text with cite chips) because React components cannot be interleaved inside a single markdown render pass. That split is the direct consequence of having to segment-split around inline markers.
- The segment-splitting path wraps each text segment in a `<p>` element, which fragments when the split markdown contains block elements like lists or headings. Latent bug; fires whenever the model cites inside a list or under a heading.
- Markers can land inside markdown structures (code blocks, emphasis, table cells) and still be extracted, because extraction is string-position based, not AST-aware.
- Validation is regex-driven rather than schema-driven. Every grammar change forces text-level reasoning instead of type-level contract changes.
- Streaming and partial parsing have to deal with "is this marker complete yet" states, coupling the reveal controller to marker grammar.
- Persisted messages keep the marker grammar load-bearing forever — any grammar change needs backward-compatibility shims for old messages or an explicit migration.

The goal is to make the assistant's structural metadata explicit in the stream, not reconstructed from prose text. This mirrors the reasoning behind the `results/tables.json` hard-cut: stop deriving structure from a shape that was only ever implicit.

## Why a hard cut, not a softer transition

The costs above are structural, not bugs. They follow from the emission contract: *structural metadata is embedded inside free-form text*. Every softer alternative either preserves that contract at some layer or leaves the class of problems unsolved.

### Alternative 1 — keep both grammars in parallel (additive)

The model can emit either inline markers or structured parts; downstream paths handle both.

- Doubles the surface area of every affected module: two parsers, two validators, two renderer paths, two persisted shapes.
- The renderer's two-path segment-splitting pattern stays in place for as long as inline markers are valid emission. That's the specific bug we are trying to eliminate.
- The prompt has to teach both contracts, or prefer one and tolerate the other. Either way, the model-facing contract is not simplified.
- Has no natural end state. "Additive" becomes "permanent."

### Alternative 2 — gradual deprecation

Ship structured parts first, leave inline markers as a secondary emission path, migrate callers one by one.

- Same surface-area doubling as Alternative 1 during the transition window.
- The transition window ends only when the old path is removed. That removal is the hard cut, just delayed. Delay compounds because every new feature shipped during the window has to support both paths.
- Historically on this codebase, "gradual" deprecations leave the last 10% of migration undone indefinitely, and the old path re-entrenches.

### Alternative 3 — translation shim at the edge

Keep inline markers on the wire, translate them into structured parts at the server-to-client boundary (or the internal-renderer boundary).

- The model-facing contract is unchanged. The prompt still teaches inline marker grammar. The server post-pass still regex-validates against text. The bugs rooted in "markers inside markdown" persist on the emission side.
- Translation becomes permanent load-bearing code. It looks like a hard cut from inside the renderer, but only because the rest of the system is still carrying the old shape.

### Alternative 4 — AST-aware markers

Keep inline markers as the syntax but parse them as first-class markdown AST nodes via a remark plugin. Solves the renderer's segment-splitting pattern without changing the stream contract.

- Addresses the specific visible symptom (the `<p>` wrapper bug, the two-path renderer) but not the root pattern.
- Validation is still regex-on-text server-side. Persistence still stores opaque marker strings that require re-parsing. The prompt still teaches an inline grammar.
- Ties the implementation to a specific parser (remark). Streaming behavior gets harder, not easier, because `react-markdown` isn't streaming-safe the way Streamdown is.
- Leaves the class of problems in place. We'd be back at this design conversation the next time a bug surfaces in any of the remaining text-level paths.

### Why the hard cut

Every softer alternative preserves the embedded-marker contract at some layer. The cost of that preservation is not one-time — it is a permanent tax on every downstream module (renderer, validator, persistence, prompt, reveal controller) and on every future change that touches emission, streaming, or rendering.

The hard cut is bounded. It is a meaningful but finite refactor across the surfaces enumerated below, with one narrow read-time compatibility layer for messages persisted before the cut. After it lands, the embedded-marker pattern is gone from every live path, and the class of problems it creates is gone with it.

We prefer changing the contract cleanly and fixing affected surfaces with typing and tests over preserving old abstractions that keep the system brittle.

## Core decision

**Decision:** render directives and citation anchors become first-class structured parts in the assistant's stream, not inline text markers.

That means:

- Text parts carry pure markdown prose — no markers, ever.
- A render becomes its own part with a typed payload (`{ tableId, focus }`).
- A citation becomes its own part with a typed payload (`{ cellIds }`) that anchors to the text part immediately preceding it.
- The client renderer consumes a typed stream of parts, not a text string to be re-parsed.
- Server validation is schema-driven on structured parts.
- Persisted messages store structured parts; a narrow read-only shim preserves rendering of pre-cut messages.

## Design principles

### 1. Structural metadata is explicit, not embedded

Render directives and citations are first-class data. They are never inferred from prose text.

### 2. Text is prose

Text parts contain only markdown prose. The assistant does not hide structural decisions inside text.

### 3. The renderer is a projection

The chat renderer reads a typed stream of parts and projects it to DOM. It does not parse structure back out of prose.

### 4. One rendering path for prose

A single markdown rendering path handles all text parts. Chips and tables render as siblings of text parts, not as React components interleaved inside markdown output.

### 5. Persistence stores truth, not source text

Persisted messages store the same structured parts the client consumes. Rehydration is not re-parsing.

### 6. Hard cut over compatibility shims

Read-time compatibility for pre-cut persisted messages is acceptable; those messages do not gain new behavior. Live-path compatibility (emission, validation, rendering) is not acceptable and preserves the problems we are trying to solve.

## Target end state

The assistant's stream to the client is a typed sequence of parts:

- `text` parts — markdown prose, no markers.
- `render` parts — structured render directives.
- `cite` parts — structured citation anchors that apply to the preceding text part.
- `tool-*` parts — existing AI-SDK tool-call parts (e.g., `tool-fetchTable`), unchanged in principle.

The client renderer walks the part list and emits one DOM block per text part, one table card per resolved render part, and one inline chip per cite part at the end of its preceding text part.

The server post-pass validates parts against a schema rather than parsing text. The persistence layer stores parts with their typed payloads.

## Proposed shape direction

Directional, not final schema text.

```ts
type AnalysisMessageParts = Array<
  | {
      type: "text"
      text: string
    }
  | {
      type: "render"
      tableId: string
      focus?: {
        rowLabels?: string[]
        rowRefs?: string[]
        groupNames?: string[]
        groupRefs?: string[]
      }
    }
  | {
      type: "cite"
      cellIds: string[]
      // The cite attaches to the end of the preceding text part. In the
      // common case, the model emits one text part per citing sentence so
      // that end-of-sentence placement is preserved without further
      // anchoring metadata.
    }
  | {
      // existing AI-SDK tool-call parts, unchanged
      type: "tool-fetchTable" | "tool-confirmCitation" | "tool-..."
      // ...
    }
>
```

Notes on chip placement: the renderer pairs a `cite` part with the text part immediately preceding it. In the typical flow, the model emits `text("<citing sentence>.") cite([...])` and the chip lands at end-of-sentence because the sentence is the whole text part. If the model emits a multi-sentence text part followed by a cite, the chip lands at end-of-paragraph — acceptable degradation but not the preferred pattern. The prompt teaches one-text-part-per-citing-sentence as the pattern.

Cell identity in the structured `cellIds` field aligns with the outcome of the `results/tables.json` hard-cut. If `valueMode` drops from cell identity there, it drops here too.

## Surfaces affected

### 1. Assistant streaming protocol

Primary file: `src/lib/analysis/AnalysisAgent.ts`

Today the agent streams assistant text with inline markers. It must switch to emitting typed structured parts interleaved with the text stream. This is the central protocol change; everything else follows.

Implementation choice to settle: whether `render` and `cite` ride as custom structured parts on the AI-SDK stream, or as lightweight tool calls that carry display semantics. The SDK surface and streaming ergonomics inform that decision; see open question 5.

### 2. Server post-pass and validation

Primary files:

- `src/lib/analysis/markerRepair.ts`
- `src/lib/analysis/claimCheck.ts`
- `src/lib/analysis/renderAnchors.ts`
- `src/lib/analysis/citeAnchors.ts`

Today these modules parse, validate, repair, and strip inline markers via regex over text. They move to validating structured parts against a schema and repairing at the part level.

Expected simplifications:

- No text-position regex. No CommonMark-vs-marker ambiguity.
- Validation becomes typed set-membership: cite parts reference only cellIds confirmed this turn; render parts reference only tables fetched this turn.
- Repair becomes part removal or part reshaping, not string rewriting.

### 3. Prompt and tool contract

Primary files:

- `src/prompts/analysis/production.ts`
- `src/prompts/analysis/alternative.ts`
- `src/lib/analysis/AnalysisAgent.ts` (tool descriptions)

The prompt stops teaching inline marker grammar and starts teaching the structured output contract.

- Remove all `[[render ...]]` and `[[cite ...]]` marker grammar sections.
- Replace with the structured contract: how to request a render, how to attach a citation to a sentence, how chip placement works.
- Keep the conceptual model (explore → analyze → ground → render → compose) unchanged. Only the emission mechanism changes.

### 4. Client rendering

Primary file: `src/components/analysis/AnalysisMessage.tsx`

Expected changes:

- Single text rendering path. All text parts flow through one markdown renderer.
- Remove `InlineCitationText` and the `<p>` wrapper.
- `buildAnalysisRenderableBlocks` becomes a pure projection over structured parts. It groups text parts with their trailing cite parts and nearby render parts.
- `buildAnalysisCiteSegments` is removed.

Secondary files:

- `src/components/analysis/AnalysisThread.tsx`
- `src/lib/analysis/renderAnchors.ts` — reduces substantially; position-based marker extraction disappears.
- `src/lib/analysis/citeAnchors.ts` — reduces substantially; string-based marker extraction disappears.

### 5. Streaming and reveal controller

Primary file: `src/components/analysis/AnalysisMessage.tsx`

The reveal controller watches marker appearances today. It switches to watching structured part appearances.

Expected changes:

- Reveal staging keys off part arrival: text part starts, cite part arrives, render part resolves with its fetched table.
- No partial-marker states. Simpler streaming semantics.

### 6. Persistence and replay

Primary files:

- `convex/analysisMessages.ts`
- `src/lib/analysis/persistence.ts`
- `src/lib/analysis/messages.ts`

Today persisted messages store parts, but text parts contain raw marker strings the client re-parses on every rehydration. The new shape stores structured `render` and `cite` parts directly.

Expected changes:

- Schema accepts the new part types with typed payloads.
- A read-only compatibility layer rehydrates messages persisted before the cut and renders them via the new renderer without round-tripping through the old marker parser. This layer is narrow; new messages are always persisted in the new shape.
- Tool-call parts unchanged.

### 7. Types

Primary file: `src/lib/analysis/types.ts`

Expected changes:

- New typed part shapes for `render` and `cite`.
- Type guards updated.
- Cell identity aligns with the `results/tables.json` hard-cut outcome.

### 8. Trace and telemetry

Primary file: `src/lib/analysis/trace.ts`

Today grounding events capture tool calls and scan text for markers. The text-scanning portion disappears; grounding events become directly derivable from structured parts.

### 9. Tests

Primary directories:

- `src/lib/analysis/__tests__/`
- `src/components/analysis/__tests__/`
- `src/app/api/runs/[runId]/analysis/__tests__/`

Expected work:

- Remove marker-grammar tests (`renderAnchors`, `citeAnchors`, `markerRepair`).
- Add part-schema tests: valid/invalid shapes, repair behavior, renderer projection, rehydration-compat behavior.
- Update component tests to assert on structured parts rather than marker presence in text.

### 10. API route handler

Primary file: `src/app/api/runs/[runId]/analysis/route.ts`

The route streams the assistant response. It must carry the new part types through to the client and persist them. Small change, but a mandatory one.

## What should be removed

This is not additive. The following should be removed, not preserved in parallel:

- Inline marker grammar in prompts and tool descriptions.
- Text-position marker extractors (`extractParsedRenderMarkerOccurrences`, `extractAnalysisCiteMarkers`).
- Regex-based marker validators (`validateAnalysisRenderMarkers`, `validateAnalysisCiteMarkers`) in favor of part-schema validation.
- The two-path text renderer in `AnalysisMessage.tsx` (`InlineCitationText`, `buildAnalysisCiteSegments`).
- The `<p>` wrapper workaround and the ReactMarkdown-per-segment pipeline.
- Marker-aware reveal controller state.

A narrow read-only compatibility layer for rehydrating pre-cut persisted messages is acceptable. Nothing on the write path depends on inline markers.

## What should remain true

The following behavioral guarantees should remain true across the transition:

- The assistant remains grounded in verified pipeline artifacts.
- A citation chip anchors to a specific, confirmed cell.
- A rendered table card corresponds to a table fetched this turn.
- Chip placement preserves end-of-sentence anchoring when the model composes cleanly (one text part per citing sentence).
- Streaming reveal behavior feels at least as smooth to the user as it does today.
- Old messages remain readable, even if they are not writable in the old shape.

## Major open questions

Design questions to settle before slice-level implementation plans.

### 1. Chip anchor contract

Is "cite attaches to the end of the preceding text part" sufficient, or do we need an explicit `sentenceIndexFromEnd` field for multi-sentence text parts?

Prompt discipline (one text part per citing sentence) preserves end-of-sentence chip placement naturally in the common case. The escape hatch matters only when the model composes multi-sentence text parts that contain multiple citing sentences. Likely deferrable to v1.1 if we teach the pattern cleanly.

### 2. Stream part granularity

Does the model emit text parts at sentence granularity or paragraph granularity?

Sentence granularity preserves chip placement but introduces more stream events and boundary logic in the renderer. Paragraph granularity is simpler but costs precision on chip placement. Prompt-level question that influences the schema decision above.

### 3. Render part resolution timing

A render part requires a fetched table to resolve. When the render arrives before its paired fetch has streamed its output, the renderer currently shows a placeholder. The resolution model (by tableId lookup, by tool-call-id pairing, or both) should be stated explicitly.

### 4. Cell identity

Should structured cite parts carry the same cell-identity shape as `confirmCitation` returns, and does that shape include `valueMode`?

Directly coupled to the `results/tables.json` hard-cut. Align cell identity in one pass once the tables hard-cut lands.

### 5. Transport — custom parts or tool calls?

The AI SDK streams text and tool-call parts. The structured-parts contract must interleave cleanly.

- Option: model `render` and `cite` as custom structured parts on the stream.
- Option: model them as lightweight tool calls (`tool-render`, `tool-cite`) whose payloads carry display semantics. They already have first-class part slots in the SDK's stream protocol.

Lightweight tool calls may be the pragmatic path because they follow the SDK's existing grain and avoid inventing a custom part type. The contract shape is unchanged either way; this decision is mostly about implementation ergonomics.

### 6. Validation timing

Server-side before stream finalizes, client-side on receipt, or both?

Today validation runs server-side in the post-pass. Structured parts make client-side validation cheap and type-safe. Defense in depth probably argues for both.

### 7. Migration posture

How long does the read-time compatibility layer for pre-cut persisted messages remain? It is low-cost but adds maintenance overhead. Decide up front whether it is "forever" or "until we backfill messages on a specific date."

## Suggested rollout structure

Not the slice plan itself. Intended grouping for future slice plans. Sequence matters: the `results/tables.json` hard-cut should land first so cell identity is stable before this work takes a dependency on it.

### Slice group A — contract definition

- settle the structured part schema
- settle chip anchor semantics
- settle render part resolution rules
- align cell identity with the tables hard-cut outcome
- settle transport (custom part vs lightweight tool call)

### Slice group B — server-side emission

- change the agent stream to emit structured parts
- replace marker-based post-pass with schema validation
- wire structured parts through the API route

### Slice group C — client-side projection

- single-path text renderer
- chip rendering from structured parts
- render part resolution against fetched tables
- reveal controller update for part-based streaming

### Slice group D — persistence

- schema update for structured parts
- read-time compatibility layer for pre-cut messages
- confirm rehydration behaves correctly end-to-end

### Slice group E — prompt and tool contract

- rewrite prompt sections that teach marker grammar
- update tool descriptions
- confirm model behavior on a representative set of turns

### Slice group F — cleanup

- remove text-position marker extractors
- remove the `<p>` wrapper path
- remove marker-grammar tests
- remove transitional prompt language

## Success criteria

Successful when all of the following are true:

- The assistant stream carries structural metadata as typed parts, not inline text markers.
- The chat renderer has a single markdown path.
- Cite chips and render blocks are projections over structured parts.
- Server validation is schema-driven, not regex-driven.
- Persistence stores structured parts; only a narrow read-time shim remains for pre-cut messages.
- The prompt no longer teaches inline marker grammar.
- Streaming, chip placement, and table rendering behavior match or exceed the current user experience.
- The brittle two-renderer and segment-splitting pattern has been removed.

## Immediate next step

After alignment on this outline, create slice-by-slice implementation plans that explicitly cover:

- structured part schema
- server-side stream emission
- client-side projection
- persistence migration
- prompt rewrite
- cleanup and removal

The key constraint for those follow-on plans: each slice moves the system toward the hard-cut end state rather than layering more compatibility scaffolding onto the old marker contract. The `results/tables.json` hard-cut should land first so cell identity is stable before this work depends on it.
