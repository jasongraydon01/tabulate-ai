# Phase 15 V1 — Chat With Your Data

**Purpose:** run-scoped conversational analysis on verified pipeline artifacts. Live at `/projects/[projectId]/runs/[runId]/analysis`.

## Current state

A custom AI-SDK chat surface is shipping against real users. The agent reads verified pipeline artifacts only — no raw `.sav` access from chat. Convex tables `analysisSessions` / `analysisMessages` / `analysisArtifacts` / `analysisMessageFeedback` back the chat UI; `analysisComputeJobs` backs the compute-lane handoff for one-group banner-extension recompute. Per-turn traces land in R2 under `project/run/analysis/`. Five grounded retrieval tools (`searchRunCatalog`, `fetchTable`, `getQuestionContext`, `listBannerCuts`, `confirmCitation`) plus the guarded `proposeDerivedRun` tool feed a native structured-answer finalize step through `submitAnswer({ parts })`. Fresh assistant turns must end in exactly one valid `submitAnswer({ parts })`; missing or malformed submit payloads, unconfirmed cite parts, and invalid render parts all fail the turn rather than degrading to prose recovery. New assistant turns persist and replay explicit `text` / `render` / `cite` parts; settled route output emits `data-analysis-render` and `data-analysis-cite`; citation chips still pin specific prose numbers to exact source cells (`tableId × rowKey × cutKey`) and scroll to the referenced cell. Cite parts must reference cellIds the agent confirmed via `confirmCitation` THIS turn (strict per-turn re-confirm), and render parts must reference tables fetched THIS turn with valid focus targets. Grounded claim refs are now cite-derived only (`claimType: "cell"`); non-claim contextual support persists separately as `contextEvidence`. A lightweight freelancing-log remains to warn when a response quotes specific numbers with zero cite activity. Marker validation/repair is no longer part of the active new-write path; the only remaining marker compatibility is the narrow read-time seam for historical content-only persisted assistant messages. Reasoning summaries stream natively from both providers (OpenAI via Responses API + `reasoningEffort: "medium"` default, Anthropic via adaptive thinking). Prompt caching is wired correctly on the analysis surface (structured system messages, Anthropic cache breakpoint, normalized cache usage capture, persisted cache-aware metrics). What's shaped-and-working: session create/list/delete, streaming turns, grounded table cards, inline cite chips with scroll-to-cell, citation evidence available even when a full table card is not rendered inline, rendered table cards preserving persisted row order (including NET / child-row ordering), separate evidence/context disclosures, follow-up chips, thumbs + correction-text feedback, title generation, copy on both message sides, click-to-edit user messages with truncate-and-resend, run-aware discoverability CTA, markdown-stripped reasoning summaries, native agent-initiated Tier B derived-run proposals, and an explicit plus-menu fallback for users who want to force a derived-run proposal.

## Trust contract and validation boundary

TabulateAI's current analysis trust layer is stronger than ordinary "answer with citations," but it should be described precisely.

What is enforced today:

- **Structured finalization:** new assistant turns must end in exactly one valid `submitAnswer({ parts })`. User-visible answer prose outside that contract fails the turn.
- **Cell-confirmed citations:** every structured `cite` part must reference a `cellId` confirmed by `confirmCitation` in the same turn.
- **Render-validated tables:** every structured `render` part must reference a table fetched by `fetchTable` in the same turn, and any row/group focus must resolve against that fetched table payload.
- **Artifact-only evidence:** rendered table cards and citation chips come from verified run artifacts or computed derivation artifacts, not from raw `.sav` queries or free-form model output.

What is not yet enforced:

- The backend does not yet parse every sentence and prove that each quoted value equals the cited cell's `displayValue`, `pct`, `count`, `n`, or `mean`.
- Qualitative interpretation is not yet deterministically scored for whether a comparison such as "higher," "stronger," or "statistically significant" is mathematically justified by the cited cells.
- After a failed finalization check, the current route fails the turn rather than handing the validation error back to the agent for continued tool work and a corrected `submitAnswer`.

Product framing should therefore distinguish the current contract from future validation. Today the accurate claim is that TabulateAI withholds final answers until they pass an artifact-grounded, cell-confirmed, render-validated backend contract. A future trust slice can extend that into sentence-level numeric claim verification.

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
- **Current compute-lane product slice: Tier A table-scoped derivations.** Add small-scope, compute-backed extensions to an existing run, starting with one selected source table. Bucket 1 row roll-ups work end to end for artifact-safe same-variable exclusive sums: the agent uses `proposeRowRollup`, backend validation creates durable proposal jobs only for valid candidates, confirmation remains button-only, the worker creates `computed_derivation` artifacts rather than child runs, and the same conversation can fetch and interpret the computed table. Bucket 2 selected-table cuts are now implemented for one source table and one new cut group: the agent uses `proposeSelectedTableCut`, backend validation resolves the exact variable/cuts, the worker computes Total plus the new cut group, and the result is stored as a `computed_derivation` artifact. Buckets 1 and 2 are the current foundation. Before starting Bucket 3, focus on hardening and broadening those lanes so the agent refuses less often for requests that can be represented safely. The remaining V1 table-scoped bucket is non-roll-up derived tables for KPI side-by-side tables, tables assembled across questions, composites, intersections, and table-type transformations.
- **Bucket 1/2 hardening and UX smoothness — next before Bucket 3.** The current lane is conservative and may recompute or re-send settled parent-run context through agents even when the derived request does not change those decisions. Before calling the compute lane fully smooth, add reuse/caching around stable parent artifacts and unchanged semantic decisions, while preserving frozen confirmed inputs, worker-queued execution, and fresh validation for the newly requested cut, roll-up, or derived table definition. Also improve queued/running derived-table feedback and the auto-continuation experience so the UI clearly shows progress while compute is underway and renders/interprets the computed artifact promptly once available. This pass should also improve prompt routing and clarify the refusal boundary: existing cut fetches, one-table cuts, small selected-table sets, full-tab derived runs, row roll-ups, and future Bucket 3 requests should be separated cleanly. After that polish, design multi-table row roll-ups and multi-table selected cuts for small related table sets; keep broad all-tab changes in the derived-run lane.
- **Still deferred and not required for v1 readiness.** In-place clarification repair, broad compute history, multi-group recompute, old-group editing, banner redesign, and promotion of derived outputs into delivery-grade artifacts remain usage-driven later work.

## Trust-layer follow-ups

These are separate from the UI overhaul and compute-card polish, but they directly affect how strongly TabulateAI can market "validated answers."

- **Bounded post-finalization repair.** If `submitAnswer` fails finalization because a cited cell was not confirmed, a rendered table was not fetched, focus targets were invalid, or the structured payload was malformed, give the agent a bounded retry loop with detailed validation errors. The retry should allow additional tool calls where needed, then require a fresh `submitAnswer`. A limit around three attempts is likely more practical than a single repair chance, with loop guards and trace metadata.
- **Sentence-level numeric claim verification.** Parse final answer text, associate nearby numeric claims with structured cite parts, and compare stated values against confirmed cell summaries. Start with percentages, counts, base sizes, means, and simple equality/rounding checks before attempting comparison-language validation.
- **Comparison and significance validation.** Later, validate claims such as "higher than," "stronger among," or "statistically significant" against fetched table metadata and confirmed cell relationships.
- **Trust-language alignment.** Until sentence-level checks exist, user-facing copy and outreach should avoid implying that every sentence has been mathematically proven. The current differentiator is pre-display artifact/cell/render contract validation; the future differentiator is deterministic claim-value checking.

## Cleanup layer

Before the analysis surface moves to production, remove the temporary backward-compatibility shims kept to land this redesign safely.

- Remove the remaining content-only marker replay fallback once old assistant history no longer needs to be rehydrated.
- Remove `rowFilter` / `cutFilter` compatibility handling from replay / persistence paths once old history no longer needs to be rehydrated.
- Simplify type/back-compat fields on persisted table-card artifacts after the migration window closes.
- Keep prompt text and tests aligned to the native structured-answer contract; do not reintroduce marker-era guidance into active surfaces.
- Audit R2 persistence coverage for the newer analysis and compute-lane state before production: structured assistant parts, rendered artifacts, citation/context evidence, traces, feedback/corrections that should survive outside Convex, compute-job lineage, child-run outputs, and derived artifacts. Every durable UI state should either be intentionally Convex-only or have a clear R2 upload/export path.
