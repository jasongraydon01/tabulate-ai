# Phase 15 Sub-Plan - Analysis UI Overhaul

**Status:** active. Slices 0-2 are complete; Slices 3-7 remain. This is a product-shape plan, not a per-ticket implementation spec. Each implementation slice should get its own focused plan before code work begins.

**Purpose:** clean up the Phase 15 analysis chat foundation before Tier A Bucket 3 work. The goal is a calmer, more predictable, more premium chat experience: grounded answers reveal smoothly after validation, thinking/tool activity carries the wait honestly, and live turns render the same way as reloaded sessions.

Parent plan: [phase15-chat-with-your-data-v1-implementation-plan.md](/Users/jasongraydon01/tabulate-ai/docs/implementation-plans/phase15-chat-with-your-data-v1-implementation-plan.md)
Compute-lane sibling: [phase15-analysis-compute-lane-implementation-plan.md](/Users/jasongraydon01/tabulate-ai/docs/implementation-plans/phase15-analysis-compute-lane-implementation-plan.md)

---

## Current State

The analysis chat surface is functionally correct enough to support real users. The structured-parts contract (`text` / `render` / `cite` / `submitAnswer`) is in place, claim-checking is enforced server-side, and the UI can render grounded table cards, citations, sources, follow-ups, feedback, edits, and compute-job proposals.

Slice 1 closed the most important consumption-layer correctness issues:

- **Live and persisted answers now share a settled answer model.** The answer renderer consumes normalized assistant parts plus message metadata rather than branching on whether the turn streamed or replayed from Convex.
- **Timeline ordering is now turn-scoped.** Messages and compute jobs are grouped by `clientTurnId` / origin message IDs. Explicitly turn-scoped jobs wait for their originating turn to be visible; legacy timestamp-only jobs still have a fallback.
- **Validated answer reveal is separated from persistence.** The UI can reveal validated streamed final parts, but feedback/edit/persistence-dependent actions wait for a persisted assistant message. If persistence fails after retry, the user sees an unsaved warning instead of a silently unsafe action surface.

Slice 2 moved the conversation shell onto a narrower primitive-backed foundation:

- **The analysis viewport now uses an AI Elements Conversation primitive.** A TabulateAI-owned `AnalysisConversationShell` wraps the primitive so the analysis thread keeps owning chat state, timeline assembly, action gating, and product semantics.
- **Stick-to-bottom behavior is no longer handcrafted in `AnalysisThread`.** Sending, editing, and follow-up requests issue a narrow scroll request to the shell; normal streaming/resizing behavior is handled by `use-stick-to-bottom`.
- **Reveal-event scrolling is no longer wired through `AnalysisMessage`.** Answer choreography still lives in `AnalysisMessage`, but it no longer drives bespoke thread scroll callbacks.
- **The product sidebar temporarily collapses on the analysis route.** The app header trigger remains available so users can reopen the global navigation when needed, and the previous sidebar state is restored after leaving analysis.

The remaining roughness is now primarily in the presentation and ownership layers:

- **Answer reveal still uses custom streaming-era choreography.** Slice 1 normalized the answer input, but `AnalysisMessage` still owns reveal timing and footer readiness. That cleanup waits for Slice 5 and Slice 7.
- **Viewport behavior is improved but still needs visual QA in real sessions.** The shell now owns stick-to-bottom behavior, but mobile, long-table, and active-streaming states should continue to be verified as future primitives land.
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

### Slice 0 - UX Baseline And Current States - Complete

Create a lightweight visual and behavioral baseline before replacing primitives. These captures are current-state references with known issues, not an endorsement that the interactions are final or "golden."

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

Exit criteria: the overhaul has concrete current-state captures, a list of representative states, known issues, and a QA checklist each later slice can run against.

### Slice 1 - Settled Answer Model And Timeline Ordering - Complete

Do the architectural correction before swapping most UI primitives. The current backend already withholds final answer text until trust validation; this slice makes the frontend consume that reality explicitly.

Implemented shape:

- Added a normalized settled answer model derived from `AnalysisUIMessage.parts` plus message metadata. `AnalysisMessage` now uses this model for streamed and persisted assistant answers.
- Chose the live-turn source of truth: reveal from validated streamed final parts, then reconcile to persisted Convex state without changing the answer DOM shape. Persistence-dependent actions wait for a persisted assistant message ID.
- Added durable turn identity with `clientTurnId` on analysis messages and origin fields on compute jobs. These fields are additive and legacy timestamp-only records still fall back to timestamp attachment.
- Replaced timestamp-first message/job interleaving with turn-scoped ordering. Compute proposal cards attach to the originating turn and render in that turn's artifact slot, below the triggering request and below that turn's assistant reasoning/tool activity. Explicitly turn-scoped jobs wait until their originating turn is visible; only legacy jobs with no origin fields use timestamp fallback.
- Fixed the derived-cut proposal ordering issue through the same turn-ordering policy rather than by hard-coding a fixed proposal-confirmation position.
- Kept server finalization strict: `submitAnswer`, citations, render parts, and trust validation still gate the final answer.
- Separated "answer is validated" from "answer is persisted." If assistant-message persistence fails after bounded retry, TabulateAI can show the validated answer with an unsaved warning while disabling persistence-dependent actions. Persistence retry is idempotent at the assistant-message layer, keyed by `sessionId + clientTurnId`; table artifacts are created once and are not re-created by retry.
- Kept `GroundedTableCard` bespoke and preserved citation identity, grounded answer behavior, and the structured-parts trust contract.
- Left the production analysis prompt unchanged. Light proposal-card handoff guidance was added only to the alternative prompt and covered by prompt tests.

Exit criteria met: live and refreshed sessions render the same assistant answer structure in the same order. Compute proposals no longer move above the triggering turn after refresh. The answer renderer no longer depends on whether a message has "ever streamed."

Remaining after Slice 1:

- The conversation shell and scroll behavior are still custom and move to Slice 2.
- Answer readability and calm pre-activity loading wait for Slice 3.
- Thinking/tool display polish remains Slice 4.
- Fine-grained answer choreography, citation hover polish, sources, suggestions, and actions primitives remain Slice 5.
- Compute-lane confirmation/progress polish remains Slice 6.
- Old reveal/scroll machinery cleanup and component ownership splits remain Slice 7.

### Slice 2 - Conversation Shell And Auto-Scroll - Complete

Adopted the lowest-risk AI Elements primitive first: the conversation viewport and stick-to-bottom behavior.

Starting point after Slice 1:

- Treat `buildAnalysisTimelineEntries` and the settled answer model as the ordering/rendering contract. Slice 2 should not reintroduce timestamp interleaving or a separate live-message renderer.
- Preserve the current turn-scoped compute-card placement exactly while swapping the viewport/scroll primitive.
- Keep persistence-aware action gating unchanged. Slice 2 is a shell and scroll slice, not another backend finalization pass.
- Use the Slice 0 baseline and the Slice 1 ordering tests as regression guards before and after the shell change.

Implemented shape:

- Added the AI Elements **Conversation** primitive locally and wrapped it in `AnalysisConversationShell`, keeping TabulateAI-specific rendering and action logic outside the primitive.
- Replaced `AnalysisThread`'s live `ScrollArea` viewport, manual near-bottom refs, message-start snapping, and pending-state scroll effect with the shell's `use-stick-to-bottom` behavior.
- Kept `buildAnalysisTimelineEntries` unchanged as the ordering contract. Compute cards still attach to their originating turn.
- Removed `AnalysisMessage`'s reveal-progress scroll callback path. The answer reveal controller still exists, but it no longer drives thread scrolling directly.
- Added a subtle scroll-to-latest affordance from the Conversation primitive when the user is away from the bottom.
- Temporarily collapsed the global product sidebar on the analysis route through the existing sidebar context while preserving the header trigger and restoring the previous sidebar state on route exit.
- Added a narrow shell contract test and kept the Slice 1 ordering/action tests passing.
- Left the legacy `analysisThreadScroll` helper file in place as deprecated dead code rather than deleting it immediately. It is no longer in the live analysis thread render path.

Exit criteria met: the normal thread no longer needs bespoke reveal-event scrolling, user-initiated sends request the latest turn through the shell, persisted sessions initialize at the latest turn, and Slice 1 ordering/action contracts remain intact.

Remaining after Slice 2:

- Browser visual QA should continue to exercise active streaming, long tables, and narrow/mobile layouts as Slices 3-7 land.
- The old reveal controller and `hasEverStreamed` path still live in `AnalysisMessage`; Slice 5 should replace the choreography, and Slice 7 should remove obsolete machinery once it is truly dead.
- The deprecated `analysisThreadScroll` helpers can be deleted in Slice 7 after any remaining references and tests are removed.
- Composer autofocus remains intentionally undecided.
- Compute card content/progress polish remains Slice 6.

### Slice 3 - Answer Readability And Loading Calm

Make the validated answer easier to read and make the pre-activity wait feel intentional. This slice is broader than a component swap, but still narrow in product scope: improve normal assistant prose rendering and the placeholder shown before visible assistant activity exists.

The practical reason for this ordering is that TabulateAI intentionally withholds answer prose until validation. If the wait looks generic and the final prose reads like raw streaming markdown, the trust model can feel slow rather than deliberate. This slice should make the validated-answer flow feel calm without reopening the structural contracts landed in Slices 1 and 2.

- Assume the Slice 2 Conversation shell is the viewport owner. Do not reintroduce message-level scroll effects while replacing markdown/loading primitives.
- Improve citation-free assistant prose rendering with AI Elements **Response** / **MessageResponse** where the primitive is a direct fit.
- Keep the rendering compact and analysis-appropriate: chat-scale headings, controlled paragraph spacing, readable lists, clear inline emphasis, and code/data formatting that respects TabulateAI's typography.
- Do not initially replace mixed text-plus-citation blocks. Those remain custom until citation choreography is addressed in Slice 5.
- Do not allow generic markdown tables to become a substitute for grounded evidence. Tabular evidence should continue to use `GroundedTableCard` unless a later product decision explicitly changes that.
- Replace the generic "TabulateAI is analyzing..." pending state with a calm assistant-side loading primitive shown only before reasoning, tool activity, or answer content is visible.
- Keep pre-activity loading copy honest. It can say TabulateAI is reading or checking run artifacts, but it should not imply a specific internal step has happened before the stream provides that signal.
- Verify shadcn-style component copies inherit:
  - Instrument Serif for display surfaces
  - Outfit for UI/body text
  - JetBrains Mono for data/citation labels
  - `ct-*` semantic accent tokens
  - dark-mode primary presentation
- Keep copy calm and product-specific. Use "TabulateAI" in user-facing text.

Deferred explicitly from Slice 3:

- Reasoning and tool display remain Slice 4. This slice may hand off cleanly to the existing thinking trace, but it should not redesign it.
- Answer reveal timing, footer readiness, and coordinated answer choreography remain Slice 5.
- Citations, sources, follow-ups, copy/action layout, feedback controls, and citation hover/click polish remain Slice 5.
- Compute proposal cards, confirmation, progress honesty, and continuation remain Slice 6.
- Table-card redesign ideas, including details-as-toggle and multi-table carousel behavior, remain outside this slice.
- Removing old reveal-controller machinery, `hasEverStreamed`, `unstableTail`, and large `AnalysisMessage` ownership cleanup remains Slice 7.

Exit criteria: citation-free assistant markdown is polished and stable in live and refreshed sessions; the pending state before visible assistant activity feels calm and product-specific; citation/table rendering remains untouched; turn-scoped ordering remains unchanged; and no new message-level scroll ownership is introduced.

### Slice 4 - Thinking Phase

Make the waiting period useful and transparent, since answer prose is intentionally withheld until validation.

- Integrate thinking/tool polish into the Slice 2 shell behavior. Expanded thinking should respect the Conversation stick-to-bottom model and should not add new bespoke viewport code.
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

- Own answer motion and layout stability here, but do not re-solve viewport stickiness. The Conversation shell decides whether the viewport follows the bottom.
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

- Own compute-card design, confirmation, progress honesty, and continuation polish. Do not reopen Slice 1 turn attachment or Slice 2 viewport ownership unless a clear product bug appears.
- Frame confirm/cancel/revise proposal interactions with AI Elements **Confirmation** where it improves clarity.
- Evaluate **Task**, **Plan**, **Queue**, and **Checkpoint** primitives for queued/running/success/failure display, but do not force-fit them if TabulateAI's compute state needs a more direct custom presentation.
- Keep cut definitions, validation messages, confidence/review flags, lineage, and derived-table details as custom slots.
- Replace hardcoded progress fallbacks where the backend can provide real progress. Where real progress is not available, label the state honestly rather than implying precise completion.
- Coordinate with the compute-lane plan's *V1 Polish - Compute Reuse And Smoothness* section. Backend caching and parent-artifact reuse belong there; this slice is the chat UI half.
- Smooth auto-continuation when a `computed_derivation` artifact lands, so the answer phase can continue without a visible refresh-and-replace.

Exit criteria: compute cards feel like first-class chat artifacts. Progress is either real or honestly indeterminate. Confirmation and continuation are clear.

### Slice 7 - Cleanup, Performance, And Ownership Boundaries

Remove obsolete machinery as each replacement lands. This slice should finish the simplification rather than defer all deletion to the end.

- Clean up only machinery proven obsolete by the landed slices. Do not delete code just because an earlier plan expected it to become dead.
- Delete the streaming-first reveal controller once settled-answer choreography owns reveal behavior.
- Remove `hasEverStreamed`, `unstableTail`, and related memo invalidation paths when they are no longer needed.
- Remove the deprecated custom auto-scroll utilities and their tests after confirming no live code depends on them.
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

For frontend implementation slices, run the relevant component tests plus browser/screenshot checks against the Slice 0 current-state baseline and known-issue notes.

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

1. Baseline the current states and known issues.
2. Normalize live and persisted assistant answers into one settled answer model.
3. Move the conversation shell onto a primitive-backed viewport.
4. Adopt the remaining AI Elements primitives in the safest order.
5. Keep TabulateAI's crosstab, citation, and compute semantics bespoke.
6. Delete old machinery only as each landed slice proves it obsolete.

Done well, this gives TabulateAI a cleaner analysis workspace before the next analytical capability lands, and it makes future chat artifacts easier to add without multiplying UI edge cases.
