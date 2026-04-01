# WinCross: Programming vs QC Next Steps

## Purpose

This note translates the Antares feedback into a practical response plan and separates the next steps into:

1. TabulateAI behavior
2. WinCross export conventions
3. QC workflow inside TabulateAI

The goal is to avoid treating every issue as a WinCross serializer problem when the actual gaps sit in different layers of the system.
It is not a transcript summary. It is a product strategy memo for what TabulateAI should do next.

---

## Current Read

- The `30%` figure from Antares should be treated as **programming-time savings**, not a measured end-to-end workflow savings number.
- Antares still sees two distinct workstreams:
  - programming / job-file creation
  - QC / validating that the output is safe and correct
- Tracks A and B remain immediate priorities because output correctness and WinCross fidelity are table stakes.
- Track C exists because even if A and B improve materially, Antares still has a separate QC bottleneck.
- Some of the current gaps are true programming defects.
- Some of the remaining drag is not that they must QC, but that their current QC workflow is inefficient because it happens outside TabulateAI by cross-referencing SPSS / Decipher manually.
- Internally, this direction is informed by having run the pipeline across many datasets already. The open external validation question is how Antares experiences the output across studies beyond Prevnar once they run those projects themselves.

## Most Important Product Insight

The short-term goal should **not** be to eliminate manual QC.

The better goal is:

- keep manual QC if needed
- but move that QC workflow into TabulateAI
- make it much faster, clearer, and more targeted than the current SPSS / Decipher cross-check process

If Antares can review every table inside TabulateAI with much better visibility into bases, counts, denominators, filters, and warnings, that may create meaningful workflow savings even before we reach full automation trust.

This does **not** reduce the importance of A or B.
It means:

- A and B improve the output itself
- C improves the cost of trusting and validating that output

---

## What Antares Is Telling Us

### 1. Programming and QC are separate in their minds

They explicitly described:

- a **programming** step: creating the WinCross job correctly
- a **QC** step: manually validating that the tables and counts are right

That means a better `.job` alone will help, but it will not fully solve the workflow problem.

### 2. Summary-table mismatches are still a real programming issue

The clearest unresolved correctness issue is still:

- summary-table percentages
- denominator / base handling
- mismatches between summary tables and underlying tables

This is a product correctness issue, not merely QC overhead.
The exact failing layer still needs manual reconciliation table by table.
The current working read is that the remaining issue is more likely in WinCross serialization / convention handling than in TabulateAI's native Excel output, but that should be confirmed against the exact tables Antares flagged.

### 3. Some content/presentation issues remain upstream

They also called out:

- overly long question text
- base title wording / routing-specific base text
- OE / T1 / subnet structure issues
- occasional rendering or formatting noise

These are not purely WinCross serializer issues. Some belong in upstream table planning / labeling / content generation.

### 4. The real bottleneck is trustable verification

Raina’s question was the strategic one:

- if they still have to manually validate everything against SPSS, how do savings become meaningful?

That suggests the next big unlock is not just cleaner export output.
It is a **faster verification workflow**.

But this should be read as an additional track, not a replacement for fixing correctness or export fidelity.

---

## Recommended Framework

Treat the work as three tracks, not one.

## Track A: TabulateAI Behavior

This is anything about how the system plans, labels, structures, or computes tables before WinCross serialization.

### Includes

- summary-table logic and denominator intent
- base text generation
- long question text cleanup
- OE structure and NET/subnet relationships
- routing-aware labeling and question/title selection

### Why this matters

If these are wrong upstream, the WinCross export will still be wrong even if the serializer is perfect.

### Immediate next steps

- Continue tightening title/base/OE logic in a dataset-general way.
- Use the WinCross-exported Excel from Antares to isolate exact summary-table percent differences.
- Compare:
  - TabulateAI Excel
  - WinCross-rendered Excel
  - source-data expectations
- Classify mismatches by table family so denominator rules become explicit instead of ad hoc.

---

## Track B: WinCross Export Conventions

This is the serializer-specific layer.

### Includes

- WinCross syntax
- total line conventions
- summary-table emission rules
- AF/stat block formatting
- NET suffix style
- presentation fidelity to reference `.job` patterns

### Why this matters

This is where house-style fidelity and WinCross-specific correctness live.

### Immediate next steps

- Treat the current summary-table issue as likely serializer/convention work unless the table-by-table comparison shows otherwise.
- Manually reconcile the exact tables Antares believes are wrong against:
  - TabulateAI Excel
  - WinCross output produced from our `.job`
  - the reference WinCross-rendered Excel they sent
- Keep improving denominator handling where the WinCross-rendered output diverges from expected percentages.
- Use the reference `.job` only for preferences that are safely inferable and repeatable.
- Do not overfit vendor-specific conventions into global defaults unless they are clearly portable.

---

## Track C: QC Workflow Inside TabulateAI

This should be treated as a separate product problem.

### Core idea

Instead of trying to stop reviewers from checking tables, give them a much better place to do that checking.

### Desired outcome

Antares may still review every table initially, but instead of:

- opening SPSS
- checking Decipher reports
- cross-referencing counts manually
- mentally tracking bases and filters

they can do that review inside TabulateAI with the right context already surfaced.

### What the QC surface should show

For each table:

- base used
- denominator type
- filter / universe used
- counts used for percentages
- whether it is a summary table, NET table, OE table, filtered table, etc.
- warnings or risk flags
- source-data comparison results where available

### Why this matters

The current pain is not only “is the output wrong?”

It is also:

- “how do I verify this quickly?”
- “why should I trust this table?”
- “where should I spend my attention?”

That is a workflow problem, not just a serializer problem.

---

## Suggested QC Product Direction

## Phase 1: Mirror Their Current QC Process Inside TabulateAI

Build a reviewer view that lets them inspect each table with:

- table output
- underlying counts
- base / denominator metadata
- source comparison notes

This does **not** require replacing their manual review process.
It only requires making that process faster.

## Phase 2: Add Exception-Driven Review

Once the QC surface exists, flag only the tables that look risky:

- summary tables
- filtered tables
- OE structures
- tables with denominator ambiguity
- tables with mismatches against source-data recomputation

Then the reviewer can still check everything if desired, but the system guides attention first.

## Phase 3: Build Trust Through Evidence

Over time, shift from:

- “review every cell because we must”

to:

- “review flagged tables and spot-check the rest because the system has already shown its work”

This is the likely path to the `60-70%` range Antares described as meaningful.

---

## What QC Is and Is Not

### QC is not

- fixing broken denominator logic
- compensating for bad summary-table behavior
- working around incorrect upstream table structure

Those are programming problems.

### QC is

- validating that counts and percentages match expectations
- verifying that bases and filters are correct
- confirming that the rendered deliverable is safe to send
- reviewing wording / presentation where analyst judgment is required

That distinction is important because we should not let true correctness bugs hide under the label of “QC.”

---

## Immediate Next Steps

## Programming

- Analyze the WinCross-exported Excel from Antares against TabulateAI output.
- Identify exact summary-table denominator mismatches by table family.
- Continue improving long title / base-text / routing text behavior.
- Continue OE / NET / subnet work only where we can define robust general rules.

## QC

- Document Antares’ current manual QC checklist explicitly.
- Map each QC step to:
  - a programming fix
  - a QC surface requirement
  - or a true judgment call that likely remains manual
- Design a first-pass QC view in TabulateAI that surfaces:
  - bases
  - denominators
  - filters
  - counts
  - risk flags
  - source comparison evidence

## Validation

- Internal confidence should continue to come from dataset-general behavior across the studies already run through the pipeline.
- External validation should come from Antares running studies beyond Prevnar inside TabulateAI and reporting what feels:
  - generally improved
  - survey-family specific
  - or still study-specific

---

## Bottom Line

The next step is not simply “make the `.job` better.”

The next step is:

- continue fixing programming correctness issues
- continue tightening WinCross export fidelity
- and build a QC workflow inside TabulateAI so reviewers can verify output much faster than they do today

Tracks A and B are immediate output work.
Track C addresses the separate QC bottleneck that will still matter even after A and B improve.

That is the most realistic route to turning current programming gains into real workflow savings.
