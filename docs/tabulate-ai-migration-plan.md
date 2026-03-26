# TabulateAI Migration Plan

**Created:** 2026-03-26
**Last updated:** 2026-03-26
**Status:** In progress — Phase 1 underway, Phase 2 ready to start
**Repo:** `jasongraydon01/tabulate-ai` on `main`
**Local path:** `/Users/jasongraydon01/tabulate-ai/`
**Goal:** Rebrand from the hawktab-ai / crosstab-ai naming mix to a clean `tabulate-ai` identity across repo, services, and infrastructure. Move fast — outreach and demos are the priority.

---

## Progress (2026-03-26)

### Completed
- [x] All decisions resolved (see below)
- [x] New GitHub repo created: `jasongraydon01/tabulate-ai`
- [x] Clean initial commit pushed to `main` (fresh history, no old commits)
- [x] Gitignored files copied over: `.env.dev`, `.env.local`, `.env.production`, `export.job`, `HCP_Vaccines.job`

### In Progress (Jason)
- [ ] WorkOS — new application setup
- [ ] Resend — domain verification for `tabulate-ai.com`
- [ ] Stripe — new organization "TabulateAI"
- [ ] Remaining Phase 1 service setup (see checklist below)

### Up Next
- Phase 2: Code changes (Claude — can start anytime, no dependency on Phase 1 credentials)
- Phase 3: Wire up new credentials + deploy

---

## Strategy

**Orphan-and-fork:** This repo (`tabulate-ai`) was created from the `crosstab-ai` `dev-tabulate-ai` branch with clean git history. The old `crosstab-ai` repo will be archived. New external services are being stood up under the `tabulate-ai` name. Code changes are minimal because the user-facing UI already says "TabulateAI" everywhere.

**What stays:** Internal code identifiers (`CrossTab` agent names, `.hawktab_` R variable prefix, `hawktab_cv_` Q export prefix) are internal conventions with zero user exposure. Changing them would touch hundreds of lines for no functional benefit. They stay.

**What changes:** Repo identity, external service accounts, hardcoded fallback URLs, CLI removal, and a handful of config references.

---

## Decisions (Resolved 2026-03-26)

| Decision | Resolution | Notes |
|----------|-----------|-------|
| **D1: Domain** | `tabulate-ai.com` | Purchased on Porkbun |
| **D2: Stripe** | New organization "TabulateAI" | No existing customer data to preserve |
| **D3: Azure OpenAI** | Removing from stack | Not currently in use. Code stays for now (potential future configurable provider), but removed from env requirements |
| **D4: CLI** | Drop entirely | Deprecated, not needed. Remove `src/cli/`, `bin/hawktab`, and bin entry from package.json |
| **D5: Data migration** | Clean start (no migration) | New Convex project + R2 buckets start empty |
| **D6: Redirect** | None | Too early for anyone to have bookmarked `crosstab-ai.com` |

---

## Current State Audit

### Naming Layers (as of 2026-03-26)

| Layer | Current State | Target State |
|-------|--------------|--------------|
| **User-facing UI** | "TabulateAI" everywhere | No change needed |
| **Generated files** (Excel, R scripts, exports) | "TabulateAI" headers/creator | No change needed |
| **Download filenames** | `TabulateAI - Project - Date.xlsx` | No change needed |
| **Domain** | `crosstab-ai.com` | `tabulate-ai.com` |
| **Email** | `notifications@crosstab-ai.com` | `notifications@tabulate-ai.com` |
| **GitHub repo** | `jasongraydon01/crosstab-ai` | `jasongraydon01/tabulate-ai` (new repo) |
| **npm package** | `hawktab-ai` | `tabulate-ai` |
| **CLI command** | `hawktab` | Removed (deprecated) |
| **Docker service** | `hawktab` | `tabulate` |
| **Railway** | `crosstab-ai-dev` service | New project `tabulate-ai` |
| **Convex** | Project `crosstab-ai` | New project `tabulate-ai` |
| **Sentry** | Org `crosstab-ai` | New org `tabulateai` (display: TabulateAI) |
| **Cloudflare R2** | Buckets `crosstab-prod`, `crosstab-dev` | `tabulate-ai-dev`, `tabulate-ai-prod` |
| **WorkOS** | App under `crosstab-ai` | New application `TabulateAI` |
| **Azure OpenAI** | Resource `crosstab-ai` | Removing from stack |
| **Stripe** | Old account | New org "TabulateAI" |
| **PostHog** | Generic project key | Rename in dashboard |
| **Resend** | Verified for `crosstab-ai.com` | Verify `tabulate-ai.com` |
| **Temp directories** | `/tmp/hawktab-ai/` | `/tmp/tabulate-ai/` |
| **Internal R vars** | `.hawktab_*` prefix | No change (internal convention) |
| **Internal agent names** | `CrossTab*` | No change (internal identifiers) |

---

## Phase 1: External Service Setup

**Who:** Jason (account creation requires auth/billing access)
**Estimated effort:** 1-2 hours of dashboard work

### 1.1 Domain (`tabulate-ai.com`) — purchased
- [x] Domain purchased on Porkbun
- [x] DNS configured — waiting on propagation
- [x] SSL — Railway auto-provisions once DNS resolves

### 1.2 GitHub — done
- [x] Created new repo `tabulate-ai`
- [x] Pushed clean initial commit to `main`
- [x] Branch protection — not needed at this stage
- [x] GitHub Actions secrets — nothing to carry over

### 1.3 Railway — done
- [x] Project created, service connected to new repo
- [x] Env vars configured
- [x] DNS resolved, SSL provisioned

### 1.4 Convex — done
- [x] Create new project — slug: `tabulateai`
- [x] Envs updated across `.env.dev`, `.env.local`, `.env.production`

### 1.5 Cloudflare R2 — done
- [x] Created buckets: `tabulate-ai-dev`, `tabulate-ai-prod`
- [x] New API token created, envs updated
- [x] Account ID unchanged

### 1.6 Sentry — done
- [x] Create org — slug: `tabulateai`, display: `TabulateAI`
- [x] Create project `javascript-nextjs` under new org
- [x] Note DSN and auth token (for source map uploads)

### 1.7 WorkOS — done
- [x] New application created
- [x] Redirect URIs configured (production + development)
- [x] Client ID and API key in `.env.local` and `.env.production`

### 1.8 Stripe — done
- [x] New organization "TabulateAI" created
- [x] 4 products with recurring + metered prices (PAYG, Starter, Professional, Studio)
- [x] Meter created (event name: `crosstab_project_created`)
- [x] All price IDs, meter ID, keys configured in env files

### 1.9 Resend — done
- [x] Domain `tabulate-ai.com` verified
- [x] API key configured in env files

### 1.10 PostHog — done
- [x] Updated `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN` and `NEXT_PUBLIC_POSTHOG_HOST`
- [x] No code change needed

---

## Phase 2: Code Changes

**Prerequisites:** None — these can happen in parallel with Phase 1
**Who:** Claude + Jason review
**Estimated effort:** ~30 files total. Mostly find-replace.

### 2.1 Package Identity

**`package.json`**
```diff
- "name": "hawktab-ai",
+ "name": "tabulate-ai",
```
```diff
- "bin": {
-   "hawktab": "./bin/hawktab"
- },
```
Remove the `bin` field entirely (CLI is being dropped).

**`docker-compose.yml`**
```diff
  services:
-   hawktab:
+   tabulate:
```

**`package-lock.json`** — Auto-regenerates after `npm install`

### 2.2 CLI Removal

Delete the following:
- `bin/hawktab` (CLI entry point script)
- `src/cli/` (entire directory — `index.tsx`, `App.tsx`, `ARCHITECTURE.md`, `components/`)

Remove from `package.json`:
- The `"bin"` field
- The `"cli"` script (`"cli": "tsx src/cli/index.tsx"`)

Update CLAUDE.md:
- Remove CLI references and the "console suppression in CLI" gotcha
- Remove `src/cli/` from directory structure

### 2.3 Hardcoded Fallback URLs

These files contain hardcoded `crosstab-ai.com` as fallback values:

| File | Change |
|------|--------|
| `src/lib/billing/notifications.ts` | `app.crosstab-ai.com` → `app.tabulate-ai.com`, `notifications@crosstab-ai.com` → `notifications@tabulate-ai.com` |
| `src/lib/notifications/email.ts` | Same pattern |
| `src/lib/demo/sendDemoEmails.ts` | Same pattern |
| `src/lib/notifications/demoEmails.ts` | Privacy link: `app.crosstab-ai.com/data-privacy` → `app.tabulate-ai.com/data-privacy` |
| `src/app/api/demo/verify/route.ts` | App URL fallback |

**Note on `app.` subdomain:** Decide whether production uses `tabulate-ai.com` directly or `app.tabulate-ai.com`. If direct, drop the `app.` prefix from all fallbacks.

### 2.4 Sentry Config

**`next.config.ts`**
```diff
- org: "crosstab-ai",
+ org: "tabulateai",
```

### 2.5 Demo & Auth Identifiers

**`src/lib/demo/demoOrg.ts`**
```diff
- const DEMO_WORKOS_ORG_ID = 'demo_crosstabai_system_org';
- const DEMO_WORKOS_USER_ID = 'demo_crosstabai_system_user';
+ const DEMO_WORKOS_ORG_ID = 'demo_tabulateai_system_org';
+ const DEMO_WORKOS_USER_ID = 'demo_tabulateai_system_user';
```
```diff
- slug: 'crosstab-ai-demo',
+ slug: 'tabulate-ai-demo',
```
```diff
- email: 'demo@crosstabai.system',
+ email: 'demo@tabulateai.system',
```

**`src/lib/auth-sync.ts`**
```diff
- ? "crosstab-ai-dev"
+ ? "tabulate-ai-dev"
```

### 2.6 Temp Directory Naming

| File | Change |
|------|--------|
| `src/lib/storage.ts` (6 occurrences) | `'hawktab-ai'` → `'tabulate-ai'` |
| `src/lib/storage/TempDirManager.ts` (2 occurrences) | `'hawktab-ai'` → `'tabulate-ai'` |
| `src/app/api/loop-detect/route.ts` | `'hawktab-loop-detect-'` → `'tabulate-loop-detect-'` |

### 2.7 `.env.example` Updates

```diff
- # ══════════════════════════════════════════════
- # Crosstab AI — Environment Variables
- # ══════════════════════════════════════════════
+ # ══════════════════════════════════════════════
+ # TabulateAI — Environment Variables
+ # ══════════════════════════════════════════════
```
```diff
- R2_BUCKET_NAME=crosstab-dev
+ R2_BUCKET_NAME=tabulate-ai-dev
```
```diff
- # Default: Crosstab AI <notifications@crosstabai.com>
+ # Default: TabulateAI <notifications@tabulate-ai.com>
```

Also update or remove Azure OpenAI section — downgrade from `[REQUIRED]` to `[OPTIONAL]` or `[DEPRECATED]` with a note that it's not currently in use.

### 2.8 Azure OpenAI References

The Azure OpenAI integration code stays in place (it's wired throughout the agent system and could be a configurable provider in the future), but:
- `.env.example`: Mark Azure section as `[OPTIONAL — not currently in active use]`
- No code deletion needed — the agents will simply fail gracefully if keys aren't set, and the model provider can be swapped when ready

### 2.9 CLAUDE.md

Full rewrite of key sections:
- `<naming>`: Update to reflect `TabulateAI` as the canonical name, `tabulate-ai.com` as domain, and note that `CrossTab`/`.hawktab_` are legacy internal identifiers
- `<branch_strategy>`: Update domain/service references
- `<constraints>` and `<gotchas>`: Remove CLI-specific items, update service references
- `<directory_structure>`: Remove `src/cli/`, update package references
- `<env_files>`: Update to reflect new service names

### 2.10 Other Documentation

| File | Change |
|------|--------|
| `README.md` | Update title, description, directory tree |
| `docs/v3-roadmap.md` | Update domain/service references (crosstab-ai.com → tabulate-ai.com) |
| `.github/workflows/claude-review.yml` | Update naming convention notes |

### 2.11 Test Files (temp directory strings only)

| File | Change |
|------|--------|
| `src/lib/exportData/__tests__/localExports.test.ts` | `hawktab-local-export-` → `tabulate-local-export-` |
| `src/lib/exportData/__tests__/contract.test.ts` | `hawktab-export-phase0-` → `tabulate-export-phase0-` |
| `src/lib/exportData/__tests__/phase1.test.ts` | `hawktab-export-phase1-` → `tabulate-export-phase1-` |

---

## Phase 3: Environment & Deploy

**Note:** Env file updates are happening alongside Phase 1 as each service is set up. The remaining items here are post-code-change verification and deploy steps.

### 3.1 Env Files — in progress with Phase 1
- [x] `.env.local` — updated as each service is configured
- [x] `.env.dev` — updated as each service is configured
- [x] `.env.production` — updated as each service is configured
- [ ] Stripe env vars (pending Phase 1 Stripe setup)

### 3.2 Post-Code-Change Verification
```bash
npm install          # regenerates package-lock.json
npm run lint         # catch any broken imports from CLI removal
npx tsc --noEmit     # type check
npx vitest run       # full test suite
```

### 3.3 Convex Deploy
```bash
npx convex deploy    # pushes schema + functions to new deployment
```

### 3.4 Stripe Webhook (after Stripe setup)
- Create webhook endpoint: `https://tabulate-ai.com/api/billing/webhook`
- Subscribe to events: `customer.subscription.*`, `invoice.*`, `checkout.session.completed`
- Add webhook signing secret to Railway env vars

---

## Phase 4: Validation

### 4.1 Dev Branch
- [ ] `npm run dev` works locally
- [ ] Landing page loads
- [ ] Auth flow (sign up, sign in, sign out)
- [ ] Basic pipeline run

### 4.2 Staging Branch
- [ ] Deploy to staging
- [ ] Auth flow works
- [ ] Demo flow (upload .sav, receive email with results)
- [ ] Billing flow (checkout session, customer portal, webhook fires)

### 4.3 Production
- [ ] Site loads at `tabulate-ai.com`
- [ ] Auth flow works
- [ ] Sentry receives test error
- [ ] PostHog receives page view events
- [ ] Email arrives from `notifications@tabulate-ai.com` with correct branding

### 4.4 Final Sweep
```bash
# Verify no stale references remain:
grep -r "crosstab-ai" --include="*.ts" --include="*.tsx" --include="*.json" --include="*.yml" --include="*.md" .
```
Any hits should be either:
- Intentional (archive references in docs, this migration plan)
- Internal identifiers that were explicitly kept (see "What Does NOT Change" below)

### 4.5 Archive Old Repo
- [ ] Archive `jasongraydon01/crosstab-ai` on GitHub (read-only)
- [ ] Decommission old Railway service
- [ ] Old Convex project can stay (free tier) for reference

---

## What Explicitly Does NOT Change

These are intentional decisions, not oversights:

| Item | Reason |
|------|--------|
| `.hawktab_` prefix in generated R variables | Internal naming convention. Zero user exposure. Changing would touch ~50 test assertions for no benefit. |
| `hawktab_cv_` prefix in Q export helpers | Same — internal to generated Q scripts. |
| `CrossTab` in agent names and prompts | Internal identifiers. Never shown in UI. Agent names appear only in logs and metrics. |
| `WinCross*` type names in export code | "WinCross" is the name of the third-party product we export to — not our branding. |
| Azure OpenAI integration code | Stays in place as dormant/configurable provider. Not deleted, just not configured. |
| User-facing "TabulateAI" text | Already correct. No changes needed. |
| `"TabulateAI"` in Excel creator metadata | Already correct. |
| `"TabulateAI - "` download filename prefix | Already correct. |
| `# TabulateAI` headers in generated R/Q scripts | Already correct. |

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Stripe webhook misconfiguration | Medium | High — billing breaks | Test with Stripe CLI locally before going live. Verify webhook signing secret matches. |
| WorkOS redirect URI mismatch | Medium | High — auth breaks | Triple-check URIs match between WorkOS dashboard and env vars. Test auth flow immediately after deploy. |
| DNS propagation delay | Low | Medium — site unreachable briefly | Set low TTL on DNS records. Railway SSL provisioning can take a few minutes. |
| Convex schema drift | Low | Medium — data ops fail | Run `npx convex deploy` from the exact same code commit that Railway deploys. |
| CLI removal breaks imports | Low | Low — build fails | `npx tsc --noEmit` catches any dangling imports. Fix before deploy. |
| Missed hardcoded URL | Low | Low — wrong link in one email | Final grep sweep in Phase 4.2 catches stragglers. |
