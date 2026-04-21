# Phase 15 V1 Implementation Plan — Chat With Your Data

**Status:** Slices 0–4 shipped. Slice 5 (artifact polish) and Slice 6 (context compaction) are the remaining v1 work. Slice 3.5 (harness robustness) and Slice 7 (compute-lane checkpoint) are deliberate backlog.

**Purpose:** Run-scoped conversational analysis on top of verified pipeline artifacts. Live at `/projects/[projectId]/runs/[runId]/analysis`.

**Background:**
- `/Users/jasongraydon01/.claude/plans/polymorphic-beaming-raven.md` (backend)
- `/Users/jasongraydon01/.claude/plans/vivid-shimmying-lobster.md` (UI/UX)
- [docs/v3-roadmap.md](/Users/jasongraydon01/tabulate-ai/docs/v3-roadmap.md) — Phase 15

## Shape of the Product

A custom surface built on the AI SDK, using TabulateAI's existing routing, auth, Convex, and design primitives. Not an off-the-shelf chat UI. No dedicated chat worker in v1. No new compute — the assistant reads verified pipeline artifacts only.

Two-lane answer policy:
- **Conversation lane** — methodology, interpretation, hypotheses, next steps flow naturally.
- **Evidence lane** — dataset-specific claims (percentages, counts, significance language, explicit table refs) must come from tool-grounded evidence. A backend post-pass enforces this with claim detection + repair.

Provenance is intentionally simple for v1: `from_tabs` vs `assistant_synthesis`. Richer taxonomies wait until a compute lane exists.

## Current Build State

### Shipped

**Route + API** — [src/app/api/runs/[runId]/analysis/route.ts](/Users/jasongraydon01/tabulate-ai/src/app/api/runs/[runId]/analysis/route.ts)
- `requireConvexAuth()` + `applyRateLimit(..., "high", ...)`
- Streams via AI SDK `streamText` → `toUIMessageStream()`
- Session creation/list/delete routes under `/api/runs/[runId]/analysis/sessions`
- Per-message feedback route under `/api/runs/[runId]/analysis/messages/[messageId]/feedback`

**Backend** (`src/lib/analysis/`)
- `AnalysisAgent.ts` — streaming orchestration with grounded tools + scratchpad tool
- `grounding.ts` — four tools against run artifacts: `searchRunCatalog`, `getTableCard`, `getQuestionContext`, `listBannerCuts`. Reads `results/tables.json`, `enrichment/12-questionid-final.json`, `planning/20-banner-plan.json`, `planning/21-crosstab-plan.json`. Tool output is sanitized and wrapped in an XML-delimited retrieved-context envelope before re-entering model context.
- `claimCheck.ts` — detects numeric/significance/table-ref claims in the assistant draft; runs a repair pass when grounding refs are missing; builds grounding refs; injects table cards into the final message.
- `followups.ts` — deterministic follow-up suggestions based on rendered table cards and available banners. Only emitted on grounded responses.
- `renderAnchors.ts` — handles `[[render-table]]` anchors emitted by the assistant so table cards land at the right point in the streamed prose.
- `persistence.ts` / `messages.ts` — UIMessage ↔ Convex round-trip; render/persistence allowlist for tool parts; artifact creation for table cards.
- `title.ts` — session title generated from first assistant response; `titleSource` tracks `default | generated | manual`.
- `trace.ts` / `scratchpad.ts` — per-turn traces written to R2 under `project/run/analysis/`.
- `model.ts` — analysis model selection (Anthropic) isolated from the pipeline model path. Do not merge back without explicit reason.

**Convex** (`convex/schema.ts` lines 357–431)
- `analysisSessions` — adds `title`, `titleSource`, `status`, `lastMessageAt`.
- `analysisMessages` — `parts`, `groundingRefs`, `followUpSuggestions`, `agentMetrics`.
- `analysisArtifacts` — `artifactType`, `sourceClass`, `payload`, `sourceTableIds`, `sourceQuestionIds`.
- `analysisMessageFeedback` — `vote` (`up | down`) + optional `correctionText`, keyed by `(messageId, userId)`.

**UI** (`src/components/analysis/`)
- `AnalysisWorkspace.tsx` — session list rail + thread + composer.
- `AnalysisSessionList.tsx` — create/rename/delete sessions.
- `AnalysisThread.tsx` — scroll-to-latest, message ordering.
- `AnalysisMessage.tsx` — streamed markdown, reasoning disclosure, evidence panel for grounded answers, deterministic follow-up chips, thumbs up/down + optional correction text.
- `GroundedTableCard.tsx` — `From your tabs` badge, bases, significance markers, column groups. Inert in v1 (no copy/export).
- `PromptComposer.tsx`, `AnalysisEmptyState.tsx`, `AnalysisTitleBadge.tsx`.

**Discoverability** — `src/app/(product)/projects/[projectId]/page.tsx` surfaces a "Chat with your data" CTA for runs with analysis-eligible artifacts.

**Tests** — backend suites under `src/lib/analysis/__tests__/` cover AnalysisAgent, claimCheck, followups, grounding, messages, model, persistence, renderAnchors, scratchpad, trace. UI suites under `src/components/analysis/__tests__/` cover message rendering, session list, thread scroll, and grounded table card.

### Not yet shipped

- **Slice 5** — artifact copy/export hooks on table cards; artifact-focused references in the UI.
- **Slice 6** — written context compaction policy for long sessions; implementation if it stays contained.
- **Slice 3.5 backlog** — tool-call dedup within a turn, stuck-loop detection, Anthropic prompt-cache audit, step-budget recalibration.
- **Slice 7 backlog** — compute-lane design checkpoint, informed by actual usage.

### Out of scope for v1

- Dedicated chat worker
- Fresh R recuts or new statistical compute
- Chart generation
- Image upload
- Live web search
- Multi-run or project-wide analysis

## Route Shape

`/projects/[projectId]/runs/[runId]/analysis`

Artifacts, provenance, and exportable analysis outputs are all run-scoped, so the surface is run-scoped too.

## Convex Schema (as shipped)

### `analysisSessions`
`orgId`, `projectId`, `runId`, `createdBy`, `title`, `titleSource`, `status`, `createdAt`, `lastMessageAt`. Indexes: `by_run`, `by_org`, `by_project`.

### `analysisMessages`
`sessionId`, `orgId`, `role` (`user | assistant | system`), `content`, `parts`, `groundingRefs`, `followUpSuggestions`, `agentMetrics`, `createdAt`. Index: `by_session_created`.

### `analysisArtifacts`
`sessionId`, `orgId`, `projectId`, `runId`, `artifactType` (`table_card | note`), `sourceClass` (`from_tabs | assistant_synthesis`), `title`, `sourceTableIds`, `sourceQuestionIds`, `payload`, `createdBy`, `createdAt`. Indexes: `by_session`, `by_run`.

### `analysisMessageFeedback`
`orgId`, `projectId`, `runId`, `sessionId`, `messageId`, `userId`, `vote`, `correctionText`, `createdAt`, `updatedAt`. Upsert per `(messageId, userId)`. Indexes: `by_session_user`, `by_message_user`.

## Grounding Tools

All tools read existing pipeline artifacts. No raw `.sav` access, no universal artifact indexer, no free-form compute.

- **`searchRunCatalog`** — fuzzy resolve ("satisfaction", "female", "region") to candidate question/table ids.
- **`getTableCard`** — renderable subset of an existing table with bases, significance info, source refs.
- **`getQuestionContext`** — question text, type/subtype, items/value labels, loop/base context.
- **`listBannerCuts`** — available banner groups/cuts for follow-ups like "break this down by age".

## Trust Layer (Slice 3 — shipped)

1. Assistant drafts a response with or without tools.
2. Backend scans the draft for dataset-specific claims: percentages, counts, significance language, explicit table/question refs, segment-difference claims.
3. No such claims → return normally.
4. Claims + valid grounding refs → return normally.
5. Claims + missing grounding → repair pass: strip unsupported specifics or rewrite with tool lookups.

User sees:
- natural prose
- inline table cards only when the assistant actually looked something up
- a message-level evidence panel linking grounded numeric answers back to originating table cards
- trustworthy follow-ups on grounded responses

User does not see repetitive disclaimers, constant warnings, or classifier language.

Injection hardening: retrieved tool text is sanitized before re-entering model context, wrapped in an XML-delimited retrieved-context envelope; control-token / system-prompt-lookalike patterns in survey verbatims and labels are stripped; render and persistence allowlists ensure only approved tool parts and run-scoped artifacts survive into the thread UI.

## Slice 4 (shipped)

- Session titles generated from the first assistant response; manual rename supported; `titleSource` tracks provenance.
- Deterministic follow-up suggestions rendered as chips after grounded responses only.
- Per-message feedback: thumbs up/down plus optional inline correction text, persisted in `analysisMessageFeedback` and inspectable per run/session.
- Cleaner thread list, tighter empty states, smoother streamed markdown, anchored table placement via `renderAnchors.ts`.

## Remaining v1 Work

### Slice 5 — Durable artifact polish

- Copy / export hooks on table cards
- Artifact-focused references in the UI
- Richer artifact metadata when it unlocks concrete UI

Exit: the assistant's structured outputs feel reusable, not ephemeral.

### Slice 6 — Context compaction policy

Late-phase. Policy first, implementation only if it stays contained.

- Utilization threshold at which summarization kicks in
- What stays verbatim: recent N turns + rendered table cards + session-level user preferences
- What gets dropped vs. collapsed into structured summaries
- How `groundingRefs` on older turns are preserved through compaction

Exit: long sessions (40+ turns) do not risk context-window exhaustion; policy documented even if implementation is deferred.

## Backlog (not prerequisites)

### Slice 3.5 — Harness robustness

- Tool-call deduplication within a single turn (identical tool + args returns cached prior result)
- Stuck-loop detection (nudge or forced-synthesis turn when the agent repeats the same tool+args)
- Anthropic prompt-cache audit: verify system prompt + tool definitions are byte-stable across turns within a session, confirm cache hits via API response headers, document what invalidates the cache
- Revisit `stopWhen: stepCountIs(12)` against real turn traces

### Slice 7 — Compute-lane design checkpoint

Decision memo after real usage. Questions to answer:
- how often do users ask for unavailable cuts?
- how often do users want charts?
- do recuts justify a dedicated queue?

## Open Questions

1. Should the analysis page be visible only for completed runs, or also partial runs with `results/tables.json` present?
2. Do we want one default session per run initially, or explicit multi-session support from day one?
3. Should the first assistant reply offer a run-aware starter prompt list automatically?

## Recommended Next Step

**Slice 5 — durable artifact polish.** Table cards are already rendered and persisted; the next useful lift is making them reusable (copy, export, reference) so the conversation produces keepable artifacts, not just ephemeral answers. Slice 6 (compaction policy) follows once we have real session-length data.

## Sources Consulted

- [AI SDK docs](https://ai-sdk.dev/docs/introduction) — chatbot tool usage, resumable streams
- [assistant-ui docs](https://www.assistant-ui.com/docs) — used as primitives reference, not adopted as surface
- [Thunderbolt](https://github.com/thunderbird/thunderbolt) — reference for thread-first layout and serious-conversation feel
