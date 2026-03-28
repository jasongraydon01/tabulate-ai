# TabulateAI

**AI-powered survey data processing for market research professionals and data processors**

---

## What TabulateAI Does

TabulateAI turns raw survey data files (.sav) into publication-ready crosstabs — the formatted cross-tabulation tables that market research teams deliver to clients. It replaces hours of manual data processing with an intelligent pipeline that understands survey structure, classifies question types, and produces complete analytical output.

**Two ways it delivers value:**

1. **End-to-end automation** — Upload survey files, get formatted Excel crosstabs with statistical testing, NET groupings, summary tables, and banner plans. Researchers review and download.

2. **Accelerated starting point for data processors** — Export Q script or WinCross .job packages that give data processors a fully classified, analytically structured starting point instead of a raw import. NETs, base text, summary tables, and subtype-appropriate statistics are already built. The processor refines presentation rather than building from scratch.

---

## How It Works

### V3 Architecture: Enrich First, Compute Second

The pipeline front-loads deterministic enrichment to build a rich understanding of every survey question before any computation happens. AI is used only where genuine ambiguity exists — classification, structure validation, and crosstab planning. Everything else is deterministic.

```
.sav --> Validation --> Question-ID Enrichment (stages 00-12)
     --> FORK:
       |-- Canonical Chain: table planning --> subtype/structure gates --> assembly
       +-- Planning Chain: banner plan --> crosstab plan
     --> JOIN --> [optional HITL review] --> R compute --> Excel + Q/WinCross exports
```

**The .sav file is the single source of truth.** R + haven extracts column names, labels, value labels, SPSS format, and actual data statistics. No CSV datamaps needed.

### Pipeline Worker Architecture

Pipelines execute via background workers, not in the web process. The web app enqueues runs into Convex; workers poll, claim, and execute them.

```
Web UI --> enqueueForWorker() --> Convex (queued) --> Worker claims --> Pipeline executes --> Release
```

**Three queue classes** with priority ordering:
1. **Review resume** — highest priority. User submitted HITL review edits; pipeline resumes from checkpoint.
2. **Project** — standard runs from the project wizard. Per-org concurrency limits apply.
3. **Demo** — unauthenticated demo runs. Capped at 2 concurrent globally.

Workers send heartbeats every 30 seconds. Stale run detection requeues orphaned runs. Durable checkpoints at key pipeline boundaries allow resume without restarting from scratch.

### What the Pipeline Produces

| Output | Description |
|--------|-------------|
| **Excel workbook** | Formatted crosstabs with statistical testing, NET row styling, indentation |
| **Q script package** | Manifest + script for import into Q (Displayr) |
| **WinCross .job package** | Job file + companion data for import into WinCross desktop |
| **Pipeline decisions summary** | Natural-language briefing of what was found and built |

### What Gets Built Automatically

- **Subtype classification** — scale, standard, multi-response, ranking, allocation, numeric
- **NET groupings** — T2B/B2B, regional, category roll-ups per analytical subtype
- **Summary tables** — T2B summaries, mean summaries, ranking families
- **Statistical rows** — mean, median, std dev, std err on appropriate question types
- **Numeric rebanding** — raw observed values grouped into meaningful ranges
- **Base text** — derived from question context and filter logic, on every table
- **Banner plans** — extracted from uploaded documents or generated from data
- **Title cleanup** — survey document parsing produces clean, human-readable text
- **Loop detection** — automatic detection, variable collapsing, entity vs respondent anchoring

---

## V3 AI Agents

AI handles genuine ambiguity through constrained agents. Each agent has a specific role and operates on enriched data — not raw input.

| Agent | Stage | Purpose |
|-------|-------|---------|
| SurveyCleanupAgent | 08a | Clean extraction artifacts from parsed survey questions |
| LoopGateAgent | 10a | Binary loop classification — genuine iteration vs false positive |
| AIGateAgent | 10, 11 | Constrained validation of enriched question metadata — triage + validate |
| SubtypeGateAgent | 13c | Validate analytical subtype classifications |
| StructureGateAgent | 13c2 | Validate structural decisions for table assembly |
| TableContextAgent | 13d | Refine table presentation metadata (subtitles, bases, labels) |
| NETEnrichmentAgent | 13e | Propose NET roll-up groupings for frequency tables |
| BannerAgent | 20 | Extract banner structure from PDF/DOCX |
| BannerGenerateAgent | 20 | Generate banners from data when no document exists |
| CrosstabAgentV2 | 21 | Question-centric crosstab planning |
| LoopSemanticsPolicyAgent | post-join | Classify cuts as respondent- vs entity-anchored |

---

## Infrastructure

### Railway Deployment

Two Railway environments, each running a web service and worker service from the same Docker image:

| Environment | Branch | Web Replicas | Worker Replicas |
|-------------|--------|--------------|-----------------|
| **Production** | `main` | 1 | 3 |
| **Development** | `staging` | 1 | 1 |

- **Web service** (`node server.js`): Next.js on port 3000, health check at `/api/ready`
- **Worker service** (`npm run worker`): polling daemon, no HTTP server

Workers are disconnected from automatic branch deploys. When code is pushed to `main` or `staging`, only the web service redeploys. Workers are redeployed manually to prevent mid-pipeline disruption.

### Technology Stack

| Layer | Technology |
|-------|------------|
| **Framework** | Next.js 15 + TypeScript |
| **AI** | Vercel AI SDK + OpenAI |
| **Database** | Convex |
| **Auth** | WorkOS AuthKit |
| **File Storage** | Cloudflare R2 |
| **Monitoring** | Sentry |
| **Analytics** | PostHog |
| **Stats Engine** | R Runtime (haven, dplyr, tidyr) |
| **Hosting** | Railway |
| **Email** | Resend (from notifications@tabulate-ai.com) |
| **Billing** | Stripe |

---

## Development

### Prerequisites

- **Node.js 22+**
- **R Runtime** — `brew install r` (macOS) or [CRAN](https://cran.r-project.org/) (Windows)
- **R packages** — `Rscript -e "install.packages(c('haven','dplyr','tidyr'))"`
- **PDF processing** — `brew install graphicsmagick ghostscript` (macOS, for banner extraction)

### Setup

```bash
npm install
cp .env.example .env.local  # Fill in credentials
```

### Commands

```bash
npm run dev                       # Start dev server (Turbopack)
npm run dev:all                   # Start dev server + Convex dev watcher
npm run worker                    # Start pipeline worker daemon
npm run lint && npx tsc --noEmit  # Quality gate
npx vitest run                    # Test suite
```

### Convex

```bash
npx convex dev                    # Local development (watches for changes)
npx convex deploy                 # Deploy functions + schema to production
```

**Important:** When changing Convex schema, deploy updated functions first. The `runs` and `projects` tables have live data — adding required fields or changing types requires a migration.

---

## Project Structure

```
tabulate-ai/
├── src/
│   ├── agents/              # AI agents (11 V3 agents)
│   ├── prompts/             # Agent prompt templates (14 dirs, production + alternative)
│   ├── schemas/             # Zod schemas (30 files, source of truth)
│   ├── lib/
│   │   ├── v3/runtime/      # V3 pipeline modules (questionId, canonical, planning, compute, review)
│   │   ├── api/             # Pipeline orchestrator + review completion
│   │   ├── worker/          # Pipeline worker (scheduling, run execution, types)
│   │   ├── exportData/      # Q and WinCross export (serializers, parsers, emitters)
│   │   ├── r/               # R script generation + sanitization
│   │   ├── excel/           # Excel formatter + renderers
│   │   ├── validation/      # .sav reader, loop detection, validation
│   │   ├── processors/      # DataMapProcessor, SurveyProcessor
│   │   ├── tables/          # Table generation + post-processing
│   │   ├── observability/   # Agent metrics, cost calculator, Sentry
│   │   └── ...              # auth, filters, review, R2, events, etc.
│   ├── app/                 # Next.js app router (API routes, auth, product UI)
│   └── components/          # React components (shadcn/ui)
├── scripts/
│   ├── worker.ts            # Pipeline worker daemon (entry point)
│   └── pull-run-artifacts.ts # Pull run artifacts from R2
├── convex/                  # Backend schema + mutations
├── data/                    # Test datasets (.sav + survey docs + reference tabs)
├── docs/                    # Roadmap, implementation plans, reference specs
└── outputs/                 # Pipeline outputs (per-dataset, per-run)
```

---

## Documentation

| Document | Purpose |
|----------|---------|
| `CLAUDE.md` | AI assistant context, coding guidelines, architecture reference |
| `docs/v3-roadmap.md` | V3 sprint phases and status |
| `docs/wincross-style-contract-implementation-plan.md` | WinCross export contract and validation plan |
| `docs/references/v3-script-targets.md` | V3 enrichment chain specification |
| `docs/references/v3-13d-canonical-table-spec.md` | Canonical table specification |
| `docs/references/v3-table-generation-rules.md` | Table generation rule reference |

---

## Security

- **OpenAI** — API-based model access with structured output enforcement
- **Authentication** — WorkOS AuthKit with org-scoped access
- **Mutations** — all Convex mutations are `internalMutation` (server-only)
- **Rate limiting** — tiered by operation criticality
- **R execution** — `execFile()` with argument arrays, no shell interpolation
- **Input validation** — Zod schemas, path allowlists, expression sanitization

---

## License

Proprietary
