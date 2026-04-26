# Phase 15 V1 — Chat With Your Data

**Purpose:** run-scoped conversational analysis on verified pipeline artifacts. Live at `/projects/[projectId]/runs/[runId]/analysis`.

## Current state

A custom AI-SDK chat surface is shipping against real users. The agent reads verified pipeline artifacts only — no raw `.sav` access from chat. Convex tables `analysisSessions` / `analysisMessages` / `analysisArtifacts` / `analysisMessageFeedback` back the chat UI; `analysisComputeJobs` backs the compute-lane handoff for one-group banner-extension recompute. Per-turn traces land in R2 under `project/run/analysis/`. Five grounded retrieval tools (`searchRunCatalog`, `fetchTable`, `getQuestionContext`, `listBannerCuts`, `confirmCitation`) plus the guarded `proposeDerivedRun` tool feed a native structured-answer finalize step through `submitAnswer({ parts })`. Fresh assistant turns must end in exactly one valid `submitAnswer({ parts })`; missing or malformed submit payloads, unconfirmed cite parts, and invalid render parts all fail the turn rather than degrading to prose recovery. New assistant turns persist and replay explicit `text` / `render` / `cite` parts; settled route output emits `data-analysis-render` and `data-analysis-cite`; citation chips still pin specific prose numbers to exact source cells (`tableId × rowKey × cutKey`) and scroll to the referenced cell. Cite parts must reference cellIds the agent confirmed via `confirmCitation` THIS turn (strict per-turn re-confirm), and render parts must reference tables fetched THIS turn with valid focus targets. Grounded claim refs are now cite-derived only (`claimType: "cell"`); non-claim contextual support persists separately as `contextEvidence`. A lightweight freelancing-log remains to warn when a response quotes specific numbers with zero cite activity. Marker validation/repair is no longer part of the active new-write path; the only remaining marker compatibility is the narrow read-time seam for historical content-only persisted assistant messages. Reasoning summaries stream natively from both providers (OpenAI via Responses API + `reasoningEffort: "medium"` default, Anthropic via adaptive thinking). Prompt caching is wired correctly on the analysis surface (structured system messages, Anthropic cache breakpoint, normalized cache usage capture, persisted cache-aware metrics). What's shaped-and-working: session create/list/delete, streaming turns, grounded table cards, inline cite chips with scroll-to-cell, citation evidence available even when a full table card is not rendered inline, rendered table cards preserving persisted row order (including NET / child-row ordering), separate evidence/context disclosures, follow-up chips, thumbs + correction-text feedback, title generation, copy on both message sides, click-to-edit user messages with truncate-and-resend, run-aware discoverability CTA, markdown-stripped reasoning summaries, native agent-initiated Tier B derived-run proposals, and an explicit plus-menu fallback for users who want to force a derived-run proposal.

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

- **Tier B banner-extension recompute — implemented for one appended group.** When the user asks to add a new cut across the full tab set, treat that as a run-level extension, not a table-card artifact. The agent can now initiate a proposal natively through `proposeDerivedRun` when the request clearly targets the full crosstab set; the composer also keeps a quieter plus-menu fallback for users who want to explicitly create a derived run. Both paths preflight one appended banner group, show a structured proposal card from a sanitized job read model, require button confirmation, queue a child run through the worker, track queued/running/terminal/expired status after refresh, and hand off into the derived run's analysis workspace when ready. The original tables in the parent run's table set stay as they are; the proposed cuts are appended in the derived run.
- **Approval + quality gate policy for analysis-triggered compute — implemented for Tier B.** Clean preflight plus explicit user confirmation is the approval event for one-group banner extension. Unsafe preflight jobs persist `needs_clarification` / review flags and cannot be confirmed. Persisted cancel/reject is available for proposed, blocked, queued, and running jobs. Raw compute-job documents are internal-only; the browser sees a client-safe projection with no R2 keys or frozen artifacts. The agent tool contract requires explicit full-crosstab-set scope and a positive assertion that table-specific derivation has been excluded before native proposal creation. We do not route the user back through the processor-facing HITL review step just to add a requested cut.
- **Current compute-lane product slice: Tier A table-scoped derivations.** Add small-scope, compute-backed extensions to an existing run, starting with one selected source table. The initial skeleton supports validated answer-option roll-up proposals, button confirmation, worker-computed `computed_derivation` artifacts, and automatic re-analysis of the computed table in the same conversation. This is the right architectural direction, but Slice 3 is not complete: the roll-up contract still needs product tightening around multi-select row collapse. A user should be able to ask in research language; TabulateAI should decide whether the safe mechanism is an artifact-safe same-variable row sum or a respondent-level any-of NET. It must not hand-add displayed percentages when selected rows can overlap. Broader advanced derivations such as AND logic, composites, averages, or changing table type should be tracked separately rather than folded into the first roll-up scope. Selected-table cuts remain the next Tier A operation after the roll-up model is settled. These outputs must be real computed artifacts, not agent-authored arithmetic. They should persist separately from canonical parent-run artifacts, with explicit lineage to source run, source table(s), derivation type, and requester. Once computed, the derived table must become grounded evidence the agent can immediately re-analyze and explain in the same conversation, so the user gets both the computed result and the interpretation loop from one request.
- **Compute reuse optimization — v1 polish after core Tier A.** The current lane is conservative and may recompute or re-send settled parent-run context through agents even when the derived request does not change those decisions. Before calling the compute lane fully smooth, add reuse/caching around stable parent artifacts and unchanged semantic decisions, while preserving frozen confirmed inputs, worker-queued execution, and fresh validation for the newly requested cut, roll-up, or derived table definition.
- **Still deferred and not required for v1 readiness.** In-place clarification repair, broad compute history, multi-group recompute, old-group editing, banner redesign, and promotion of derived outputs into delivery-grade artifacts remain usage-driven later work.

## Cleanup layer

Before the analysis surface moves to production, remove the temporary backward-compatibility shims kept to land this redesign safely.

- Remove the remaining content-only marker replay fallback once old assistant history no longer needs to be rehydrated.
- Remove `rowFilter` / `cutFilter` compatibility handling from replay / persistence paths once old history no longer needs to be rehydrated.
- Simplify type/back-compat fields on persisted table-card artifacts after the migration window closes.
- Keep prompt text and tests aligned to the native structured-answer contract; do not reintroduce marker-era guidance into active surfaces.
- Audit R2 persistence coverage for the newer analysis and compute-lane state before production: structured assistant parts, rendered artifacts, citation/context evidence, traces, feedback/corrections that should survive outside Convex, compute-job lineage, child-run outputs, and derived artifacts. Every durable UI state should either be intentionally Convex-only or have a clear R2 upload/export path.
