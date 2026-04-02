# Current Priorities

**As of:** April 2, 2026
**Branch:** `dev` (active development), `main` (production)

Two active workstreams. Everything else is parked.

---

## 1. Output Quality: Text and Presentation

### Context

Antares confirmed 30% programming-time savings from TabulateAI output versus manual WinCross programming. Their threshold for meaningful savings is 60-70%. The gap is not structural — the pipeline architecture, table planning, denominator logic, and export serializer are all working. The remaining issues are text quality and presentation: the things a reviewer has to manually fix before the output is client-ready.

Every item they have to manually fix is also an item they have to manually verify. Closing the text quality gap improves both programming time and QC time.

### What's been shipped

- Summary table denominator correctness (base contract matrix, `resolveBaseContract.ts`)
- WinCross denominator metadata enforcement
- Native `AF=` stat blocks for eligible numeric tables
- Scale anchor ordering (favorable-high anchored scales)
- Stub label cleanup (question text stripped from attribute rows)
- Title wrapping and Unicode normalization
- Simplified base text policy (4 approved patterns)

### What remains

These are the items Antares raised in the April 1 feedback call that are not yet addressed:

- **Question text length** — Full survey question text passes through to table titles. Antares is truncating these manually. The SurveyCleanupAgent preserves original wording by design, but there is no step that produces a concise display title for table headers.

- **Base text specificity** — The base contract simplified base text to 4 generic patterns (`Total respondents`, `Respondents shown this question`, etc.). Antares wants base text that describes the routing universe in domain terms (e.g., who was eligible and why). This requires judgment about what the routing means, not just that it exists.

- **Formatting artifacts** — Minor presentation noise: occasional unexpected font sizes, residual markup in labels. Likely a mix of SurveyProcessor conversion artifacts and SurveyCleanupAgent pass-through.

### Relevant pipeline components

All existing — no new modules required:

- `SurveyProcessor` (`src/lib/processors/SurveyProcessor.ts`) — DOCX-to-Markdown conversion
- `SurveyCleanupAgent` (`src/agents/SurveyCleanupAgent.ts`, prompts in `src/prompts/surveyCleanup/`) — question text cleanup, instruction extraction, section headers
- `TableContextAgent` (`src/agents/TableContextAgent.ts`, prompts in `src/prompts/tableContext/`) — base text, subtitles, row label refinement
- Base contract resolution (`src/lib/v3/runtime/canonical/resolveBaseContract.ts`) — deterministic base mode and text assignment

### Approach

Still under investigation. The fixes are likely a combination of:

- Tighter agent guidance (prompt refinement, not new agents)
- Deterministic post-processing (title shortening, label cleanup)
- Better use of existing metadata already available in the enrichment chain

No timeline commitment yet. These should be scoped changes compatible with the outreach sprint — not feature development.

---

## 2. Launch Outreach

### Context

Product is live at `tabulate-ai.com` with pricing, demo, and billing. The goal is buyer signal by April 12.

See Phase 9e in `docs/v3-roadmap.md` for the full outreach plan, channels, and lead lists.

### Status

- Outreach sprint started March 30
- Email, LinkedIn, Reddit, and direct outreach channels active
- Demo flow live at `/demo` (no account required)
- Code changes limited to real user-reported bugs only

### What matters

- Prospect-reported issues are highest priority
- No proactive refactoring or speculative features
- The output quality work above is permitted because it directly affects what prospects see when they evaluate the product

---

## Parked

These are documented and will be revisited after the outreach window or when triggered by user feedback:

- **WinCross serializer conventions** — Buckets 1-3 shipped. Remaining fidelity items (NET suffix style, OE structure) are backlog unless a prospect raises them.
- **QC verification surface** — Long-term product direction (see Phase 10 in `v3-roadmap.md`). Addressed naturally when the Senior Processor QC Agent is built. Not a near-term blocker.
- **Open-ended / NET-subnet structure** — No reliable general-purpose approach identified yet. Deferred.

---

## Reference (archived)

Previous working documents that informed this file have been moved to `docs/archive/`:

- `wincross-convention-fixes.md` — detailed bucket-by-bucket implementation status
- `wincross-programming-vs-qc-next-steps.md` — Track A/B/C framework and QC product direction
- `Feedback Implementation Review.txt` — April 1 Antares call transcript
- `base-contract-matrix.md` — simplified base contract spec (implemented)
