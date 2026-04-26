# Phase 15 V1 — Chat With Your Data

**Purpose:** run-scoped conversational analysis on verified pipeline artifacts. Live at `/projects/[projectId]/runs/[runId]/analysis`.

## Current state

A custom AI-SDK chat surface is shipping against real users. The agent reads verified pipeline artifacts only — no raw `.sav`, no new R compute yet. Convex tables `analysisSessions` / `analysisMessages` / `analysisArtifacts` / `analysisMessageFeedback` back the UI; per-turn traces land in R2 under `project/run/analysis/`. Five grounded retrieval tools (`searchRunCatalog`, `fetchTable`, `getQuestionContext`, `listBannerCuts`, `confirmCitation`) now feed a native structured-answer finalize step through `submitAnswer({ parts })`. Fresh assistant turns must end in exactly one valid `submitAnswer({ parts })`; missing or malformed submit payloads, unconfirmed cite parts, and invalid render parts all fail the turn rather than degrading to prose recovery. New assistant turns persist and replay explicit `text` / `render` / `cite` parts; settled route output emits `data-analysis-render` and `data-analysis-cite`; citation chips still pin specific prose numbers to exact source cells (`tableId × rowKey × cutKey`) and scroll to the referenced cell. Cite parts must reference cellIds the agent confirmed via `confirmCitation` THIS turn (strict per-turn re-confirm), and render parts must reference tables fetched THIS turn with valid focus targets. Grounded claim refs are now cite-derived only (`claimType: "cell"`); non-claim contextual support persists separately as `contextEvidence`. A lightweight freelancing-log remains to warn when a response quotes specific numbers with zero cite activity. Marker validation/repair is no longer part of the active new-write path; the only remaining marker compatibility is the narrow read-time seam for historical content-only persisted assistant messages. Reasoning summaries stream natively from both providers (OpenAI via Responses API + `reasoningEffort: "medium"` default, Anthropic via adaptive thinking). Prompt caching is wired correctly on the analysis surface (structured system messages, Anthropic cache breakpoint, normalized cache usage capture, persisted cache-aware metrics). What's shaped-and-working: session create/list/delete, streaming turns, grounded table cards, inline cite chips with scroll-to-cell, citation evidence available even when a full table card is not rendered inline, rendered table cards preserving persisted row order (including NET / child-row ordering), separate evidence/context disclosures, follow-up chips, thumbs + correction-text feedback, title generation, copy on both message sides, click-to-edit user messages with truncate-and-resend, run-aware discoverability CTA, markdown-stripped reasoning summaries.

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
- Inline render emphasis is explicit through structured `render` parts, while citation remains strict for grounding through structured `cite` parts.
- Historical `fetchTable` replay now uses the same compact projection as live tool execution, so later turns do not silently regress to full-card payloads.
- The Final Table Contract hard-cut's Slice C is complete; the next hard-cut work is Slice D (rendered-table and citation alignment).

The important architectural outcome is that the three layers are now much cleaner:

- model-facing payload: compact and retrieval-oriented
- persisted artifact payload: full and structured for UI/debugging
- user-facing rendering: emphasis and placement without redefining the evidence itself

## Analytical layer

Work that changes what the agent can compute, or how rendered evidence behaves structurally — not just how it's prompted.

Detailed implementation spec: [phase15-analysis-compute-lane-implementation-plan.md](/Users/jasongraydon01/tabulate-ai/docs/implementation-plans/phase15-analysis-compute-lane-implementation-plan.md)

- **New cuts on the fly, NETs, derived tables (Tier A).** Add a dedicated analysis compute lane for small-scope, compute-backed extensions to an existing run: one table, or a very small set of related tables, with one added cut, NET, or derived view. These outputs must be real computed artifacts, not agent-authored arithmetic. They should persist as sibling derived artifacts on top of the source run rather than mutating `results/tables.json` in place. Lineage should be explicit: source run, source table, derivation type, and who requested it. The original processor-deliverable artifacts remain immutable; the analysis surface adds a separate grounded object with its own citations and render card.
- **Compute-lane design checkpoint.** The next design bar is a dedicated compute lane initiated from the analysis surface but enforced by backend compute, not by the model. The contract is strict: the agent may propose a computation and explain what it will do, but any new dataset-specific numbers must come back from R-backed compute. This lane should support at least two job classes from the start: `single_table_derivation` and `banner_extension_recompute`. It should preserve lineage to the originating run and table set, reuse verified upstream artifacts wherever possible, and keep the analysis surface separate from the main pipeline's canonical deliverables.
- **Re-compute tabs for new groups across the dataset (Tier B).** When the user asks to add a new cut across the full tab set, treat that as a run-level extension, not a table-card artifact. Create a child run / run revision that reuses the completed run's upstream artifacts and resumes from the planning / compute boundary rather than rerunning the full pipeline from raw ingestion. The original run stays immutable; the new run carries lineage metadata to the parent run and the requested banner extension. UX-wise, this should behave like a deliberate transition out of the chat surface into pipeline-in-progress status, then return with a resumed analysis session once the extended run is ready.
- **Approval + quality gate policy for analysis-triggered compute.** Analysis-triggered compute should require an explicit user confirmation in chat. For this lane, that confirmation acts as the approval event for the requested extension; we do not route the user back through the normal processor-facing HITL review step just to add a requested cut or derived view. If a later workflow needs to promote the extended outputs into a delivery-grade artifact, that should be a separate deliberate action.

## Cleanup layer

Before the analysis surface moves to production, remove the temporary backward-compatibility shims kept to land this redesign safely.

- Remove the remaining content-only marker replay fallback once old assistant history no longer needs to be rehydrated.
- Remove `rowFilter` / `cutFilter` compatibility handling from replay / persistence paths once old history no longer needs to be rehydrated.
- Simplify type/back-compat fields on persisted table-card artifacts after the migration window closes.
- Keep prompt text and tests aligned to the native structured-answer contract; do not reintroduce marker-era guidance into active surfaces.
