# Outreach & Product Plan (Rolling)

**Original scope:** April 5 – May 3, 2026 ("April Sprint" — 20 workdays of processor outreach + product polish).
**Current scope:** Rolling. Outreach has become a multi-month effort, now expanding in two dimensions: **audience** (adding insights professionals alongside processors) and **channels** (beyond direct email into LinkedIn presence, personal brand, and content/SEO).
**Goal:** Buyer signal across both product workflows. At least one paying customer. Close the output-quality gap for Antares-profile firms. Prove Chat with Your Data as a differentiated hook for insights-professional firms.

> This doc started as a fixed April sprint and has intentionally evolved. B2B outreach in this market takes longer than 20 workdays to produce signal, and the product now supports two complementary workflows — so the plan had to grow with it. Kept the filename for continuity; scope is rolling.

---

## Daily Structure (unchanged)

Every workday follows this order. No exceptions.

1. **Outreach first.** Complete the day's planned outreach before touching code.
2. **Product second.** Work on product improvement tracks only after outreach is done.

The reasoning: outreach compounds with consistency. Skipping a day to chase a code fix is always tempting and always wrong at this stage — and the compounding horizon is months, not weeks.

---

## Track 1: Outreach (rolling)

### What changed since April 3

The original plan was 20 workdays of processor-profile outreach against 221 Apollo look-alike accounts. That window has passed and the work is still ongoing. Key learnings that reshaped the plan:

- **Pool quality was noisier than expected.** Of the 201 accounts processed (after de-dupe/error cleanup), ~61% were skipped — panels, clinical CROs, qual-only shops, domain/name collisions, and a handful of bad Apollo entries. The 39% that survived are higher-quality than we could have filtered for upfront, but the skip rate means raw account count overstates addressable pool.
- **B2B sales cycles for MR tooling are longer than 20 workdays.** Even "interested" prospects need budget cycles, buy-in from ops leads, and a comparison against incumbent tooling. Two weeks isn't a validation window — it's the first touch.
- **Channel breadth compounds more than channel depth.** Pure email pushes saturate the same inboxes. Adding LinkedIn activity, a personal-brand presence, content/SEO, and Reddit makes the product discoverable from multiple angles over months, not just at inbox-open time.
- **Audience has expanded.** Phase 15 (Chat with Your Data) has shipped enough of v1 that we can now credibly approach the insights-professional audience. That changes the ICP mix starting in May (see Track 1.5 below).

### Current state (as of 2026-04-21)

**Antares-profile account work — 2026-04-05 through 2026-04-16 send days:**

| Metric | Count |
|--------|-------|
| Accounts in original pool | 221 (→ 201 after de-dupe / bad-entry cleanup) |
| Accounts researched + tiered | 201 |
| Accounts skipped | 122 (61% — pool noise) |
| Accounts outreached (pre-4/16 weekend) | 25 |
| Accounts queued, contacts pulled, ready to send | 54 |
| Accounts needing LinkedIn-only sourcing | 9 (Apollo returned nothing usable) |
| Accounts with thin Apollo pool (1 contact) | 4 (supplement via LinkedIn) |
| Total accounts that will be touched | ~79 (39% of original pool) |

**Emails sent by batch day (pre-4/16 weekend):**

| Date | Accounts | Emails scheduled |
|------|----------|------------------|
| 2026-04-05 | 9 | 25 |
| 2026-04-06 | 4 | 24 |
| 2026-04-07 | 3 | 13 |
| 2026-04-12 | 4 | 12 |
| 2026-04-14 | 5 | 31 |
| **Totals** | **25** | **~105** |

**Still queued:** 54 accounts, ~291 contacts (avg ~5.4 per account). Tier mix: 8 strong, 46 regular. Send work is manual, one account at a time, personalized per contact.

See `batch-logs/` for per-day batch logs, `batch-logs/outreach-tracker.md` for the per-account send queue, and `batch-logs/sprint-complete.md` for the 4/16 weekend completion summary.

### Strategy (revised)

**Audience 1: Data processors (Antares-profile).** Firms that do fielding, programming, and tabulation. The crosstab workflow is the primary value prop. Q/WinCross exports and programming-time savings are the headline. This work continues at a lower weekly cadence from the current queue.

**Audience 2: Insights professionals (starting May 2026).** Market research consultancies (HawkPartners-profile), agency research/strategy teams, corporate insights managers, brand teams. Chat with Your Data is the differentiated hook — the crosstab is the foundation, but the value for this audience is the conversational analysis surface grounded in verified artifacts.

Both audiences work together: selling processor-facing crosstabs produces the verified runs that an insights team can then interrogate conversationally. One workflow doesn't compete with the other; they compound.

### Channels (expanded from April 3)

**1. Direct email (primary, established).**
- Manual send from TabulateAI email. AI-assisted drafting is fine, but each email should feel personally written.
- Personalized per account (reference services, clients, recent work).
- No unsubscribe footer / mass-email signals.
- For insights-professional outreach starting May, lead with Chat with Your Data rather than export parity.

**2. LinkedIn outreach (secondary, same day as email).**
- Connection requests + short messages to the same contacts as email.
- LinkedIn Premium free trial for InMail access where email isn't findable.
- Especially important for insights-professional outreach — that audience reads LinkedIn more than email.

**3. LinkedIn Page — TabulateAI (new emphasis).**
- Product updates, customer stories, before/after output examples (sanitized).
- Commentary on MR industry shifts, AI tooling tradeoffs, programming-time benchmarks.
- Goal: someone evaluating the product after a cold email should find a credible, active company page.

**4. Personal brand — Jason's LinkedIn (new emphasis).**
- Building Jason's LinkedIn presence as a credibility anchor for TabulateAI.
- Share thinking from HawkPartners consultancy experience: survey craft, tab design decisions, what "good" output looks like.
- Cross-reference the TabulateAI page without being salesy. Credibility first, conversion secondary.
- This matters specifically for the insights-professional audience — they evaluate people as much as products.

**5. Content + SEO — blog (new, in progress).**
- Two blog posts live on the website. Continuous publishing cadence is the goal, not volume.
- Topics to cover: hybrid AI + deterministic compute, why grounded conversational analysis beats "chat with a CSV," WinCross style fidelity, programming-time savings math, how to evaluate MR tooling.
- SEO goal: rank for searches that MR ops leads and insights managers actually run ("WinCross automation," "crosstab software," "survey data chat AI," etc.).
- Content feeds both outbound (reference in emails) and inbound (organic discovery).

**6. Reddit (existing, maintain).**
- Post in market research subreddits where relevant and authentic. Focus on genuine value, not spam.

**7. Direct warm outreach (existing).**
- Sago, Testset, and other known prospects already in conversation.
- Follow-ups on all open threads.

### Weekly cadence (revised, rolling)

No longer a fixed five-week window. Rough rhythm:

| Phase | Window | Focus |
|-------|--------|-------|
| **April 2026** | Completed / ongoing | Processor send queue from 4/16 weekend sprint (54 accounts). Follow-ups on 25 already sent. |
| **May 2026** | Starts | First insights-professional outreach batch. Lead with Chat with Your Data. Continue processor follow-ups. Begin steady-state blog cadence. |
| **June 2026+** | Ongoing | Rolling multi-channel cadence: direct outreach, LinkedIn activity, blog posts, Reddit, warm intros. Re-contact non-responders with new material (product updates, blog posts, case studies). |

### Success metrics (unchanged framing, longer horizon)

1. **Buyer signal** — at least one firm enters a paid tier (PAYG counts). Primary goal.
2. **Demo completions** — prospects who try the demo end-to-end.
3. **Access requests** — prospects who request full platform access after demo.
4. **Response rate** — track which messages/channels/personas generate replies.
5. **Organic discovery (new)** — blog traffic, LinkedIn page follows, inbound from Reddit or SEO. Longer feedback loop but tracks brand-building return.

---

## Track 2: Product development

Work on these only after daily outreach quota is met.

### Track 2a: Phase 15 — Chat with Your Data (active)

This is the active product track, pulled forward from the post-PMF backlog specifically to enable insights-professional outreach. The conversational analysis surface is live at `/projects/[projectId]/runs/[runId]/analysis` and grounds answers in the same verified pipeline artifacts that power the crosstab workflow.

**Slice status:**

| Slice | Status |
|-------|--------|
| 0 — Convex schema + route scaffolding | ✓ Shipped |
| 1 — AI SDK streaming chat shell, persistent messages | ✓ Shipped |
| 2 — Grounded lookup tools, inline table cards | ✓ Shipped |
| Intermediate — Workspace surfaced via project-page CTA | ✓ Shipped |
| 3 — Claim-check + repair lane (durable trust layer) | **Next** |
| 4 — Session polish, follow-up suggestions | Follow-on |
| 5 — Durable artifact polish, copy/export hooks | Follow-on |
| 6 — Compute-lane design checkpoint | Deliberately deferred |

See `docs/implementation-plans/phase15-chat-with-your-data-v1-implementation-plan.md` for the slice-by-slice plan. See the `<analysis_surface>` section in `CLAUDE.md` for the code-level overview.

**Why it's ahead of the market-validation gate:** Processor outreach (Track 1, Audience 1) doesn't need Chat with Your Data — the crosstab workflow stands alone. Insights-professional outreach (Track 1, Audience 2) does. Shipping Phase 15 v1 alongside May's outreach expansion is the unlock.

### Track 2b: Output quality (continuing from original April plan)

The original April sprint's product track was output-quality work driven by Antares-profile feedback. Those items remain live — they drive the 30% → 60–70% programming-time savings target and they block serious processor adoption. Sequencing is still **validation first, then fixes**.

**Sequencing note (unchanged):** The temptation is to jump straight to prompt changes for question text and base text. Resist that. The right sequence is:

1. Run 2–3 surveys + Prevnar through the pipeline (P0)
2. Review output with a **presentation quality lens** — not correctness; that's last round's work. Focus on: does the question text read like what a programmer would write? Are base lines clean? Do denominators match across table types?
3. Compile specific findings across surveys
4. *Then* decide whether fixes are prompt changes, deterministic changes, or both — informed by real cross-survey evidence

**P0: Cross-survey validation.** Run 2–3 non-Prevnar surveys through the pipeline with the same rigor. Gives the evidence base for all subsequent fixes. Ensures fixes generalize, not Prevnar-specific. Re-run Prevnar to validate the summary-table denominator fix (base contract matrix, April 1 commits) against Poorna's reference.

**P1: Question text shortening.** Full verbatim survey text currently lands as table titles — paragraph-length. Every processor will edit this manually before client delivery. Likely fix: prompt change (TableContextAgent / SurveyCleanupAgent) and/or deterministic truncation in canonical assembly. Informed by P0 findings.

**P2: Base text quality.** Base text doesn't yet match what a programmer would write, even though denominator math is correct. Poorna explicitly linked this to substantial time savings. Ensure resolved base text from the base contract produces clean, standard base lines across survey types.

**P3: Base contract propagation audit.** Audit the full pipeline for base-related logic. Canonical assembly, TableContextAgent prompts, R script generation, WinCross serialization, Excel formatting — every surface that touches base text or denominators should consume the resolved contract, not infer its own.

**P4: QC assistance export.** Per-table companion Excel with table number, question text, variable name(s), base description, base count, denominator type, sample size. Antares manually QCs against SPSS today; this dramatically speeds it up without replacing their workflow. All data already exists in canonical `table.json` + R output — rendering/export task, not computation.

---

## What's explicitly not in scope (revised)

- **Full QC automation** (comparing pipeline output against SPSS programmatically) — strategic opportunity mapped to Phase 10/15 senior-processor QC, too large for near-term. P4 (QC assistance export) is the lightweight version.
- **Open-ended question linking** — not reliably solvable; deprioritized by mutual agreement.
- **Architecture changes** — no pipeline restructuring, no new stages, no schema migrations outside Phase 15 slice work.
- **WinCross serializer syntax fixes** — serializer is no longer the bottleneck per Antares feedback; remaining issues are upstream content quality.
- **New product features outside the plans above** — no multiple banners, no Excel input, no derived analytical tables. Those are post-validation (or phase 10/13+).
- **Proactive refactoring** — code changes limited to Track 2a (Phase 15 slices) and Track 2b (P0–P4) items.

> **Note on Chat with Your Data:** Previously listed as out-of-scope under the April framing. It's now the primary Track 2a deliverable — see above. The original "no chat" rule was correct for the fixed April window; it's the wrong rule for the rolling plan because Chat with Your Data is the insights-professional outreach hook.

---

## Decision Log

Track key decisions and pivots here as the plan evolves.

| Date | Decision | Context |
|------|----------|---------|
| Apr 3 | Shifted outreach target from HawkPartners-profile to Antares-profile firms | Data processors are the clearest initial value prop; role titles are unreliable so use account-first approach |
| Apr 3 | Manual email over Apollo sequences | Personalization > automation at this volume; Apollo unsubscribe footer looks mass-market |
| Apr 3 | LinkedIn added as co-equal outreach channel | Premium free trial available; covers contacts without findable emails |
| Apr 3 | Outreach extended from Apr 12 to May 3 | Original 10-day window insufficient; 20 workdays gives consistent daily effort |
| Apr 3 | Validation pass (P0) before any code fixes | Prevents Prevnar-specific band-aids; ensures fixes target root causes across survey types |
| Apr 3 | Added QC assistance export (P4) | Lightweight per-table metadata export to speed up Antares' manual QC — not full QC automation |
| Apr 4 | Account list built: 221 accounts from Apollo | Antares/Sago/Test look-alikes, filtered by industry, U.S. only. ~12 accounts/day, 30–60 emails/day. |
| Apr 16 | 4/16 weekend sprint completed research + contact pulls for remaining 201 accounts | 122 skipped (61% pool noise), 54 queued for manual send, 25 already sent across 4/5–4/14 |
| Apr 21 | Plan scope expanded from fixed April sprint to rolling multi-month effort | B2B cycles exceed 20-workday window; channel breadth (LinkedIn page, personal brand, blog/SEO) compounds over months not weeks |
| Apr 21 | Phase 15 (Chat with Your Data) pulled forward from post-PMF backlog to active Track 2a | Unlocks May insights-professional outreach; ships alongside audience expansion rather than waiting for the market-validation gate |
| Apr 21 | May 2026 scheduled as start of insights-professional outreach (Audience 2) | Phase 15 Slices 0–2 shipped + Slice 3 underway; conversational analysis is the differentiated hook for consultancy/brand-team audience |
