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

**Prompt follow-up notes for the next pass.** The next prompt revision should be organized around a shared mental model rather than around isolated tool caveats.

- The agent is doing multiple jobs in one surface: exploration, analysis, grounding, UI rendering, and answer/story composition.
- The tool layer should support that directly:
  - retrieval tools help the model explore and analyze
  - `confirmCitation` handles strict grounding
  - `[[render ...]]` handles presentation of already-grounded artifacts
- Semantic-first language should be taught as a cross-tool norm, not as a one-off rule for one tool.
- The prompt should be clearer about when to fetch, when to cite, when to render, and when to simply answer without extra UI artifacts.
- Request understanding should happen before tool use. A lightweight acknowledgment / intent read can reduce erratic over-searching and make the model feel less "stressed" about choosing tables, rows, groups, and card count.
- Request classification is likely useful: exploration vs synthesis vs methodology vs narrow lookup vs follow-up.
- The prompt should help the model understand that render focus and citation are part of how it shares an answer with the user, not just part of artifact exploration.
- We should keep asking what belongs in the system prompt by default versus what should stay behind tools. Examples:
  - should cuts come from `listBannerCuts` instead of the prompt?
  - should question details come from `getQuestionContext` instead of default run context in the prompt?
- There is likely value in minimizing run-specific payload baked into the prompt and letting the model learn to use the tools early and intentionally instead of being handed too much context up front.
- The goal of the next prompt pass should be clarity without redundancy: teach one mental model that covers retrieval, grounding, rendering, and response composition cleanly.

**Pre-production cleanup note.** Before the analysis surface moves to production, remove the temporary backward-compatibility shims that were kept to land this redesign safely. In particular:

- remove legacy `rowKey` / `cutKey` emphasis from the prompt once semantic-first citation/render paths are the only intended contract
- remove `rowFilter` / `cutFilter` compatibility handling from replay / persistence paths once old history no longer needs to be rehydrated
- simplify type/back-compat fields on persisted table-card artifacts after the migration window closes
- audit prompt text and tests so the production-facing contract no longer teaches transitional paths

### What's still deferred, unchanged

**Analytical capability expansion.** Still gated on compute-lane checkpoint. New cuts on the fly, NETs, derived tables. Not for now.

**Compute-lane design checkpoint.** Still backlog, still driven by usage signal.
