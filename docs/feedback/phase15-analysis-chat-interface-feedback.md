# Phase 15 Analysis Chat Interface Feedback

Purpose: capture observations, friction points, and open hypotheses about the current TabulateAI "Chat with your data" experience without locking in implementation decisions too early.

This note is intentionally lightweight. It is not a slice plan, and it is not a committed solution document. It exists so we can accumulate interface and agent-behavior feedback as we use the feature.

Related plan:
- [docs/implementation-plans/phase15-chat-with-your-data-v1-implementation-plan.md](/Users/jasongraydon01/tabulate-ai/docs/implementation-plans/phase15-chat-with-your-data-v1-implementation-plan.md)

## Current Notes

1. Grounded table-card limits are hardcoded today.
The current table-card behavior uses fixed limits for visible rows and cuts. This likely needs to become configurable rather than being embedded directly in code.
Open question: should this be a plain environment value, a model-aware setting, or a more explicit analysis-chat configuration surface?

2. The rendered row count can feel more constrained than the stated row limit.
The system reports that rows are limited to 12, but observed behavior can look closer to 4 visible rows in practice. That suggests there is a second shaping effect happening beyond the top-level row-limit constant, or at minimum a mismatch between what the UI communicates and what the user perceives.
Open question: is the issue true row filtering, table structure, viewport/layout compression, or model-selected narrowing via tool arguments?

3. Row truncation may be the wrong default interaction model.
The current grounded card appears to render a snippet rather than the full row set. That is acceptable for now, but the long-term experience may need a clearer "truncated preview" pattern with an obvious way to expand, inspect, or scroll the rest of the row set.
Open question: should the default behavior be "show all rows and let the container scroll," "show a preview with expand," or "show a preview plus a dedicated drill-in view"?

4. The model likely needs a way to prioritize rows more intentionally.
There are cases where the most relevant rows are obvious from the user prompt, but the current snippet can still feel generic. A useful future direction may be allowing the model to indicate row-priority hints so the most relevant rows are surfaced first without changing the underlying table contents.
Example observation: for a question about CSB awareness, the row ordering might benefit from prioritizing rows such as "Told" or "Not told" rather than relying purely on default table order.

5. The default cut presentation may be too broad.
For many questions, the cleanest first view is probably just Total. Additional cuts are more valuable when the user is asking comparative questions or explicitly asks for subgroup detail.
Open question: should the default grounded card bias toward Total-only until the user asks for cuts, with additional cuts added only when the conversational context clearly calls for them?

6. We need a place to capture hypotheses before turning them into work.
Some of the right next moves may be slice work, some may be polish, and some may not need action at all. We should continue recording the issues and possible angles first, then decide later which items deserve implementation, prioritization, or deferral.

7. The page currently feels too container-heavy.
The analysis workspace has a lot of visible cards, borders, and boxed regions. Even when the visual styling is clean, the overall impression is still crowded and strongly segmented.
Open question: should the message area move closer to a ChatGPT-style "content on the page" layout where assistant responses feel less boxed in, while still preserving TabulateAI structure where it matters?

8. The grounded table card feels visually crowded.
The current table rendering exposes a lot of metadata, labels, and support text in the main card body. That makes the first read denser than it likely needs to be.
Open question: which metadata should remain visible by default, and which parts should move behind a lower-emphasis disclosure such as an info icon, popover, or secondary detail layer?

9. Some table metadata may belong in a popover rather than the default surface.
Items like standard-overview style metadata, explanatory notes, or supporting context may be useful without deserving permanent visual weight in the main reading flow.
Open question: can we make the first read cleaner by moving some of this metadata into a compact detail affordance instead of rendering it inline every time?

10. The assistant should not produce faux text tables when a grounded card is already rendering.
The current behavior can lead to awkward duplication where the assistant both renders a table card and then also tries to write a markdown-style or pseudo-ASCII table in the response text below it.
Open question: do we need clearer agent instructions that grounded table rendering replaces manual table formatting in the prose response?

11. Tool activity is currently hidden from the user.
The experience would likely feel more legible if the interface showed what the assistant actually did, especially when it searched, resolved a question, or loaded a grounded table.
Open question: should tool calls appear as inline status steps, collapsed activity chips, or some other low-noise activity pattern?

12. The session/workspace language could be clearer and more intentional.
"Analysis Session" is functional but generic. It does not clearly communicate that the user is interacting with TabulateAI's AI analysis workspace rather than a plain saved thread.
Open question: should the workspace, thread, or session naming shift toward language that makes the AI analysis function more explicit?

13. Significance rendering likely needs a more legible visual language.
The current significance presentation is text-heavy and explanatory in a way that competes with the data values. Letters and phrases like "vs total" add clutter in the current layout.
Open question: should significance be rendered more like a compact indication system, for example superscripts, color emphasis, or other lower-noise notation that preserves the meaning without reading like prose?

14. "Versus total" may not need to be stated explicitly every time.
In many table contexts the relationship is already implied by the structure, so repeatedly spelling it out adds bulk.
Open question: can that meaning be communicated more quietly through design language rather than repeated explanatory text?

15. The current interface needs a more opinionated design language for analysis.
The feature works, but the reading experience still feels closer to assembled product primitives than to a fully designed analysis environment.
Open question: what design conventions should define the TabulateAI analysis workspace so it feels calmer, easier to scan, and more purposeful while still supporting grounded detail?

## Working Rules For This Note

- Capture the issue first.
- Add hypotheses when useful.
- Do not force a solution too early.
- Do not assume every observation becomes a task.
- Let this document accumulate before we prioritize aggressively.
