# Phase 15 V1 — Chat With Your Data

**Purpose:** run-scoped conversational analysis on verified pipeline artifacts. Live at `/projects/[projectId]/runs/[runId]/analysis`.

## Current state

A custom AI-SDK chat surface is shipping against real users. The agent reads verified pipeline artifacts only — no raw `.sav`, no new R compute. Convex tables `analysisSessions` / `analysisMessages` / `analysisArtifacts` / `analysisMessageFeedback` back the UI; per-turn traces land in R2 under `project/run/analysis/`. Five grounded tools (`searchRunCatalog`, `fetchTable`, `getQuestionContext`, `listBannerCuts`, `confirmCitation`) front two prose-level display markers. `[[render tableId=<id>]]` places a full table card inline; `[[cite cellIds=<id>,...]]` pins specific prose numbers to their source cells (`tableId × rowKey × cutKey × valueMode`) and renders as a numbered chip that scrolls to the exact cell. Both marker families go through a shared post-pass: validator → combined one-shot model repair → deterministic strip. Cite markers must reference cellIds the agent confirmed via `confirmCitation` THIS turn (strict per-turn re-confirm). The old regex-based claim-check is gone; persisted grounding refs are now per-cell (`claimType: "cell"`), plus a lightweight freelancing-log that warns when a response quotes specific numbers with zero cite activity. Reasoning summaries stream natively from both providers (OpenAI via Responses API + `reasoningEffort: "medium"` default, Anthropic via adaptive thinking). Prompt caching is now wired correctly on the analysis surface (structured system messages, Anthropic cache breakpoint, normalized cache usage capture, persisted cache-aware metrics). Full repo test suite: 2236 green. What's shaped-and-working: session create/list/delete, streaming turns, grounded table cards, inline cite chips with scroll-to-cell, evidence panel (cell entries route to the exact cell), follow-up chips, thumbs + correction-text feedback, title generation, copy on both message sides, click-to-edit user messages with truncate-and-resend, run-aware discoverability CTA, markdown-stripped reasoning summaries.

### The core insight 

Three decisions that originally looked independent are actually one decision:

1. **Transport.** `getSanitizedConversationMessagesForModel` in `messages.ts` strips every non-text part across turns — prior table cards, tool outputs, confirmCitation results. The UI rehydrates them; the model is blind to them. Cost was the original justification; cite/render validation were the imagined concerns. Both concerns dissolve on inspection: marker validation is already strictly per-turn (it keys off tool outputs from this `streamText` call only), and cost is really a prompt-cache argument. The standard agent-harness approach (Claude Code, every reference implementation) preserves the full `tool_use` / `tool_result` trail across turns. We should do the same — once cache is set up to absorb it.

2. **Tool shape.** `fetchTable` today returns every USED cut on the table regardless of what the question was. A typical table is 10–20KB of JSON; a turn that fetches three for comparison can push 50KB of cells the model didn't ask for. `cutFilter` is a render hint only — it does not filter data for the model, which is its own source of confusion. The fix: `fetchTable(tableId)` returns Total only; the model opts into additional cut groups explicitly via a real `cutGroups` parameter. That maps to how analysts actually read tables (topline first, then drill) and makes "do I need this cut?" a deliberate choice per fetch. Same treatment likely fits `getQuestionContext`, which today dumps items + related tables + survey wording + scale labels in one payload.

3. **Format.** The benchmarks are consistent: for tabular data, **markdown tables outperform JSON on both accuracy and token cost** (improvingagents.com: markdown-KV 60.7% vs HTML 53.6% on the same task; TOON and markdown both substantially cheaper than JSON on Claude). HTML is actually the worst of the three on accuracy. Once `fetchTable` payloads are narrowed by Total-default, swapping the model's view from JSON to markdown is a clean follow-on.

### The redesign

**(1) Anthropic prompt-cache audit.** Done. The analysis surface now uses structured system messages, Anthropic cache breakpoints, normalized cache usage capture, and cache-aware trace / metric plumbing. This was the prerequisite for transport work and for carrying richer grounded history without paying full prompt cost every turn. Treat this as completed foundation, not open design.

**(2) Tool-shape redesign.** Done for the current pass. The analysis tool layer now follows the intended "minimal useful default, explicit expansion when needed" contract. `fetchTable(tableId)` returns a Total-first model projection by default, with `cutGroups: ['age']` / `cutGroups: ['age', 'gender']` / `cutGroups: '*'` opting into more evidence explicitly. `getQuestionContext` now defaults to a compact question profile and expands through `include`, `listBannerCuts` defaults to compact cut metadata and moves expressions behind `include: ['expressions']`, and `searchRunCatalog` supports scoped search. Crucially, the persisted `AnalysisTableCard` artifact (the thing the `[[render]]` marker materializes into an inline card for the user) stays full — the card the user sees and can expand hasn't changed. What's changing is the *projection* the model gets back as tool-result content, which narrows to the information the model asked for. Historical `fetchTable` replay now uses that same compact projection, so later turns do not silently regress to full-card payloads. This completes the first tool-contract simplification pass and removes the `cutFilter` split-brain from the live prompt/tool path.

**(3) Transport: replace the custom sanitizer with standard pass-through.** Done for the current pass. Prior analysis turns now preserve useful `tool-*` history in a much more standard AI SDK / agent-harness shape instead of aggressively flattening conversation state down to text. Persistence and rehydration were updated alongside the model transport path, so prior grounded `tool_use` / `tool_result` context survives both across turns and after session reloads. The trust contract did not loosen: historical `[[render]]` / `[[cite]]` markers are still stripped from prior-turn prose before replay, marker validation remains per-turn, inline citation still depends on same-turn `confirmCitation`, and artifact-backed `fetchTable` cards still persist via the existing artifact flow. This completes the transport redesign that addresses the two trace-backed failure modes: (a) the "I need a supporting card" refusal when the model had prior grounding in-thread but could not see it, and (b) unnecessary duplicate re-fetching while drilling into the same topic across turns.

**(4a) Model render: simplify `fetchTable`'s model-facing projection.** Done for the current pass. The model-facing projection is now a literal analyst-readable markdown table instead of a JSON dump or schema-like block. It keeps the minimum high-value fields above the table (question ID + question text in the heading, table ID, subtitle when present, base text when present), renders stat letters in the headers, places significance letters inline beside the bolded values, and includes a `Base n` row directly under the headers. The persisted `AnalysisTableCard` artifact remains structured — it still powers the UI card. For now, compact row / cut identifiers remain inline because `confirmCitation` still requires exact stable references. Treat this as the completed render simplification pass; the next step is to improve the citation contract so those inline machine-oriented identifiers can shrink or disappear later.

**(4b) Citation underpinning: move from machine-first references toward semantic references.** Done for the current pass. `confirmCitation` now supports a semantic-first input path (`tableId + rowLabel + columnLabel`) while still resolving to the same stable `cellId` the inline citation system already uses. When labels are ambiguous, the tool returns structured retry guidance and accepts `rowRef` / `columnRef` fallback tokens from the fetched markdown table. Legacy `rowKey` / `cutKey` inputs remain supported during the transition pass, so the backend identity model and UI-side cite rendering stay unchanged. This completes the first citation-contract simplification pass without changing the inline citation mechanism itself.

**Prompt layer implication.** Items (2), (3), (4a), and (4b) were not only transport / tool-output changes; they required a prompt revision once the tool contracts settled. The live `alternative` prompt now documents how fetched markdown tables look, how to read significance and Base n without over-explaining them, how `fetchTable` works as a Total-first retrieval tool with explicit `cutGroups`, how semantic-first `[[render ...]]` markers control UI emphasis, and how `confirmCitation` should use semantic labels first with `rowRef` / `columnRef` only as ambiguity fallbacks. Continue to keep durable interpretation rules in the system prompt and keep repetitive scaffolding out of the tool payloads.

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

**Prompt workflow and intentionality.** Request classification (exploration / synthesis / methodology / narrow lookup / follow-up), one-line goals, acknowledgment-before-work. Waits until (2), (3), and the first pass of (4b) have landed — several of the frictions it targets (over-matching `cutFilter`, rendering more cuts than justified, over-explaining the payload, and forcing machine IDs into the model-facing view) become design-level non-issues once the tool outputs, history transport, and citation contract are simplified. Revisit scope after.

**Analytical capability expansion.** Still gated on compute-lane checkpoint. New cuts on the fly, NETs, derived tables. Not for now.

**Compute-lane design checkpoint.** Still backlog, still driven by usage signal.

**UI citation polish.** Keep on backlog separately from the tool / prompt redesign: show the question ID in the citation label, prefer comma-separated citation rendering over the bare number, and keep citations inline instead of letting them drop to their own line.
