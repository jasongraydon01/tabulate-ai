# Phase 15 Analysis Chat Interface Feedback

Purpose: capture observations, friction points, and open hypotheses about the current TabulateAI "Chat with your data" experience without locking in implementation decisions too early.

This note is intentionally lightweight. It is not a slice plan, and it is not a committed solution document. It exists so we can accumulate interface and agent-behavior feedback as we use the feature.

Related plan:
- [docs/implementation-plans/phase15-chat-with-your-data-v1-implementation-plan.md](/Users/jasongraydon01/tabulate-ai/docs/implementation-plans/phase15-chat-with-your-data-v1-implementation-plan.md)

## Reading This Document

The observations are grouped by feature area so that each cluster can be considered as a candidate implementation slice. Original item numbers are preserved in parentheses so earlier conversations and commits remain traceable.

The suggested cluster ordering below is one reasonable sequence, not a decision:

1. Table card — visual language
2. Table card — data and shaping
3. Thread and assistant behavior
4. Workspace frame — layout and copy
5. Session lifecycle
6. Grounding sources

Clusters 1 and 2 are paired: the card is the most visible surface, and its look and its contents should be tuned together, with visual first and shaping immediately after. Clusters 3 and 4 are smaller conversational and chrome polish. Cluster 5 is a small but necessary feature gap. Cluster 6 is the biggest net-new capability and is best tackled once the card itself is solid so that richer grounding has a clean surface to render into.

## Cluster 1. Table card — visual language

What binds this cluster: how the grounded table card looks. Density, typography, significance notation, and numeric formatting. These changes are purely about rendering; they do not change what the card contains.

Related in other clusters: cluster 2 item (17) also touches the cut header, because showing the group name visually depends on the shaping layer exposing group info in the first place.

### (8) The grounded table card feels visually crowded.
The current table rendering exposes a lot of metadata, labels, and support text in the main card body. That makes the first read denser than it likely needs to be.
Open question: which metadata should remain visible by default, and which parts should move behind a lower-emphasis disclosure such as an info icon, popover, or secondary detail layer?

### (9) Some table metadata may belong in a popover rather than the default surface.
Items like standard-overview style metadata, explanatory notes, or supporting context may be useful without deserving permanent visual weight in the main reading flow.
Open question: can we make the first read cleaner by moving some of this metadata into a compact detail affordance instead of rendering it inline every time?
Direction: treat the default card as minimal and push density into disclosure. Per-cut column headers likely do not need the stat letter and base n rendered underneath every cut name by default — those belong in an info popover attached to the cut header. The footer metadata on the card (significance test name, alpha, "not shown" counts, comparison group list) is the same pattern: useful on hover or click, distracting when always visible. The design assumption should be that the user wants a clean first read and full detail on demand, not the other way around.

### (13) Significance rendering likely needs a more legible visual language.
The current significance presentation is text-heavy and explanatory in a way that competes with the data values. Letters and phrases like "vs total" add clutter in the current layout.
Open question: should significance be rendered more like a compact indication system, for example superscripts, color emphasis, or other lower-noise notation that preserves the meaning without reading like prose?
Direction: the Excel rendering is the reference pattern. Significance should appear inline with the value as a compact superscript of stat letters, with the cell itself carrying the emphasis — bold, a tinted cell background, or a colored value — rather than a supporting text line underneath. If we can achieve that inline, we get most of the value of the Excel export without leaving the chat surface, which is one of the stronger arguments for relying on the grounded card instead of falling back to the spreadsheet.

### (14) "Versus total" may not need to be stated explicitly every time.
In many table contexts the relationship is already implied by the structure, so repeatedly spelling it out adds bulk.
Open question: can that meaning be communicated more quietly through design language rather than repeated explanatory text?

### (18) Cell values show decimals by default and read as engineering output.
The card currently shows values like 15.6% and 44.0% directly from the artifact. That level of precision is rarely what a research user wants at a glance and it adds noise to the table. The default should bias toward whole-number presentation using sensible rounding rules, with decimals only when the user explicitly asks for more precision or when the underlying value mode (e.g. mean) needs it.
Open question: what is the right default rounding policy by value mode — whole numbers for percent and count, one decimal for mean, and an explicit "show precise values" affordance when the user wants the raw figures?

## Cluster 2. Table card — data and shaping

What binds this cluster: what actually ends up inside the card. Row and cut selection, prioritization, defaults, truncation behavior, and how cuts relate to their banner groups. These observations are about the tool contract between the model and the card, not about rendering.

Related in other clusters: cluster 1 is the rendering half of this work. The cut-group label surfaced in (17) is a visual consequence of exposing group info through the shaping layer.

### (1) Grounded table-card limits are hardcoded today.
The current table-card behavior uses fixed limits for visible rows and cuts. This likely needs to become configurable rather than being embedded directly in code.
Open question: should this be a plain environment value, a model-aware setting, or a more explicit analysis-chat configuration surface?

### (2) The rendered row count can feel more constrained than the stated row limit.
The system reports that rows are limited to 12, but observed behavior can look closer to 4 visible rows in practice. That suggests there is a second shaping effect happening beyond the top-level row-limit constant, or at minimum a mismatch between what the UI communicates and what the user perceives.
Open question: is the issue true row filtering, table structure, viewport/layout compression, or model-selected narrowing via tool arguments?

### (3) Row truncation may be the wrong default interaction model.
The current grounded card appears to render a snippet rather than the full row set. That is acceptable for now, but the long-term experience may need a clearer "truncated preview" pattern with an obvious way to expand, inspect, or scroll the rest of the row set.
Open question: should the default behavior be "show all rows and let the container scroll," "show a preview with expand," or "show a preview plus a dedicated drill-in view"?

### (4) The model likely needs a way to prioritize rows more intentionally.
There are cases where the most relevant rows are obvious from the user prompt, but the current snippet can still feel generic. A useful future direction may be allowing the model to indicate row-priority hints so the most relevant rows are surfaced first without changing the underlying table contents.
Example observation: for a question about CSB awareness, the row ordering might benefit from prioritizing rows such as "Told" or "Not told" rather than relying purely on default table order.

### (5) The default cut presentation may be too broad.
For many questions, the cleanest first view is probably just Total. Additional cuts are more valuable when the user is asking comparative questions or explicitly asks for subgroup detail.
Open question: should the default grounded card bias toward Total-only until the user asks for cuts, with additional cuts added only when the conversational context clearly calls for them?

### (17) Cut groups are not visible, and truncation should preserve groups.
The column headers currently render a generic "CUT" eyebrow over each column instead of the real banner group name, so the user cannot tell which cuts belong together. That removes important context — for example, knowing that a set of columns is the "Brand" banner vs the "Segment" banner. On top of that, the current truncation limits are applied at the individual cut level, which can cut a group off partway through. The default should either show all cuts or, when truncation is unavoidable, operate at the group level so every cut within a rendered group is shown together. Partially rendered groups make the table misleading.
Open question: should the card fetch and render cuts grouped by banner group with the group name as a real header, and should truncation happen group-wise (drop whole groups) rather than column-wise (drop individual cuts)?

## Cluster 3. Thread and assistant behavior

What binds this cluster: how the assistant's work reads inside the thread itself, independent of card rendering. These are mostly prompt-level and small inline UI changes.

### (10) The assistant should not produce faux text tables when a grounded card is already rendering.
The current behavior can lead to awkward duplication where the assistant both renders a table card and then also tries to write a markdown-style or pseudo-ASCII table in the response text below it.
Open question: do we need clearer agent instructions that grounded table rendering replaces manual table formatting in the prose response?

### (11) Tool activity is currently hidden from the user.
The experience would likely feel more legible if the interface showed what the assistant actually did, especially when it searched, resolved a question, or loaded a grounded table.
Open question: should tool calls appear as inline status steps, collapsed activity chips, or some other low-noise activity pattern?

## Cluster 4. Workspace frame — layout and copy

What binds this cluster: the chrome around the thread. Page headings, copy tone, container weight, session-list styling, and overall design language. No change to the card itself or to the agent behavior.

### (7) The page currently feels too container-heavy.
The analysis workspace has a lot of visible cards, borders, and boxed regions. Even when the visual styling is clean, the overall impression is still crowded and strongly segmented.
Open question: should the message area move closer to a ChatGPT-style "content on the page" layout where assistant responses feel less boxed in, while still preserving TabulateAI structure where it matters?

### (12) The session/workspace language could be clearer and more intentional.
"Analysis Session" is functional but generic. It does not clearly communicate that the user is interacting with TabulateAI's AI analysis workspace rather than a plain saved thread. The surrounding page copy has the same issue — phrases like "Run-scoped analysis", "grounded lookup against the published artifacts", and "durable run-scoped threads" read as internal engineering language rather than research-user language. The feature is really about chatting with your data and exploring your research, and the copy should reflect that capability instead of describing the plumbing.
Open question: what is the right naming and tone across the workspace — for the session label, the page tagline, the body copy under the title, and the sidebar blurb — so the whole surface reads as a research environment rather than a technical workspace?

### (15) The current interface needs a more opinionated design language for analysis.
The feature works, but the reading experience still feels closer to assembled product primitives than to a fully designed analysis environment.
Open question: what design conventions should define the TabulateAI analysis workspace so it feels calmer, easier to scan, and more purposeful while still supporting grounded detail?

### (20) The message counter in the thread header is chrome without a clear purpose.
The "N messages" badge in the top-right of the thread does not give the user meaningful information. It does not help them navigate, does not summarize content, and does not indicate progress. It reads like developer instrumentation.
Open question: should it be removed outright, or replaced with something that actually supports the research workflow, such as a "jump to latest grounded result" link or a compact session-state indicator?

## Cluster 5. Session lifecycle

What binds this cluster: creating, renaming, deleting, and archiving sessions. Small but real usability gap.

### (19) Sessions can be created but not managed.
A user can start new sessions, but there is no way to delete, rename, or archive them. Over time this becomes a usability issue even before it becomes a storage issue — stale exploratory sessions pile up in the sidebar with no way to clean them up.
Open question: what is the minimum viable session-management surface for v1 — delete, rename, both, and how should it align with the eventual session-polish slice in the implementation plan?

## Cluster 6. Grounding sources

What binds this cluster: expanding what the model can reach beyond the current three artifacts. The largest net-new capability in the list, because it touches tool design, artifact access, and potentially project-level materials that do not exist as uploads today.

### (16) The model is missing access to research materials beyond the crosstab artifacts.
When doing research or reporting, the natural workflow is to move back and forth between the data and the supporting research materials — the survey document, the banner plan, message testing inputs, and any project brief. The current grounding layer only exposes `results/tables.json`, the final questionid artifact, and the crosstab plan. The banner plan (`planning/20-banner-plan.json`), the cleaned survey document, and project-level research materials are not surfaced to the model. That means the assistant can describe what a table shows but cannot easily talk about how a question was asked, why a particular banner was chosen, or what the project was trying to learn.
Open question: what is the right shape for exposing survey document, banner plan, and broader project materials — a dedicated grounding tool per artifact, a unified "research context" lookup, or a lightweight project-materials attachment model that lives alongside the run?

## Meta

### (6) We need a place to capture hypotheses before turning them into work.
Some of the right next moves may be slice work, some may be polish, and some may not need action at all. We should continue recording the issues and possible angles first, then decide later which items deserve implementation, prioritization, or deferral.

## Working Rules For This Note

- Capture the issue first.
- Add hypotheses when useful.
- Do not force a solution too early.
- Do not assume every observation becomes a task.
- Let this document accumulate before we prioritize aggressively.