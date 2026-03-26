# Phase 10 Implementation Plan — Derived Analytical Tables

**Status:** Not started — deferred until Phases 1–9 are complete.

**Goal:** Automatically generate derived analytical tables that go beyond tabulating raw survey responses — shift analyses, cross-question comparisons, composite metrics, and category-level rollups. These are tables a senior analyst would build by hand after receiving initial tabulations.

**Why this matters:** This is the feature that most differentiates Crosstab AI from WinCross and Q. Those tools require an analyst to manually program every derived table. If we can detect the right opportunities and generate them automatically, we save hours of post-processing work and deliver richer output from day one.

---

## Two Use Cases

### Use Case A: Proactive Generation

The system examines the assembled table set, the enriched questionid metadata, and the survey structure, then **proactively generates** derived tables that add analytical value. These are additive — appended to the table set, clearly tagged as derived. If a user doesn't want one, they delete it. Low risk.

**Where it sits in the pipeline:**
```
... → 13e (context + NETs) → 13f-derived (NEW) → compute chain → R → Excel
```

### Use Case B: Reactive Generation (Post-Delivery Requests)

An analyst reviews the initial output and requests additional tables — e.g., "Can we get a summary that shows which message category was ranked 1st/2nd/3rd across all sets?" The system needs infrastructure to respond to these requests, which means the same pattern catalog, R generation layer, and table assembly machinery must exist.

This could eventually feed into a richer HITL review experience where reviewers can request new tables, not just edit existing ones. But the underlying engine is the same as Use Case A.

---

## Pattern Catalog

Research across two reference sources — a WinCross .job file (626 tables) and an internal reference workbook (71 tables) — identified 7 distinct patterns of derived analytical tables. These cover the vast majority of what human analysts build by hand.

### Pattern 1: Pre/Post Shift Analysis

**What it is:** Compare the same allocation/numeric question asked at different scenario points. Classify each respondent as increased/decreased/stayed the same. Compute mean difference.

**Trigger signal:** Multiple allocation questions on the same brands/items asked at different points in the survey flow (baseline → intervention → counter-intervention).

**Example:** S18b_B (current allocation) → A200a (hypothetical baseline) → D300a (after intervention) → D900 (after counter-intervention). Each is a separate questionId, but they all ask "what % would you allocate to Product A vs Product B?"

**Example:** A3 "last 100 cases" vs A4 "next 100 cases" — shift analysis per item at three granularity levels, each with increase/decrease/same + mean difference.

**Computation:** Per respondent: `diff = post_value - pre_value`. Classify: `diff > 0` → Increased, `diff < 0` → Decreased, `diff == 0` → Same. Tabulate the classification + compute mean of `diff`.

**R requirement:** Respondent-level arithmetic on existing .sav variables, creation of new derived variable, then standard tabulation of that variable.

**Multi-scenario extension:** Surveys with multiple scenarios (e.g., baseline → intervention → counter-intervention) are a natural fit here. Beyond pairwise shift analysis, an analyst would also want cross-scenario summary views — averages across scenarios, net change from first to last, and which items show the most volatility. Detection should flag when 3+ allocation questions share the same item set across survey flow points as a multi-scenario opportunity, not just pairwise shift.

---

### Pattern 2: Cross-Question Ratio

**What it is:** Divide one question's value by another per respondent, band the result into ranges, compute mean/median of the ratio.

**Trigger signal:** Two numeric questions where one is a subset of the other (e.g., "patients with condition X" / "total patients managed").

**Example:** S11 (subset count) / S10 (total count) → "% with characteristic X", banded into <25%, 25-49%, 50-74%, 75%+ with mean and median.

**Computation:** Per respondent: `ratio = Q_subset / Q_total * 100`. Band into ranges. Tabulate bands + mean/median.

**R requirement:** Respondent-level division, conditional banding (via `cut()`), standard tabulation.

---

### Pattern 3: Cross-Item Logical Combination

**What it is:** Evaluate a logical condition across multiple items in a grid question. "ONLY this item", "ALL items", "NONE of the items" meet a criterion.

**Trigger signal:** Grid questions where items represent competing alternatives (drugs, brands, categories) and a scale is applied to each.

**Example:** A1 asks about treatments and indications for 4 items. Derived rows: "ONLY Item A has this indication", "ALL 4 items have this indication", "NONE have this indication" — computed by checking each respondent's responses across all 4 items.

**Computation:** Per respondent: evaluate a logical expression across grid items. Tabulate the count/percentage meeting the condition.

**R requirement:** Multi-variable logical expressions, creation of binary derived variable, standard tabulation.

---

### Pattern 4: Ranking Cut-Point Summaries

**What it is:** Multiple views of the same ranking question at different thresholds (ranked 1st only, top 2, top 3, top K).

**Status:** **Already covered** by our canonical chain — `ranking_overview_rank` and `ranking_overview_topk` table kinds. No Phase 10 work needed.

---

### Pattern 5: Hierarchical Sum Rollup

**What it is:** Sum child allocation items into computed parent categories. "Public Insurance (Total)" = Medicare + Medicaid + VA.

**Trigger signal:** Allocation questions where items have a natural hierarchy (insurance types, practice settings, patient segments).

**Example:** B1 allocation question with 10+ items. Computed rows: "Any Category (Grand Total)", "Category A (Total)" = sum of 3-4 child items, "Sub-Category A1 (Subtotal)" = sum of 3 subcategories.

**Status:** Partially covered by NET enrichment (Pass B). May need extension for allocation-specific sum rollups where the hierarchy is semantic rather than just item grouping.

**Computation:** Per respondent: sum child variables. Tabulate the sum variable.

---

### Pattern 6: Composite Switching Metric

**What it is:** Identify respondents who rate one item high AND competing items low. A "switching potential" or "persuadability" metric.

**Trigger signal:** Scale questions rating competing alternatives (drugs, brands) on the same dimension (likelihood, preference, perception).

**Example:** "Product A high likelihood (T2B) WITH lower likelihood (B3B) for Products B & C" — identifies the segment that's uniquely favorable to Product A.

**Computation:** Per respondent: evaluate compound logical condition across items (item A in top-2-box AND items B, C in bottom-3-box). Tabulate the binary result.

**R requirement:** Multi-variable compound logical expression, binary derived variable, standard tabulation.

---

### Pattern 7: Category Rollup Across Exercise Sets

**What it is:** When a survey has parallel ranking/evaluation exercises across named sets (e.g., message themes), collapse individual items to their parent set and show which set "wins" at each rank level.

**Trigger signal:** Multiple ranking exercises (different questionIds) that share a common structure and are explicitly organized into named sets/themes.

**Example:** B500 has 3 message sets (Theme A, Theme B, Theme C). B700 shows "% where ANY Theme A message was ranked 1st" vs "% where ANY Theme B message was ranked 1st" — a set-level competition summary.

**Example (analyst request):** "Could we get a summary table that just shows % ranked 1, 2, 3 by category? We don't need the specific message, just which category has the most 1st, 2nd, 3rd place rankings."

**Computation:** Per respondent: determine which set contains their rank-1 pick, rank-2 pick, rank-3 pick. Tabulate at the set level.

**R requirement:** Mapping from individual items to parent set, per-respondent set-level classification, standard tabulation.

---

## Architecture

### Step 1: Opportunity Detection (deterministic + light AI)

Scan the enriched questionid metadata and assembled table set for structural signals that match the pattern catalog:

| Pattern | Detection Signal |
|---------|-----------------|
| Shift analysis | Multiple allocation/numeric questions on overlapping items at different survey flow points |
| Cross-question ratio | Two numeric questions where one is a semantic subset of the other |
| Cross-item logical combo | Grid items representing competing alternatives with a shared evaluation scale |
| Hierarchical rollup | Allocation items with parent-child semantic relationships |
| Composite switching | Scale questions rating competing items on the same dimension |
| Category rollup | Parallel ranking exercises organized into named sets |

Most detection can be deterministic (variable naming patterns, matching item labels across questions, survey section structure). AI helps with the ambiguous cases — "are A200a and D300a asking the same question at different timepoints?" requires understanding question text and survey flow.

### Step 2: Table Proposal (AI)

For each detected opportunity, an AI agent proposes:
- The specific derived table(s) to create
- Which source variables are involved
- What respondent-level computation is needed (in abstract terms)
- A natural language description of what the table shows and why it's useful
- Suggested table title, subtitle, and base text

The agent sees the enriched questionid entries, the relevant assembled tables, and the raw survey text for context.

### Step 3: R Expression Generation (AI → validated)

Convert the abstract computation proposal into concrete R code. This is similar to what the existing R generation layer does, but for derived variables rather than simple `freq()` / `mean()` calls:

```r
# Pattern 1 example: allocation shift
df$shift_product_a <- df$D300ar1c2 - df$A200ar1
df$shift_cat_product_a <- ifelse(df$shift_product_a > 0, "Increased",
                               ifelse(df$shift_product_a < 0, "Decreased", "No Change"))

# Pattern 6 example: composite switching
df$product_a_switch <- ifelse(df$A8r1 >= 4 & df$A8r2 <= 2 & df$A8r3 <= 2, 1, 0)
```

All generated R code passes through `sanitizeRExpression()` and `CutExpressionValidator` before execution — same safety pipeline as all other R generation.

### Step 4: Table Assembly

The computed derived variables get tabulated using the existing R pipeline infrastructure. Each derived table gets a canonical table definition with:
- `source: 'derived'` — clearly tagged as generated, not from raw survey data
- `derivedFrom: ['A200a', 'D300a']` — provenance back to source questions
- `derivedPattern: 'shift_analysis'` — which catalog pattern produced it
- Standard metadata: title, subtitle, baseText, rows

The tables are appended to the canonical table set and flow through the normal compute → R → Excel pipeline.

---

## Open Design Questions

1. **How many derived tables per dataset?** Need guardrails — probably cap at 20-30 derived tables max to avoid overwhelming the output.
2. **Ordering in Excel output:** Derived tables should appear near their source tables? Or in a separate "Analytical Summary" section at the end?
3. **Quality validation:** How do we verify derived table output is correct? Per-respondent computation is harder to spot-check than simple frequency tables.
4. **Use Case B mechanics:** How does the "request a new table" flow work? Through HITL review? Through a separate interface? Through natural language prompt?
5. **Pattern extensibility:** As we encounter new derived table types in future datasets, how do we add to the catalog without prompt contamination?

---

## References

- **WinCross .job reference:** `docs/references/wincross-job-reference/HCP_Vaccines.job` — 626 tables, shows B700/C700 cross-set summaries (Pattern 7) but no shift analysis tables
- **Internal reference workbook:** `docs/references/` — 71 tables, shows Patterns 1-3, 5-6 in practice
- **Analyst request:** Email requesting B700/C700 category-level summary — Pattern 7 as a reactive request (Use Case B)