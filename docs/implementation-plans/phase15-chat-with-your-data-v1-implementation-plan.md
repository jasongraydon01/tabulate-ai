# Phase 15 V1 — Chat With Your Data

**Purpose:** run-scoped conversational analysis on verified pipeline artifacts. Live at `/projects/[projectId]/runs/[runId]/analysis`.

## Current state

A custom AI-SDK chat surface is shipping against real users. The agent reads verified pipeline artifacts only — no raw `.sav`, no new R compute. Convex tables `analysisSessions` / `analysisMessages` / `analysisArtifacts` / `analysisMessageFeedback` back the UI; per-turn traces land in R2 under `project/run/analysis/`. Five grounded tools (`searchRunCatalog`, `fetchTable`, `getQuestionContext`, `listBannerCuts`, `confirmCitation`) front two prose-level display markers. `[[render tableId=<id>]]` places a full table card inline; `[[cite cellIds=<id>,...]]` pins specific prose numbers to their source cells (`tableId × rowKey × cutKey × valueMode`) and renders as a small inline source-label chip (for example `Q1¹`) that scrolls to the exact cell. Both marker families go through a shared post-pass: validator → combined one-shot model repair → deterministic strip. Cite markers must reference cellIds the agent confirmed via `confirmCitation` THIS turn (strict per-turn re-confirm). The old regex-based claim-check is gone; persisted grounding refs are now per-cell (`claimType: "cell"`), plus a lightweight freelancing-log that warns when a response quotes specific numbers with zero cite activity. Reasoning summaries stream natively from both providers (OpenAI via Responses API + `reasoningEffort: "medium"` default, Anthropic via adaptive thinking). Prompt caching is now wired correctly on the analysis surface (structured system messages, Anthropic cache breakpoint, normalized cache usage capture, persisted cache-aware metrics). Full repo test suite: 2236 green. What's shaped-and-working: session create/list/delete, streaming turns, grounded table cards, inline cite chips with scroll-to-cell, evidence panel (cell entries route to the exact cell), follow-up chips, thumbs + correction-text feedback, title generation, copy on both message sides, click-to-edit user messages with truncate-and-resend, run-aware discoverability CTA, markdown-stripped reasoning summaries.

## Completed foundation

The major redesign work that used to be tracked as items `(1)` through `(4)` is now effectively done for the current pass:

- Prompt caching is in place and working on the analysis surface.
- Tool transport now preserves useful `tool-*` history across turns and session reloads in a much more standard agent-harness shape.
- Tool contracts now follow a simpler model-facing pattern:
  - `fetchTable` defaults to Total-only model evidence and expands through explicit `cutGroups`
  - `getQuestionContext` defaults to a compact profile and expands through `include`
  - `listBannerCuts` defaults to compact cut metadata and expands through `include: ['expressions']`
  - `searchRunCatalog` supports scoped search
- `fetchTable`'s model-facing view is now a compact markdown table rather than a full JSON-like payload, while the persisted `AnalysisTableCard` artifact remains full for UI rendering and debugging.
- `confirmCitation` is now semantic-first (`tableId + rowLabel + columnLabel`), with fallback refs only for ambiguity cases.
- Render markers are semantic-first for UI emphasis, while citation remains strict for grounding.
- Historical `fetchTable` replay now uses the same compact projection as live tool execution, so later turns do not silently regress to full-card payloads.

The important architectural outcome is that the three layers are now much cleaner:

- model-facing payload: compact and retrieval-oriented
- persisted artifact payload: full and structured for UI/debugging
- user-facing rendering: emphasis and placement without redefining the evidence itself

## Prompt layer

The live `alternative` prompt has already been updated to match the new contracts: fetched markdown tables, Total-first retrieval via `cutGroups`, semantic-first render focus, semantic-first citation confirmation, and inline cite markers that stay attached to the sentence rather than behaving like detached footnotes.

The next prompt revision should be organized around a shared mental model rather than around isolated tool caveats.

### Shared mental model

- The agent is doing multiple jobs in one surface: exploration, analysis, grounding, UI rendering, and answer/story composition. The prompt should name those jobs explicitly.
- The tool layer should support that directly:
  - retrieval tools help the model explore and analyze
  - `confirmCitation` handles strict grounding
  - `[[render ...]]` handles presentation of already-grounded artifacts
- Semantic-first language should be taught as a cross-tool norm, not a one-off rule for one tool.
- Be clearer about when to fetch, when to cite, when to render, and when to simply answer without extra UI artifacts.
- Render focus and citation are part of how the model shares an answer with the user, not just part of artifact exploration.

### Turn flow: understand → explore → organize → confirm → respond

- A lightweight acknowledgment / intent read before tool use reduces erratic over-searching and makes the model feel less "stressed" about choosing tables, rows, groups, and card count.
- Request classification is likely useful: exploration vs synthesis vs methodology vs narrow lookup vs follow-up.
- Confirm citations *late*, not early. The model should explore, organize its answer, and only then call `confirmCitation` on the cells it's actually about to cite. Early confirmation pollutes the confirmed set with cells that don't end up in the final response and encourages the model to cite widely instead of precisely.

### Answer-shape heuristics

- "Key findings" / "what stands out" questions are asking for what's *unique* or *different*, not what's common. Only flip to commonality framing when the user explicitly asks what's the same.
- Teach default heuristics for the common question shapes so the model doesn't re-derive them every turn.

### Render policy

- Not every turn needs a table, and many turns need fewer tables than the model instinctively reaches for. The prompt should balance "render something useful" against "don't flood the thread."
- Total is the default model-facing view — if a card is already rendering Total, don't render a second Total-only copy of the same `tableId`. Subgroup renders are for genuinely different cuts, not reprints of the same evidence.
- If a NET roll-up table is being rendered, the non-NET version of the same question is redundant — the NET card already carries all the answer rows. Pick one.
- Charts count as rendering: when the topic is naturally visual (e.g., demographics like age), the model should consider a chart render, not just inline prose.
- If a cited number isn't surfaced as a full card, the cite chip itself should still be enough to reach the source — see the citation-as-evidence item in the analytical layer.

### Tool input clarity

- Some tool fields are not obviously derivable from prior tool output (`rowKey` is the live example from a recent reasoning trace). For every non-obvious input, the prompt should give a clear path — which prior tool call produces it, or which semantic alternative to reach for first.
- Tools with many fields are fine, but defaults and "when to bother" guidance should be explicit so the model isn't guessing.

### Prompt scope

- Keep asking what belongs in the system prompt by default versus what should stay behind tools:
  - should cuts come from `listBannerCuts` instead of the prompt?
  - should question details come from `getQuestionContext` instead of default run context in the prompt?
- Favor minimizing run-specific payload baked into the prompt; let the model learn to use the tools early and intentionally.
- Goal of the next prompt pass: clarity without redundancy. Teach one mental model that covers retrieval, grounding, rendering, and response composition cleanly.

## Analytical layer

Work that changes what the agent can compute, or how rendered evidence behaves structurally — not just how it's prompted.

- **Row-order parity with persisted artifacts.** Rendered tables should preserve the persisted artifact's row order, especially when NETs are involved. Answer rows under a NET should appear in the same sequence as the underlying artifact. First verify this is already happening end-to-end; if it isn't, fix the render path so the card's row order is always authoritative from the artifact, not re-derived.
- **Citation-as-evidence for unrendered tables.** When a cited number's source table isn't rendered as a card, the cite chip should still be able to surface the relevant source — popover, side panel, or inline table preview — so the user can see the exact cell without us having to render a full card every time the model cites. This lets the render policy lean lighter without losing provenance.
- **New cuts on the fly, NETs, derived tables.** Expand the analytical surface so the agent can propose cuts, NETs, or derived views that weren't in the original tab spec. Real capability, real v1 scope; the design bar is the compute-lane checkpoint below.
- **Compute-lane design checkpoint.** The design bar for a dedicated compute lane (separate from the pipeline) that lets the analysis surface run new computations safely. Driven by real usage signal — what numbers are users asking for that the pipeline didn't pre-compute? Treat this as active design work, not a parked item.

## Cleanup layer

Before the analysis surface moves to production, remove the temporary backward-compatibility shims kept to land this redesign safely.

- Remove legacy `rowKey` / `cutKey` emphasis from the prompt once semantic-first citation/render paths are the only intended contract.
- Remove `rowFilter` / `cutFilter` compatibility handling from replay / persistence paths once old history no longer needs to be rehydrated.
- Simplify type/back-compat fields on persisted table-card artifacts after the migration window closes.
- Audit prompt text and tests so the production-facing contract no longer teaches transitional paths.
