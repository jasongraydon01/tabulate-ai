# Phase 15 Sub-Plan - Analysis UI Overhaul

**Status:** implemented through Slice 7. This is a product-shape plan, not a per-ticket implementation spec. Future Bucket 3 artifact work should use this as the current UI baseline rather than reopening the earlier overhaul slices.

**Purpose:** clean up the Phase 15 analysis chat foundation before Tier A Bucket 3 work. The goal is a calmer, more predictable, more premium chat experience: grounded answers reveal smoothly after validation, thinking/tool activity carries the wait honestly, and live turns render the same way as reloaded sessions.

Parent plan: [phase15-chat-with-your-data-v1-implementation-plan.md](/Users/jasongraydon01/tabulate-ai/docs/implementation-plans/phase15-chat-with-your-data-v1-implementation-plan.md)
Compute-lane sibling: [phase15-analysis-compute-lane-implementation-plan.md](/Users/jasongraydon01/tabulate-ai/docs/implementation-plans/archive/phase15-analysis-compute-lane-implementation-plan.md)

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

- **Answer reveal is now isolated from message chrome.** Slice 7 moved reveal timing into a small settled-answer reveal hook. Live validated answers still reveal progressively, while refreshed persisted answers render immediately.
- **Viewport behavior is improved but still needs visual QA in real sessions.** The shell now owns stick-to-bottom behavior, but mobile, long-table, and active-streaming states should continue to be verified as future primitives land.
- **AnalysisMessage is now an orchestrator.** User-message editing/copy, settled answer body rendering, answer reveal timing, work disclosure, and the answer footer each have clearer ownership boundaries.
- **Compute progress is partly real and partly fallback.** Child run progress is used when present, but queued/running states still fall back to hardcoded values when the worker has not emitted meaningful progress. The UX reads as less trustworthy than the rest of the analysis surface.

The backend contract is not the main problem. The primary work is to normalize the UI model and adopt polished primitives where they fit.

---

## Target Product Shape

The analysis surface should move from **streaming-first answer rendering** to **settled-answer orchestration**.

- During the agent loop, the UI shows a **work phase**: curated activity from reasoning summaries and tool calls streams live as a compact assistant-side reasoning/work disclosure.
- After the model submits its structured final answer, the UI enters a quiet **finalization / validation handoff**: answer prose remains hidden while the backend checks the `submitAnswer` contract, confirmed cite parts, and render directives.
- After validation passes, the UI enters the **answer phase**: text, tables, citations, sources, follow-ups, and actions reveal from one complete, normalized answer model.
- Persisted reload uses the same answer-phase renderer as a live turn. Reload can skip the thinking phase, but it should not use a different DOM structure.
- Vercel AI Elements becomes the primitives layer where useful. We use it shadcn-style, themed into TabulateAI's existing design system. We do not let generic primitives replace product-specific survey/crosstab behavior.

This is not a move away from streaming altogether. Streaming remains valuable for reasoning and tool activity. What changes is that untrusted answer prose no longer trickles into the UI before its grounding has been validated.

The product should not make validation feel like a compliance workflow. Users should experience a stable reasoning/work disclosure, then a clean answer. Expanded reasoning/tool detail is available for transparency, but it is not the primary surface.

---

## Terminology

- **AI SDK stream:** The existing `UIMessage` stream from the analysis API. It carries reasoning, tool parts, metadata, data parts, and final answer chunks.
- **AI Elements Response / MessageResponse:** A frontend markdown response primitive. This is not a backend migration to OpenAI's Responses API.
- **Settled answer model:** A complete, normalized representation of one assistant answer after `submitAnswer` validation and trust resolution. Both live and persisted rendering should consume this same model.
- **Bespoke product surface:** TabulateAI-specific rendering that should stay custom: `GroundedTableCard`, significance markers, banner/cut grouping, `tableId x rowKey x cutKey` citation identity, and compute-lineage details.

---

## Architecture Rules

- **One answer renderer.** Live turns and persisted reloads should produce the same answer DOM in the same order.
- **Work may stream; grounded answers settle first.** Reasoning/tool activity can stream live as a curated work phase. Dataset-specific claims, tables, citations, sources, and follow-ups wait for backend validation.
- **Finalization is a handoff, not visible answer prose.** Once the model submits `submitAnswer`, the UI may acknowledge that TabulateAI is checking the answer against run artifacts, but it should not reveal answer content until the backend accepts the contract.
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
- Old reveal/scroll machinery cleanup and component ownership splits were completed in Slice 7.

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
- Initially left the legacy `analysisThreadScroll` helper file in place as deprecated dead code. Slice 7 later deleted it after confirming no live code depended on it.

Exit criteria met: the normal thread no longer needs bespoke reveal-event scrolling, user-initiated sends request the latest turn through the shell, persisted sessions initialize at the latest turn, and Slice 1 ordering/action contracts remain intact.

Remaining after Slice 2:

- Browser visual QA should continue to exercise active streaming, long tables, and narrow/mobile layouts as Slices 3-7 land.
- The old reveal controller and deprecated scroll helpers were removed in Slice 7 after the replacement choreography landed.
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
- Removing old reveal-controller machinery and large `AnalysisMessage` ownership cleanup was completed in Slice 7.

Exit criteria: citation-free assistant markdown is polished and stable in live and refreshed sessions; the pending state before visible assistant activity feels calm and product-specific; citation/table rendering remains untouched; turn-scoped ordering remains unchanged; and no new message-level scroll ownership is introduced.

### Slice 4 - Work Phase And Validation Handoff

Make the waiting period useful and transparent, since answer prose is intentionally withheld until validation. This slice is not "make the reasoning transcript prettier." It creates one stable assistant-side reasoning/work disclosure that covers the private work phase, the quiet finalization/validation handoff, and the transition into the validated answer.

Target turn model:

1. **Work phase:** TabulateAI is inspecting the run: searching artifacts, fetching tables, checking question context, confirming cells, or preparing a compute proposal. Reasoning summaries and tool activity may stream, but the default surface is a curated status line rather than an open transcript.
2. **Finalization / validation handoff:** the model has submitted `submitAnswer({ parts })`; TabulateAI is checking that the structured answer contract holds. Keep answer prose hidden. A quiet status such as "Checking the answer against the run artifacts..." is acceptable.
3. **Answer phase:** once validation passes, collapse the disclosure if the user has not manually opened it and reveal the settled answer below it.

Implemented shape:

- Added local AI Elements **Reasoning** and **Tool** primitives, used through the TabulateAI-owned `AnalysisWorkDisclosure` adapter rather than directly against raw `UIMessage.parts`.
- `AnalysisWorkDisclosure` now owns the shared unframed assistant-side treatment for pre-activity loading, active reasoning/tool activity, validation handoff, and refreshed analysis steps.
- Added transient stream status `data-analysis-status` with `phase: "validating_answer"` and label `TabulateAI is checking the answer against the run artifacts...`. This status is live-stream-only; it is not persisted to Convex and does not enter final answer text/rendering.
- The default disclosure state is collapsed, including while active. The compact line shows a loader plus a curated status without a separate answer-like container; expanded detail shows curated tool rows before sanitized reasoning summaries.
- Internal tool names, raw JSON, `submitAnswer`, unknown tools, and hidden proposal tools are excluded from default activity rendering.
- The disclosure auto-collapses when settled answer content starts unless the user manually opened it. Refreshed sessions show available trace detail collapsed by default as `Analysis steps`.

Deferred explicitly from Slice 4:

- Sentence-level numeric claim verification remains a future trust-layer slice. Current validation confirms structured answer shape, confirmed cite cell IDs, and fetched/valid render parts; it does not yet prove every numeric sentence equals the cited cell value.
- Post-`submitAnswer` repair/retry remains a backend trust-layer follow-up. Today a finalization failure fails the turn; a future bounded retry loop should give the agent detailed validation errors and a chance to fetch/confirm/submit again.
- Answer reveal choreography, citations/sources/actions/footer layout, feedback controls, and follow-up chips remain Slice 5.
- Compute proposal/result card lifecycle, lineage, and traceability remain Slice 6 unless a Slice 4 container change directly affects the thinking/tool handoff.
- Large `AnalysisMessage` ownership cleanup was completed in Slice 7.

Exit criteria: the wait between prompt and answer feels substantive but calm. Users see TabulateAI working against verified run artifacts, can expand for transparency, then the reasoning/work disclosure gets out of the way when the validated answer is ready.

### Slice 5 - Answer Phase Choreography

Polish the coordinated reveal of the settled answer: text, tables, citations, sources, suggestions, and actions.

- Own answer motion and layout stability here, but do not re-solve viewport stickiness. The Conversation shell decides whether the viewport follows the bottom.
- Drive reveal motion from the settled answer model, not from raw streaming deltas.
- Use calm easing and small staggered groups rather than timer-heavy sentence-by-sentence trickle.
- Treat copy, sources, feedback, and follow-up prompts as one answer-attached footer phase, not as independent UI pieces that pop in below the answer.
- Reserve a predictable footer footprint so sources, feedback, and suggestions do not cause a second visible layout jump after the answer has settled.
- Coordinate auto-scroll with that predicted footprint. Slice 5 may tune when the viewport follows the answer/footer reveal, but it should not replace the Conversation shell's overall bottom-follow ownership.
- Tighten footer spacing: reduce the gap between follow-up suggestions and the composer, remove excess padding around copy/sources, and avoid large vertical breaks between answer body, actions, and suggestions.
- Place feedback closer to core message actions where possible. A likely direction is copy + feedback in the same compact action row, with sources nearby and follow-up prompts as the row below.
- Hide follow-up suggestions as soon as the user starts typing in the composer so stale prompts do not compete with the user's next question.
- Render `GroundedTableCard` once in its ready state where possible. Avoid shell-to-ready table jank during answer reveal.
- Adopt AI Elements **Inline Citation** only as a primitive shell. Keep TabulateAI's `tableId x rowKey x cutKey` anchor identity and scroll/highlight behavior.
- Add citation hover affordances where useful, but verify click behavior works both live and after refresh.
- Adopt AI Elements **Sources** for evidence/context disclosure, while preserving the distinction between rendered table evidence and additional context evidence.
- Adopt AI Elements **Suggestion** for follow-up chips, but constrain the product pattern to three stable-width, pro-style prompts that read like a strong analyst might naturally ask next.
- Adopt AI Elements **Actions** for copy, edit, regenerate/resend-style message actions where the existing behavior maps cleanly.
- Keep feedback affordances product-specific unless AI Elements provides a clean, accessible primitive that does not dilute the current workflow.
- Future AI-generated follow-ups should hydrate progressively inside the same reserved suggestion slot rather than gating the whole footer. Deterministic suggestions can remain an immediate fallback; a faster model such as Gemini Flash can replace or refine them when available. The footer height should stay stable whether suggestions are deterministic, AI-generated, loading, or absent.
- Observed follow-up from Slice 3 QA: on proposal/derived-table turns, copy/feedback/follow-up controls can float between the assistant text and the proposal/result card. Answer-phase choreography should treat those controls as the footer for the whole turn, not just the prose block, or intentionally suppress/defer them for compute proposal turns.

Exit criteria: the end-of-turn answer reveal is smooth, anchored, and reload-stable. Citations work after refresh. Sources, feedback, copy, and follow-ups feel like one native footer phase instead of bolted-on controls.

### Slice 6 - Compute Lane UI

**Status:** implemented.

Bring compute proposals and job progress into the same chat experience without hiding their special semantics.

- Own compute-card design, confirmation, progress honesty, and continuation polish. Do not reopen Slice 1 turn attachment or Slice 2 viewport ownership unless a clear product bug appears.
- Frame confirm/cancel/revise proposal interactions with AI Elements **Confirmation** where it improves clarity.
- Evaluate **Task**, **Plan**, **Queue**, and **Checkpoint** primitives for queued/running/success/failure display, but do not force-fit them if TabulateAI's compute state needs a more direct custom presentation.
- Keep cut definitions, validation messages, confidence/review flags, lineage, and derived-table details as custom slots.
- Replace hardcoded progress fallbacks where the backend can provide real progress. Where real progress is not available, label the state honestly rather than implying precise completion.
- Coordinate with the compute-lane plan's *V1 Polish - Compute Reuse And Smoothness* section. Backend caching and parent-artifact reuse belong there; this slice is the chat UI half.
- Smooth auto-continuation when a `computed_derivation` artifact lands, so the answer phase can continue without a visible refresh-and-replace.
- Observed follow-up from Slice 3 QA: proposal-ready and derived-table-ready cards currently read as separate artifacts below the assistant text, while the assistant footer controls remain above them. Compute-lane polish should make proposal/result cards feel attached to the turn they complete, including confirmation, queued, and derived-ready states.
- Observed follow-up from live QA: once a proposal is confirmed, the UI needs clearer traceability from proposal -> queued compute -> persisted `computed_derivation` artifact -> rendered table. A completed card should identify the persisted artifact/table it produced and make it obvious whether the user is looking at the result, waiting on compute, or still only looking at the original proposal. The card should answer "what state is this in?" without requiring the user to ask the agent again.

Exit criteria: compute cards feel like first-class chat artifacts. Progress is either real or honestly indeterminate. Confirmation and continuation are clear.

Shipped behavior:

- Compute cards now carry a compact lifecycle row from proposal through confirmation, queued/computing, and ready/terminal states.
- Proposed jobs use a clearer `Confirm compute` action while keeping cancel/revise/continue behavior scoped to the appropriate states.
- Successful derived runs identify the child run as ready and keep the existing `Continue in derived run` handoff.
- Successful table-scoped jobs identify that the derived table was added to the current analysis session and show an `Artifact saved` indicator when a persisted `computed_derivation` artifact is attached.
- Table-scoped running jobs use an indeterminate activity state instead of fake numeric progress; derived runs still use real child-run progress when available.
- Banner definitions, row roll-ups, selected-table cut definitions, validation details, confidence/review flags, and lineage semantics remain TabulateAI-specific custom slots.
- Backend compute reuse and Bucket 3 table derivations remain deferred.

### Slice 7 - Cleanup, Performance, And Ownership Boundaries

**Status:** implemented.

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

Shipped behavior:

- `AnalysisMessage` now stays focused on turn orchestration: it resolves the settled answer model, work disclosure state, footer readiness, and top-level layout.
- User message copy/edit/resend moved into `AnalysisUserMessage`.
- Settled assistant answer rendering moved into `AnalysisAnswerBody`, including markdown, inline citation chips, placeholder/missing table states, and `GroundedTableCard` placement.
- Live/reload answer choreography moved into `useAnalysisAnswerReveal`. The streaming-era `hasEverStreamed` / `unstableTail` path was removed; live turns still animate from the settled answer model, and refreshed turns render settled immediately.
- The deprecated `analysisThreadScroll` helper and its tests were deleted. Bottom-follow behavior remains owned by `AnalysisConversationShell` / `use-stick-to-bottom`; citation and source anchor navigation remain independent `scrollIntoView` behavior.
- Reveal helper tests moved out of `AnalysisMessage.test.ts` and now target the reveal module directly.

Remaining deferred work:

- Bucket 3 artifact additions should build on the extracted answer-body and footer boundaries.
- Broader artifact architecture, AI-generated follow-up hydration, compute reuse/caching, and table promotion remain outside the UI overhaul.

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
