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
| **Sentry** | Org `crosstab-ai` | New org `tabulate-ai` |
| **Cloudflare R2** | Buckets `crosstab-prod`, `crosstab-dev` | `tabulate-prod`, `tabulate-dev` |
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
- [ ] Configure DNS (will point to Railway in Phase 3)
- [ ] No SSL setup needed yet — Railway provisions automatically when domain is connected

### 1.2 GitHub — done
- [x] Created new repo `tabulate-ai`
- [x] Pushed clean initial commit to `main`
- [ ] Set branch protection rules if desired
- [ ] Transfer or re-create GitHub Actions secrets (Sentry auth token, etc.)

### 1.3 Railway
- [ ] Create new project `tabulate-ai`
- [ ] Create production service (connected to new GitHub repo, `main` branch)
- [ ] Don't deploy yet — env vars need to be configured first (Phase 3)

### 1.4 Convex
- [ ] Create new project `tabulate-ai` in Convex Dashboard
- [ ] Create production deployment → note the deployment URL + deploy key
- [ ] Create development deployment → note the deployment URL + deploy key

### 1.5 Cloudflare R2
- [ ] Create bucket `tabulate-prod`
- [ ] Create bucket `tabulate-dev`
- [ ] Create new API token with Object Read & Write permissions
- [ ] Note: account ID stays the same, just new token + buckets

### 1.6 Sentry
- [ ] Create org `tabulate-ai`
- [ ] Create project `javascript-nextjs` under new org
- [ ] Note DSN and auth token (for source map uploads)

### 1.7 WorkOS — in progress
- [ ] Create new application `TabulateAI`
- [ ] Configure redirect URIs:
  - Production: `https://tabulate-ai.com/auth/callback`
  - Development: `http://localhost:3000/auth/callback`
- [ ] Note client ID and API key
- [ ] Configure social providers (Google, etc.) as needed

### 1.8 Stripe — in progress
- [ ] Create new Stripe organization "TabulateAI"
- [ ] Create products and prices matching current plan structure:
  - PAYG: recurring + metered price
  - Starter: recurring + metered price
  - Professional: recurring + metered price
  - Studio: recurring + metered price
- [ ] Create meter for project usage
- [ ] Set up webhook endpoint URL (configure after deploy): `https://tabulate-ai.com/api/billing/webhook`
- [ ] Note all price IDs, meter ID, publishable key, secret key, webhook secret

### 1.9 Resend — in progress
- [ ] Add and verify domain `tabulate-ai.com`
- [ ] Set up SPF, DKIM, DMARC DNS records
- [ ] Note API key (can reuse existing Resend account, just verify new domain)

### 1.10 PostHog
- [ ] Rename existing project in dashboard to "TabulateAI"
- [ ] No code change needed — same API key works

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
+ org: "tabulate-ai",
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
+ R2_BUCKET_NAME=tabulate-dev
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

**Prerequisites:** Phase 1 (services exist) + Phase 2 (code changes applied)
**Who:** Jason (Railway dashboard) + Claude (verification)

### 3.1 Create `.env.local` for New Repo

Populate with all new service credentials from Phase 1:

```
# Convex
CONVEX_URL=                          # from new project
NEXT_PUBLIC_CONVEX_URL=              # same
CONVEX_DEPLOY_KEY=                   # from new project

# Cloudflare R2
R2_ACCOUNT_ID=                       # same account
R2_ACCESS_KEY_ID=                    # new token
R2_SECRET_ACCESS_KEY=                # new token
R2_BUCKET_NAME=tabulate-dev

# WorkOS
WORKOS_CLIENT_ID=                    # from new app
WORKOS_API_KEY=                      # from new app
WORKOS_COOKIE_PASSWORD=              # generate: openssl rand -base64 32
NEXT_PUBLIC_WORKOS_REDIRECT_URI=http://localhost:3000/auth/callback

# Sentry
SENTRY_DSN=                          # from new project
NEXT_PUBLIC_SENTRY_DSN=              # same
SENTRY_AUTH_TOKEN=                   # from new org

# Stripe
STRIPE_SECRET_KEY=                   # from new TabulateAI org
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_METER_ID=
STRIPE_PRICE_PAYG=
STRIPE_PRICE_PAYG_METERED=
STRIPE_PRICE_STARTER=
STRIPE_PRICE_STARTER_METERED=
STRIPE_PRICE_PROFESSIONAL=
STRIPE_PRICE_PROFESSIONAL_METERED=
STRIPE_PRICE_STUDIO=
STRIPE_PRICE_STUDIO_METERED=

# Resend
RESEND_API_KEY=
RESEND_FROM_ADDRESS=TabulateAI <notifications@tabulate-ai.com>

# PostHog
NEXT_PUBLIC_POSTHOG_KEY=             # keep existing
NEXT_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com

# App
NEXT_PUBLIC_APP_URL=https://tabulate-ai.com
AUTH_BYPASS=true                     # dev only
```

### 3.2 Initialize Convex
```bash
npx convex deploy  # pushes schema + functions to new deployment
```

### 3.3 Local Verification
```bash
npm install          # regenerates package-lock.json
npm run lint         # catch any broken imports from CLI removal
npx tsc --noEmit     # type check
npx vitest run       # full test suite
npm run dev          # smoke test locally
```

### 3.4 Railway Production Deploy
Set all env vars in Railway dashboard with production values:
- `NEXT_PUBLIC_APP_URL=https://tabulate-ai.com`
- `NEXT_PUBLIC_WORKOS_REDIRECT_URI=https://tabulate-ai.com/auth/callback`
- `R2_BUCKET_NAME=tabulate-prod`
- Production Convex deployment URL + deploy key
- Production Stripe keys (live mode) + webhook secret
- Production Sentry DSN
- Resend with production API key

Connect custom domain `tabulate-ai.com` in Railway settings.

### 3.5 Stripe Webhook
- In Stripe dashboard: create webhook endpoint `https://tabulate-ai.com/api/billing/webhook`
- Subscribe to events: `customer.subscription.*`, `invoice.*`, `checkout.session.completed`
- Copy webhook signing secret → add to Railway env vars as `STRIPE_WEBHOOK_SECRET`

### 3.6 DNS Cutover
- In Porkbun: point `tabulate-ai.com` CNAME to Railway's provided domain
- Railway will auto-provision SSL
- Verify site loads at `https://tabulate-ai.com`

---

## Phase 4: Validation

### 4.1 Production Smoke Test
- [ ] Landing page loads at `tabulate-ai.com`
- [ ] Auth flow works (sign up, sign in, sign out)
- [ ] Demo flow works (upload .sav, receive email with results)
- [ ] Billing flow works (checkout session, customer portal, webhook fires)
- [ ] Sentry receives test error
- [ ] PostHog receives page view events
- [ ] Email arrives from `notifications@tabulate-ai.com` with correct branding

### 4.2 Final Sweep
```bash
# In the new repo, verify no stale references remain:
grep -r "crosstab-ai" --include="*.ts" --include="*.tsx" --include="*.json" --include="*.yml" --include="*.md" .
```
Any hits should be either:
- Intentional (archive references in docs, this migration plan)
- Internal identifiers that were explicitly kept (see "What Does NOT Change" below)

### 4.3 Archive Old Repo
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
