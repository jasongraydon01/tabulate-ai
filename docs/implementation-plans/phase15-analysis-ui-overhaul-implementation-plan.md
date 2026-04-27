# Phase 15 Sub-Plan - Analysis UI Overhaul

**Status:** active. Slice 0 is complete; Slices 1-7 are not yet started. This is a product-shape plan, not a per-ticket implementation spec. Each implementation slice should get its own focused plan before code work begins.

**Purpose:** clean up the Phase 15 analysis chat foundation before Tier A Bucket 3 work. The goal is a calmer, more predictable, more premium chat experience: grounded answers reveal smoothly after validation, thinking/tool activity carries the wait honestly, and live turns render the same way as reloaded sessions.

Parent plan: [phase15-chat-with-your-data-v1-implementation-plan.md](/Users/jasongraydon01/tabulate-ai/docs/implementation-plans/phase15-chat-with-your-data-v1-implementation-plan.md)
Compute-lane sibling: [phase15-analysis-compute-lane-implementation-plan.md](/Users/jasongraydon01/tabulate-ai/docs/implementation-plans/phase15-analysis-compute-lane-implementation-plan.md)

---

## Current State

The analysis chat surface is functionally correct enough to support real users. The structured-parts contract (`text` / `render` / `cite` / `submitAnswer`) is in place, claim-checking is enforced server-side, and the UI can render grounded table cards, citations, sources, follow-ups, feedback, edits, and compute-job proposals.

The roughness is in the consumption layer:

- **Live and persisted turns behave differently.** Live turns use a streaming/reveal controller, while persisted reload renders complete messages immediately. The same assistant turn can produce subtly different DOM order and timing in the live path versus after refresh.
- **Timeline ordering is fragile.** Messages and compute-job cards are interleaved by timestamps. Client-generated live messages, Convex-persisted messages, and compute-job records do not always share a single reliable chronology, which is why proposal cards can appear in a different place live than they do after reload.
- **Answer reveal is coupled to stream mechanics.** The backend already suppresses untrusted answer text until `submitAnswer` and trust resolution complete, but the frontend still treats the final answer as a streaming object. That creates choppy handoffs, table-card shell transitions, and footer pop-in.
- **Auto-scroll is over-owned by custom code.** Stick-to-bottom state, reveal-aware scroll events, and message-start scrolling are all handcrafted. This is a solved primitive and should not remain one of the riskiest parts of the chat surface.
- **AnalysisMessage is doing too much.** It owns markdown rendering, reveal timing, table rendering, citations, sources, reasoning, tool activity, copy actions, feedback, edit/resend behavior, and several derived lookups.
- **Compute progress is partly real and partly fallback.** Child run progress is used when present, but queued/running states still fall back to hardcoded values when the worker has not emitted meaningful progress. The UX reads as less trustworthy than the rest of the analysis surface.

The backend contract is not the main problem. The primary work is to normalize the UI model and adopt polished primitives where they fit.

---

## Target Product Shape

The analysis surface should move from **streaming-first answer rendering** to **settled-answer orchestration**.

- During the agent loop, the UI shows a **thinking phase**: reasoning summaries and curated tool activity stream live.
- Dataset-specific answer content remains hidden until the backend has validated `submitAnswer`, checked citations/render directives, and resolved trust.
- After validation, the UI enters the **answer phase**: text, tables, citations, sources, follow-ups, and actions reveal from one complete, normalized answer model.
- Persisted reload uses the same answer-phase renderer as a live turn. Reload can skip the thinking phase, but it should not use a different DOM structure.
- Vercel AI Elements becomes the primitives layer where useful. We use it shadcn-style, themed into TabulateAI's existing design system. We do not let generic primitives replace product-specific survey/crosstab behavior.

This is not a move away from streaming altogether. Streaming remains valuable for reasoning and tool activity. What changes is that untrusted answer prose no longer trickles into the UI before its grounding has been validated.

---

## Terminology

- **AI SDK stream:** The existing `UIMessage` stream from the analysis API. It carries reasoning, tool parts, metadata, data parts, and final answer chunks.
- **AI Elements Response / MessageResponse:** A frontend markdown response primitive. This is not a backend migration to OpenAI's Responses API.
- **Settled answer model:** A complete, normalized representation of one assistant answer after `submitAnswer` validation and trust resolution. Both live and persisted rendering should consume this same model.
- **Bespoke product surface:** TabulateAI-specific rendering that should stay custom: `GroundedTableCard`, significance markers, banner/cut grouping, `tableId x rowKey x cutKey` citation identity, and compute-lineage details.

---

## Architecture Rules

- **One answer renderer.** Live turns and persisted reloads should produce the same answer DOM in the same order.
- **Thinking may stream; grounded answers settle first.** Reasoning/tool activity can stream live. Dataset-specific claims, tables, citations, sources, and follow-ups wait for backend validation.
- **Normalize before choreography.** Do not build motion around raw `UIMessage.parts`. First convert streamed or persisted data into a stable answer model, then reveal from that model.
- **AI Elements drives primitives; TabulateAI drives product semantics.** Conversation, response markdown, reasoning, tools, sources, suggestions, and actions can use AI Elements. Table cards, citation identity, and compute derivation detail remain custom.
- **Do not weaken the structured-parts contract.** The server-side rules around `confirmCitation`, `fetchTable`, `render`, `cite`, and `submitAnswer` stay strict.
- **Do not block Tier A Bucket 3 on cosmetic perfection.** This plan should remove structural UI friction and leave the surface easier to extend. It should not become an open-ended redesign.

---

## Slices

### Slice 0 - UX Baseline And Golden States - Complete

Create a lightweight visual and behavioral baseline before replacing primitives. This gives each later slice a target and prevents subjective "it feels smoother" debates.

Completed baseline package: [slice-0/baseline.md](/Users/jasongraydon01/tabulate-ai/docs/implementation-plans/slice-0/baseline.md)

- Capture the key chat states using fixtures, Storybook-style harnesses, or focused component tests/screenshots:
  - empty analysis session
  - user-only pending turn
  - thinking with reasoning
  - thinking with tool activity
  - settled text-only answer
  - settled answer with inline citations
  - settled answer with grounded table card
  - sources expanded/collapsed
  - follow-up suggestions
  - edit/resend affordance
  - feedback affordance
  - compute proposal
  - queued/running compute job
  - failed/expired compute job
  - refreshed persisted session
- Define desktop and mobile viewport checks for composer overlap, scroll behavior, long labels, long citations, and table-card width.
- Document the known current bugs this overhaul is meant to remove, especially live/reload ordering divergence.
- Identify the smallest deterministic tests needed to protect timeline order and settled-answer rendering.

Exit criteria: the overhaul has a concrete baseline, a list of representative states, and a QA checklist each later slice can run against.

### Slice 1 - Settled Answer Model And Timeline Ordering

Do the architectural correction before swapping most UI primitives. The current backend already withholds final answer text until trust validation; this slice makes the frontend consume that reality explicitly.

- Introduce a normalized settled answer model derived from `AnalysisUIMessage.parts` plus message metadata.
- Make this model the single input to answer rendering for both live turns and persisted messages.
- Decide and document the live-turn source of truth after validation:
  - either reveal from the streamed final parts and then reconcile to persisted Convex state without changing DOM shape
  - or wait for Convex replay and reveal from the persisted message
- Replace timestamp-sensitive timeline interleaving with a single deterministic ordering policy for messages and compute jobs.
- Fix the derived-cut proposal ordering bug as part of that ordering policy.
- Keep the server's strict finalization path intact: validate `submitAnswer`, validate citations/render parts, resolve trust, then produce the settled answer model.
- Separate "answer is validated" from "artifacts/messages are persisted" so the implementation is explicit about what the user is seeing and what can be safely reloaded.

Exit criteria: live and refreshed sessions render the same assistant answer structure in the same order. Compute proposals no longer move around after refresh. The answer renderer no longer depends on whether a message has "ever streamed."

### Slice 2 - Conversation Shell And Auto-Scroll

Adopt the lowest-risk AI Elements primitive first: the conversation viewport and stick-to-bottom behavior.

- Replace the custom analysis thread scroll/stickiness machinery with AI Elements **Conversation** and its `use-stick-to-bottom` behavior.
- Preserve the existing layout constraints: session title header, full-height thread, sticky composer, dark-mode primary presentation, and long-table handling.
- Verify that user scrolling is respected during active thinking/tool streaming.
- Verify that a new settled answer reveal scrolls only when the user is already at or near the bottom.
- Remove custom scroll utilities only after equivalent behavior is covered by tests or visual QA.

Exit criteria: auto-scroll feels predictable, user scroll is not fought, and the thread no longer needs bespoke reveal-event scrolling for normal answer rendering.

### Slice 3 - Response Markdown And Loading Primitives

Adopt AI Elements response/loading primitives where they are a direct fit, without disturbing citations or table rendering prematurely.

- Replace pure text markdown rendering with AI Elements **Response** / **MessageResponse**.
- Do not initially replace mixed text-plus-citation blocks. Those should remain custom until citation choreography is addressed in Slice 5.
- Replace the generic "TabulateAI is analyzing..." pending state with AI Elements **Loader** / **Shimmer** patterns themed to TabulateAI.
- Verify shadcn-style component copies inherit:
  - Instrument Serif for display surfaces
  - Outfit for UI/body text
  - JetBrains Mono for data/citation labels
  - `ct-*` semantic accent tokens
  - dark-mode primary presentation
- Keep copy calm and product-specific. Use "TabulateAI" in user-facing text.

Exit criteria: pure markdown rendering is simpler and stable, loading states feel consistent with the design system, and citation/table rendering is untouched.

### Slice 4 - Thinking Phase

Make the waiting period useful and transparent, since answer prose is intentionally withheld until validation.

- Adopt AI Elements **Reasoning** for reasoning summaries.
- Adopt AI Elements **Tool** for tool activity, but continue feeding it curated labels from TabulateAI's existing tool-label policy.
- Keep internal tool names, raw JSON, and hidden proposal tools out of the default UI.
- Auto-open thinking while the agent is actively working when useful.
- Auto-collapse thinking when the settled answer begins to reveal.
- Preserve expand-on-demand for transparency after the answer is complete.
- Tighten the language so the activity reads like meaningful analysis work, not a developer trace.

Exit criteria: the wait between prompt and answer feels substantive. Reasoning/tool activity streams naturally, then gets out of the way when the answer is ready.

### Slice 5 - Answer Phase Choreography

Polish the coordinated reveal of the settled answer: text, tables, citations, sources, suggestions, and actions.

- Drive reveal motion from the settled answer model, not from raw streaming deltas.
- Use calm easing and small staggered groups rather than timer-heavy sentence-by-sentence trickle.
- Reserve enough layout space that table cards, sources, chips, and actions do not cause visible layout jump.
- Render `GroundedTableCard` once in its ready state where possible. Avoid shell-to-ready table jank during answer reveal.
- Adopt AI Elements **Inline Citation** only as a primitive shell. Keep TabulateAI's `tableId x rowKey x cutKey` anchor identity and scroll/highlight behavior.
- Add citation hover affordances where useful, but verify click behavior works both live and after refresh.
- Adopt AI Elements **Sources** for evidence/context disclosure, while preserving the distinction between rendered table evidence and additional context evidence.
- Adopt AI Elements **Suggestion** for follow-up chips.
- Adopt AI Elements **Actions** for copy, edit, regenerate/resend-style message actions where the existing behavior maps cleanly.
- Keep feedback affordances product-specific unless AI Elements provides a clean, accessible primitive that does not dilute the current workflow.

Exit criteria: the end-of-turn answer reveal is smooth, anchored, and reload-stable. Citations work after refresh. Sources and follow-ups feel native instead of bolted on.

### Slice 6 - Compute Lane UI

Bring compute proposals and job progress into the same chat experience without hiding their special semantics.

- Frame confirm/cancel/revise proposal interactions with AI Elements **Confirmation** where it improves clarity.
- Evaluate **Task**, **Plan**, **Queue**, and **Checkpoint** primitives for queued/running/success/failure display, but do not force-fit them if TabulateAI's compute state needs a more direct custom presentation.
- Keep cut definitions, validation messages, confidence/review flags, lineage, and derived-table details as custom slots.
- Replace hardcoded progress fallbacks where the backend can provide real progress. Where real progress is not available, label the state honestly rather than implying precise completion.
- Coordinate with the compute-lane plan's *V1 Polish - Compute Reuse And Smoothness* section. Backend caching and parent-artifact reuse belong there; this slice is the chat UI half.
- Smooth auto-continuation when a `computed_derivation` artifact lands, so the answer phase can continue without a visible refresh-and-replace.

Exit criteria: compute cards feel like first-class chat artifacts. Progress is either real or honestly indeterminate. Confirmation and continuation are clear.

### Slice 7 - Cleanup, Performance, And Ownership Boundaries

Remove obsolete machinery as each replacement lands. This slice should finish the simplification rather than defer all deletion to the end.

- Delete the streaming-first reveal controller once settled-answer choreography owns reveal behavior.
- Remove `hasEverStreamed`, `unstableTail`, and related memo invalidation paths when they are no longer needed.
- Remove custom auto-scroll utilities after Conversation fully owns viewport behavior.
- Split `AnalysisMessage` into smaller ownership units:
  - user message
  - assistant thinking
  - settled answer body
  - citations/sources
  - message actions
  - feedback
  - edit/resend
- Memoize and prop-stabilize the remaining components where it actually reduces rerender churn.
- Audit dead helpers and tests that only exist for the previous dual-path renderer.
- Keep `GroundedTableCard` as its own product surface; do not fold table rendering into generic message rendering.

Exit criteria: `AnalysisMessage` is materially smaller, the old dual-rendering path is gone, and ownership boundaries are clear enough that Bucket 3 work can add new artifacts without threading through a 1400-line component.

---

## Testing And QA Expectations

Each slice should add or update targeted tests where behavior changes. Minimum expected coverage:

- timeline ordering and live/reload equivalence
- settled answer model conversion from streamed and persisted `UIMessage` shapes
- citation identity and anchor scroll behavior
- source visibility and evidence de-duplication
- follow-up/action visibility rules
- compute-job status/progress display states
- mobile and desktop visual QA for composer, scroll, long labels, citations, and table cards

For frontend implementation slices, run the relevant component tests plus browser/screenshot checks for the golden states from Slice 0.

---

## Out Of Scope

- Prompt optimization, refusal-boundary tuning, and scope routing. Those remain in the parent Phase 15 plan.
- New analytical capabilities for Tier A Bucket 3, including derived table behavior and multi-table analytical expansion. This overhaul prepares the UI foundation for that work.
- Compute-lane backend reuse/caching beyond the UI-facing progress and continuation needs. That remains in the compute-lane plan.
- GroundedTableCard internal redesign. This plan may reserve layout space and smooth reveal around the card, but it does not redesign crosstab rendering itself.
- Raw `.sav` access from the analysis surface. The analysis surface remains artifact-grounded.

---

## Practical Takeaway

The current chat surface is correct but not calm. The next step is not to chase polish randomly; it is to remove the structural UI friction before Tier A Bucket 3 expands the surface area.

The plan is:

1. Baseline the states we care about.
2. Normalize live and persisted assistant answers into one settled answer model.
3. Adopt AI Elements primitives in the safest order.
4. Keep TabulateAI's crosstab, citation, and compute semantics bespoke.
5. Delete the old dual-path machinery as the new path proves itself.

Done well, this gives TabulateAI a cleaner analysis workspace before the next analytical capability lands, and it makes future chat artifacts easier to add without multiplying UI edge cases.
