# April Sprint: Validation & Outreach

**Window:** April 5 (Sun) – May 3 (Sat) — 20 workdays (Mon–Fri)
**Goal:** Get at least one paying customer for TabulateAI, and close the gap from 30% to 60–70% programming-time savings for Antares-profile firms.

---

## Daily Structure

Every workday follows this order. No exceptions.

1. **Outreach first.** Complete the day's email + LinkedIn quota before touching any code.
2. **Code second.** Work on the product improvement track only after outreach is done.

The reasoning: outreach compounds with consistency. Skipping a day to chase a code fix is always tempting and always wrong at this stage.

---

## Track 1: Outreach (20 workdays)

### Strategy

Target firms that look like Antares — companies that do fielding, programming, and tabulation for research clients. Not full-service research consultancies (HawkPartners profile), but dedicated data processing and field shops.

**Reference accounts (for Apollo.io look-alike search):**
- Antares
- Sago
- Test

### Account-First Approach

Role titles are unreliable across these firms. A "Project Manager" at one shop does the same programming work as a "Data Processing Director" at another. The approach:

1. **Build the account list.** Use Apollo.io's "companies like" feature against the three reference accounts. U.S. only. This produces the master list.
2. **Prioritize accounts.** Not every look-alike is equally promising. Prioritize by: firm size (sweet spot: 20–150 employees), services offered (must do tabulation/programming, not just fielding), and any signal of current WinCross/Q usage.
3. **Identify 3–5 contacts per account.** Manually review each account to find the right people — project managers, data processing leads, programming team leads, operations directors. Don't rely on title-based filtering alone.
4. **Divide contacts across 20 days.** Total contacts / 20 = daily quota.

### Channels

**Email (primary):**
- Send manually from personal email — not through Apollo sequences
- AI-assisted drafting is fine, but each email should feel personally written
- No unsubscribe footer / mass-email signals
- Personalize per-account: reference their services, clients, or recent work where visible

**LinkedIn (secondary, same day):**
- Connection requests + short messages to the same contacts targeted by email
- Use LinkedIn Premium free trial for InMail access
- Also reach people whose email addresses aren't findable
- Profile should be updated to reflect TabulateAI context before outreach begins

### Weekly Cadence (approximate)

| Week | Dates | Focus |
|------|-------|-------|
| 0 (prep) | Apr 5–6 (Sun–Mon) | Build account list, prioritize, identify first batch of contacts |
| 1 | Apr 7–11 | First full outreach week. Aim for all priority accounts touched. |
| 2 | Apr 14–18 | Follow-ups on Week 1 + new accounts. Iterate messaging based on response patterns. |
| 3 | Apr 21–25 | Continued outreach + follow-ups. Mid-sprint assessment: what's working? |
| 4 | Apr 28–May 2 | Final push. Follow-up on all open threads. Close any warm leads. |

### Success Metrics

1. **Buyer signal** — at least one firm enters a paid tier (PAYG counts). Primary goal.
2. **Demo completions** — prospects who try the demo end-to-end.
3. **Access requests** — prospects who request full platform access after demo.
4. **Response rate** — track which messages/channels/personas generate replies.

---

## Track 2: Product Improvement

Work on these only after daily outreach quota is met.

### Sequencing Note

**Validation first, then fixes.** The temptation is to jump straight to prompt changes or code fixes for question text and base text. Resist that. The right sequence is:

1. Run 2–3 surveys + Prevnar through the pipeline (P0 below)
2. Review output with a **presentation quality lens** — not correctness (that was last round), but: Does the question text read like what a programmer would write? Are base lines clean? Do denominators match across table types?
3. Compile specific findings across surveys
4. *Then* decide whether fixes are prompt changes, deterministic changes, or both — informed by real cross-survey evidence

This prevents band-aids that work for Prevnar but break on other structures. It also ensures we're fixing root causes, not symptoms.

### P0: Cross-Survey Validation (Do This First)

**Problem:** Most pipeline testing has focused on Prevnar (the Antares benchmark study). Other surveys have been run through the pipeline and produced output, but haven't received the same level of scrutiny — reviewing every table, checking denominators, validating question text, confirming .job correctness.

**What Antares said:** They want to test additional studies. We should do the same on our side first.

**Impact:** Gives us the evidence base for all subsequent fixes. Ensures fixes are generalizable, not Prevnar-specific. Catches survey-specific edge cases before Antares (or any new prospect) encounters them.

**Approach:** Select 2–3 surveys from our test data that represent different structures (e.g., one with loops, one with grids, one straightforward tracker). Run each through the pipeline, then review the Excel and .job output with the same rigor applied to Prevnar. This time the focus is **presentation quality**: question text length, base text readability, denominator consistency, table structure, and whether the output looks like what a programmer would send to a client without manual edits.

Also re-run Prevnar to validate the summary table denominator fix (base contract matrix, April 1 commits). Compare summary table percentages against the WinCross reference output Poorna shared.

### P1: Question Text Shortening

**Problem:** Full verbatim survey question text is being used as table titles. These can be paragraph-length. Every data processor at every firm will need to manually shorten these before client delivery.

**What Poorna said:** "The question text is too lengthy."

**Impact:** Affects every table in the output. Fixing this removes a per-table manual edit that multiplies across hundreds of tables.

**Approach:** Informed by P0 findings. The fix may be a prompt change (e.g., TableContextAgent or SurveyCleanupAgent), a deterministic change (truncation/extraction logic in canonical assembly), or both. Don't prescribe the solution until we see the patterns across surveys. The goal is the kind of concise title a programmer would write — not the full survey instrument text.

### P2: Base Text Quality

**Problem:** Base text lines don't match what a programmer would write. Even though the base contract matrix fixed the denominator math, the human-readable text still requires manual editing.

**What Poorna said:** "The base title needs to be updated manually." She explicitly linked this to substantial time savings if fixed.

**Impact:** Affects every table. Combined with P1, these two fixes address the two things Poorna said would move the needle most.

**Approach:** Informed by P0 findings. Ensure the resolved base text from the base contract produces clean, standard base lines. The fix needs to work across survey types — not just Prevnar's specific routing patterns.

### P3: Base Contract Propagation Audit

**Problem:** The base contract matrix defines correct behavior, but not all parts of the system are aware of it yet. Some AI agents may still generate contradictory base descriptions or denominator logic because they haven't been updated to respect the resolved contract.

**Impact:** Creates inconsistency — some tables follow the contract, others don't. Undermines trust in the output.

**Approach:** Audit the full pipeline for base-related logic. Ensure the base contract resolution propagates through: canonical assembly, TableContextAgent prompts, R script generation, WinCross serialization, and Excel formatting. Every surface that touches base text or denominators should consume the resolved contract, not infer its own.

### P4: QC Assistance Export

**Problem:** Antares manually QCs every table by cross-referencing counts and bases against the SPSS data file. This is time-consuming and our platform doesn't help with it at all.

**What Raina asked:** Can TabulateAI help automate or assist the QC process?

**Impact:** Doesn't replace their QC workflow, but dramatically speeds it up by providing the reference data they're manually looking up. This is a differentiator — no other tool gives them a QC companion file alongside the tables.

**Approach:** Generate a simple Excel export (available as a download from the project detail page alongside the existing exports) that provides, per table: table number, question text, variable name(s), base description, base count, denominator type, and sample size. All of this data already exists in the canonical `table.json` and R compute output — this is a rendering/export task, not a computation task. Keep it simple: one worksheet, one row per table, clean headers.

---

## What's Explicitly Not in Scope

- **Open-ended question linking** — not reliably solvable; deprioritized by mutual agreement
- **Full QC automation** (comparing output against SPSS programmatically) — strategic opportunity mapped to Phase 10/15, but too large for this sprint. The QC assistance export (P4) is the lightweight version that helps without building the full workflow.
- **Architecture changes** — no pipeline restructuring, no new stages, no schema migrations
- **WinCross serializer syntax fixes** — the serializer is no longer the bottleneck per Antares feedback; remaining issues are upstream content quality
- **New features** — no Chat With Your Data, no multiple banners, no Excel input. Those are post-validation.
- **Proactive refactoring** — code changes are limited to the five items above

---

## Decision Log

Track key decisions and pivots here as the sprint progresses.

| Date | Decision | Context |
|------|----------|---------|
| Apr 3 | Shifted outreach target from HawkPartners-profile to Antares-profile firms | Data processors are the clearest value prop; role titles are unreliable so use account-first approach |
| Apr 3 | Manual email over Apollo sequences | Personalization > automation at this volume; Apollo unsubscribe footer looks mass-market |
| Apr 3 | LinkedIn added as co-equal outreach channel | Premium free trial available; covers contacts without findable emails |
| Apr 3 | Outreach extended from Apr 12 to May 3 | Original 10-day window insufficient; 20 workdays gives consistent daily effort |
| Apr 3 | Validation pass (P0) before any code fixes | Prevents Prevnar-specific band-aids; ensures fixes target root causes across survey types |
| Apr 3 | Added QC assistance export (P4) | Lightweight per-table metadata export to speed up Antares' manual QC — not full QC automation |
