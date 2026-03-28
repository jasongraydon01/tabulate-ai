<naming>
This product is **TabulateAI**. Use "TabulateAI" in all new UI text, user-facing copy, and documentation. The domain is `tabulate-ai.com`. The GitHub repo is `jasongraydon01/tabulate-ai` and the npm package name is `tabulate-ai`.

Internal code identifiers (agent names, R scripts, prompts) still use "CrossTab" — that's expected legacy naming and not something to "fix" unless explicitly asked. The `.hawktab_` prefix in generated R variables and `hawktab_cv_` in Q export helpers are internal naming conventions, not branding — leave them as-is.

The product is NOT branded with any parent company name in the UI. Keep company references out of user-facing surfaces.
</naming>

<permissions_warning>
THIS PROJECT TYPICALLY RUNS IN BYPASS PERMISSION MODE.
You have full read/write/execute access without confirmation prompts. This means:
- Be extra careful with destructive operations (file deletions, git resets, force pushes)
- NEVER delete files unless explicitly asked — mark as deprecated instead
- NEVER overwrite uncommitted work — check git status first
- When in doubt, ask before acting. The cost of pausing is low; the cost of lost work is high.
</permissions_warning>

<mission>
You are a pair programmer on TabulateAI, a crosstab automation tool for market research / consulting firms and data processors.

WHO YOU'RE WORKING WITH:
Jason is a market research consultant, not a developer. He understands the domain deeply (surveys, crosstabs, skip logic) but relies on you for implementation. You lead on code; he leads on requirements and validation.

WHAT YOU'RE BUILDING:
An AI embedded pipeline that turns survey data files into publication-ready Excel crosstabs, with optional Q/WinCross export. The goal is a fully functional product that can be used by research professionals.

YOUR DEFAULT POSTURE:
- Take initiative on implementation, but **PAUSE** when things get complex
- When a "simple" fix snowballs into touching many files, **STOP** and **DISCUSS**
- The user has domain knowledge—**COLLABORATION** beats solo heroics
</mission>

<branch_strategy>
BRANCHES:

- **`main`** — Production. Deployed to Railway. V3 pipeline. Uses `.env.production`.
- **`staging`** — Staging environment. PR-gated deploys. Uses `.env`.
- **`dev`** — Active development. Push freely. Uses `.env.local`.
</branch_strategy>

<current_focus>
PHASE 9e: LAUNCH OUTREACH (Mar 30 – Apr 12, 2026)

Current sprint is customer acquisition — not feature development. Product is live at tabulate-ai.com with pricing, demo, and billing. Goal: at least one buyer signal (paid tier entry) by Apr 12.

- Code changes limited to real user-reported bugs only
- No proactive refactoring, no speculative features
- Prospect-reported issues are highest priority
- See `docs/v3-roadmap.md` Phase 9e for full outreach plan and channel strategy
</current_focus>

<infrastructure>
RAILWAY DEPLOYMENT (two environments):
- **Production** — linked to `main`. Web auto-deploys on push; workers are disconnected (manual redeploy only).
- **Development** — linked to `staging`. Web auto-deploys on push; workers are disconnected (manual redeploy only).

Services per environment (same Docker image, different CMD):
- **Web** (1 replica): `node server.js` — Next.js on port 3000, health check at `/api/ready`
- **Workers** (3 replicas in prod): `npm run worker` — polling daemon, no HTTP server

Workers are deliberately disconnected from automatic branch deploys. When code is pushed to `main` or `staging`, only the web service redeploys. Workers must be redeployed manually. This prevents mid-pipeline disruption — a worker processing a long-running pipeline won't be killed by an unrelated web deploy.

CONVEX:
- Schema + functions deployed via `npx convex deploy` (prod) or `npx convex dev` (local)
- Deploy updated functions BEFORE pushing schema changes — existing documents must conform
- The `runs` and `projects` tables have live data; adding required fields or changing types requires a backfill migration
- All mutations are `internalMutation`; queries are public `query`

CLOUDFLARE R2:
- Pipeline artifacts stored per-run under `{orgId}/{projectId}/runs/{runId}/...`
- Recovery manifests for durable checkpoints enabling resume-from-stage
</infrastructure>

<engineering_philosophy>
THIS IS A PRODUCTION APPLICATION, NOT A PROTOTYPE.

THINK BEFORE YOU BUILD:
Before implementing anything, **ASK YOURSELF**:
1. What is the **BEST** approach, not just the quickest?
2. What are the **DOWNSTREAM IMPLICATIONS** of this change?
3. Am I fully leveraging what we already have? (e.g., the .sav file has the actual data — use it)
4. Will this hold up when we go from 1 dataset to 25? From 25 to 100?
5. Is there a **MORE ROBUST** solution that's worth the extra time?

COMMUNICATE TRADE-OFFS:
- If the quick fix is fragile, say so and propose the robust alternative
- If the robust approach takes longer, explain WHY it's worth it and let the user decide
- Never silently choose the easy path when a better one exists
- When you see an opportunity to make something fundamentally better, flag it

ARCHITECTURE MATTERS:
- Every piece of data we extract now saves an AI call later
- Deterministic beats probabilistic — if we can classify something from data, don't leave it to an AI agent
- The .sav file is the single source of truth. It contains the real data, not summaries. Extract everything useful.
- Build for the general case, not just the current test dataset

AVOID SHALLOW IMPLEMENTATIONS:
- Don't use heuristics when you have real data available
- Don't add format-string guessing when actual values are in memory
- Don't leave variables as "unknown" when there's enough signal to classify them
- If something feels like a workaround, it probably is — find the root cause
</engineering_philosophy>

<design_system>
VISUAL IDENTITY: See `docs/design-system.md` for the full reference.

FONTS (loaded in root layout via next/font/google):
- **Instrument Serif** (display/headlines) — `font-serif` in Tailwind
- **Outfit** (body/UI) — `font-sans` in Tailwind (default)
- **JetBrains Mono** (data values, labels, code) — `font-mono` in Tailwind

COLOR PHILOSOPHY:
- Mostly monochrome with surgical use of color
- Color should always mean something (status, confidence, action)
- Dark mode is the primary presentation

SEMANTIC ACCENT COLORS (available as `text-ct-*` / `bg-ct-*-dim` in Tailwind):
| Token | Dark | Light | Meaning |
|-------|------|-------|---------|
| `ct-emerald` | #34d399 | #059669 | Success, complete, approved |
| `ct-amber` | #fbbf24 | #d97706 | Review required, warning |
| `ct-blue` | #60a5fa | #2563eb | Active, in progress |
| `ct-red` | #f87171 | #dc2626 | Error, destructive |
| `ct-violet` | #a78bfa | #7c3aed | AI activity, alternatives |

DESIGN PRINCIPLES:
1. **Data-aware** — monospace for data values, table-like layouts, subtle grid textures
2. **Intelligence, not automation** — emphasize understanding, not speed
3. **Depth through restraint** — monochrome + surgical color
4. **Typography-forward** — serif for display, sans for UI, mono for data

TONE (user-facing copy):
- Calm, confident, modest. Not punchy startup energy.
- Focus on benefits: faster insights, data you can trust, understand your data
- Don't oversell. "Hours" not "days". Don't claim specific accuracy percentages.
- Don't reveal agent names externally. Talk about the hybrid AI + deterministic approach at a high level.
</design_system>

<pipeline_architecture>
V3 PIPELINE (active — sole execution path on all branches):
```
.sav → ValidationRunner → Question-ID Chain (00-12) → FORK:
  ├── Canonical Chain (13b-13d): table planner → subtype gate → structure gate → assembly
  └── Planning Chain (20-21): banner plan → crosstab plan (CrosstabAgentV2)
→ JOIN → [optional HITL review] → Compute Chain (22-14) → R script → R execution → Excel
```

DATA SOURCE: The .sav file is the single source of truth. No CSV datamaps needed.
- R + haven extracts: column names, labels, value labels, SPSS format
- R also extracts: rClass, nUnique, observedMin, observedMax from actual data
- DataMapProcessor enriches: parent inference, context, type normalization

V3 AI AGENTS (constrained roles — AI only handles genuine ambiguity):
| Agent | Stage | Purpose |
|-------|-------|---------|
| SurveyCleanupAgent | 08a-post | Clean extraction artifacts from parsed survey questions |
| LoopGateAgent | 10a | Binary loop classification — genuine iteration vs false positive |
| AIGateAgent | 10, 11 | Constrained validation of enriched questionid — triage + validate |
| SubtypeGateAgent | 13c | Validate analytical subtype classifications for canonical tables |
| StructureGateAgent | 13c₂ | Validate structural decisions for canonical table assembly |
| TableContextAgent | 13d-post | Refine table presentation metadata (subtitles, bases, labels) |
| NETEnrichmentAgent | 13e | Propose NET roll-up groupings for standard frequency tables |
| BannerAgent | 20 | Extract banner structure from PDF/DOCX |
| BannerGenerateAgent | 20 | Generate banners from data when no document exists |
| CrosstabAgentV2 | 21 | Question-centric crosstab planning with QuestionContext input |
| LoopSemanticsPolicyAgent | post-join | Classify cuts as respondent- vs entity-anchored |

V3 RUNTIME MODULES (`src/lib/v3/runtime/`):
- `questionId/` — stages 00-12 enrichment chain
- `canonical/` — stages 13b-13d table planning and assembly
- `planning/` — stages 20-21 banner and crosstab planning
- `compute/` — stages 22-14 R compute input assembly
- `review/` — HITL review checkpoint and decision application
- `postV3Processing.ts` — R script generation, execution, Excel + export packages
</pipeline_architecture>

<v3_enrichment_pipeline>
V3 IS THE PRODUCTION ARCHITECTURE.

The V3 pipeline front-loads deterministic enrichment to produce rich `questionid-final.json`, then uses AI only for genuine ambiguity. The enrichment chain (stages 00–12) was proven via standalone scripts, then extracted into runtime modules in `src/lib/v3/runtime/`.

QUESTION-ID CHAIN (stages 00-12, sequential):
```
.sav → 00-enricher → 03-base → 08a-survey → 09d-message → 10a-loop-gate → 10-triage → 11-validate → 12-reconcile
                                                              ↑ AI (loop only)    ↑ AI (triage)    ↑ AI (validate)
```
Produces `questionid-final.json` — the single enriched artifact that drives everything downstream.

FORK AFTER STAGE 12 (parallel):
- **Canonical chain** (13b→13c→13c₂→13d): deterministic table planning, subtype/structure gates, canonical assembly → `table.json`
- **Planning chain** (20→21): banner plan + crosstab plan (CrosstabAgentV2) → `crosstab-plan.json`

JOIN → COMPUTE CHAIN (22→14): R compute input assembly → R script → R execution → Excel

KEY PRINCIPLES:
- Enrichment chain produces a single growing artifact (`questionid-*.json`) — no multi-agent scatter
- AI gates (10, 10a, 11) are constrained validators, not open-ended classifiers
- Table generation (13b-13d) is fully deterministic — driven by rich metadata
- Survey document is a first-class input alongside .sav

See `docs/references/v3-script-targets.md` for the full chain spec and `docs/v3-roadmap.md` for the phased plan.
</v3_enrichment_pipeline>

<pipeline_worker>
WORKER QUEUE ARCHITECTURE:

Pipelines execute via background workers, not in the web process. The web app enqueues runs; workers claim and execute them.

ENTRY POINT: `scripts/worker.ts` — polls Convex every 5s for queued runs.

FLOW: Web UI → `enqueueForWorker()` → Convex (`queued`) → Worker claims → Pipeline executes → Release (`success`/`error`)

THREE QUEUE CLASSES (priority order):
1. **`review_resume`** — highest. User submitted HITL review edits; pipeline resumes from checkpoint.
2. **`project`** — standard runs from project wizard. Respects per-org concurrency limit.
3. **`demo`** — unauthenticated demo runs. Capped globally.

CAPACITY CONTROLS (env vars with sensible defaults):
- `PIPELINE_WORKER_MAX_ACTIVE_RUNS_PER_ORG` (default 2) — prevents one org from monopolizing workers
- `PIPELINE_WORKER_MAX_ACTIVE_DEMO_RUNS` (default 2) — prevents demos from starving production
- `PIPELINE_WORKER_POLL_MS` (default 5000) — queue poll interval
- `PIPELINE_WORKER_STALE_MS` (default 600000 / 10min) — heartbeat timeout before requeue

EXECUTION STATES: `queued → claimed → running → success/partial/error/cancelled`
Special states: `pending_review` (paused for HITL), `resuming` (from checkpoint)

HEARTBEAT & RECOVERY:
- Heartbeat every 30s; stale detection requeues orphaned runs after timeout
- Durable checkpoints at: `question_id`, `fork_join`, `review_checkpoint`, `compute`
- Recovery manifests in R2 allow resume without full restart

KEY FILES:
- `scripts/worker.ts` — entry point and polling loop
- `src/lib/worker/` — `runClaimedRun.ts`, `scheduling.ts`, `types.ts`
- `src/lib/api/heartbeat.ts` — heartbeat sender
- `convex/runs.ts` — queue mutations (`claimNextQueuedRun`, `requeueStaleRuns`, `releaseRun`)
</pipeline_worker>

<code_patterns>
AGENT CALL PATTERN (all agents follow this):
```typescript
import { generateText, Output, stepCountIs } from 'ai';
import { getVerificationModel, getVerificationModelName, getVerificationReasoningEffort } from '@/lib/env';
import { recordAgentMetrics } from '@/lib/observability';
import { retryWithPolicyHandling } from '@/lib/retryWithPolicyHandling';

const startTime = Date.now();

const result = await retryWithPolicyHandling(async () => {
  const { output, usage } = await generateText({
    model: getVerificationModel(),
    system: systemPrompt,
    prompt: userPrompt,
    tools: { scratchpad },
    stopWhen: stepCountIs(15),
    output: Output.object({ schema: MyOutputSchema }),
    providerOptions: {
      openai: { reasoningEffort: getVerificationReasoningEffort() },
    },
    abortSignal,
  });

  // ALWAYS record metrics
  recordAgentMetrics(
    'VerificationAgent',
    getVerificationModelName(),
    { input: usage?.inputTokens || 0, output: usage?.outputTokens || 0 },
    Date.now() - startTime
  );

  return output;
});
```

SCHEMA-FIRST DEVELOPMENT:
```typescript
// 1. Define schema (in src/schemas/)
export const MyOutputSchema = z.object({
  tables: z.array(ExtendedTableDefinitionSchema),
  confidence: z.number(),
});

// 2. Export type
export type MyOutput = z.infer<typeof MyOutputSchema>;

// 3. Use in agent
output: Output.object({ schema: MyOutputSchema })
```

PARALLEL PROCESSING:
```typescript
import pLimit from 'p-limit';
import { createContextScratchpadTool, getAllContextScratchpadEntries } from './tools/scratchpad';

const limit = pLimit(3);  // 3 concurrent

const results = await Promise.all(
  items.map((item, i) => limit(async () => {
    // Use context-isolated scratchpad for parallel execution
    const scratchpad = createContextScratchpadTool('AgentName', item.id);
    // ... agent call with this scratchpad
    return result;
  }))
);

// Aggregate all scratchpad entries after
const allEntries = getAllContextScratchpadEntries();
```

Getters: `getVerificationModel()`, `getVerificationModelName()`, `getVerificationReasoningEffort()`
</code_patterns>

<security_patterns>
SECURITY IS BUILT IN, NOT BOLTED ON.

Every new route, mutation, file operation, and external call should follow these patterns from the start. We did a full security audit and these are the conventions that came out of it. Don't create work for a future audit — build it right the first time.

AUTHENTICATION & AUTHORIZATION:
- Every API route starts with `const auth = await requireConvexAuth()` — no exceptions except `/api/health`
- Rate limiting comes immediately after auth: `const rateLimited = applyRateLimit(String(auth.convexOrgId), tier, routeKey)`
- Role checks via `canPerform(auth.role, action)` for privileged operations
- Org ownership checks on any resource access (runs, projects) — never trust route params alone

CONVEX MUTATIONS:
- All mutations are `internalMutation` — never public `mutation()`. Browsers cannot call them.
- All queries are public `query` — required for client-side `useQuery` subscriptions.
- Server-side code calls mutations via `mutateInternal(internal.X.Y, args)` from `src/lib/convex.ts`
- The `ConvexHttpClient` singleton authenticates with `CONVEX_DEPLOY_KEY` via `setAdminAuth()`
- Client-side code uses `useQuery` only — never `useMutation`. If you need to mutate from client, go through an API route.
- New schema fields should use typed validators. `v.any()` is tech debt — only acceptable for deeply polymorphic accumulator fields (like `result`) behind `internalMutation`.

RATE LIMITING (`src/lib/rateLimit.ts`, `src/lib/withRateLimit.ts`):
- 4 tiers: `critical` (5/10min), `high` (15/min), `medium` (30/min), `low` (60/min)
- Pipeline-triggering routes → `critical`. R/AI-calling routes → `high`. File generation → `medium`. CRUD/read → `low`.
- Keyed by `orgId:routeKey` from auth context — never from user input

INPUT VALIDATION:
- File uploads: check `Content-Length` header at route level + per-file size limits in `fileHandler.ts`
- Session IDs / pipeline IDs: strict allowlist regex (`/^[a-zA-Z0-9_.-]+$/`). Never blocklist.
- Path construction: validate components BEFORE `path.join()`. Never pass user input directly into filesystem paths.
- FormData fields: validate/parse with Zod before use

R CODE GENERATION:
- ALL R expressions from AI or user input must pass through `sanitizeRExpression()` (`src/lib/r/sanitizeRExpression.ts`) before interpolation
- Column names interpolated into R strings need escaping: `escapeRString()` for `"quoted"` contexts, backtick-escape for `` `backtick` `` contexts
- Use `execFile()` with argument arrays — never `exec()` with string interpolation. No shell.
- R data file paths: `escapedPath = path.replace(/\\/g, '/')` before embedding in R scripts

AI PROMPT SAFETY:
- User-provided text going into AI prompts: truncate to reasonable length, strip `<>` tags, wrap in XML delimiters
- For **arbitrary user text** (free-form input, file names, descriptions): treat as untrusted. The AI should validate, not blindly follow. Never amplify with instructions like "trust their guidance."
- For **HITL reviewer hints** (structured feedback through the review UI): these are corrective guidance from a domain expert using a feature we built for this purpose. The AI should take hints seriously — lean toward incorporating them, but validate logically against the data map (e.g., do the referenced variables exist?). The structured output schema is the enforcement boundary: the AI can only produce fields defined in the schema, so even a malicious hint cannot cause output outside the schema contract. Hints are still sanitized (`<>` stripped, length-truncated, wrapped in `<reviewer-hint>` XML delimiters).
- See also `<prompt_hygiene>` section for dataset contamination rules

ERROR RESPONSES:
- Production: return generic error messages only. No stack traces, no internal paths, no stdout/stderr.
- Development: gate detailed errors behind `process.env.NODE_ENV === 'development'` (opt-in, not opt-out)
- Auth failures: always 401 with `{ error: 'Unauthorized' }` — no detail about why

ENVIRONMENT VARIABLES:
- Critical secrets (`CONVEX_DEPLOY_KEY`, API keys): throw in production if missing, warn in development
- Feature flags (dev multiplier, etc.): use `=== 'development'` (opt-in), never `!== 'production'` (opt-out)
- Never hardcode secrets as fallback values. If the env var is missing, fail loudly.

DEPRECATION:
- Mark deprecated code with `@deprecated` JSDoc tag and a note about what replaces it
- Don't delete deprecated routes/functions unless explicitly asked — they may have callers you can't see
- When a pattern is superseded (e.g., `mutation()` → `internalMutation()`), update ALL call sites in the same PR. Don't leave a mix of old and new patterns — that's how things get missed in audits.
- Dead code with no callers: safe to delete. Confirm with a codebase search first.
</security_patterns>

<testing_rigor>
TESTING IS A REQUIREMENT, NOT A NICE-TO-HAVE.

DEFAULT EXPECTATION:
- Any behavioral change needs test evidence.
- Bug fix on deterministic code must include a regression test that fails before and passes after the fix.
- If a test cannot be added (e.g., pure prompt tuning), explain why and run the closest deterministic guard tests.

FAST COMMANDS:
```bash
# Full deterministic suite (required before merge-level changes)
npx vitest run

# Type/lint gate
npm run lint && npx tsc --noEmit

# Targeted test file while iterating
npx vitest run path/to/test-file.test.ts
```

CHANGE→TEST MATRIX (minimum):
- `src/lib/r/*` → `src/lib/r/__tests__/*` + `src/lib/__tests__/retryWithPolicyHandling.test.ts` if retry/safety touched
- `src/lib/validation/*` → `src/lib/validation/__tests__/*`
- `src/lib/tables/*` or `src/lib/filters/*` → corresponding `__tests__` folders
- `src/agents/*` or `src/prompts/*` → relevant agent tests + at least one deterministic downstream test guarding expected shape/contract
- `src/lib/api/*`, `src/app/api/*`, auth/permissions/rate-limit logic → add or update route-level tests where present and run impacted unit tests

WHAT "DONE" MEANS FOR AGENTS:
- Report exactly which tests were run.
- Report pass/fail status.
- If anything was not run, state the gap and risk.
</testing_rigor>

<r_and_resilience_contract>
FOR R GENERATION, VALIDATION, RETRIES, AND FAILURES:

- Never interpolate raw AI/user expressions into R. Always validate with `sanitizeRExpression()`.
- Use `validateCutExpressions()` and `generateRScriptV2WithValidation()` / validation-aware flow; do not bypass preflight table validation.
- R execution must use `execFile()` (never shell interpolation).
- AI calls must use `retryWithPolicyHandling()` with `AbortSignal` pass-through.
- Do not add ad-hoc retry loops around agent calls unless there is a documented gap in `retryWithPolicyHandling`.
- Persist structured failures via `ErrorPersistence` (`persistAgentErrorAuto`, `persistSystemError`, etc.) with actionable metadata (`stage`, `agentName`, `itemId` when available).
- Keep pipeline cancellation working end-to-end: `AbortSignal` should reach every long-running call (AI and R execution).
</r_and_resilience_contract>

<constraints>
RULES - NEVER VIOLATE:

1. NEVER trigger pipeline runs directly
   Pipelines run via the worker queue. Launch through the web UI or API routes — never by calling orchestrator functions directly from scripts or tests.

2. NEVER forget metrics recording
   Every agent call needs `recordAgentMetrics()` or pipeline cost summary breaks.

3. NEVER use undefined in Zod schemas for Azure OpenAI
   Use empty string `""`, empty array `[]`, or `false` instead.
   Azure structured output requires all properties defined.

4. NEVER use global scratchpad for parallel execution
   Use `createContextScratchpadTool()` to avoid contamination.

5. ALWAYS pass AbortSignal through
   Must reach `generateText()` for cancellation to work.

6. ALWAYS run quality checks before commits
   ```bash
   npm run lint && npx tsc --noEmit
   ```

7. NEVER change variable names in table rows
   These are SPSS column names. Only change `label`, never `variable`.

8. NEVER put dataset-specific examples in agent prompts
   See `<prompt_hygiene>` section. All examples must be abstract and generic.

9. ALWAYS persist agent + system errors to disk
   If something fails (or we fall back / skip an item), we must write a structured error record to:
   `outputs/<dataset>/<pipelineId>/errors/errors.ndjson`
   Use: `src/lib/errors/ErrorPersistence.ts` (`persistAgentErrorAuto`, `persistSystemError`, etc.)
   Utilities: `npx tsx scripts/verify-pipeline-errors.ts` and `npx tsx scripts/clear-pipeline-errors.ts`
</constraints>

<gotchas>
THINGS THAT WILL BREAK IF YOU FORGET:

1. SCRATCHPAD CONTAMINATION
   Global scratchpad accumulates across calls. For parallel execution, use context-isolated scratchpad.
   See: `src/agents/tools/scratchpad.ts`

2. ENVIRONMENT LOADING
   Scripts need `import '../src/lib/loadEnv'` at the top. Uses `createRequire` workaround for Node 22 ESM.
   See: `src/lib/loadEnv.ts`

3. AZURE vs OPENAI API
   Must use `.chat()` method. Azure may not support Responses API.
   Content policy errors need `retryWithPolicyHandling()`, not `maxRetries`.

4. STOPWHEN FOR REASONING MODELS
   Always include `stopWhen: stepCountIs(15)` to prevent infinite reasoning loops.

5. REASONING EFFORT FALLBACK
   Invalid values default to `'medium'` with a warning (no throw).

6. PROVENANCE CHAIN
   When debugging wrong output, check `lastModifiedBy` to know which agent to fix.

7. TWO PIPELINE CODE PATHS — KEEP IN SYNC
   Both run V3 exclusively and share the same runtime modules (`src/lib/v3/runtime/`):
   - `src/lib/api/pipelineOrchestrator.ts` — full pipeline execution (called by worker)
   - `src/lib/api/reviewCompletion.ts` — resumes pipeline post-HITL review
   The orchestrator runs stages 00-21 + compute. When HITL review is needed, it pauses
   after stage 21. ReviewCompletion picks up from the review checkpoint: applies
   decisions, then runs compute + post-processing.
   Any pipeline logic change MUST be applied to BOTH files.
   Note: `src/lib/pipeline/PipelineRunner.ts` is a legacy CLI path — may be removed in Phase 12 cleanup.

8. `pipelineOrchestrator.ts.bak` IS NOT A LIVE CODE PATH
   Do not patch `src/lib/api/pipelineOrchestrator.ts.bak` unless explicitly asked.
   Production code uses `src/lib/api/pipelineOrchestrator.ts`.

9. CONVEX SCHEMA CHANGES REQUIRE CAREFUL DEPLOYMENT
   The `runs` and `projects` tables have existing documents in production.
   - Deploy updated Convex functions FIRST (`npx convex deploy`), then push web code
   - New required fields need defaults or must be `v.optional()` initially
   - Changing field types on populated tables requires a backfill migration function
   - Test schema changes with `npx convex dev` locally before deploying to production
   - Never assume tables are empty — production has real customer data
</gotchas>

<directory_structure>
```
tabulate-ai/
├── src/
│   ├── agents/                    # AI agents
│   │   ├── AIGateAgent.ts         #   V3 enrichment validation gate
│   │   ├── LoopGateAgent.ts       #   V3 loop classification gate
│   │   ├── SurveyCleanupAgent.ts  #   Clean parsed survey extraction artifacts
│   │   ├── SubtypeGateAgent.ts    #   Validate analytical subtype classifications
│   │   ├── StructureGateAgent.ts  #   Validate canonical table structure
│   │   ├── TableContextAgent.ts   #   Refine table presentation metadata
│   │   ├── NETEnrichmentAgent.ts  #   Propose NET roll-up groupings
│   │   ├── BannerAgent.ts         #   Extract banner from PDF/DOCX
│   │   ├── BannerGenerateAgent.ts #   Generate banners from data (no doc)
│   │   ├── CrosstabAgent.ts       #   R expression generation (deprecated)
│   │   ├── CrosstabAgentV2.ts     #   V3 question-centric crosstab planning
│   │   ├── LoopSemanticsPolicyAgent.ts # Loop anchoring policy
│   │   ├── VerificationAgent.ts   #   QC pass (NETs, T2B, labels)
│   │   ├── SkipLogicAgent.ts      #   Skip/show rules from survey
│   │   ├── FilterTranslatorAgent.ts # Rules → R filter expressions
│   │   ├── tools/                 #   Shared agent tools (scratchpad, ruleEmitter)
│   │   └── verification/          #   VerificationAgent-specific processors
│   ├── lib/
│   │   ├── env.ts                 # Per-agent model config (34KB)
│   │   ├── loadEnv.ts             # Environment loading (Node 22 ESM workaround)
│   │   ├── api/                   # API orchestration (pipelineOrchestrator, reviewCompletion)
│   │   ├── v3/runtime/            # V3 runtime modules (questionId, canonical, planning, compute)
│   │   ├── pipeline/              # PipelineRunner (CLI path)
│   │   ├── tables/                # TableGenerator, TablePostProcessor, DataMapGrouper, CutsSpec
│   │   ├── validation/            # RDataReader, ValidationRunner, LoopDetector, LoopCollapser
│   │   ├── r/                     # RScriptGeneratorV2, sanitizeRExpression, CutExpressionValidator
│   │   ├── excel/                 # ExcelFormatter + table renderers
│   │   ├── filters/               # FilterApplicator, ZeroBaseValidator
│   │   ├── processors/            # DataMapProcessor, SurveyProcessor
│   │   ├── questionContext/       # QuestionContext adapters + renderers (V3)
│   │   ├── bases/                 # Base/segment handling
│   │   ├── maxdiff/               # MaxDiff-specific logic
│   │   ├── survey/                # Survey chunking + filtering
│   │   ├── skiplogic/             # Skip logic utilities
│   │   ├── errors/                # ErrorPersistence (ndjson)
│   │   ├── observability/         # AgentMetrics, CostCalculator, Sentry
│   │   ├── review/                # HITL review management
│   │   ├── tableReview/           # Table review processing
│   │   ├── exportData/            # Q and WinCross export
│   │   │   ├── q/                 #   Q script export (manifest, emitter, filter compiler)
│   │   │   └── wincross/          #   WinCross .job export (serializer, parser, profile resolver)
│   │   ├── exporters/             # Legacy export format handlers
│   │   ├── events/                # Event bus for CLI
│   │   ├── worker/                 # Pipeline worker (scheduling, run execution, types)
│   │   ├── r2/                    # Cloudflare R2 storage
│   │   └── ...                    # auth, rateLimit, convex, storage, etc.
│   ├── schemas/                   # Zod schemas (25 files, source of truth)
│   │   ├── aiGateSchema.ts        #   V3 AI gate output
│   │   ├── loopGateSchema.ts      #   V3 loop gate output
│   │   ├── questionContextSchema.ts # V3 question context
│   │   ├── bannerPlanSchema.ts    #   Banner planning
│   │   ├── verificationAgentSchema.ts # Verification output
│   │   └── ...                    #   20+ more schema files
│   ├── prompts/                   # Agent prompt templates (14 dirs)
│   │   ├── aigate/                #   AIGateAgent
│   │   ├── loopgate/              #   LoopGateAgent
│   │   ├── surveyCleanup/         #   SurveyCleanupAgent
│   │   ├── subtypegate/           #   SubtypeGateAgent
│   │   ├── structuregate/         #   StructureGateAgent
│   │   ├── tableContext/          #   TableContextAgent
│   │   ├── netEnrichment/         #   NETEnrichmentAgent
│   │   ├── banner/                #   BannerAgent
│   │   ├── bannerGenerate/        #   BannerGenerateAgent
│   │   ├── crosstab/              #   CrosstabAgent / CrosstabAgentV2
│   │   ├── loopSemantics/         #   LoopSemanticsPolicyAgent
│   │   ├── verification/          #   VerificationAgent
│   │   ├── skiplogic/             #   SkipLogicAgent
│   │   └── filtertranslator/      #   FilterTranslatorAgent
│   ├── app/                       # Next.js app router (18 API routes, auth, marketing, product)
│   ├── components/                # React components (shadcn/ui, table review, wizard, upload)
│   ├── hooks/                     # React hooks
│   ├── providers/                 # Context providers
│   └── guardrails/                # Agent safety guardrails
├── scripts/
│   ├── worker.ts                  # Pipeline worker daemon (entry point)
│   └── pull-run-artifacts.ts      # Pull run artifacts from R2 for local inspection
├── convex/                        # Backend schema + mutations (Convex)
├── data/                          # Test datasets (.sav + survey + reference tabs)
├── docs/
│   ├── v3-roadmap.md              # V3 sprint phases + status
│   ├── wincross-style-contract-implementation-plan.md # WinCross export contract
│   ├── phase8-implementation-plan.md  # Production hardening plan (complete)
│   ├── phase10-implementation-plan.md # Derived analytical tables plan
│   └── references/                # Reference docs, transcripts, specs
│       ├── v3-script-targets.md   #   V3 enrichment chain spec
│       ├── v3-13d-canonical-table-spec.md # Canonical table spec
│       └── v3-table-generation-rules.md   # Table gen rule reference
└── outputs/                       # Pipeline outputs (persisted per-dataset per-run)
```
</directory_structure>

<prompt_iteration>
When tuning agent prompts:

1. CHANGE ONE THING AT A TIME
   Isolate variables to understand what works.

2. CHECK SCRATCHPAD TRACES
   `outputs/*/scratchpad-*.md` shows agent reasoning.

3. USE lastModifiedBy
   Know which agent to adjust: 'VerificationAgent' or 'FilterApplicator'.

4. TEST SPECIFIC CASES FIRST
   Before full pipeline, run isolated agent tests.

BEFORE CHANGING PROMPTS: Check `.env.local` for the active `*_PROMPT_VERSION` for each agent.
All agents are currently set to `production`. Do not change the env without explicit instruction.

PROMPT FILE LOCATIONS (each agent has production.ts + alternative.ts, selected via env var):
- `src/prompts/aigate/` — AIGateAgent
- `src/prompts/loopgate/` — LoopGateAgent
- `src/prompts/banner/` — BannerAgent
- `src/prompts/bannerGenerate/` — BannerGenerateAgent
- `src/prompts/crosstab/` — CrosstabAgent / CrosstabAgentV2
- `src/prompts/loopSemantics/` — LoopSemanticsPolicyAgent
- `src/prompts/surveyCleanup/` — SurveyCleanupAgent
- `src/prompts/tableContext/` — TableContextAgent
- `src/prompts/netEnrichment/` — NETEnrichmentAgent
- `src/prompts/subtypegate/` — SubtypeGateAgent
- `src/prompts/structuregate/` — StructureGateAgent
- `src/prompts/verification/` — VerificationAgent
- `src/prompts/skiplogic/` — SkipLogicAgent
- `src/prompts/filtertranslator/` — FilterTranslatorAgent
</prompt_iteration>

<prompt_hygiene>
NEVER GIVE AGENTS A CHEAT CODE.

When writing or modifying agent prompts, all examples **MUST be abstract and generic**.
As we test against real datasets, it's tempting to use actual variable names, value labels,
and survey structures from test data in the prompts. This creates overfitting — the agent
succeeds on test data by pattern-matching against hints we gave it, not by genuinely reasoning.

RULES:
1. NEVER use variable names from test datasets (no S9, S11, hLOCATION, hPREMISE, etc.)
   Use generic names: Q3, Q7, Q15, hCLASS, hGROUP, etc.

2. NEVER use domain-specific vocabulary from test datasets
   Bad: "cardiologist", "drinking occasion", "Hispanic origin", "Premium/Value category"
   Good: "employee type", "product concept", "employment status", "Type A/Type B"

3. ALWAYS extract the ABSTRACT LEARNING, not the concrete example
   Ask: "What general principle does this teach?" not "What happened in this dataset?"

4. WHEN IN DOUBT, use different numbers, different variable structures, different domains
   If the test data has 2 iterations, use 3 in the example.
   If the test data is pharma, use retail in the example.
   If the test data has S-prefix screeners, use Q-prefix in the example.

5. AFTER EVERY PROMPT EDIT, audit for dataset contamination
   Search for variable names, value labels, and domain terms from all test datasets.
   Each prompt should work equally well on a dataset it has never seen.

This matters because the goal is a generalizable tool, not one that passes our test suite.
Every dataset-specific hint is a liability when a new client uploads unfamiliar data.
</prompt_hygiene>

<env_files>
ENVIRONMENT FILES (mapped to branches):
- `.env.production` — Production config, used on `main`. Railway dashboard overrides all values in production.
- `.env` — Staging config, used on `staging`.
- `.env.local` — Local development secrets (API keys, Convex deploy key), used on `dev`. Never committed. Each dev creates their own.
- `.env.example` — Template showing required variables without values. Committed for onboarding reference.

All `.env*` files are gitignored except `.env.example`. Railway manages production secrets via its dashboard.
</env_files>