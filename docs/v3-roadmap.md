# V3 Roadmap

**Sprint:** Feb 24 (Tue) → Mar 23 (Mon) — 19+7 working days (extended from Mar 16)
**Goal:** Build a production-quality, self-serve crosstab automation product that research firms can evaluate and subscribe to independently.
**Context:** See `docs/references/transcripts/` for early validation feedback.
**Validation partner role:** Readiness signal, not purchase gate. Early partner feedback validates whether we've built the product properly — addressed known issues, professional-grade exports, usable by a real org. Broader distribution proceeds regardless unless fundamental issues surface.

---

## V3 End State

By March 23, the production version of Crosstab AI should:

1. **Run benchmark dataset flawlessly** — the primary validation dataset
2. **Export platform-ready starter packages** — Q and WinCross
3. **Continue printing Excel tabs** — existing format, our rendering
4. **Gate/hide in-app control features** — no Review Tables in production
5. **Clean codebase** — unused files deprecated or removed

---

## Phase 1: Surface and Understand Failure Modes ✓

Audited 7 of 18 datasets (chosen for complexity), synthesized 22 findings into `docs/implementation-plans/layer2-audit-synthesis.md`. Remaining 11 datasets held back as validation set.

Top findings: sum constraint detection (6/7), survey filter drops (5/7), hidden variables (5/7), per-row base splitting (3/7).

Outputs: `outputs/_layer2-audit-2026-02-24T21-14-34-797Z/`, `docs/v3-script-targets.md`

---

## Phase 2: Build Architecture Through Working Scripts ✓

**Principle:** Enrich first, compute second. Scripts prove the approach on real data before integration.

- **2a ✓** — Consolidated 22 findings into 7 script targets → `docs/v3-script-targets.md`
- **2b ✓** — Gap-checked against 6 existing plan docs. No new targets needed.
- **2c ✓** — Gap-checked against Raina's 10 issues. All map to existing targets.
- **2d ✓** — Script-by-script implementation in `scripts/v3-enrichment/`. Each script proves one problem area against real datasets. Completed: #0, #3/6, #8, #9, #10a, #10, #11, #12, #13a, #13b, #13c, #13c₂.

**Exit:** `scripts/v3-enrichment/` contains proven scripts for each target. ✓

---

## Phase 3: Migrate Production Pipeline to V3 Architecture ✓

Replaced the legacy multi-agent pipeline with V3's enrichment-first architecture across all three code paths. Work done on `dev-refactor` branch.

- **3a ✓** — `PipelineRunner.ts` (CLI path): V3-only execution, legacy agents removed.
- **3b ✓** — `pipelineOrchestrator.ts` (web path): V3-only. Flow: `runQuestionIdPipeline` → FORK (`runCanonicalPipeline` ‖ `runPlanningPipeline`) → review check → `runComputePipeline` → `runPostV3Processing`.
- **3c ✓** — `reviewCompletion.ts` (post-review path): V3-only. Loads checkpoint + artifacts from disk, applies review decisions, runs compute chain.
- **3d ✓** — V3 runtime modules extracted from scripts into `src/lib/v3/runtime/` (questionId, canonical, planning, compute chains).
- **3e ✓** — Audit fixes: message-matching path safety, R2 review recovery with V3 artifacts, fork abort on sibling failure, stat config parity, scratchpad threading, checkpoint propagation.

**Exit:** All three pipeline code paths run V3 exclusively. 997 tests passing. ✓

---

## Phase 4: Finalize V3 Table Chain and Agent Tuning ✓

**Status:** Complete

The V3 architecture is integrated, but the table chain has remaining work in canonical assembly and analytical enrichment. See `docs/v3-script-targets.md` for script-level status.

- **4a** — Canonical table assembly (step 13d): deterministic conversion from validated plan to `table.json`. Runtime module exists (`runCanonicalPipeline`), but needs continued refinement against edge cases.
- **4b** — Analytical enrichment (step 13e): AI pass(es) over assembled tables to fill gaps — cross-question relationships, coded open-end views, additional cuts a data processor would add. Scope still being defined.
- **4c** — Agent prompt tuning: review and finalize prompts for all AI agents given the new V3 context (richer input, constrained roles). Includes LoopSemanticsPolicyAgent (may need better guidance given new system), CrosstabAgentV2 (want to add better signals for cut selection without HITL), BannerGenerateAgent, AI gate agents.

**Exit:** Table chain produces complete, publication-ready output. Agent prompts tuned for V3 context.

---

## Phase 5: Benchmark Validation and Dataset Testing ✓

**Status:** Complete

- **5a** — Benchmark validation via batch pipeline (not UI). Test both datasets: current (open-ends uncoded) and coded version. Compare output against reference final tables to measure closeness.
- **5b** — Broad dataset testing across all 17+ datasets via batch pipeline. Spot-check Excel output. Focus on regression — ensure V3 migration didn't break previously-working datasets.

**Exit:** Benchmark issues demonstrably resolved. No regressions across dataset suite.

---

## Phase 6: UI/UX Update for V3

**Status:** Complete

Update the product UI to reflect V3 changes. Deprecate features that are no longer part of the product surface.

- **6-pre** — Convex schema alignment (prerequisite for all UI work)

  The Convex schema is functional but has structural gaps that will block or complicate UI work. Fix these first:

  **Must fix:**
  - **Type the `result` field.** Currently `v.any()` — the orchestrator writes a specific shape but there's no contract. Define a `RunResultShape` TypeScript interface and use it in both the orchestrator (write side) and frontend (read side). Add `result.formatVersion: 3` to distinguish V3 results from legacy runs.
  - **Persist V3 checkpoint to Convex.** Currently disk/R2 only. Container restart mid-review loses the checkpoint. Add checkpoint data to the `result` object so `reviewCompletion` can recover from Convex alone.
  - **Persist UI-facing review metadata to Convex.** Full review-state recovery remains disk/R2-backed because the full `CrosstabReviewState` exceeds Convex document limits on larger datasets. Persist the scalar review fields the UI needs and keep the full recovery chain as disk → R2 → fail.
  - **Enum-ify the `stage` field.** Currently free-text `v.string()`. Convert to `v.union(v.literal(...))` for all V3 stages so typos fail at write time, not silently in the UI.

  **Should fix:**
  - **Add V3 metadata fields.** Store canonical table counts, loop summary, flagged column counts in Convex so the dashboard/results screen can display them without R2 fetches.
  - **Persist study metadata needed by the current Phase 6 UI.** The active intake taxonomy is `studyMethodology + analysisMethod`, with backward-compatible `projectSubType` still persisted behind the scenes. `hasMaxDiff` remains relevant now; broader demand / choice-model taxonomy is a follow-on only if the runtime contract expands.
  - **Add a field for the AI decisions summary** (6f output). Plain text, stored after pipeline completion.
  - **Remove or deprecate legacy fields.** `stopAfterVerification`, pre-V3 config options that are no longer respected.

  **Validation approach:** Run `npx convex dev` locally and see what breaks. Cross-reference every `updateRunStatus` / `mutateInternal` call in the orchestrator and reviewCompletion against the schema to catch mismatches.

- **6a** — Deprecate Review Tables and any in-app table editing UI. Users control tables through platform exports (Q/WinCross), not in-browser editing.
- **6b** — Update intake/wizard flows to match the current V3 config model and shipped prep work. The Phase 6 intake taxonomy is `studyMethodology + analysisMethod`, with methodologies `standard | message_testing | concept_testing | segmentation` and analysis methods `standard_crosstab | maxdiff`. `projectSubType` remains as a backward-compatible bridge in persistence/runtime paths. Do not expand this phase to demand / choice-model intake unless the runtime contract changes first.
- **6c ✓** — Update results/download screens for V3 output (Excel + export packages). The project detail page now exposes Excel downloads plus on-demand Q / WinCross export generation and download.
- **6d** — General UI cleanup: remove references to deprecated features, update copy, ensure flows are consistent with the V3 pipeline.
- **6e ✓** — Standardize run-scoped output/R2 alignment. Local artifacts now follow the V3 phase-organized layout, and run artifacts upload under `{orgId}/{projectId}/runs/{runId}/...` with shared validation/reporting across direct-completion and post-review flows.
- **6f ✓** — Pipeline Decisions panel. Completed runs now show a collapsible decisions surface with persisted structured metrics plus a prose briefing on the project detail page. The current implementation uses deterministic decision assembly and stored summary text rather than a separate AI summarizer step.
- **6g ✓** — Pipeline timeline + crosstab review polish. Review cards now use design system tokens instead of raw yellow/green colors. Simplified copy ("considerations" not "AI Concerns", calmer badge labels). Removed `AlertTriangle` from default status badges in favor of subtler `Clock` icons. Responsive footer stacking on review page.
- **6h ✓** — Organization-scoped WinCross profiles. Saved org-level profiles now live in Convex, admins manage them from Settings, and both the wizard and project-page export flow can select them. WorkOS remains the identity and role boundary rather than the profile-data store.
- **6i ✓** — Per-project table presentation preferences. Project/run config now supports a shared label vocabulary, completed runs can rebuild Excel + cached exports in place from stored artifacts, and the project detail page exposes a Table Labels editor that only shows slots used in the current tables.

  **Pipeline timeline:**
  - The real-time progress infrastructure is solid (Convex subscriptions via `useRunStatus()` / `useRunProgress()`, no HTTP polling needed).
  - The timeline component (`pipeline-timeline.tsx`) references legacy stage names (`parallel_processing`, `waiting_for_tables`, `filtering`, `splitting`, `verification`) that no longer match V3 stages. Remap to V3 stage names (`v3_enrichment`, `v3_fork_join`, `v3_compute`, etc.).
  - Keep user-facing step labels high-level and engaging — no agent names or internal terminology. The goal is to keep the user informed while the pipeline runs, not to expose pipeline internals.
  - Verify the orchestrator's `updateRunStatus` calls cover all V3 stages with meaningful progress increments and user-facing messages.

  **Crosstab review UI:**
  - The review flow (accept / pick alternative / give hint / skip) is functionally complete and works well. This is a design and tone pass, not a rebuild.
  - **Fix emoji at the source:** CrosstabAgentV2 (and any other agents producing `userSummary` / `uncertainties`) should be prompted to never output emojis. The frontend `stripEmojis()` hack can remain as a safety net but should not be doing the work. Update agent prompts to explicitly prohibit emoji in user-facing text fields.
  - **Design system alignment:** The review cards currently use a warning-heavy aesthetic (`border-yellow-500/50`, alert triangles). Tone this down to match the design system — calmer, more confident, understated. Use `ct-amber` sparingly and only when genuine attention is needed (low confidence), not as the default card treatment.
  - **Simplify copy:** Ensure all user-facing text in the review flow (labels, tooltips, empty states) is clean, direct, and free of developer-facing language. Match the tone guidelines: calm, confident, modest.

  **Goal:** After a pipeline run completes, show the user a 1–2 paragraph natural-language summary of what was found and what was built. This is the first thing users see on the results screen — a confident analyst briefing, not a pipeline log.

  **Tone & principles:**
  - *Survey-aware, not pipeline-aware.* Lead with understanding of the survey content (topics, audience, respondent universe), not internal stage names or agent terminology.
  - *Confident decisions, not ambiguity flags.* "We identified 3 grid designs and decomposed them into item-level detail tables" — not "we were ambiguous about 3 grids."
  - *Outcomes, not process.* "52 questions produced 295 tables" — not "the AI gate flagged 8 and corrected 6."
  - *Show survey understanding.* The summary should demonstrate that we understand the research, not just the data. This is a key differentiator.

  **What gets mentioned:**
  - What the survey is about (topics, audience, approximate respondent count)
  - How many questions produced how many tables
  - What was excluded and why (briefly — "system metadata and derived variables")
  - Notable structural patterns found (loops, grids, MaxDiff — or their absence)
  - Banner structure (how many cuts, what they cross by)
  - Structural decisions framed as what we *did* (e.g., "grid designs were decomposed into item-level tables"), not what we were uncertain about

  **What stays hidden:**
  - Agent names, stage numbers, gate terminology
  - Confidence scores, mutation counts, internal correction/confirmation metrics
  - Subtype taxonomy (scale/standard/ranking/allocation)
  - AI vs deterministic distinction
  - Any "sausage being made" detail

  **Implementation approach:**
  1. *Digest assembler* — deterministic function that reads stage report artifacts (`questionid-final.json`, table plan, canonical assembly summary, banner/crosstab output, gate reports) and produces a compact `PipelineDecisionDigest` object (~1–2KB). No AI needed for this step.
  2. *Survey context input* — pass parsed survey JSON alongside the digest so the AI can speak to the research topic, not just counts.
  3. *Summarizer call* — single `generateText` call with a system prompt defining the analyst-briefing role and the digest + survey context as user input. Output is plain text (1–2 paragraphs). Can use a cheaper/faster model since this is prose generation, not classification. Negligible cost (~500 tokens in, ~200 out).
  4. *UI placement* — summary text displayed at the top of the pipeline decisions panel, with optional expandable detail sections below for users who want raw numbers.

  **Example output (target vibe):**
  > *This survey explores messaging and positioning concepts among healthcare professionals, with approximately 500 respondents. We identified 52 reportable questions spanning screening criteria, concept evaluations, and likelihood-to-prescribe measures. 12 additional data columns were excluded as system metadata and derived variables. No loop structures or specialty choice models were detected.*
  >
  > *From these questions we generated 295 tables, cross-tabulated across 24 banner columns organized into 6 demographic and attitudinal groups. Several questions used grid designs — we decomposed these into individual item-level tables to provide row-level detail. The majority of tables are standard frequency distributions with a shared respondent base.*

**Exit:** UI reflects V3 capabilities. Deprecated features gated or removed. All Phase 6 slices (6a–6i, 6g, 8a, 8b, 8e cleanup) are complete.

---

## Phase 7: Q and WinCross Export ✓

**Status:** Complete
**Reference:** `docs/references/wincross-style-contract-implementation-plan.md`, `docs/references/v3-13d-canonical-table-spec.md`

Both Q and WinCross exports are functional and shipping. Canonical `table.json` feeds both export paths cleanly.

- **7a ✓** — Q script export: manifest builder, filter compiler, and emitter produce valid Q scripts from canonical tables. Tested across stacked and non-stacked datasets.
- **7b ✓** — WinCross `.job` export: serializer generates valid `.job` files with `DATA`, `TABLE`, `BANNER`, and `INDEX` sections. Supports stacked/loop studies with multiple `DATAFILE` declarations and frame-level table routing. Org-level WinCross profile selection applies portable style conventions from uploaded reference `.job` files.
- **7c ✓** — Export plumbing: Phase 6 UI surfaces (project detail page export section) backed by on-demand Q/WinCross generation and download. Org profile management in Settings. Loop family collapse and data frame tagging ensure stacked studies route correctly through both export paths.

**Where we are:**
- Produces valid WinCross jobs for stacked and non-stacked studies
- Supports selectable house-style profiling from uploaded reference `.job` files
- CrosstabAI is the authority for study logic (cuts, banners, tables, loop semantics)
- Targeted desktop validation completed across multiple test datasets

**What we do not claim:**
- Exact legacy-format parity with a client's existing WinCross output
- Exhaustive desktop validation across the full table surface
- Coverage of every WinCross edge case or feature

**Exit:** Q and WinCross export packages are production-ready and backed by the Phase 6 UI. Style fidelity is improved over the default profile but not guaranteed to exactly match legacy outputs. Contract documented in `docs/references/wincross-style-contract-implementation-plan.md`.

---

## Phase 8: Production Hardening

**Status:** Complete
**Reference:** `docs/phase8-implementation-plan.md` (detailed plan from full audit)

Tighten the system for early-production reliability and operational clarity before broader external use. This phase is intentionally scoped as an MVP hardening pass, not a broad polish / platform-maturity phase.

- **8.1** — Startup validation & readiness: fail-fast env validation at boot, split `/api/health` vs `/api/ready`, verify Convex/R/R2 readiness
- **8.2** — Pipeline failure containment: R2 upload retry, larger configurable R buffer, cleanup-failure logging, abandoned-run reconciliation after restarts
- **8.3** — Frontend resilience: React error boundaries and timeout-based fallback states on key Convex-driven pages
- **8.4** — Observability on critical paths: Sentry capture for high-impact API routes plus final failed/partial pipeline summary events
- **8.5** — Legacy surface containment: disable legacy session-based routes in production by default unless explicitly re-enabled
- **8.6** — Known limitations / operating envelope documentation

**Explicitly deferred from this phase:** broad structured logging, sidebar/query performance work, fetch-abort cleanup, CSP rollout, broad accessibility polish, and large-scale dead-code deletion.

**Exit:** App validates config at startup. Railway readiness checks cover downstream dependencies. Key product pages fail with fallback UI instead of white screens. R2 upload failures are retried and unresolved ones end clearly as `partial`. Failed/degraded runs reach Sentry with enough context to debug. Legacy session routes are not exposed by default in production. Known operating limits are documented.

---

## Phase 9: Launch Readiness

**Status:** In progress (9a–9d complete, 9e remaining)
**Reference:** `docs/pricing-implementation-plan.md`

Make Crosstab AI self-serve — any research firm should be able to discover the product, understand what it does, try it, and subscribe. Early partner feedback is a readiness signal: did we address their issues, do the exports work for a professional org, is the product sound? Broader distribution proceeds regardless unless fundamental issues surface.

### 9a — Pricing + Billing ✓

Stripe integration with WorkOS. Revised pricing model: Pay-As-You-Go ($200/project, no monthly fee) + three subscription tiers (Starter $849/mo, Professional $1,999/mo, Studio $4,999/mo). Project-based billing with graduated metered overages via Stripe Meters. Bills on first successful run, not project creation. Failed runs are free. Re-runs and banner additions within a project are free.

- Convex schema (subscriptions table, billingCounted on projects)
- Stripe client, plan config, overage math, smart upgrade breakpoints
- Checkout session creation, Billing Portal, webhook handler, subscription query route
- Subscription enforcement at project launch (402 if no active plan)
- Usage recording on pipeline success (mark project + increment counter + Stripe meter event)
- Billing notifications via Resend (near-limit, overage, upgrade suggestion) — PAYG skips near_limit/overage
- Public pricing page at `/pricing` — PAYG + 3-plan comparison grid, all features included in every tier, transparent overage billing section, FAQ, checkout CTA flow
- Settings billing section — plan status badge, usage bar with color-coded thresholds (PAYG shows running total instead), overage alerts, smart upgrade hints, Stripe Billing Portal access for plan management and invoice history

### 9b — Demo / Trial Mode ✓

Lightweight trial for prospects who haven't signed up yet. Same pipeline, restricted output.

- Accessible at `/demo` route — no account required, just name + email
- Full input: upload `.sav` + optional survey document, same wizard flow (step labels match main wizard)
- Restricted output: first 25 tables only, first 100 respondents from the `.sav`
- Email verification flow: confirmation link sent on submit, output delivered after verification + pipeline completion
- Delivery via email: Excel attached standalone, Q/WinCross exports as zips (each includes script/job + wide.sav + manifest)
- Q/WinCross exports generated locally during demo pipeline via `generateLocalQAndWinCrossExports()`
- WinCross profile selector hidden in demo mode — uses default profile with upsell message
- 24-hour per-email rate limit (bypassed in development)
- Light-themed email templates across all notification types
- Human-readable duration formatting in emails (e.g., "31m 37s" not "1897.4s")
- Demo output files cleaned up from server after successful email delivery

### 9c — Domain + Branded Email ✓

- Domain `tabulate-ai.com` purchased via Porkbun, DNS verified
- Resend configured with verified domain — sends from `notifications@tabulate-ai.com`
- Pipeline completion notifications (success, partial, error, review_required)
- Demo verification and output delivery emails
- Billing threshold notifications
- All email templates use light theme (white card, dark text)

### 9d — Pricing Page + How It Works ✓

- `/pricing` — public pricing page with PAYG + tier comparison, CTA → Stripe Checkout
- Landing page hero CTAs are auth-aware: logged in → "Go to Dashboard", not logged in → "Try the Demo" + "Get Started"
- How It Works section communicates hybrid approach: AI understands survey intent, deterministic code computes every number
- Demo CTA strip after How It Works section for prominent access
- Marketing copy broadened to address both internal teams and client-facing work
- Nav links work from any marketing page (absolute paths to anchors)
- Marketing layout is server-rendered with auth detection (shows "Dashboard" vs "Log In")
- User dropdown includes "TabulateAI Home" link back to marketing pages

### 9e — Launch Outreach

**Timeline:** Mar 30 (Mon) → Apr 12 (Sun) — 10 working days.

**Goal hierarchy:**
1. **Buyer signal** — at least one firm enters a paid tier (Pay-As-You-Go counts). This is the primary success metric for the sprint.
2. **Access requests** — prospects who complete the demo and ask for full access.
3. **Demo completions** — prospects who try the demo flow end-to-end.

**Lead lists (pre-built):**
- Data Processors (~64 contacts)
- Research Analysts & Insights Managers (~457 contacts)
- AI Leads in Market Research (~77 contacts)

**Channels:**
- **Email outreach** via Skrapp.io (or similar) for high-confidence emails. All outreach sent from TabulateAI email — no more mixing personal/HawkPartners email.
- **LinkedIn** for low-confidence contacts and warm intros. Consider LinkedIn Premium free trial to reach inboxes directly. Also used for positioning content and product updates.
- **Reddit** — post in market research subreddits at least once per week where relevant and authentic. Focus on genuine value, not spam.
- **Direct outreach** to Sago and Testset from TabulateAI email. These are known prospects with established context.

**Approach:**
- Lead with the demo flow as the low-friction entry point — no account required, immediate value
- Recognize B2B sales cycles are longer than B2C, but push for signal within the two-week window
- Messaging should emphasize differentiation: hybrid AI + deterministic compute, professional exports (Q/WinCross), purpose-built for MR

**Exit:** Product is publicly available at `tabulate-ai.com` with pricing, trial access, branded email notifications, and active outreach across all channels. Multiple firms can evaluate and subscribe independently. At least one buyer signal received by Apr 12.

---

> **Gate: Market Validation**
>
> Everything below this line adds analytical depth and platform extensions that aren't necessary for initial product-market fit. Phases 1–9 deliver a complete, self-serve crosstab automation product with professional exports. Phases 10+ are investments in differentiation and breadth that should be driven by real user feedback and demand signals — not built speculatively.
>
> Proceed to Phase 10+ when: multiple firms are actively using the product, and feedback indicates which extensions would deliver the most value.

---

## Phase 10: Senior Processor QC + Derived Analytical Tables

**Status:** Not started — contingent on market validation gate.
**Reference:** `docs/phase10-implementation-plan.md`

This phase adds the final quality layer before output delivery — the judgment a senior data processor would apply after the pipeline runs. It covers two complementary concerns: QC review of the generated table set, and derived analytical tables that go beyond raw tabulation.

### 10a — Senior Processor QC Agent

A post-pipeline QC pass that evaluates the full table set with the judgment of a senior processor. This is not a mechanical validation (the pipeline already handles structural correctness). This is about deliverable quality — the kind of review a senior processor does before sending tabs to a client.

**What it does:**
- **Table pruning** — identify and flag tables that shouldn't be in the final deliverable (redundant views, tables with no meaningful variation, system-metadata questions that slipped through)
- **Label cleanup** — catch survey programming language that leaked into user-facing labels (e.g., "Pipe", "Loop", "ROTATE", "RANDOMIZE", screening syntax). The SurveyCleanupAgent (stage 08a) handles initial extraction artifacts, but it doesn't always catch domain-specific programming terms that require judgment to rewrite into natural language.
- **Presentation judgment** — flag tables where the structure is technically correct but would confuse a reader (e.g., a grid decomposed into 20 single-item tables when a summary view would be clearer, or scale tables with anchors that read awkwardly after cleanup)
- **Completeness check** — identify gaps a processor would notice: missing NET rows on questions that obviously need them, questions that should be cross-tabbed but aren't, banners that don't include an obvious demographic cut

**Relationship to SurveyCleanupAgent (08a):**
The SurveyCleanupAgent runs early in the enrichment chain and cleans extraction artifacts from parsed survey text. It should also be updated to avoid propagating survey programming language — terms like "Pipe", "INSERT", "ANCHOR", "ROTATE" that appear in raw survey instruments should be adapted into natural language rather than passed through literally. The Senior Processor QC Agent is the downstream safety net: it catches anything that slipped through earlier stages and evaluates the full table set holistically.

### 10b — Derived Analytical Tables

Automatically generate derived analytical tables that go beyond tabulating raw survey responses. These are the tables a senior analyst builds by hand after receiving initial tabulations — shift analyses, cross-question comparisons, composite switching metrics, category-level rollups.

Two use cases:
- **Use Case A (Proactive):** The system detects opportunities from the data and generates derived tables automatically. Additive and low-risk — users can delete any they don't want.
- **Use Case B (Reactive):** Analysts request additional tables after reviewing initial output ("Can we get a summary by message category?"). Requires the same underlying infrastructure as Use Case A.

Seven derived table patterns identified from reference workbooks (WinCross .job reference, internal reference tabs):

| # | Pattern | Example |
|---|---------|---------|
| 1 | Pre/Post Shift Analysis | % who increased/decreased/stayed same across scenario timepoints |
| 2 | Cross-Question Ratio | Subset ÷ total per respondent, banded |
| 3 | Cross-Item Logical Combination | "ONLY Drug A", "ALL drugs", "NONE" meet a criterion |
| 4 | Ranking Cut-Point Summaries | **Already covered** by canonical chain |
| 5 | Hierarchical Sum Rollup | Parent-category totals from child allocations |
| 6 | Composite Switching Metric | High on A AND low on B — persuadability segments |
| 7 | Category Rollup Across Sets | Which message theme wins at each rank level |

All patterns (except #4, already handled) require respondent-level R computation — new derived variables created from existing .sav columns, then tabulated through the standard pipeline.

**Exit:** Senior Processor QC Agent reviews and cleans the full table set before delivery. System can detect and generate the most common derived table types. Survey programming language is eliminated from all user-facing labels. Infrastructure supports both proactive generation and reactive analyst requests.

---

## Phase 11: Excel Input Compatibility

**Status:** Not started

Accept `.xlsx` files as a data input format alongside `.sav`. This broadens the intake funnel for clients who work in Excel rather than SPSS, which is common at smaller firms and for ad hoc projects.

**Scope:**
- Support `.xlsx` upload as an alternative to `.sav` in the intake flow
- Extract variable names (column headers), response data, and value labels from structured Excel workbooks
- Feed extracted data into the same V3 enrichment pipeline that `.sav` currently uses
- Handle common Excel-specific issues: mixed types in columns, merged header rows, multiple sheets

**Explicitly out of scope:**
- `.csv` input — too ambiguous (no metadata, no value labels, delimiter variance). Not worth the support burden.
- Replacing `.sav` as the primary path — Excel is an additional input, not a replacement

**Exit:** Users can upload a well-structured `.xlsx` file and receive the same pipeline output (enrichment, canonical tables, exports) as a `.sav` upload.

---

## Phase 12: Dead Code Cleanup

**Status:** Not started

The V3 migration deprecated significant amounts of legacy code — agents, parsers, pipeline paths, and utilities that are no longer called. These have been marked `@deprecated` but remain in the codebase. This phase is an aggressive cleanup pass.

**Scope:**
- Remove deprecated agents and their associated prompts, schemas, and tests (e.g., legacy TableGenerator, FilterApplicator, pre-V3 pipeline paths)
- Remove deprecated parsers and processors that were replaced by `.sav`-forward validation (e.g., CSV/Excel datamap parsers, format detectors)
- Remove dead utility code confirmed via codebase search to have no callers
- Clean up `groupingAdapter.ts` and pull it out of DataMapGrouper if still relevant after cleanup
- Audit and remove unused schema fields, Convex mutation/query dead ends, and orphaned test fixtures
- Verify no runtime imports break after each removal pass (lint + type check + full test suite)

**Approach:** Incremental — remove one module or family of files per commit, verify green, repeat. Not a single big-bang deletion.

**Exit:** Codebase contains only actively-used code. No `@deprecated` markers remain without a concrete timeline for removal.

---

## Phase 13: Multiple Banners and Wave-Over-Wave

**Status:** Not started

Currently, each pipeline run produces a single banner structure. This phase extends the system to support multiple banner sets per run and introduces wave-over-wave (tracking) functionality.

**Multiple banners:**
- Allow users to define or upload multiple banner configurations for a single dataset
- Each banner set produces its own cross-tabulation output (separate tabs or sections in Excel, separate export packages for Q/WinCross)
- Common use case: a "demographics" banner and a "behavioral" banner run side by side

**Wave-over-wave:**
- Support longitudinal studies where the same survey is fielded across multiple waves (time periods)
- Enable wave comparison tables: show results from Wave 1, Wave 2, ..., Wave N side by side with significance testing across waves
- Requires linking datasets across waves by shared variable structure, handling sample size differences, and producing comparative output formats
- Common in tracking studies (brand health, ATU, satisfaction monitors)

**Exit:** Users can configure multiple banner sets per run and produce wave-comparative output for longitudinal studies.

---

## Phase 14: WinCross Export Fidelity

**Status:** Not started
**Reference:** `docs/references/wincross-style-contract-implementation-plan.md`, `docs/wincross-convention-fixes.md`

Phase 7 shipped functional WinCross export with portable style profiling. This phase is continued investment in fidelity — closing the gap between what TabulateAI produces and what a client's legacy WinCross output looks like.

**Concrete feedback from Antares** (triaged in `docs/wincross-convention-fixes.md`):
- **Contract-critical:** Summary tables using wrong total-line base (`TN^1` vs `TN^0`), numeric interim tables need native `AF=` stat blocks, scale anchor/factor-code mismatch, OE theme row duplication
- **High-priority fidelity:** Remove `|` from table titles, Unicode escape cleanup (`<U+2019>`), rating scale ordinal display order, stub rows polluted with question text
- **Needs confirmation:** `OI2` job-level vs stub-level preference, exact NET row suffix styling (`^SX` vs `^SX,GX`)

The Antares feedback is the first real-world vendor validation of our WinCross output. The correctness items (Bucket 1) should be treated as bugs, not style preferences — they affect reported percentages and deliverable quality. The fidelity items (Bucket 2) are what separate "usable starting point" from "vendor-grade output."

**Scope:**
- Fix all Bucket 1 (contract-critical) items from the Antares feedback — these are correctness bugs
- Fix Bucket 2 (high-priority fidelity) items — these close the gap to vendor-grade output
- Broader desktop validation across more datasets and table families beyond the targeted validation done in Phase 7
- Additional style convention extraction from uploaded reference `.job` files (spacing, decimal precision, suppression rules, custom stat-test notation)
- Improved `INDEX` generation for complex multi-banner configurations
- Better handling of WinCross-specific features: custom significance letter schemes, multi-level NET definitions, conditional formatting directives
- Investigate `.jlb` (WinCross library) import for richer preference extraction

**What this phase is not:**
- This is not about changing the contract — TabulateAI remains the authority for study logic. This is about making the style layer more faithful.
- This is not about exact parity. The goal is "materially closer to their house style" with each iteration, not pixel-perfect reproduction.

**Exit:** Antares contract-critical items resolved. WinCross exports are demonstrably closer to client reference files across a broader set of datasets and table configurations. Style extraction covers the most commonly used WinCross formatting conventions.

---

## Phase 15: Conversational Data Analysis ("Chat With Your Data")

**Status:** Not started — contingent on market validation gate.
**"Backend" Focus:** /Users/jasongraydon01/.claude/plans/polymorphic-beaming-raven.md
**UI/UX Companion:** /Users/jasongraydon01/.claude/plans/vivid-shimmying-lobster.md

Add natural-language conversational analysis on top of the crosstab output. Users ask questions of their data in plain English and get answers grounded in the verified artifacts the pipeline has already produced.

**Why this matters:**
- The competitive reference point is Panoplai, which markets "digital twins" of datasets and lets users ask questions of the data conversationally. This is increasingly table-stakes for non-processor audiences (insights managers, brand teams, agency strategists) who want answers without navigating tab books.
- TabulateAI has a unique structural advantage: we don't just have raw data — we have **verified crosstab artifacts** (canonical `table.json`, enriched question metadata, computed cross-tabulations with significance testing). The AI can reference these as a ground-truth starting point rather than computing from scratch, which reduces hallucination risk and grounds answers in the same numbers the client sees in their deliverables.
- This extends the product beyond the data processor segment into the broader research consumer segment — the people who commission tabs but don't want to read 300-page tab books.

**Approach (high-level, not yet designed):**
- The conversational layer references the pipeline's computed artifacts (tables, metadata, enriched question context) as its knowledge base — not the raw `.sav` directly
- Simple questions ("What % of respondents are female?") should be answerable from existing cross-tabs without new computation
- Complex questions ("Is there a significant difference in brand preference between regions?") can reference specific tables and significance test results
- Out-of-scope questions (anything not covered by the existing table set) should be acknowledged honestly, not hallucinated — with an option to suggest which additional tables would answer the question
- The UI should make it clear when an answer comes from a verified table vs. when it's an AI interpretation

**What we do NOT want to build:**
- A generic SQL/dataframe chat agent that queries raw data with no grounding — that's the commodity approach and it hallucinates
- A replacement for the tab book — conversational analysis is complementary, not a substitute for the full deliverable
- Premature infrastructure — this phase should be designed after we have real user feedback on what questions people actually ask

**Why it's here now (even though it's post-PMF):**
This should not be an afterthought bolted onto a product that wasn't designed for it. Architectural decisions made in Phases 10–14 (artifact structure, metadata richness, export formats) should be made with awareness that a conversational layer will eventually sit on top. That doesn't mean building for it now — it means not building against it.

**Exit:** Users can ask natural-language questions about their dataset and receive answers grounded in verified pipeline artifacts. The system clearly distinguishes between answers from computed tables and AI interpretations.

---

## Post-V3 Backlog

Items deferred beyond the V3 sprint. Not blocking for MVP or initial validation. Tracked here so they don't get lost.

### Open-Ended Question Linking

**Source:** Benchmark audit finding #10

**Problem:** Open-ended questions are appended at the back of the table set with generic Q-labels because we can't reliably link them to their parent closed-ended questions. Ideally, each OE would appear immediately after its parent question in the output.

**Why it's deferred:** OE linking requires reliable parent-child detection across question types — suffix patterns (e.g., B500 → B500b), survey flow adjacency, and question text references ("Why did you say that?"). The enrichment chain doesn't currently model these relationships for OEs. Getting this wrong (linking to the wrong parent) is worse than the current behavior (appending at the end).

**When to revisit:** After V3 is stable and we have bandwidth for enrichment chain extensions. This is a quality-of-life improvement for the output, not a correctness issue — the OE data is still in the tables, just not optimally positioned.
