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

## Remaining v1 Work — Two Parallel Tracks

The remaining v1 work splits into two tracks that can progress independently. Track A is fit-and-finish and has been shipping steadily alongside outreach. Track B is deeper, needs deliberate design before implementation, and carries most of the "feels like an analysis partner" weight.

### Track A — Interface polish (active)

Small, tight UX fixes against real usage. Low blast radius, no model behavior changes.

Recently shipped:
- Grounded table card decoupled from render filter — `getTableCard` now carries every USED cut; `focusedCutIds` is a presentation hint; expand button is no longer truncation-gated; Details disclosure and Expand dialog both surface the full cut set, with focused groups ordered right after Total.
- Follow-up chips hidden unless the user is idle at the tail assistant message (not just disabled).
- `GENERATED` title pill removed from session cards and thread header.
- In-session empty state rewritten to centered-serif treatment matching the no-sessions empty state.
- Reasoning summaries now stream on the OpenAI/Azure analysis path (routed through the Responses API instead of Chat Completions so `reasoningSummary` is actually honored).
- Copy action on user and assistant messages — `navigator.clipboard.writeText`, sonner toast, icon flips to a check for 1.5s after success. Hidden on assistant messages while streaming so partial prose doesn't get copied.

Outstanding under this track, in rough priority order:

1. **Edit user message** — click-to-edit on any user message; saving truncates the thread after that point and resends the edited text. Convex work: new `truncateAndResend` mutation that deletes subsequent `analysisMessages` + their `analysisArtifacts` + their `analysisMessageFeedback` records atomically. In-flight streaming turn must be stopped before truncation. Feedback and artifacts tied to deleted assistant turns should be cleaned up, not orphaned.
2. **Slice 5 — Durable artifact polish.** Copy / export hooks on table cards, artifact-focused references, richer artifact metadata when it unlocks concrete UI. Exit: structured outputs feel reusable, not ephemeral. Conceptually a sibling of the message-level copy action that shipped — both make the conversation's outputs keepable.
3. **Ongoing fit-and-finish** as real usage surfaces friction. Don't pre-design — ship as it surfaces.

### Deferred from Track A: abandoned-session cleanup

Originally queued as a Track A polish item ("if a user clicks New Chat and walks away, don't leave an empty session"). Rejected the quick-and-dirty approach (server-side cron sweep of sessions with zero messages) because it would leave ghost sessions flickering in the sidebar for the sweep window and doesn't match how users expect chat apps to behave. ChatGPT and Claude don't create a session record until the first user message is actually sent — the "New Chat" button just opens a blank composer in-place.

The right implementation:

1. Introduce a draft-session UI path. URL has no `sessionId`; `AnalysisThread` mounts in a "no selected session" mode where Convex queries skip and messages start empty. Composer stays enabled.
2. "New Chat" button stops calling `handleCreateSession` — it just navigates to the analysis route with no `sessionId`.
3. Composer submit becomes: if no `sessionId`, call the create-session mutation, get the new id, update the URL, then send the message against the new id. Race to watch: `useChat({ id })` transitions from draft key to real sessionId mid-flow and the first turn's streaming must not drop.
4. Optionally: make the API atomic server-side — `POST /api/runs/[runId]/analysis` accepts an optional `sessionId`; if absent, it creates the session + first message in one call. Cleaner but bigger surface change.

Estimated effort: 2–3 hours of careful work, not a polish tweak. Deferred as its own small slice rather than forcing it into Track A or accepting the cron band-aid. Pick up when a batch of session-related work makes sense, or when the ghost-session problem actually surfaces in real use.

Touchpoints when we implement it: `AnalysisWorkspace.tsx` (`handleCreateSession`, `selectedSession` derivation, URL handling), `AnalysisThread.tsx` (draft mode, `useChat` keying), `AnalysisEmptyState.tsx` (may simplify to "just let them type"), `src/app/api/runs/[runId]/analysis/route.ts` (optional atomic create-and-send shape), `convex/analysisSessions.ts` (mutation contract).

### Chat sharing (new standalone slice candidate — not Track A polish)

Being able to share a chat with a teammate is high-value and has come up as "feels pretty important," but it is a new product surface rather than fit-and-finish, so it gets its own slice. Key design decisions before implementation:

- **Auth shape.** Public read-only links bypass `requireConvexAuth` — need a share-token scheme on `analysisSessions` with revocation + optional expiration.
- **Payload boundary.** A shared session references grounded artifacts (`results/tables.json`, banner plan, question metadata) that are org-scoped in R2. Two options: (a) inline the rendered table cards into the share payload so the share is self-contained; (b) punch a scoped read-only hole for the referenced artifacts. (a) is safer and the current artifact model already stores rendered table cards in Convex, so most of the inline payload already exists.
- **Viewer UI.** Read-only renderer — no composer, no feedback, no edit, no delete. Existing `AnalysisMessage` component should be reusable with action props omitted.
- **Evidence links in shared view.** They currently link back into the originating run's analysis workspace. Shared viewers can't follow those — design the fallback (inline expansion? disabled state with tooltip?).
- **Governance.** Who can share — any org member, or admins only? Does sharing leave an audit trail? Does the session owner see who has viewed?

Worth treating as a named slice with a short design note before code. Not a prerequisite for v1 exit, but a concrete candidate once the current Track A queue is cleared.

### Track B — Prompt intentionality + analytical depth (deferred, design first)

The piece that pushes the surface from "grounded Q&A" toward "analysis partner." Four sub-areas that reinforce each other, plus one cross-cutting observation worth flagging so it doesn't get lost:

**1. Prompt workflow and intentionality.** The analysis prompt today is a tool-usage protocol plus a trust contract. It does not ask the agent to think about what the user is actually after before it starts calling tools. Borrow from the V3 pipeline agents: give it an explicit internal workflow — classify the request (exploration / synthesis / methodology / narrow lookup / follow-up on prior evidence), write down a one-line goal, decide what scope is sufficient, then act.

Concrete friction this would address, observed in real sessions:
- Agent refusing to summarize grounded evidence that is already in-thread ("I need a supporting table card") — see sub-area 2 for the root cause; the prompt-side fix is teaching the agent to recognize synthesis-of-prior-evidence as a legitimate request shape.
- Over-matching `cutFilter` — user says "primary bank," agent pulls a separate "bank type" cut because the word "bank" matched both.
- Agent rendering more cuts than the user's question justified, instead of picking the one that answers it.

**Acknowledgment-before-work pattern.** Part of the workflow design, worth calling out separately. Claude's hosted agents lead with a one-sentence acknowledgment ("Let me pull the age breakdown first") before making tool calls, then stream the final answer. It's not a tool — it's just the model emitting a text part, then tool-call parts, then more text parts; the AI SDK surfaces them in order and our UI already renders interleaved text + tool parts correctly. The value is twofold: (a) the user sees immediate confirmation the agent understood the ask, and (b) the user can hit stop if the stated plan is wrong, before we spend tool calls and tokens. This is cheap prompt-side work once the workflow design lands.

The prompt does not have to stay at its current length. It might grow; it might also shrink once intentionality is expressed as a workflow rather than as a wall of constraints.

**2. Agent context optimality — what the agent sees, and when.** The current turn transport is lossy in both directions and we have not been deliberate about it. Design a policy before we pile more capabilities on top of it.

What the agent sees *today*:
- On the turn it calls `viewTable` / `getTableCard`: the full `AnalysisTableCard` payload (every USED cut, every row × cut cell, full metadata). See `grounding.ts`.
- On every subsequent turn: **tool outputs are stripped**. `getSanitizedConversationMessagesForModel` in `src/lib/analysis/messages.ts` keeps only text parts before `convertToModelMessages`. Prior table cards, prior catalog searches, prior question-context lookups — all dropped from model context. The UI thread still has them (rehydrated from `analysisArtifacts`) and the claim-check post-pass still uses them via `priorTableArtifacts`, but the *model itself* is blind to prior tool results.

Why stripping exists: (a) cost — a single card can be 5–30KB and carrying every prior card across turns grows context linearly with session length; (b) determinism — forces re-fetch through grounded tools, preserving lookup discipline; (c) prompt-cache safety — variable-size tool outputs in the transcript would invalidate the Anthropic prompt cache every turn.

Why it hurts: the agent cannot synthesize across its own prior evidence without re-calling tools, which manifests as the "I need a supporting card" refusal Jason hit. Tool-call history is also absent, so the agent cannot see what it already tried and has to rediscover dead ends. More broadly, we have not asked "what is the minimum set of prior context the agent needs to answer well?" — we just default to text-only. There is a lot of room between "drop everything" and "carry everything."

Design options in scope when this slice opens (not decided):
- Compact text summary of each prior table card (title, cuts present, rows present, a handful of key values) injected into the conversation — the agent knows what's available without carrying full payloads. Cheap, cache-friendly.
- A system-level card inventory injected per turn listing `artifactId`s + titles of cards rendered earlier so the agent can re-`viewTable` them deliberately instead of re-searching.
- Full pass-through within a rolling window (last 3–5 turns) + summarization for older turns. Higher cost, simpler agent behavior.
- Tool-call history summarization — a short trace of "already tried X with args Y, got Z" so the agent doesn't re-search.
- Any combination of the above, gated on session length.

This sub-area shares design DNA with Slice 6 (context compaction policy). They should be worked as one policy document, not two.

**3. Tool surface review — what the agent should have, and what's redundant.** The tool set has grown organically. Before we add more tools in sub-area 4, audit what's there. Two candidate redundancies to open the conversation with:

- **Scratchpad tool vs. reasoning summaries.** The scratchpad tool (`createAnalysisScratchpadTool` in `src/lib/analysis/scratchpad.ts`) exists so the agent can write private notes that get captured in the trace. Now that the analysis model routes through the OpenAI Responses API and surfaces streamed reasoning summaries (and Anthropic already surfaces thinking), the scratchpad may be redundant — reasoning summaries cover the same observability role without the agent having to choose to call a tool. Worth deciding whether to keep it, remove it, or reserve it for a narrower purpose.
- **`viewTable` vs. `getTableCard`.** Same payload, different side effect (render or not). The two-tool shape is a prompt-level affordance — inspect before render. Worth asking whether one tool with a render flag is clearer, or whether the split is what's keeping the agent from speculative rendering. Neutral on the answer; flagging as review-worthy.

The broader question: which tools give the model *too much* context (bloated tool definitions inflate every turn's system prompt, hurting prompt-cache stability and attention) and which are load-bearing? A pass against real turn traces — what the agent actually uses, what it ignores, what it misuses — would tell us. This is a near-zero-code review exercise that should inform the prompt-workflow design note before anything ships.

**4. Analytical capability expansion.** More tools, so the agent can actually *help* rather than only read. None of these ship in v1, but they belong in the design space so we don't paint ourselves into a corner with the current grounding layer.

- Building new cuts on the fly when the banner doesn't carry one the user asked for (the "what about gender?" case).
- Expanding cuts — compute combinations the crosstab pipeline didn't emit.
- Generating NETs from the data when grouping sharpens the answer.
- Other derived-table patterns from Phase 10b that the assistant might reasonably produce conversationally.

These cross into the compute-lane design checkpoint (Slice 7) — they can't ship without it — so the design conversation is one conversation, not two.

### Cross-cutting observation: reasoning summaries in the pipeline

The V3 pipeline agents (`VerificationAgent`, `CrosstabAgentV2`, `LoopSemanticsPolicyAgent`, etc.) currently do not capture reasoning summaries, even though they run on reasoning models. Now that we have the OpenAI Responses API plumbing working on the analysis path, the same fix mechanically applies to the pipeline: switch `.chat()` → `.responses()` on reasoning-capable models, enable `reasoningSummary`, and the summaries would flow into agent metrics / traces. Not Phase 15 work, not Track B strictly — flagging here so it doesn't get lost when we think about observability improvements across the stack.

### Slice mapping against the tracks

| Slice | Track | Status |
|-------|-------|--------|
| 5 — Durable artifact polish | A | Outstanding, opportunistic |
| 6 — Context compaction policy | B (sub-area 2) | Merge with the agent-context-optimality design note — one policy covers both |
| 3.5 — Harness robustness (dedup, stuck-loop, cache audit) | B | Backlog; becomes load-bearing as the prompt workflow grows |
| 7 — Compute-lane design checkpoint | B (sub-area 4) | Deferred; gating milestone for capability expansion |

### Slice 6 — Context compaction policy (cross-cutting)

- Utilization threshold at which summarization kicks in
- What stays verbatim: recent N turns + rendered table cards + session-level user preferences
- What gets dropped vs. collapsed into structured summaries
- How `groundingRefs` on older turns are preserved through compaction

Exit: long sessions (40+ turns) do not risk context-window exhaustion; policy documented even if implementation is deferred.

### Slice 3.5 — Harness robustness (Track B backlog)

- Tool-call deduplication within a single turn (identical tool + args returns cached prior result)
- Stuck-loop detection (nudge or forced-synthesis turn when the agent repeats the same tool+args)
- Anthropic prompt-cache audit: verify system prompt + tool definitions are byte-stable across turns within a session, confirm cache hits via API response headers, document what invalidates the cache
- Revisit `stopWhen: stepCountIs(12)` against real turn traces

### Slice 7 — Compute-lane design checkpoint (Track B core)

Decision memo after real usage. Questions to answer:
- how often do users ask for unavailable cuts?
- how often do users want charts?
- do recuts justify a dedicated queue?
- which derived-table patterns (NETs, cross-question ratios, shift analyses) show up conversationally often enough to justify pulling into the assistant's toolkit vs. leaving to the processor workflow?

## Open Questions

1. Should the analysis page be visible only for completed runs, or also partial runs with `results/tables.json` present?
2. Do we want one default session per run initially, or explicit multi-session support from day one?
3. Should the first assistant reply offer a run-aware starter prompt list automatically?

## Recommended Next Step

Continue **Track A** opportunistically — finish Slice 5 when a concrete "I want to copy/export this card" moment surfaces, and keep picking off UX friction as real sessions expose it.

Before touching **Track B**, write three design notes and resolve them before any prompt, tool, or transport change lands:

1. **Prompt workflow design note** — intentionality stages, request taxonomy, acknowledgment-before-work pattern, how to surface the scope check without cluttering responses.
2. **Agent context policy note** — what survives from prior turns (summaries? tool-call trace? full payloads within a window?), what gets reconstructed on demand, how it composes with Slice 6 compaction.
3. **Tool surface review note** — audit existing tools against real turn traces (scratchpad vs reasoning summaries, `viewTable` vs `getTableCard`, anything else that looks redundant or over-contextual); decide what stays, what merges, what gets cut, before capability expansion adds more.

Pressure-test all three against real session transcripts — especially cases where the assistant refused to synthesize already-grounded evidence, over-matched `cutFilter`, re-ran a tool it had already tried, or skipped a useful acknowledgment. The production prompt stays frozen — workflow experiments land on alternative first. Transport changes (what survives sanitization) and tool-surface changes are independent of prompt changes and can each be trialed behind a feature flag.

## Sources Consulted

- [AI SDK docs](https://ai-sdk.dev/docs/introduction) — chatbot tool usage, resumable streams
- [assistant-ui docs](https://www.assistant-ui.com/docs) — used as primitives reference, not adopted as surface
- [Thunderbolt](https://github.com/thunderbird/thunderbolt) — reference for thread-first layout and serious-conversation feel
