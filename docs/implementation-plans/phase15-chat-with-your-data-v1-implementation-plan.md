# Phase 15 V1 — Chat With Your Data

**Purpose:** run-scoped conversational analysis on verified pipeline artifacts. Live at `/projects/[projectId]/runs/[runId]/analysis`.

## Current state

A custom AI-SDK chat surface is shipping against real users. The agent reads verified pipeline artifacts only — no raw `.sav`, no new R compute. Convex tables `analysisSessions` / `analysisMessages` / `analysisArtifacts` / `analysisMessageFeedback` back the UI; per-turn traces land in R2 under `project/run/analysis/`. Five grounded tools (`searchRunCatalog`, `fetchTable`, `getQuestionContext`, `listBannerCuts`, `confirmCitation`) front two prose-level display markers. `[[render tableId=<id>]]` places a full table card inline; `[[cite cellIds=<id>,...]]` pins specific prose numbers to their source cells (`tableId × rowKey × cutKey × valueMode`) and renders as a numbered chip that scrolls to the exact cell. Both marker families go through a shared post-pass: validator → combined one-shot model repair → deterministic strip. Cite markers must reference cellIds the agent confirmed via `confirmCitation` THIS turn (strict per-turn re-confirm). The old regex-based claim-check is gone; persisted grounding refs are now per-cell (`claimType: "cell"`), plus a lightweight freelancing-log that warns when a response quotes specific numbers with zero cite activity. Reasoning summaries stream natively from both providers (OpenAI via Responses API + `reasoningEffort: "medium"` default, Anthropic via adaptive thinking). Full repo test suite: 2236 green. What's shaped-and-working: session create/list/delete, streaming turns, grounded table cards, inline cite chips with scroll-to-cell, evidence panel (cell entries route to the exact cell), follow-up chips, thumbs + correction-text feedback, title generation, copy on both message sides, click-to-edit user messages with truncate-and-resend, run-aware discoverability CTA, markdown-stripped reasoning summaries.

## Remaining work

Interface polish is largely done. What's left is real capability — pushing the surface from "grounded Q&A" toward "analysis partner." The work below is one coupled redesign, not four independent tickets. Pressure-testing against real session traces surfaced a single thread running through transport, tool shape, and output format: the surface is doing too much custom work where the standard agent-harness shape would serve the model better.

### The core insight

Three decisions that originally looked independent are actually one decision:

1. **Transport.** `getSanitizedConversationMessagesForModel` in `messages.ts` strips every non-text part across turns — prior table cards, tool outputs, confirmCitation results. The UI rehydrates them; the model is blind to them. Cost was the original justification; cite/render validation were the imagined concerns. Both concerns dissolve on inspection: marker validation is already strictly per-turn (it keys off tool outputs from this `streamText` call only), and cost is really a prompt-cache argument. The standard agent-harness approach (Claude Code, every reference implementation) preserves the full `tool_use` / `tool_result` trail across turns. We should do the same — once cache is set up to absorb it.

2. **Tool shape.** `fetchTable` today returns every USED cut on the table regardless of what the question was. A typical table is 10–20KB of JSON; a turn that fetches three for comparison can push 50KB of cells the model didn't ask for. `cutFilter` is a render hint only — it does not filter data for the model, which is its own source of confusion. The fix: `fetchTable(tableId)` returns Total only; the model opts into additional cut groups explicitly via a real `cutGroups` parameter. That maps to how analysts actually read tables (topline first, then drill) and makes "do I need this cut?" a deliberate choice per fetch. Same treatment likely fits `getQuestionContext`, which today dumps items + related tables + survey wording + scale labels in one payload.

3. **Format.** The benchmarks are consistent: for tabular data, **markdown tables outperform JSON on both accuracy and token cost** (improvingagents.com: markdown-KV 60.7% vs HTML 53.6% on the same task; TOON and markdown both substantially cheaper than JSON on Claude). HTML is actually the worst of the three on accuracy. Once `fetchTable` payloads are narrowed by Total-default, swapping the model's view from JSON to markdown is a clean follow-on.

### The redesign

**(1) Anthropic prompt-cache audit.** *First actionable beat — prerequisite for everything downstream.* `src/lib/analysis/model.ts` creates the Anthropic client via `@ai-sdk/anthropic` with no `cacheControl` breakpoints anywhere. Default Anthropic behavior is no caching. OpenAI Responses caches automatically — confirm that too, briefly. On the Anthropic branch we're likely paying full rate on system prompt + tool definitions + conversation history every turn. Small, self-contained audit; fix is breakpoints after system, after tool defs, rolling on conversation. This unblocks (3) — without cache, keeping tool outputs across turns is too expensive to default on.

**(2) Tool-shape redesign.** `fetchTable(tableId)` returns Total only. `cutGroups: ['age']` / `cutGroups: ['age', 'gender']` / `cutGroups: '*'` opts into more. Crucially, the persisted `AnalysisTableCard` artifact (the thing the `[[render]]` marker materializes into an inline card for the user) stays full — the card the user sees and can expand hasn't changed. What's changing is the *projection* the model gets back as tool-result content, which narrows to the cuts the model asked for. This decouples UI card payload from model view and removes the `cutFilter` split-brain entirely. `getQuestionContext` probably gets the same treatment (minimal profile by default, `include: ['survey' | 'items' | 'relatedTables']` to expand). Prompt simplification follows — several paragraphs of "don't over-match cutFilter, availability isn't a reason to feature" collapse into "ask for what you need." Blast radius: tool execute functions, `persistence.ts`, `alternative.ts`, the `grounding.fetchTable` tests — tractable but real.

**(3) Transport: replace the custom sanitizer with standard pass-through.** Once cache is healthy, stop stripping non-text parts across turns. Preserve the `tool_use` / `tool_result` trail like the standard agent-harness shape. The two failure modes this fixes are documented in real traces: (a) the "I need a supporting card" refusal when the model has cards in the thread but can't see them (kx782 turn 3 → 4); (b) heavy duplicate re-fetching across turns when drilling in (kx736 turn 3 at 1.21M input tokens). Marker validation stays per-turn — it already is. Behind a feature flag, default off until cache is measured.

**(4) Format: markdown tables over JSON for the model's view.** After (2) narrows the payload, replace the JSON serialization of `fetchTable`'s model-facing output with a markdown table (one row per row, one column per cut, dominant value per cell, sig markers as superscript-ish notation, baseN in a subtitle line). The persisted `AnalysisTableCard` artifact remains structured — it powers the UI card. This is a pure optimization on top of (2); worth a benchmark turn once the narrowed payload is in place. Defer if post-(2) payloads are small enough that the savings aren't meaningful.

### What's still deferred, unchanged

**Prompt workflow and intentionality.** Request classification (exploration / synthesis / methodology / narrow lookup / follow-up), one-line goals, acknowledgment-before-work. Waits until (1)–(4) have landed — several of the frictions it targets (over-matching `cutFilter`, rendering more cuts than justified) become design-level non-issues once (2) lands. Revisit scope after.

**Analytical capability expansion.** Still gated on compute-lane checkpoint. New cuts on the fly, NETs, derived tables. Not for now.

**Compute-lane design checkpoint.** Still backlog, still driven by usage signal.

## Recommended next step

Sequence the four pieces, not parallelize. (1) cache audit first, because it's the prerequisite. (2) tool-shape redesign next, because it has the largest behavioral impact and stands on its own value even without the transport flip. (3) transport pass-through after cache is measured as healthy, so we know the cost shape. (4) format benchmark last, once the narrowed payload exists to compare against. Production prompt stays frozen throughout; experiments land on `alternative.ts`. Each step is a focused PR, not an omnibus.
