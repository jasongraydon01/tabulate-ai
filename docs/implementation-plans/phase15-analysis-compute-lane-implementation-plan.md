# Phase 15 Sub-Plan — Analysis Compute Lane

**Status:** active design, not implemented.

**Purpose:** define the compute-lane architecture for Phase 15 so the analysis surface can extend a completed run without mutating the original run or re-litigating banner work that is already settled.

This document is intentionally tighter than a full implementation plan. Slice 1 is described as a guided technical overview. Later slices stay higher level and will be expanded into implementation plans only after Slice 1 is locked.

---

## Current state

Today the analysis surface is read-only with respect to pipeline artifacts.

- `src/app/api/runs/[runId]/analysis/route.ts` streams grounded answers over settled run artifacts.
- `src/lib/analysis/grounding.ts` reads:
  - `results/tables.json`
  - `enrichment/12-questionid-final.json`
  - `planning/20-banner-plan.json`
  - `planning/21-crosstab-plan.json`
- Stage 20 is the banner-planning step:
  - `BannerAgent` extracts groups and cuts from an uploaded banner document
  - `BannerGenerateAgent` generates groups and cuts when the banner route falls back
  - output is `planning/20-banner-plan.json`
- Stage 21 is the crosstab-validation step:
  - `CrosstabAgentV2` validates banner groups against the dataset
  - output is `planning/21-crosstab-plan.json`
- The worker runtime knows how to do:
  - full pipeline runs
  - review resumes
- It does **not** yet know how to run an analysis-triggered extension.

The most important limitation is this: analysis can inspect the settled banner and settled tables, but it cannot yet walk the user from "I want gender added" through "here are the exact cuts I found" and then freeze that aligned result for recompute.

---

## Where we need to be

For Tier B, the target workflow is:

1. User asks in analysis for a new cut across the dataset.
2. Analysis asks whether this is:
   - a table-only request
   - or a full rerun / banner extension
3. For a full rerun, analysis stays in chat and runs a **preflight**.
4. Preflight inspects:
   - the parent run's stage 20 banner plan
   - the parent run's stage 21 crosstab plan
   - the parent run's question/variable context
5. Preflight drafts **one appended banner group**.
6. Preflight immediately validates **only that one appended group** with the same single-group validation logic stage 21 uses.
7. Analysis shows the user the exact proposed group and cuts it found.
8. The user confirms yes or no in chat.
9. After final confirmation, backend creates a child run and moves into pipeline-in-progress.
10. The child run reuses the parent run's settled planning artifacts for all previously approved groups and appends the confirmed new group.
11. The child run recomputes outputs under a new run id. The original run remains unchanged.

The critical property is: **what the user aligned on in chat is what the child run actually consumes**.

---

## Why we chose this architecture

### 1. It preserves the good UX without weakening the trust model

The user should be able to stay in the chat window while the system finds the proposed cuts, shows them, and gets confirmation. That is a better experience than immediately kicking them into pipeline progress or a separate review screen.

But chat should not be the place where final dataset numbers are invented or where finished artifacts are patched in place. Backend compute still owns the actual rerun.

### 2. It avoids re-litigating settled groups

This is the main architectural decision.

We do **not** want a child run to hand the entire extended banner back to `CrosstabAgentV2` and let it revisit previously approved groups. That creates exactly the hesitation we surfaced in design: the user aligns on one new group in chat, but the rerun could quietly reinterpret old cuts.

Instead:

- the parent run's existing stage 20 and stage 21 outputs are treated as settled
- only the appended group is drafted and validated during preflight
- the child run consumes the parent run's settled planning plus the frozen appended group

### 3. The repo already has the seam we need

`CrosstabAgentV2` is not all-or-nothing. The code already exposes `processGroupV2`, which validates a single group. That is the right seam for preflight.

So Slice 1 should not be framed as:

- "run stage 20 and 21 again in miniature"

It should be framed as:

- "draft one stage-20 group"
- "run the exact stage-21 single-group validator on that group"
- "freeze the result for the child run"

### 4. Final stat letters belong to the child run, not the chat

The chat can lock:

- the appended group
- the cuts inside that group
- the validated expressions

The chat should **not** promise final stat letters as immutable, because letters are a function of the final rerun output universe. The child run should produce the final letters and final output layout.

### 5. We should not reopen the old HITL flow by default

If preflight returns a clean, user-confirmed appended group, that chat confirmation is the practical HITL for Slice 1.

The old review UI should only be a fallback for unstable cases, such as:

- policy fallback
- unresolved ambiguity
- low-confidence mappings the user did not resolve in chat

Default path:

- clean preflight + user confirms -> no extra review stop

Fallback path:

- messy preflight -> require review before compute

---

## Proposed slices

### Slice 1 — Tier B full-group extension with frozen preflight

This is the first slice we should build.

### Scope

Slice 1 supports only:

- full rerun / banner extension requests
- one appended banner group at a time
- chat preflight followed by child-run recompute

Slice 1 does **not** support:

- single-table derivations
- arbitrary multi-group recomputes
- editing old settled groups
- free-form "design me a whole new banner" workflows

### Core workflow

#### A. Chat triage

Analysis asks whether the request is:

- table-only
- or a full rerun

If it is a full rerun, analysis switches into banner-extension preflight.

#### B. Preflight input

Preflight should load from the parent run:

- `planning/20-banner-plan.json`
- `planning/21-crosstab-plan.json`
- `enrichment/12-questionid-final.json`
- any variable/question context needed to support single-group validation

#### C. Preflight output

Preflight should produce two frozen artifacts:

1. **Appended stage 20 group**
   - `groupName`
   - `columns[]`
   - each column's `name`
   - each column's `original`

2. **Appended stage 21 validated group**
   - the validated expressions for that same group
   - confidence / uncertainty fields
   - enough metadata to know whether the group is safe to proceed without review

The child run should consume these frozen artifacts directly.

#### D. Chat confirmation

The analysis response to the user should show:

- the proposed group name
- the cuts it found
- enough explanation for the user to confirm or reject

The user then confirms yes or no in chat.

#### E. Child run creation

On final confirmation:

- create an analysis compute job record
- create a child run with lineage to the parent run
- persist the frozen appended group artifacts
- enqueue the child run

#### F. Child-run execution

The child run should:

- reuse the parent run's settled stage 20 banner plan for all old groups
- append the frozen new stage 20 group
- reuse the parent run's settled stage 21 crosstab plan for all old groups
- append the frozen new validated stage 21 group
- skip rerunning banner discovery for old groups
- skip rerunning crosstab validation for old groups
- continue into compute and finalization

This is the key guarantee of Slice 1.

### Backend shape

Slice 1 likely needs:

- a new analysis-compute job record for lifecycle tracking
- optional lineage fields on `runs` so child runs are explicit
- a backend preflight service that can:
  - draft one appended group
  - validate one appended group
- a route that starts preflight and a route that confirms / enqueues the child run
- a new worker execution path for analysis extension runs

The exact schemas and route contracts belong in the later implementation plan. The architecture decision for Slice 1 is simply that **preflight freezes the appended group before the child run starts**.

### Review policy

Default:

- no extra review stop if preflight is clean and the user confirms in chat

Fallback:

- if preflight is unstable, force review before compute

### Acceptance criteria

Slice 1 is successful when:

- the user can request one new full group in chat
- the system can show the exact proposed cuts before rerun
- the user-confirmed appended group is the exact one used by the child run
- old settled groups are not revalidated or reinterpreted
- the original run remains immutable

---

### Slice 2 — Analysis workspace handoff and child-run resume

Once Slice 1 exists, improve the user experience around it.

Focus:

- clearer chat-state transitions
- pipeline-in-progress status inside the analysis workspace
- clean resume into the child run once outputs are ready
- system messaging that explains the new run is derived from the original run

This slice is mostly product polish on top of the core architecture.

---

### Slice 3 — Tier A single-table derivations

After Tier B is stable, add the smaller-scope compute lane.

Focus:

- one table or a very small related set
- appended cuts, NETs, or derived views
- persistent derived artifacts with clear lineage
- no mutation of the canonical run results

This slice should reuse the same overall philosophy as Slice 1:

- align in chat
- freeze the derived artifact inputs before compute
- backend compute owns the actual result

---

### Slice 4 — Discovery, history, and broader extension workflows

After both lanes exist, broaden the surface.

Possible focus areas:

- re-discovery of prior derivations within a run
- history of analysis-triggered compute jobs
- richer follow-up flows after recompute
- broader multi-group extension workflows if real usage supports them

This slice should remain usage-driven. It is intentionally deferred.

---

## Practical takeaway

The architecture is now:

- chat is responsible for **alignment**
- preflight is responsible for **freezing the appended group**
- the child run is responsible for **compute and final output**

That is the cleanest way to keep the user experience strong while ensuring the rerun does not reinterpret work that the previous run already settled.
