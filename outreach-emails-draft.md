# TabulateAI Outreach — Strategy & Email Templates (Draft v1)

---

## TARGETING STRATEGY

### The Universe

We built a list of **HawkPartners lookalikes** — companies in the market research world that also span management consulting, marketing, and advertising. All US-based, 11–200 employees, $500K–$50M revenue. This is intentionally narrow: small-to-mid MR firms where internal communication is tight and word-of-mouth travels fast. TabulateAI has broader applicability, but this is the beachhead.

### Why Three Tiers

From that company list, we created three prospect tiers on Apollo.IO based on role type. Apollo expands your keywords into matching titles, so each tier captures a range of actual job titles within the target.

**Tier 1 — Primary: Research Analysts & Managers (~500 sendable / ~833 total)**
People who do what Jason does at HawkPartners. Research analysts, insights managers, research directors — all levels. We intentionally did not filter by seniority. The theory: at companies this size, even a junior analyst who tries the demo and likes it will mention it to their manager. The tight internal communication at small firms means bottom-up adoption is a real path. That said, we may prioritize senior managers in early batches to test whether top-down or bottom-up converts better.

**Tier 2 — Secondary: Data Processors (~586 sendable broad / 26 sendable from lookalikes)**
Unlike Tiers 1 and 3, this group is **not restricted to HawkPartners lookalikes** — the role is too niche for that (only 26 verified emails at lookalike firms). The broad list pulls from the full market research industry and adjacent categories, giving us ~586 sendable contacts. The 26 lookalike-company contacts are the highest priority sub-group and should go out in the first batch.

These are the people who actually build crosstabs for others. They inspired the product in the first place: the initial feedback loop came from Antares (a data processing firm), and the Q script / WinCross .job export features were built specifically for this workflow. For data processors, TabulateAI isn't replacing their work — it's giving them a classified, structured starting point instead of a blank spec.

**Tier 3 — Tertiary: AI-Interested Roles (~36 sendable / ~47 total)**
The broadest and loosest fit. These are people at the same target companies who have AI mentioned somewhere in their profile or role. The thinking: they may have a mandate (or personal interest) to always be evaluating new AI tools. They may not do crosstab work themselves, but they're positioned to recognize a novel application of AI in MR (quant-side automation vs. the usual qual-side summarization) and route it to the right person internally.

### Warm Leads (Separate — Not in Apollo)
There's also a set of contacts from companies HawkPartners works with directly. These will be handled separately with more personalized outreach, not through the Apollo sequences.

### Sending Strategy
- **Tool:** Apollo.IO sequences (sends from Gmail, tracks opens/replies, auto-stops on reply)
- **Cadence:** 2-touch per person (initial + follow-up on Day 5)
- **Batching:** 50 primary + 26 lookalike data processors (priority) + 24 broad data processors + all 36 tertiary in Week 1, then rolling 50s per tier weekly
- **Goal:** Demo conversions → at least one paid-tier signal by Apr 12, 2026

---

## EMAIL TEMPLATES

**Sender:** Jason Anderson <jason.anderson@tabulate-ai.com>
**Signature block (all emails):**

> Jason Anderson
> Founder, TabulateAI
> [LinkedIn](https://www.linkedin.com/in/jasongandersonjr/)

**Merge fields:** `{{first_name}}`, `{{company}}`

---

## TIER 1 — PRIMARY TARGETS (Research Managers / Insights Managers)

### Email 1A: Initial

**Subject:** crosstabs from .sav — no spec, no wait

Hi {{first_name}},

I built TabulateAI because I spent years on the consulting side of market research waiting on crosstabs — or building them myself when timelines got tight.

The tool reads your .sav file and survey document, figures out the table structure (NETs, T2B, bases, stat testing), and produces publication-ready Excel output. AI interprets the research design; R computes every number. No hallucinated data.

If you want to see what it does with your own data, the demo processes 100 respondents and 25 tables — takes about five minutes to set up, and results come back to your inbox.

https://tabulate-ai.com/demo

Happy to answer any questions.

Jason

---

### Email 1B: Follow-up (Day 5)

**Subject:** re: crosstabs from .sav — no spec, no wait

Hi {{first_name}},

Wanted to follow up briefly — I know these things get buried.

If the table-building side of your projects ever feels like it takes longer than it should, TabulateAI might be worth five minutes of your time. You upload a .sav and survey doc, and it comes back with formatted crosstabs, stat tests, and NETs.

The demo is free and uses your actual data: https://tabulate-ai.com/demo

Your files are encrypted, not used for model training, and auto-deleted within 30 days. More on that here if helpful: https://tabulate-ai.com/data-privacy

Jason

---

## TIER 2 — SECONDARY TARGETS (Data Processors)

### Email 2A: Initial

**Subject:** Q and WinCross export from .sav — automated starting point

Hi {{first_name}},

I'm building TabulateAI — a tool that reads .sav files and survey documents, classifies every variable, and produces structured table definitions with NETs, stat testing, bases, and skip logic already mapped.

The output includes Q script packages and WinCross .job files, so instead of starting from a blank spec, you get a classified, analytically structured starting point that you can refine.

AI handles the interpretation (question types, NET groupings, table structure). R handles all the computation. No numbers come from the AI.

If you'd like to try it on a dataset, the demo takes about five minutes: https://tabulate-ai.com/demo

Happy to hear your thoughts — especially on what a tool like this would need to get right for your workflow.

Jason

---

### Email 2B: Follow-up (Day 5)

**Subject:** re: Q and WinCross export from .sav — automated starting point

Hi {{first_name}},

Quick follow-up in case this slipped past — I reached out last week about TabulateAI, which generates Q scripts and WinCross .job files from .sav data.

The idea isn't to replace what you do — it's to skip the setup. Variable classification, NET groupings, table specs, and stat test configuration come pre-built, ready for you to adjust.

Five-minute demo with your own data: https://tabulate-ai.com/demo

Curious if this is the kind of thing that would actually save you time, or if I'm solving the wrong part of the problem. Either way, I'd value the perspective.

Jason

---

## TIER 3 — TERTIARY TARGETS (AI-Interested at MR Companies)

### Email 3A: Initial

**Subject:** AI for the quant side of market research

Hi {{first_name}},

Most AI tools in market research focus on the qual side — summarizing open-ends, writing reports, pulling themes. I've been building something for the quantitative processing side.

TabulateAI takes an SPSS data file and survey document and produces publication-ready crosstabs — with stat testing, NETs, and proper bases. The AI reads the survey to understand the research design. Then validated R code computes every number from the actual data. Nothing is estimated or generated.

It also exports to Q and WinCross for teams that use those tools.

I'm curious how something like this would fit at {{company}} — whether it's relevant to your team's workflow or just an interesting approach. Either way, happy to chat.

The demo is free and takes about five minutes: https://tabulate-ai.com/demo

Jason

---

### Email 3B: Follow-up (Day 5)

**Subject:** re: AI for the quant side of market research

Hi {{first_name}},

Following up on my note about TabulateAI. The short version: it automates crosstab production from SPSS files, using AI for the interpretation and R for the math. The approach is a bit different from most AI tools in the space — it's focused on data processing accuracy, not content generation.

If you or anyone on your team touches survey data processing, the demo might be worth a look: https://tabulate-ai.com/demo

No commitment — just upload a .sav file and see what comes back.

Jason

---

## NOTES FOR APOLLO SEQUENCING

**Sequence setup (per tier):**
- Step 1: Initial email (Day 1)
- Step 2: Follow-up email (Day 5)
- Auto-stop: If prospect replies or clicks

**First batch (Week 1):**
- 50 primary targets
- 50 secondary targets
- All 36 tertiary targets

**Subsequent batches:**
- 50 per tier per week
- Monitor open/reply rates after first batch before scaling

**Subject line notes:**
- Lowercase subjects feel more personal / less marketing
- "re:" on follow-ups is a common cold email tactic — if it feels dishonest, drop it and use a fresh subject. Your call.
