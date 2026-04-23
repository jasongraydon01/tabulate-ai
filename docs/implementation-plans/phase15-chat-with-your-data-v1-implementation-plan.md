# Phase 15 V1 — Chat With Your Data

**Purpose:** run-scoped conversational analysis on verified pipeline artifacts. Live at `/projects/[projectId]/runs/[runId]/analysis`.

## Current state

A custom AI-SDK chat surface is shipping against real users. The agent reads verified pipeline artifacts only — no raw `.sav`, no new R compute. Convex tables `analysisSessions` / `analysisMessages` / `analysisArtifacts` / `analysisMessageFeedback` back the UI; per-turn traces land in R2 under `project/run/analysis/`. Four grounded tools (`searchRunCatalog`, `fetchTable`, `getQuestionContext`, `listBannerCuts`) front a prose-level render primitive — `[[render tableId=<id>]]` markers are resolved against this-turn's fetched tables by `renderAnchors.ts`, with a post-pass validator + single-shot model repair for invalid markers. A claim-check + repair lane enforces that dataset-specific numeric claims are backed by a rendered card. Reasoning summaries stream natively from both providers (OpenAI via Responses API + `reasoningEffort: "medium"` default, Anthropic via adaptive thinking). Full repo test suite: 2206 green. What's shaped-and-working: session create/list/delete, streaming turns, grounded table cards, evidence panel, follow-up chips, thumbs + correction-text feedback, title generation, copy on both message sides, click-to-edit user messages with truncate-and-resend, run-aware discoverability CTA, markdown-stripped reasoning summaries.

## Track A — interface polish

Opportunistic UX fixes against real usage. Low blast radius, no model behavior changes.

**Remaining:**

1. **Slice 5 — durable artifact polish.** Copy / export hooks on table cards, artifact-focused references, richer artifact metadata when it unlocks concrete UI. Exit: structured outputs feel reusable, not ephemeral.
2. **Ongoing fit-and-finish** as real usage surfaces friction. Ship as it surfaces.

**Deferred:**

- **Abandoned-session cleanup.** Rejected the cron-sweep quick fix; the right implementation is a draft-session UI path (no `sessionId` in URL until composer submit creates one atomically). 2–3 hours of careful work — pick up when session-related work batches, or if ghost sessions surface in real use. Touchpoints: `AnalysisWorkspace.tsx`, `AnalysisThread.tsx`, `AnalysisEmptyState.tsx`, the POST route, `convex/analysisSessions.ts`.
- **Chat sharing.** Own slice, not polish. Design decisions before code: share-token scheme + revocation, payload boundary (inline rendered cards vs scoped artifact read), read-only viewer UI, evidence-link fallback for shared viewers, governance (who can share, audit trail).

## Track B — prompt intentionality + analytical depth

The piece that pushes the surface from "grounded Q&A" toward "analysis partner." Sub-area 3 (tool surface) shipped — see current state above. Two active design beats, one deferred capability expansion.

**1. Prompt workflow and intentionality.** *Next actionable design beat.* The alternative prompt now codifies `search → fetch → mark` as the workflow; the next layer is request classification (exploration / synthesis / methodology / narrow lookup / follow-up on prior evidence), a one-line goal written before action, and an acknowledgment-before-work pattern so the user can stop a wrong-shaped turn early. Friction this targets:

- Agent refusing to synthesize grounded evidence already in-thread (root cause is sub-area 2 — prompt side teaches the agent to recognize the request shape).
- Over-matching `cutFilter` when user phrasing and cut labels share a common word.
- Rendering more cuts than the user's question justified.

Experiments land on `alternative.ts`; production stays frozen.

**2. Agent context policy (merged with Slice 6 — context compaction).** *Next actionable design beat, paired with sub-area 1.* Today `getSanitizedConversationMessagesForModel` in `messages.ts` strips every non-text part across turns — prior table cards, catalog searches, question-context lookups. The UI rehydrates them; the model is blind to them. Cost + determinism + cache-safety explain the current policy, but it directly causes the "I need a supporting card" refusal when synthesis across prior turns would be valid. Design options on the table:

- Compact per-card summary (title, cuts, rows, a handful of key values) injected into conversation history.
- System-level card inventory per turn listing `tableId`s + titles of earlier-rendered cards.
- Full pass-through within a rolling window (last 3–5 turns) + summarization older.
- Tool-call history summarization so the agent sees what it already tried.
- Any combination, gated on session length.

Exit: long sessions (40+ turns) don't risk context exhaustion; policy documented even if rollout is staged.

**4. Analytical capability expansion.** *Deferred — gated on compute-lane checkpoint (Slice 7).* Candidate tools: build new cuts on the fly, expand cuts the crosstab pipeline didn't emit, generate NETs, other Phase-10b-style derived tables. Can't ship without a compute lane, so design conversation is one conversation, not two.

**Backlog — Slice 3.5 (harness robustness).** Tool-call deduplication within a turn, stuck-loop detection, Anthropic prompt-cache audit, `stopWhen: stepCountIs(12)` recalibration against real turn traces. Becomes load-bearing as the prompt workflow in sub-area 1 grows.

**Backlog — Slice 7 (compute-lane design checkpoint).** Decision memo driven by real-usage signal: how often do users ask for unavailable cuts, how often do they want charts, do recuts justify a dedicated queue, which derived-table patterns show up conversationally often enough to pull into the assistant's toolkit.

## Cross-cutting: inline markers as the rendering primitive

Already load-bearing. `[[render tableId=<id>]]` markers resolve deterministically against fetched data. The same primitive extends naturally to per-claim citations (`[[cite tableId=… rowKey=… cutKey=…]]`) — higher resolution than document-chunk citations because the artifact is structured. Not shipping in v1; worth keeping in mind when the context-policy note gets written, since "what survives across turns" becomes data indexed by stable IDs rather than rendered UI.

## Out of scope for v1

- Dedicated chat worker
- Fresh R recuts or new statistical compute
- Chart generation
- Image upload
- Live web search
- Multi-run or project-wide analysis
- Per-claim inline citations (direction-of-travel, not v1)

## Recommended next step

Continue Track A opportunistically — Slice 5 when a concrete copy/export moment surfaces.

For Track B: write the two design notes (prompt workflow, context policy) before any transport or prompt change lands. Pressure-test both against real session transcripts — especially cases where the assistant refused to synthesize already-grounded evidence, over-matched `cutFilter`, re-ran a tool it had already tried, or skipped a useful acknowledgment. Production prompt stays frozen; experiments land on `alternative.ts` first. Transport changes (what survives sanitization) and prompt changes are independent — each can trial behind a feature flag.
