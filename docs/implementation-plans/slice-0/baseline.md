# Slice 0 Baseline - Analysis UI Overhaul

**Status:** baseline captured with current materials. More screenshots would be useful for final QA, but they are not required before starting Slice 1.

**Purpose:** turn the Slice 0 screenshots and notes into a practical baseline for the analysis UI overhaul. This is not an implementation spec; it is the reference point future slice plans should use when defining acceptance criteria.

Parent plan: [phase15-analysis-ui-overhaul-implementation-plan.md](/Users/jasongraydon01/tabulate-ai/docs/implementation-plans/archive/phase15-analysis-ui-overhaul-implementation-plan.md)

---

## Baseline Verdict

The current materials are enough to establish the direction of the overhaul.

They clearly show the highest-value issues:

- live answer versus settled answer jank
- proposal card ordering bugs
- analysis workspace clutter
- weak empty states
- missing composer autofocus
- reasoning display density problems
- footer/action/follow-up spacing problems
- citation-to-table highlighting behavior
- table details pushing content down
- compute/derived-run status not feeling integrated

The remaining gaps should be handled as QA additions during implementation, not as blockers for starting the next slice.

---

## Critical Findings

### 1. Live/settled answer handoff feels broken

Source: [non-image-feedback.md](/Users/jasongraydon01/tabulate-ai/docs/implementation-plans/slice-0/non-image-feedback.md)

Observed:

- The assistant answer appears complete.
- Then the UI enters a second settle/refresh moment.
- Feedback, follow-up bubbles, and other post-answer elements appear afterward.
- This makes the answer feel done twice.

Desired behavior:

- Thinking/tool activity can stream while the answer is being prepared.
- Final answer content should reveal once, after validation and trust resolution.
- Feedback, sources, follow-ups, and actions should enter as part of the same settled answer phase, not as a later UI refresh.

Likely slice:

- Slice 1 - Settled Answer Model And Timeline Ordering
- Slice 5 - Answer Phase Choreography

Must-have:

- Yes. This is the core architectural issue Slice 1 exists to fix.

### 2. Proposal cards can appear before the user/message context

Source: [11-proposal-tool-initially-goes-ahead-of-my-message-until-fully-settle.png](/Users/jasongraydon01/tabulate-ai/docs/implementation-plans/slice-0/images/11-proposal-tool-initially-goes-ahead-of-my-message-until-fully-settle.png)

Observed:

- A proposal card appears above the relevant user message and reasoning context.
- The interaction order feels unnatural: the user is asked to confirm a thing before the surrounding answer explains it.
- The UI may not fully update until refresh.

Desired behavior:

- Timeline order should match the conversation order:
  1. user request
  2. thinking/tool activity
  3. assistant context/explanation
  4. proposal or derived artifact action
  5. follow-up state
- Live and refreshed sessions should preserve the same order.

Likely slice:

- Slice 1 - Settled Answer Model And Timeline Ordering
- Slice 6 - Compute Lane UI

Must-have:

- Yes. This is a structural correctness issue, not just polish.

### 3. The analysis workspace has too much chrome

Source: [2-cluttered-entry-collapse-dashboard-sidebar-when-in-analysis.png](/Users/jasongraydon01/tabulate-ai/docs/implementation-plans/slice-0/images/2-cluttered-entry-collapse-dashboard-sidebar-when-in-analysis.png)

Observed:

- The dashboard sidebar and analysis session rail both appear.
- The chat/table content is compressed.
- The workspace feels more like a nested admin page than a focused analysis surface.

Desired behavior:

- The analysis route should prioritize the conversation and evidence area.
- The global dashboard sidebar should be collapsed or minimized by default when inside the analysis workspace.
- The session rail should remain available, but it should not make the main thread feel cramped.

Likely slice:

- Slice 2 - Conversation Shell And Auto-Scroll

Must-have:

- Yes for workspace quality. It is not required for the settled-answer model, but it should be part of the shell work.

### 4. Empty states are too generic

Sources:

- [5-empty-state-with-previous-sessions-maybe-instead-use-prompt-bubles-like-copilot-that-are-dataset-aware-liekly-need-ai.png](/Users/jasongraydon01/tabulate-ai/docs/implementation-plans/slice-0/images/5-empty-state-with-previous-sessions-maybe-instead-use-prompt-bubles-like-copilot-that-are-dataset-aware-liekly-need-ai.png)
- [6-empty-state-with-no-sessions-make-more-non-technical-something-friendly.png](/Users/jasongraydon01/tabulate-ai/docs/implementation-plans/slice-0/images/6-empty-state-with-no-sessions-make-more-non-technical-something-friendly.png)

Observed:

- The empty session state is calm, but it does not help the user start.
- The no-session state is functional but technical.
- With prior sessions available, the empty state could do more than show generic instruction text.

Desired behavior:

- New session should feel friendly and immediately actionable.
- With prior sessions, consider dataset-aware prompt suggestions.
- With no prior sessions, use less technical copy and a clearer first step.
- Suggested prompts should not feel like marketing cards; they should be compact, useful analysis starters.

Likely slice:

- Slice 3 - Response Markdown And Loading Primitives, or a small shell/empty-state subtask inside Slice 2

Must-have:

- Should-have before Bucket 3. Not a blocker for Slice 1.

### 5. Composer should autofocus in a fresh session

Source: [7-when-opening-fresh-session-try-to-place-input-in-the-box-immediately-so-users-dont-need-to-click-to-start-typing.png](/Users/jasongraydon01/tabulate-ai/docs/implementation-plans/slice-0/images/7-when-opening-fresh-session-try-to-place-input-in-the-box-immediately-so-users-dont-need-to-click-to-start-typing.png)

Observed:

- The composer is visible but not active.
- User has to click before typing, even in a brand-new session.

Desired behavior:

- Fresh analysis sessions should autofocus the composer when safe.
- Do not steal focus when the user navigates to an existing session, opens a menu, or interacts with another control.

Likely slice:

- Slice 2 - Conversation Shell And Auto-Scroll

Must-have:

- Small but high-impact. Include in shell work.

### 6. Reasoning is too expanded and too spacious

Sources:

- [4-reasoning-too-spaced-out-make-more-compact-and-more-premium.png](/Users/jasongraydon01/tabulate-ai/docs/implementation-plans/slice-0/images/4-reasoning-too-spaced-out-make-more-compact-and-more-premium.png)
- [8-do-not-default-to-reasoning-open-and-hide-dropdown-though-allow-it-to-if-clicked-upon.png](/Users/jasongraydon01/tabulate-ai/docs/implementation-plans/slice-0/images/8-do-not-default-to-reasoning-open-and-hide-dropdown-though-allow-it-to-if-clicked-upon.png)

Observed:

- Reasoning opens by default in a way that exposes too much intermediate text.
- Spacing is loose and feels less premium.
- The control reads as a developer trace rather than a calm analysis status.

Desired behavior:

- Default state should be compact.
- During active work, show a concise current-status line.
- Full reasoning/tool history should remain available on demand.
- Auto-collapse when the final answer begins.
- Hide or soften the dropdown affordance unless it adds value.

Likely slice:

- Slice 4 - Thinking Phase

Must-have:

- Yes for perceived quality, but after Slice 1.

### 7. Answer footer actions and suggestions feel detached

Source: [3-too-much-space-underneath-suggested-prompts-remove-those-bubles-shrink-feedback-align-left-next-to-copt.png](/Users/jasongraydon01/tabulate-ai/docs/implementation-plans/slice-0/images/3-too-much-space-underneath-suggested-prompts-remove-those-bubles-shrink-feedback-align-left-next-to-copt.png)

Observed:

- There is too much vertical space below the answer.
- Feedback controls float in the center.
- Follow-up bubbles feel too prominent and detached.
- Copy, sources, feedback, and suggestions are not organized as one footer system.

Desired behavior:

- Copy, sources, and feedback should feel like one compact message action row.
- Follow-up suggestions should be smaller, fewer, and more clearly secondary.
- Suggestions should not compete with the composer.
- The footer should not create a second visual endpoint below the answer.

Likely slice:

- Slice 5 - Answer Phase Choreography

Must-have:

- Yes for polish before Bucket 3, but not a blocker for the settled-answer model.

### 8. Citation highlighting is directionally useful

Source: [10-when-clicking-on-citation-cells-highlght-in-tis-fashion.png](/Users/jasongraydon01/tabulate-ai/docs/implementation-plans/slice-0/images/10-when-clicking-on-citation-cells-highlght-in-tis-fashion.png)

Observed:

- Clicking a citation highlights relevant table cells.
- The current highlight is visible and understandable.
- The citation label is small but workable.

Desired behavior:

- Preserve citation-to-cell scroll and highlight.
- Ensure behavior works after refresh, not only live.
- Consider hover preview later, but do not let generic citation primitives weaken the existing `tableId x rowKey x cutKey` identity.

Likely slice:

- Slice 5 - Answer Phase Choreography

Must-have:

- Yes. This is a product differentiator.

### 9. Table details should not push evidence away

Source: [non-image-feedback.md](/Users/jasongraydon01/tabulate-ai/docs/implementation-plans/slice-0/non-image-feedback.md)

Observed:

- Details dropdown expands vertically and pushes table content down.
- This makes the table/evidence area feel less stable.

Desired behavior:

- Consider a toggle between table view and details view.
- Keep table height/layout more stable.
- Only show expand affordances when table view is active and useful.

Likely slice:

- Slice 5 - Answer Phase Choreography

Must-have:

- Should-have. It improves table stability but can follow the core reveal/order fixes.

### 10. Multi-table answers may need a carousel pattern

Source: [non-image-feedback.md](/Users/jasongraydon01/tabulate-ai/docs/implementation-plans/slice-0/non-image-feedback.md)

Observed:

- Multiple rendered tables stacked one after another may become heavy.
- Citation navigation could be more elegant if tied to a carousel or grouped evidence region.

Desired behavior:

- Support both stacked tables and grouped/carousel table evidence.
- Let citations navigate to the relevant table/cell within the grouped evidence UI.
- Do not force carousel for single-table answers.

Likely slice:

- Slice 5 - Answer Phase Choreography, exploratory follow-on

Must-have:

- Not for Slice 1. Treat as a design option for multi-table answers, not a baseline blocker.

### 11. Derived run/project page status is confusing

Source: [1-derived-run-time-metrics-override.png](/Users/jasongraydon01/tabulate-ai/docs/implementation-plans/slice-0/images/1-derived-run-time-metrics-override.png)

Observed:

- The project page says the derived output includes a confirmed added cut from Chat with your data.
- It also shows original run stats/exports in a way that may imply the output is fully normal when some export artifacts are still pending.

Desired behavior:

- Derived outputs should clearly distinguish inherited/original run metrics from derived-run additions.
- Export readiness should remain honest and specific.
- The path back into the analysis workspace should be clear.

Likely slice:

- Slice 6 - Compute Lane UI, possibly compute-lane plan polish

Must-have:

- Not a blocker for Slice 1, but important before compute-derived workflows are presented broadly.

---

## Additional Captures

More screenshots are not required before starting implementation. If more captures are easy, these would be the highest value:

1. **Mobile or narrow desktop analysis thread.** Needed because composer overlap, table width, and session rail behavior are likely to break first on smaller viewports.
2. **Queued/running/failed compute state.** Useful before Slice 6 so progress and failure states do not rely on imagination.
3. **Sources expanded state.** Useful before Slice 5 to clarify how evidence disclosure should sit with copy/feedback/suggestions.
4. **Live versus refreshed comparison of the same turn.** Useful for Slice 1 if the ordering bug is easy to reproduce.

Everything else can be handled through implementation QA.

---

## Slice Mapping

| Finding | Primary Slice | Blocking? |
| --- | --- | --- |
| Live/settled answer jank | Slice 1, Slice 5 | Yes |
| Proposal ordering bug | Slice 1, Slice 6 | Yes |
| Workspace chrome clutter | Slice 2 | Yes for shell polish |
| Empty states | Slice 2 or Slice 3 | No |
| Composer autofocus | Slice 2 | No, but small/high-impact |
| Reasoning density/default open | Slice 4 | No |
| Footer/action/suggestion clutter | Slice 5 | No |
| Citation highlight behavior | Slice 5 | Yes to preserve |
| Details dropdown pushes table | Slice 5 | No |
| Multi-table carousel | Slice 5 follow-on | No |
| Derived run status clarity | Slice 6 | No |

---

## Definition Of Slice 0 Complete

Slice 0 can be considered complete when:

- this baseline file exists and is kept with the screenshots
- current screenshots and feedback are preserved
- missing mobile/compute/source-expanded captures are listed as QA follow-ups, not blockers
- Slice 1 implementation planning references this baseline directly

By that standard, Slice 0 is complete enough to move into Slice 1 planning.
