# Phase 15 V1 Implementation Plan — Chat With Your Data

**Status:** In progress.

**Purpose:** Convert the Phase 15 background thinking into a concrete v1 execution plan that matches the current TabulateAI codebase, preserves a strong AI experience, and avoids a retrofit when we add richer compute later.

**Related background docs:**
- `/Users/jasongraydon01/.claude/plans/polymorphic-beaming-raven.md`
- `/Users/jasongraydon01/.claude/plans/vivid-shimmying-lobster.md`
- [docs/v3-roadmap.md](/Users/jasongraydon01/tabulate-ai/docs/v3-roadmap.md)

This document supersedes the older Phase 15 notes for **v1 build sequencing**. The older docs are still useful as background, but they assume a heavier first pass than we should ship initially.

## Recommendation

Build **a custom analysis surface on top of the AI SDK**, using TabulateAI's existing routing, auth, Convex, and design primitives.

Do **not** adopt a generic off-the-shelf chat UI as the product surface.

Do **not** build a dedicated chat worker in v1.

Do build the **durable foundation now**:
- run-scoped route
- persistent sessions/messages
- streaming responses
- grounded lookup tools against existing run artifacts
- durable analysis artifacts for any table/result the assistant renders
- a lightweight evidence/repair layer so the assistant stays natural without inventing numbers

That gets us one level up from the earlier thin slice without paying the cost of a full compute subsystem before we know how often users actually need recuts.

## Why This Approach

### 1. It fits the current codebase

TabulateAI already has the important backend building blocks:
- run-scoped artifact storage in [src/lib/r2/R2FileManager.ts](/Users/jasongraydon01/tabulate-ai/src/lib/r2/R2FileManager.ts)
- validated output artifacts such as `results/tables.json`, `enrichment/12-questionid-final.json`, and planning artifacts
- question-centric adapters in [src/lib/questionContext/adapters.ts](/Users/jasongraydon01/tabulate-ai/src/lib/questionContext/adapters.ts)
- stable auth and route security patterns in [src/lib/requireConvexAuth.ts](/Users/jasongraydon01/tabulate-ai/src/lib/requireConvexAuth.ts) and [src/lib/withRateLimit.ts](/Users/jasongraydon01/tabulate-ai/src/lib/withRateLimit.ts)
- strong run/project scoping already visible in the product routes under `src/app/(product)/projects/[projectId]/runs/[runId]/...`

The missing piece is not "AI infrastructure" in the abstract. The missing piece is a run-scoped conversational surface that can read these artifacts coherently and present them well.

### 2. It preserves the right product feel

The assistant should feel like Claude/Codex with direct access to the run, not like a locked-down query console.

That means:
- free conversation is allowed
- methodology discussion is allowed
- interpretation is allowed
- follow-up reasoning is allowed
- dataset-specific claims must be grounded

The system should prevent made-up numbers, not prevent intelligent conversation.

### 3. It avoids premature architecture

The earlier Phase 15 backend plan assumed three tiers from day one, including a dedicated compute worker. That is defensible long term, but it is too much for the first real implementation pass.

The right v1 move is:
- make the session and artifact model durable now
- make the API and UI stream-first now
- make the grounded lookup layer real now
- leave the heavy compute lane as a deliberate follow-on slice

That keeps us from retrofitting the data model later, while avoiding unnecessary operational surface area today.

## External Product/UX References

### Custom + AI SDK

The AI SDK is the best fit for v1 because it gives us:
- streaming chat transport
- tool-call aware message parts
- message persistence patterns
- resumable streams later if we need them
- compatibility with our existing TypeScript/Next.js stack

It is already present in the repo through the core `ai` package, and the TabulateAI analysis chat surface is now wired for run-scoped streaming conversations.

### assistant-ui

assistant-ui is useful as a **reference implementation** for chat primitives, thread state, and follow-up/suggestion patterns, but not as the TabulateAI surface itself. It is broader than we need and would still require substantial customization to feel like a focused research-analysis workspace.

### Thunderbolt

[Thunderbolt](https://github.com/thunderbird/thunderbolt) is useful as a reference for:
- dedicated thread-first layout
- strong separation between conversation surface and backend capabilities
- persistent chat/workbench feel rather than "toy widget" feel

It is **not** a direct UI model for TabulateAI. Thunderbolt is a general AI client with a much broader product surface. The useful takeaway is the seriousness of the conversation environment, not its overall feature breadth.

## Product Scope for V1

### In scope

- A run-scoped "Chat with your data" page
- Session list for a run
- Persistent thread history
- Streaming assistant responses
- Grounded lookup into existing run artifacts
- Inline data table cards with provenance
- Follow-up suggestions after data-backed responses
- Guardrails that repair unsupported dataset-specific claims before they reach the user

## Current Build State

### Implemented

- **Slice 0:** run-scoped analysis route, Convex persistence tables, session creation flow, empty-state workspace
- **Slice 1:** streaming chat shell, persisted user/assistant messages, loading and error states
- **Slice 2:** grounded lookup tools against run artifacts with inline grounded table cards
- analysis chat model selection is now isolated from the pipeline model path, so the analysis surface can use Anthropic while the pipeline remains on OpenAI/Azure

### Working now

- the analysis workspace route exists at `/projects/[projectId]/runs/[runId]/analysis`
- sessions persist and reload
- assistant responses stream into the thread
- simple run-specific questions can be answered from validated run artifacts
- inline table cards render in-thread and persist as analysis artifacts

### Still missing before V1 feels usable in-product

- Slice 4 polish: follow-up suggestions, tighter session UX, and lightweight feedback capture
- follow-up polish so the workspace feels productized rather than developer-accessible

### Explicitly out of scope for initial v1

- Dedicated chat worker
- Fresh R recuts or new statistical compute
- Chart generation
- Image upload
- Live web search inside the product
- Multi-run or project-wide analysis
- Generic "agent platform" features

### Near-term v1.1 candidates

- Async compute lane for recuts
- chart specs on top of grounded table results
- image attachments for screenshots/briefs
- resumable streams if long-running steps justify the extra storage complexity

## Core Decisions

### 1. Route shape

Use:

`/projects/[projectId]/runs/[runId]/analysis`

Reason:
- the artifacts are run-scoped
- provenance is run-scoped
- exportable/generated analysis artifacts should attach to a specific completed run
- the app already has run-scoped product routes under this segment

Do **not** use `/projects/[projectId]/analysis` for v1.

### 2. UI strategy

Use a **custom page** built from:
- Next.js App Router
- existing shadcn/Radix primitives
- `react-markdown` for assistant text rendering
- AI SDK transport/hooks for streaming and typed tool states

Do **not** bring in assistant-ui as a top-level dependency for the first build.

### 3. Data model

Add durable Convex tables now:
- `analysisSessions`
- `analysisMessages`
- `analysisArtifacts`

Do **not** add `analysisComputeJobs` in the first build slice.

This is the right middle ground:
- enough persistence to avoid rework
- no worker-specific schema before the compute lane exists

### 4. Guardrail model

Use a **two-lane answer policy**:

- `conversation lane`: the assistant can discuss methodology, implications, hypotheses, and next steps naturally
- `evidence lane`: when it makes dataset-specific claims, those claims must come from tool-grounded evidence

Enforce this with a backend post-pass:
- if the draft answer includes dataset-specific claims and grounding refs exist, allow it
- if the draft answer includes dataset-specific claims and grounding refs do not exist, run one repair pass
- the repair pass either removes unsupported specifics or forces a lookup-backed rewrite

Do **not** turn the primary prompt into a wall of restrictions.

### 5. Provenance model

For v1, keep provenance simple:
- `from_tabs`
- `assistant_synthesis`

Rendered behavior:
- table/result cards show `From your tabs`
- surrounding natural language does not wear a badge on every sentence
- citations/linked table refs are visible where the user actually needs trust signals

This is intentionally simpler than the four-way provenance taxonomy proposed in the older docs. We only need more classes once compute exists.

## V1 Architecture

```text
User message
  -> AI SDK chat endpoint
  -> Analysis agent
     -> grounded lookup tools against run artifacts
     -> assistant draft
     -> evidence/claim check
     -> optional repair pass
  -> streamed assistant message parts
  -> inline table/result cards
  -> persisted session/messages/artifacts
```

### Backend components

New modules:
- `src/app/api/runs/[runId]/analysis/route.ts`
- `convex/analysisSessions.ts`
- `convex/analysisMessages.ts`
- `convex/analysisArtifacts.ts`
- `src/lib/analysis/AnalysisAgent.ts`
- `src/lib/analysis/grounding/*.ts`
- `src/lib/analysis/claimCheck.ts`

New UI surface:
- `src/app/(product)/projects/[projectId]/runs/[runId]/analysis/page.tsx`
- `src/components/analysis/*`

### Reused modules

- [src/lib/r2/R2FileManager.ts](/Users/jasongraydon01/tabulate-ai/src/lib/r2/R2FileManager.ts)
- [src/lib/questionContext/adapters.ts](/Users/jasongraydon01/tabulate-ai/src/lib/questionContext/adapters.ts)
- [src/lib/excel/ExcelFormatter.ts](/Users/jasongraydon01/tabulate-ai/src/lib/excel/ExcelFormatter.ts)
- [src/components/ui/grid-loader.tsx](/Users/jasongraydon01/tabulate-ai/src/components/ui/grid-loader.tsx)
- [src/components/ui/info-tooltip.tsx](/Users/jasongraydon01/tabulate-ai/src/components/ui/info-tooltip.tsx)
- [src/app/globals.css](/Users/jasongraydon01/tabulate-ai/src/app/globals.css)

## Convex Schema Plan

### `analysisSessions`

Purpose: one durable conversation thread for one run.

Fields:
- `orgId`
- `projectId`
- `runId`
- `createdBy`
- `title`
- `status`: `active | archived`
- `createdAt`
- `lastMessageAt`

Indexes:
- `by_run`
- `by_org`
- `by_project`

### `analysisMessages`

Purpose: store the thread itself plus streamed assistant output after completion.

Fields:
- `sessionId`
- `orgId`
- `role`: `user | assistant | system`
- `content`
- `parts`: optional structured summary of rendered tool/result parts
- `groundingRefs`: optional array of source refs used in the answer
- `agentMetrics`: optional model/tokens/duration
- `createdAt`

Indexes:
- `by_session_created`

### `analysisArtifacts`

Purpose: durable rendered outputs from the chat surface.

Fields:
- `sessionId`
- `orgId`
- `projectId`
- `runId`
- `artifactType`: `table_card | note`
- `sourceClass`: `from_tabs | assistant_synthesis`
- `title`
- `sourceTableIds`
- `sourceQuestionIds`
- `payload`
- `createdBy`
- `createdAt`

Indexes:
- `by_session`
- `by_run`

### Why this model is enough for v1

It solves the important product problems:
- users can revisit threads
- rendered tables are durable
- we have a place to hang provenance and future actions
- we can later add compute-job linkage without discarding this model

## Grounding Layer

The grounding layer should read from **existing pipeline artifacts**, not the raw `.sav`.

Primary inputs:
- `results/tables.json`
- `enrichment/12-questionid-final.json`
- `planning/21-crosstab-plan.json`
- optional run metadata from Convex

### V1 tools

#### `searchRunCatalog`

Purpose:
- resolve fuzzy user requests like "satisfaction", "brand preference", "female", "region"
- return candidate tables/questions/cuts

Input:
- free-text query

Output:
- top matching question ids
- top matching table ids
- cut names/group names when relevant

#### `getTableCard`

Purpose:
- return a renderable subset of an existing table from `results/tables.json`

Input:
- `tableId`
- optional row filter
- optional cut filter
- optional value mode

Output:
- title
- rows
- columns
- bases
- significance info
- source refs for citation

#### `getQuestionContext`

Purpose:
- give the model richer context about a question without forcing it to inspect raw artifacts

Input:
- `questionId`

Output:
- question text
- type/subtype
- items/value labels
- loop/base context

#### `listBannerCuts`

Purpose:
- help with follow-up suggestions like "break this down by age"

Input:
- optional filter

Output:
- available banner groups and cuts for the run

### What we should not do in v1

- no universal artifact indexer
- no generic code-execution tool
- no raw `.sav` querying
- no free-form compute planner

The first version should prove that high-quality conversational analysis is already possible with the validated outputs we have.

## Guardrails Without Killing the Experience

This is the most important product behavior decision.

### Bad version

"You may only answer from the data. If not found, refuse."

This makes the product feel worse than ChatGPT or Claude immediately.

### Good version

The assistant behaves naturally, but the backend distinguishes between:
- conversational reasoning
- dataset-specific claims

### V1 claim-check algorithm

1. The assistant drafts a response with or without tools.
2. The backend inspects the draft for likely dataset-specific claims:
   - percentages
   - counts
   - significance language
   - explicit table/question references
   - claims about differences between segments
3. If no such claims appear, return the answer normally.
4. If such claims appear and there are valid `groundingRefs`, return the answer normally.
5. If such claims appear and grounding is missing, run a repair pass:
   - remove unsupported specifics
   - or rewrite using tool lookups

### User-facing behavior

The user sees:
- natural prose
- inline table cards when the assistant actually looked something up
- trustworthy follow-ups

The user should **not** see:
- repetitive disclaimers
- constant warnings
- visible "classifier" language

## UI Plan

### Page layout

Desktop:
- left: optional session list rail
- center: thread
- bottom: prompt composer
- right: optional collapsible evidence/detail drawer in later slices

Mobile:
- thread first
- session switcher in header or sheet
- composer pinned at bottom

### Primary components

- `AnalysisHeader`
- `SessionList`
- `AnalysisThread`
- `AnalysisMessage`
- `ToolStatusInline`
- `TableResultCard`
- `PromptComposer`
- `FollowUpChips`

### Visual direction

Follow the existing design system in the current codebase:
- `Fraunces` for display
- `Outfit` for interface/body
- `JetBrains Mono` for values, bases, and labels
- existing `tab-*` accent tokens from [src/app/globals.css](/Users/jasongraydon01/tabulate-ai/src/app/globals.css)

Do **not** copy the styling assumptions in the older Phase 15 frontend memo where the token names and typography were stale.

### Message behavior

User messages:
- compact, right-aligned
- visually secondary

Assistant messages:
- full width available
- optimized for mixed prose + structured result cards

Tool status:
- subtle inline loader using the existing `GridLoader`
- human-readable copy only
- no internal tool names shown

### Data presentation

The most important UI element is the inline table card.

Requirements:
- title
- provenance badge: `From your tabs`
- clean row/column layout
- bases visible
- significance markers preserved
- copy/export later, but not required for slice 1

Use the deprecated [src/components/table-review/TableGrid.tsx](/Users/jasongraydon01/tabulate-ai/src/components/table-review/TableGrid.tsx) as a **reference for table structure only**, not as an active component to revive.

### Follow-up suggestions

Only show after grounded data responses.

Examples:
- `Break this down by age`
- `Show significance notes`
- `Which cuts are most different?`

These should come from server-generated suggestions based on the grounded result, not generic canned prompts.

## API Plan

### `POST /api/runs/[runId]/analysis`

Responsibilities:
- authenticate with `requireConvexAuth()`
- rate limit with `applyRateLimit()`
- verify org ownership of project/run/session
- load the relevant analysis session and prior messages
- run the analysis agent with grounded tools
- stream the response through AI SDK UI message protocol
- persist the completed assistant message and any emitted artifacts

Suggested rate limit tier:
- `high`

### Future route

`GET /api/runs/[runId]/analysis/sessions/[sessionId]`

This can be added if the page needs explicit server fetching beyond Convex subscriptions.

## Dependency Plan

Likely additions:
- `@ai-sdk/react`

Already present and reusable:
- `ai`
- `react-markdown`
- existing shadcn/Radix stack

Not needed in the first implementation slice:
- `assistant-ui`
- `recharts`
- resumable stream storage

## Harness Alignment Notes

After Slices 0–2 shipped, the remaining plan was pressure-tested against the 2025 consensus on agentic-chat harnesses — tool design, loop control, context management, grounding and citations, injection safety, prompt caching, observability. The review confirmed the core direction is on the right side of current practice: orthogonal tools, an inspect-vs-act tool split (`viewTable` / `getTableCard`), structured error returns over throws, streamed reasoning display, provider-isolated model selection, per-turn traces, and a structured prompt with delimited sections.

The review also surfaced additions worth folding into the remaining slices so the product stands up against what users now expect from ChatGPT, Claude.ai, and comparable platforms:

- structured per-claim citations — folded into **Slice 3**
- tool-output injection hardening — folded into **Slice 3**
- tool-call deduplication and stuck-loop detection — new **Slice 3.5**
- prompt-cache behavior audit for Anthropic — new **Slice 3.5**
- feedback capture on assistant messages — folded into **Slice 4**
- context compaction policy for long sessions — new **Slice 6** (late-phase)

Items considered and deliberately deferred beyond v1:

- a dedicated eval harness for grounding fidelity — acknowledged as the right long-term investment, but a cross-cutting concern across the entire pipeline rather than something analysis-specific. Revisit once the product has real users and regressions actually start to matter.
- resumable streams, mid-stream interjection, TodoWrite-style task tracking, subagent patterns, tool-search / progressive disclosure of tools, and model routing for main synthesis — all legitimate 2025 patterns, but none are felt gaps at our current tool count, session length, or cost profile.

These additions are flagged at the slice level below with **Harness alignment note:** markers so future slices know which items came from this review and why.

## Slice-by-Slice Build Plan

### Slice 0: Schema and route scaffolding

Status: Implemented

Deliver:
- Convex tables for sessions/messages/artifacts
- run-scoped analysis page route
- empty-state UI

Exit criteria:
- user can open `/projects/[projectId]/runs/[runId]/analysis`
- create/select a session
- no AI yet

### Slice 1: Streaming chat shell

Status: Implemented

Deliver:
- AI SDK chat transport
- assistant message rendering
- persistent user/assistant messages
- loading and error states

Exit criteria:
- natural conversation works
- messages persist across refresh
- no grounded table tools yet

### Slice 2: Grounded lookup tools

Status: Implemented

Deliver:
- `searchRunCatalog`
- `getTableCard`
- `getQuestionContext`
- `listBannerCuts`

Exit criteria:
- assistant can answer simple run-specific questions from actual artifacts
- inline table cards render in-thread

### Intermediate step before Slice 3: Surface the analysis workspace

Status: Implemented

Deliver:
- visible CTA or navigation path from the main run/project UI into `/projects/[projectId]/runs/[runId]/analysis`
- copy and status handling that makes it obvious when analysis is available for a run
- enough discoverability that the workspace can be exercised and critiqued before trust-layer work continues

Exit criteria:
- a user can reach the analysis workspace naturally from the product without typing the URL
- Jason can start using the real analysis surface to tune UX and interaction flow

The "Chat with your data" CTA on the project page (`src/app/(product)/projects/[projectId]/page.tsx`) routes the user into the analysis workspace for the latest eligible run.

### Slice 3: Trust layer — evidence panel, claim-check, injection hardening

Status: Completed in simplified v1 form

Deliver:
- dataset-claim detection on the assistant's draft response
- a repair pass that either strips unsupported numeric specifics or forces a lookup-backed rewrite
- a message-level evidence panel that links grounded numeric answers back to the originating table card or contextual source without cluttering prose
- `groundingRefs` persisted on assistant messages at message level so the trust decision is auditable and available to future UI
- tool-output injection hardening: retrieved tool text is sanitized before re-entering model context, tool outputs carry a sanitized XML-delimited retrieved-context envelope for model-side handling, and control-token / system-prompt-lookalike patterns in survey verbatims and labels are stripped
- render/persistence allowlists so only approved analysis tool parts and run-scoped artifacts survive into the thread UI

Exit criteria:
- unsupported numerical answers are revised before display
- methodology conversation remains natural — no wall of disclaimers
- numeric answers expose visible evidence links through the message evidence panel
- survey free-text containing injection-shaped strings cannot redirect tool use or system behavior

Harness alignment note: for v1 we are intentionally choosing a lighter trust presentation than full per-claim inline citations. The evidence panel keeps trust signals available at the message level without turning every grounded answer into citation-heavy prose. Tool-output injection hardening still addresses the primary attack vector for grounded-chat agents — untrusted content flowing back into the model context through retrieval — and remains part of the core Slice 3 contract.

### Backlog: Harness robustness checkpoints (formerly Slice 3.5)

Status: Optional follow-on backlog. Not required before Slice 4.

Deliver:
- tool-call deduplication within a single turn — identical tool + args returns the cached prior result rather than re-running
- stuck-loop detection — a nudge or forced-synthesis turn when the agent calls the same tool with near-identical args multiple times in a row
- prompt-cache behavior audit for Anthropic: verify the system prompt + tool definitions are byte-stable across turns within a session, confirm cache hits via API response headers, and document what invalidates the cache for future prompt changes
- revisit the `stopWhen: stepCountIs(12)` budget against real turn traces; tighten toward the 5–8 range if turns do not use the headroom

Exit criteria:
- traces show no duplicate tool calls within a turn for identical args
- repeat-pattern nudges land in-context when they apply
- measurable cache hit rate across multi-turn sessions
- step budget calibrated to observed usage

Harness alignment note: tool-call dedup and stuck-loop detection are standard 2025 chat-harness guards that research calls out specifically for chat agents, which have lower silence tolerance than coding agents. The prompt-cache audit is a one-shot verification that often uncovers easy cost wins within the 5-minute Anthropic TTL.

### Slice 4: Session polish and feedback capture

Status: High-level follow-on after Slice 3 / 3.5

Deliver:
- session titles
- follow-up suggestions after grounded responses
- cleaner thread list
- better empty states and inline status copy
- feedback capture on assistant messages: thumbs up / down plus an optional inline correction ("this number is wrong — it should be X"), persisted per assistant message

Exit criteria:
- analysis surface feels productized, not experimental
- user feedback is captured per assistant message and inspectable per run / session

Harness alignment note: feedback capture is cheap UX that gives us ground truth on grounding failures and will feed any future evaluation work. Adding it here means we accumulate signal before we need it, rather than retrofitting once regressions become a real problem.

### Slice 5: Durable artifact polish

Status: High-level follow-on

Deliver:
- richer `analysisArtifacts`
- copy / export hooks for table cards
- artifact-focused references in the UI

Exit criteria:
- the assistant's structured outputs feel reusable, not ephemeral

### Slice 6: Context compaction policy

Status: Late-phase. Policy work happens after the rest of v1 is stable; implementation may or may not land within Phase 15 depending on scope at that point.

Deliver:
- a written compaction policy covering: utilization threshold at which summarization kicks in, what stays verbatim (recent N turns + rendered table cards + any session-level user preferences), what gets dropped vs. collapsed into structured summaries, and how `groundingRefs` on older turns are preserved through compaction
- an implementation only if the policy resolves cleanly and the change stays contained; otherwise ship the policy document and defer the code

Exit criteria:
- long sessions (40+ turns) do not risk context-window exhaustion
- compaction — when it runs — preserves enough context that the assistant remains coherent across turns
- policy is documented even if implementation is deferred

Harness alignment note: coding agents get natural context resets per task; chat agents do not. Deciding this policy before sessions actually grow long avoids a migration later. Leaving it until the tail of Phase 15 is a deliberate choice: we want real session-length data before we freeze the policy.

### Slice 7: Compute-lane design checkpoint

Status: Deliberately deferred

Deliver:
- decision memo after actual usage of slices 1–5

Questions to answer before building compute:
- how often do users ask for unavailable cuts?
- how often do users want charts?
- do they need recuts often enough to justify a dedicated queue immediately?

## Open Questions

1. Should the analysis page be visible only for completed runs, or also partial runs with `results/tables.json` present?
2. Should we allow session creation from the project page as a CTA, or only from the run-scoped page?
3. Do we want one default session per run initially, or explicit multi-session support from day one?
4. Should the first assistant reply offer a run-aware starter prompt list automatically?

## Recommended Next Step

**Slice 4 — session polish and feedback capture.**

The trust layer is now in place in a simpler v1 shape: claim-check + repair, message-level grounding refs, an evidence panel for grounded answers, and tightened tool-output hardening. The next useful work is productizing the session experience rather than adding heavier citation machinery.

Slice 4 should deliver:
- session titles and thread-list cleanup
- follow-up suggestions after grounded responses
- better empty states and inline status copy
- lightweight per-message feedback capture for correction signals

Exit criteria:
- the analysis surface feels productized rather than experimental
- follow-up paths are obvious after grounded answers
- message-level user feedback is captured per assistant response and inspectable per run/session

The former Slice 3.5 workstream remains a valid hardening follow-on when we want tighter loop control and cache verification, but it is explicitly backlog now rather than a numbered prerequisite in the delivery path.

## Sources Consulted

- [Thunderbolt GitHub repo](https://github.com/thunderbird/thunderbolt)
- [Thunderbolt architecture doc](https://github.com/thunderbird/thunderbolt/blob/main/docs/architecture.md)
- [AI SDK docs](https://ai-sdk.dev/docs/introduction)
- [AI SDK chatbot tool usage](https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-tool-usage)
- [AI SDK chatbot resume streams](https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-resume-streams)
- [assistant-ui docs](https://www.assistant-ui.com/docs)
- [assistant-ui LocalRuntime docs](https://www.assistant-ui.com/docs/runtimes/custom/local)
