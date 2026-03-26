# WinCross Export — Feedback Triage

This note separates external tab-vendor feedback into three buckets:

1. True export-contract issues that affect correctness or practical usability.
2. House-style / presentation fidelity issues.
3. Ambiguous items we should confirm with the tab vendor before treating as blockers.

The point is to avoid over-calling every delta a "WinCross bug". Some of these are real exporter defects. Some are style choices. Some belong upstream in survey-cleanup or canonical labeling.

---

## Bottom Line

### Current read
- Our `.job` is usable as a starting point, but it is not yet a straight-through vendor-grade export.
- The biggest concern is not cosmetics. It is summary-table base logic. That changes the reported percentages.
- The second class of concern is content fidelity: wrong scale anchor text, duplicated OE theme rows, and stubs polluted with question text.
- The rest is mostly style / cleanup debt: title wrapping pipes, Unicode normalization, preferred ordering, capitalization, and similar polish.

### Practical implication
- I would not frame the current output as blocked on every external comment.
- I would frame it as not yet safe to claim "matches vendor WinCross conventions" until the correctness items are fixed.

---

## Bucket 1: Contract-Critical Or Near-Critical

These are the items I would treat as real export defects, not optional style alignment.

### 1. Summary tables using `Total^TN^1` instead of `Total^TN^0`
- **Observed**:
  - Our export uses `Total^TN^1` everywhere.
  - The reference file uses `Total^TN^0` on summary tables such as Top 2 Box, Middle Box, Bottom Box, and Mean Summary outputs.
- **Why it matters**:
  - This changes the denominator. It is not a display preference.
  - Summary percentages can become self-referential if the base only includes respondents who selected the summarized codes.
- **Classification**: Export contract / correctness bug.
- **Likely fix owner**: WinCross serializer.

### 2. Numeric interim tables should prefer native `AF=` stat blocks
- **Observed**:
  - Our export sometimes emits every observed numeric value as its own stub, then adds stats.
  - The reference uses `AF=S7^  ^OA` plus `^SM`, `^SD`, `^SV`, `^SR`.
- **Why it matters**:
  - For interim data, enumerating all current values is brittle. New values later will not automatically have stubs.
  - This is not just style. It affects durability of the `.job`.
- **Classification**: Export convention with real operational impact.
- **Likely fix owner**: WinCross serializer, with planner input when analyst-defined ranges are intentional.

### 3. Scale anchor / factor-code mismatch
- **Observed**:
  - In one of our anchored scale distributions, code `(7)` is labeled with a `1-...` prefix.
  - The reference correctly aligns the label prefix with the coded value.
- **Why it matters**:
  - This is a content bug, not a formatting preference.
  - A human can misread the table even if WinCross technically runs it.
- **Classification**: Data-labeling bug.
- **Likely fix owner**: Canonical row-label generation or scale-label mapping.

### 4. OE theme duplication that repeats the same count twice
- **Observed**:
  - Our coded OE tables include a NET row and then a child like `T1.<same concept>`, creating visible duplication.
  - Reference OE tables keep the NET row and then the more specific `T1.ST1`, `T1.ST2`, etc., without repeating the theme as another value row.
- **Why it matters**:
  - This creates visible duplicate values in the table body.
  - It is not a WinCross syntax problem, but it is a real deliverable-quality issue.
- **Classification**: High-priority content/presentation bug.
- **Likely fix owner**: OE coding output design upstream of the serializer.

---

## Bucket 2: High-Priority Fidelity / House Style

These should be fixed if the goal is "their style", but I would not call all of them blockers to basic `.job` usability.

### 5. Remove `|` from table titles
- **Observed**:
  - Our serializer intentionally inserts `|` line breaks in titles.
  - The reference style prefers a plain single-line title string with spaces only.
- **Why it matters**:
  - This is a style contract issue, not a calculation issue.
  - It likely does not prevent WinCross from loading the job, but it does break fidelity to their preferred authored style.
- **Classification**: Serializer presentation choice, not semantic breakage.

### 6. Unicode escape strings like `<U+2019>`
- **Observed**:
  - Example in our export: `I don<U+2019>t ...`
- **Why it matters**:
  - Ugly and unprofessional; may also signal incomplete text normalization.
  - Usually not a blocker to execution.
- **Classification**: Text-cleanup / serializer-output hygiene.

### 7. Rating scales should show the top anchor first
- **Observed**:
  - Our Top 2 Box children can appear `6` then `7-Extremely Positive`.
  - The reference prefers `7` first, then `6`.
- **Why it matters**:
  - This is mainly readability and house style.
  - It does not change calculations if the codes are correct.
- **Classification**: Ordinal display-order convention.

### 8. Stub rows should contain only the attribute text
- **Observed**:
  - Some summary-table stubs repeat the full question wording after each message fragment.
  - The reference keeps only the attribute text itself.
- **Why it matters**:
  - This is much noisier and makes OE summary tables hard to read.
  - It is more a row-labeling problem than a WinCross problem.
- **Classification**: Survey-cleanup / canonical-label fidelity issue.

---

## Bucket 3: Ambiguous Or Needs Confirmation

These are the items I would not hard-code as blockers until the tab vendor clarifies intent.

### 9. "OI2 already set at the job level; no need to specify at the stub level"
- **Why ambiguous**:
  - The wording suggests a WinCross-specific preference, but the reference file still uses row-level NET suffixes such as `^SX,GX`.
  - I do not see evidence that this is a core execution issue from the reference alone.
- **Current read**:
  - Treat this as a vendor style rule until they show the exact pattern they want removed.

### 10. Exact NET row suffix styling (`^SX` vs `^SX,GX`)
- **Why ambiguous**:
  - Their reference uses `^SX,GX` broadly.
  - Our export sometimes emits only `^SX`.
  - This may affect presentation behavior in WinCross, but from the feedback it is not yet clear whether this is mandatory for import, mandatory for display parity, or simply preferred.
- **Current read**:
  - Worth aligning eventually, but confirm before calling it a blocker.

---

## Ownership By Pipeline Layer

### WinCross serializer (`src/lib/exportData/wincross/serializer.ts`)
- Summary-table total line selection (`TN^0` vs `TN^1`)
- Title wrapping behavior (`|`)
- Unicode text normalization on final emitted strings
- Native `AF=` emission for stat-only numeric tables

### Canonical / table-planning / label-generation
- Wrong scale-anchor numbering like `1-Extremely Positive` on code `(7)`
- Preferred ordinal ordering within scale tables
- Deciding when a table is a summary versus full distribution if serializer cannot infer it cleanly

### Survey-cleanup / OE coding output
- Removing question text from attribute stubs
- Eliminating duplicated OE theme rows where NET and `T1` say the same thing

---

## What I Would Ask The Tab Vendor

If we want sharper feedback from them, the most useful question is not "are these all blockers?" It is:

- Which of these issues prevented direct use of the `.job`?
- Which were quick cleanup edits versus structural rebuilds?
- Did you have to recalculate tables, or mainly restyle titles/stubs/base lines?
- Which issue classes must be fixed before your team can use our export at all?

That will tell us whether we are dealing with:
- a true export-contract gap,
- a style-fidelity gap,
- or just the normal last-mile cleanup an external tab house expects.

---

## Concrete Roadmap

This roadmap assumes we invest in Buckets 1 and 2 now, and explicitly defer Bucket 3.

### Phase 1: Correctness And Durability

Goal: make the exported `.job` reliable enough that we can defend "good starting point" without hand-waving around incorrect bases or obviously wrong labels.

#### 1. Summary-table base logic
- **Work**:
  - Detect summary/derived tables and emit `Total^TN^0` instead of `Total^TN^1`.
  - Preserve support for explicit filtered totals like `Total^VariableName (codes)^0` where needed.
- **Owner**: WinCross serializer.
- **Why first**: This is the most important correctness issue.
- **Acceptance**:
  - Top 2 Box, Bottom Box, Middle Box, and Mean Summary tables export with the intended total-line behavior.
  - Summary percentages align with corresponding detail tables.

#### 2. Numeric stat-table durability
- **Work**:
  - Expand native `AF=` handling for stat-only numeric tables.
  - Distinguish true analyst-defined bins from interim-value enumeration.
- **Owner**: WinCross serializer, with planner guardrails if needed.
- **Why first**: Avoid fragile jobs that break as interim values expand.
- **Acceptance**:
  - Interim numeric tables no longer require enumerating every currently observed value.
  - Uploaded reference styles that use native `AF=` continue to round-trip cleanly.

#### 3. Scale-label correctness
- **Work**:
  - Fix code-to-label alignment so the anchor prefix matches the actual code.
  - Add regression tests for 7-point scales and similar anchored ordinal questions.
- **Owner**: Canonical row-label generation / scale handling.
- **Why first**: Wrong anchor text is visibly incorrect even if the table technically runs.
- **Acceptance**:
  - `(7)` never receives a `1-...` label.
  - High and low anchors consistently match their coded values.

#### 4. OE duplication cleanup
- **Work**:
  - Remove duplicate theme rows where NET and top-level theme row carry the same count.
  - Keep NET plus specific subthemes instead of NET plus duplicate umbrella child.
- **Owner**: OE coding output / canonical row generation.
- **Why first**: This is a real deliverable-quality problem, not just a style preference.
- **Acceptance**:
  - NET rows do not repeat as duplicated child rows.
  - Reference-style coded OE tables read cleanly without repeated counts.

### Phase 2: Generalizable Fidelity Improvements

Goal: improve visible match to uploaded reference jobs in ways that are portable and worth productizing.

#### 5. Title-style normalization
- **Work**:
  - Stop emitting `|` line-wrap markers in serialized table titles.
  - Normalize title text to plain spaces.
- **Owner**: WinCross serializer.
- **Acceptance**:
  - Exported titles no longer contain synthetic `|` breaks.
  - Long titles remain readable without looking unlike authored reference jobs.

#### 6. Unicode cleanup
- **Work**:
  - Normalize escaped Unicode artifacts like `<U+2019>` into real characters or approved ASCII equivalents.
- **Owner**: WinCross serializer text-output path.
- **Acceptance**:
  - Escaped Unicode artifacts do not appear in exported job text.

#### 7. Ordinal display-order conventions
- **Work**:
  - Standardize scale presentation so fully anchored positive scales show highest anchor first where appropriate.
  - Preserve logical order for other scale types rather than hard-coding one rule everywhere.
- **Owner**: Canonical ordering rules, not the profile parser alone.
- **Acceptance**:
  - 7-point positive scales read `7, 6, ...` in the style expected by reference jobs when relevant.
  - Order changes do not break NET grouping or mean/stat rows.

#### 8. Expand what a reference upload can actually teach us
- **Work**:
  - Extend profile extraction beyond alignment hints to lightweight style preferences that are safely inferable.
  - Candidate learnable preferences:
    - preferred NET suffix token when clearly detectable
    - whether title line-break markers should be preserved or flattened
    - stable row alignment conventions
    - maybe ordinal anchor order when strongly evidenced across many tables
- **Owner**: WinCross profile parser plus serializer application layer.
- **Important constraint**:
  - Do not pretend a single uploaded `.job` can teach semantic planning rules that it cannot reliably encode.
- **Acceptance**:
  - Uploaded references produce measurable style adaptation beyond spacing/alignment only.
  - We can explain exactly which preferences are learnable from the profile and which are not.

### Deferred Phase 3: Last-Mile Cleanup

Goal: explicitly defer work that is useful but not necessary for the current "80% fidelity" claim.

#### Defer for now
- Deep OE stub rewriting where the issue is really upstream survey cleanup
- Local house-style wording and casing choices that do not affect meaning
- Highly bespoke analyst preferences that are difficult to infer safely from a reference job

This is the work we can reasonably leave to the tab house or treat as later product polish.

---

## Product Positioning

### What we should claim now
- Uploading a WinCross reference helps us match many structural and formatting conventions.
- The output is intended to be a strong starting point for a tab team, not a claim of perfect authored parity.
- We are targeting reliable and portable WinCross exports first, then reference-informed fidelity improvements.

### What we should not claim yet
- That any uploaded `.job` teaches us all of a team's semantic table-planning preferences
- That we reproduce every local house style automatically
- That export parity is complete enough to remove all tab-house cleanup

### Simple positioning language
- "We aim to produce a usable WinCross-ready starting point that reflects your house conventions where they can be learned safely from your reference file."
- "We do not yet claim perfect one-to-one authored parity with every tab vendor's last-mile style choices."

---

## Vendor Conversation Plan

### What to ask about this version
- Was the export usable as a working starting point?
- Which fixes were mandatory before your team could use it?
- Which fixes were quick cleanup versus true rebuilds?
- Did any issue create incorrect percentages or materially wrong table interpretation?

### What to show after Phases 1 and 2
- Corrected summary-table denominator behavior
- Cleaner numeric stat handling
- Corrected scale anchors
- Cleaner title output and Unicode normalization
- Improved visible fidelity where the uploaded reference can teach stable conventions

### What to clarify in the pitch
- The reference upload is for style adaptation and serialization alignment, not for learning every analyst judgment implicitly.
- The product goal is "high-quality starting point with meaningful house-style adaptation", not "perfect recreation of every handcrafted `.job`".
