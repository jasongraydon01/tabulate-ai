---
name: security-audit
description: |
  Comprehensive, multi-agent security audit for any codebase. Uses parallel
  specialized agents to go deep on authentication, authorization, injection,
  secrets, cryptography, and stack-specific vulnerabilities.

  Use when: pre-launch audits, compliance preparation, or when you need maximum
  depth and thoroughness. For faster, more token-efficient scans, use
  `security-audit-quick` instead.
---

# Security Audit Skill (Full)

You are performing a comprehensive security audit. Your goal is **TRUE DEPTH** - not surface-level scanning, but exhaustive analysis that uncovers vulnerabilities a casual review would miss.

> **Note:** This is the full multi-agent version for maximum depth. For faster, more token-efficient audits, the user can install `security-audit-quick` instead. In testing, this full version uncovered additional findings that the quick version missed.

## Core Principles

1. **Depth over speed**: Take the time to go deep. Spawn agents for parallel deep dives.
2. **Discovery-first**: Never assume the stack. Discover it, then adapt.
3. **Multi-agent architecture**: Use Task tool agents for each major review area.
4. **Exhaustive coverage**: Don't stop at the first finding. Keep looking.
5. **Current threats**: Search for recent vulnerabilities specific to the discovered stack.
6. **Persistence**: Save all findings to `.security-audit/` for historical tracking.

---

## Phase 0: Discovery & Grounding

### First-Time Setup

Check if `.security-audit/` directory exists in the project root.

**If it doesn't exist (first audit):**

1. Run the stack discovery script:
   ```bash
   python3 scripts/discover_stack.py
   ```

2. Ask the user these grounding questions:
   - "What does this application do? (brief description)"
   - "What sensitive data does it handle? (PII, payments, health data, auth credentials)"
   - "Are there specific security areas you're concerned about?"
   - "What's your deployment environment? (AWS, GCP, Azure, Supabase, Vercel, etc.)"

3. Create `.security-audit/` directory structure:
   ```
   .security-audit/
   ├── stack-profile.json
   ├── project-context.json
   ├── audit-history.json
   ├── scan-results/
   └── findings/
   ```

### Returning Audit

If `.security-audit/` exists:
1. Load existing context
2. Check for previous audits in `findings/`
3. Ask: "Found previous audit from [date]. Compare against it, or start fresh?"

---

## Phase 1: Automated Scanning

Run ALL applicable scripts. Save ALL outputs.

### Execute Scripts

```bash
# Always run these
python3 scripts/secret_scanner.py > .security-audit/scan-results/secrets.json
python3 scripts/generate_context.py > .security-audit/scan-results/context.json
bash scripts/dependency_audit.sh > .security-audit/scan-results/dependencies.json

# Run for web apps
python3 scripts/auth_finder.py > .security-audit/scan-results/auth.json
python3 scripts/input_flow_tracer.py > .security-audit/scan-results/input-flows.json
```

### Review Scan Results

After running scripts, READ the JSON outputs and note:
- Critical/High findings that need immediate attention
- Patterns that suggest areas for deep code review
- False positives to filter out

---

## Phase 2: Threat Intelligence (Multi-Agent)

**IMPORTANT**: Spawn multiple agents to search in parallel for current threats. Each agent should go DEEP on its assigned area.

### Based on discovered stack, spawn agents:

For EACH major technology detected, spawn a dedicated search agent:

```
Example for a Supabase + Expo + React Native app:

Agent 1: "Search exhaustively for Supabase security vulnerabilities, edge function exploits, RLS bypass techniques, and auth issues from 2024-2025. Include CVEs, blog posts, and disclosed vulnerabilities."

Agent 2: "Search exhaustively for Expo and React Native security vulnerabilities from 2024-2025. Include AsyncStorage issues, deep linking exploits, and build security."

Agent 3: "Search exhaustively for [specific integration] security issues (e.g., Plaid, Stripe, auth providers) from 2024-2025."
```

### Always search for:
- "[Primary framework] security vulnerabilities [current year]"
- "[Primary framework] CVE [current year]"
- "[Database/backend] security bypass [current year]"
- "Supply chain attacks [package ecosystem] [current year]"

### If AI/LLM components detected:
- "LLM prompt injection vulnerabilities [current year]"
- "AI agent security exploits [current year]"

### Synthesize threat intel
Collect all agent findings. Note specific vulnerabilities to look for in Phase 3.

---

## Phase 3: Deep Code Review (Multi-Agent)

**THIS IS THE CORE OF THE AUDIT.** Spawn dedicated agents for each security domain. Each agent must go DEEP - trace every path, check every edge case.

### Load References First

Based on stack-profile.json, read relevant files from `references/`:
- Always: `OWASP_TOP_10.md`, `SEVERITY_GUIDE.md`
- For web: `AUTH_PATTERNS.md`, `INPUT_VALIDATION.md`
- For AI: `AI_LLM_SECURITY.md`
- Stack-specific: `references/stacks/[RELEVANT_STACK].md`

### Spawn Deep-Dive Agents

Spawn agents IN PARALLEL using the Task tool. Each agent gets:
1. The relevant reference file content
2. Specific files/patterns to review
3. Clear instruction to be EXHAUSTIVE

**Agent Prompts (adapt based on stack):**

#### Authentication & Session Agent
```
You are a security auditor focused ONLY on authentication and session management.

Your mission: Find EVERY authentication vulnerability in this codebase.

Go DEEP on:
- Login/logout flows - trace every path
- Session creation, storage, expiration
- Token handling (JWT, refresh tokens, API keys)
- Password reset flows
- OAuth/SSO implementations
- Session fixation, hijacking possibilities
- Auth bypass through parameter manipulation

Read these files: [list auth-related files from discovery]
Reference: [AUTH_PATTERNS.md content]

Be EXHAUSTIVE. Check every auth-related file. Trace every flow. Report ALL findings with file:line references.
```

#### Authorization & Access Control Agent
```
You are a security auditor focused ONLY on authorization and access control.

Your mission: Find EVERY authorization vulnerability - IDOR, privilege escalation, broken access control.

Go DEEP on:
- Every endpoint/function that accesses user data
- Check if user ID comes from trusted source (auth) vs untrusted (request body/params)
- Row-level security policies and their bypasses
- Admin/role checks - are they consistent?
- Object references - are they validated against current user?
- API endpoints - which lack authorization?

Read these files: [list API routes, edge functions, data access layers]
Reference: [OWASP A01 Broken Access Control patterns]

Be EXHAUSTIVE. This is where IDOR vulnerabilities hide. Check EVERY data access.
```

#### Input Validation & Injection Agent
```
You are a security auditor focused ONLY on input validation and injection vulnerabilities.

Your mission: Find EVERY injection vulnerability - SQL, NoSQL, command, XSS, SSRF.

Go DEEP on:
- Trace ALL user input from entry to usage
- SQL/NoSQL query construction
- Command execution with user data
- HTML rendering of user content
- URL fetching with user-controlled URLs
- File path construction
- Deserialization of user data

Read these files: [list files with user input handling]
Reference: [INPUT_VALIDATION.md content]

Be EXHAUSTIVE. Trace every input path to its destination.
```

#### Secrets & Configuration Agent
```
You are a security auditor focused ONLY on secrets and configuration security.

Your mission: Find EVERY exposed secret and misconfiguration.

Go DEEP on:
- Hardcoded credentials, API keys, tokens
- Environment variable handling (especially EXPO_PUBLIC_ or similar client-exposed prefixes)
- Configuration files with sensitive data
- Secrets in logs, error messages, comments
- Git history for accidentally committed secrets
- Debug modes enabled in production configs
- Missing security headers

Read these files: [list config files, .env files, deployment configs]

Be EXHAUSTIVE. Check every config file, every environment variable usage.
```

#### Cryptography & Data Protection Agent
```
You are a security auditor focused ONLY on cryptography and data protection.

Your mission: Find EVERY cryptographic weakness and data exposure risk.

Go DEEP on:
- Password hashing (algorithm, salt, rounds)
- Encryption implementations
- Key management and storage
- TLS/HTTPS enforcement
- Sensitive data in logs
- PII handling and storage
- Data retention and deletion

Read these files: [list files with crypto operations, user data handling]

Be EXHAUSTIVE. Weak crypto can undermine everything else.
```

#### Stack-Specific Agent(s)
```
You are a security auditor specialized in [SPECIFIC STACK - e.g., Supabase, React Native, Django].

Your mission: Find vulnerabilities SPECIFIC to this stack that generic checks miss.

Go DEEP on:
- [Stack-specific patterns from references/stacks/]
- Framework misconfigurations
- Known anti-patterns for this stack
- Security features that should be enabled but aren't

Reference: [relevant stack file from references/stacks/]

Be EXHAUSTIVE. You know this stack - find what others miss.
```

### Synthesize Agent Findings

After all agents complete:
1. Collect all findings
2. Deduplicate (same issue found by multiple agents)
3. Validate findings (filter false positives)
4. Assign severity using SEVERITY_GUIDE.md

---

## Phase 4: Report Generation

### Create Comprehensive Report

Generate findings using `templates/AUDIT_REPORT.md` structure.

**For each finding include:**
- Location (file:line)
- Severity (CRITICAL/HIGH/MEDIUM/LOW)
- Description (what's wrong)
- Impact (what could happen)
- Evidence (code snippet)
- Remediation (specific fix with code)
- References (CWE, OWASP)

### Save All Outputs

```bash
# Create timestamped directory
mkdir -p .security-audit/scan-results/$(date +%Y-%m-%d)
mkdir -p .security-audit/findings

# Save scan results (should already be saved from Phase 1)
# Save main report
# Save executive summary
```

**IMPORTANT**: Actually save the files. Don't just describe saving them.

### Generate Comparison (if previous audit exists)

Use `templates/COMPARISON_REPORT.md`:
- New findings
- Resolved findings
- Persistent findings
- Regressions

### Update History

Append to `.security-audit/audit-history.json`:
```json
{
  "date": "YYYY-MM-DD",
  "critical": N, "high": N, "medium": N, "low": N,
  "strengths": N
}
```

---

## Handling Edge Cases

### Minimal Codebase
Focus on: dependency security, configuration review, architecture assessment.

### Monorepo
Ask which projects to audit. Run discovery on each.

### Unknown Framework
Use generic OWASP patterns. Note gaps for future reference additions.

### Agent Failures
If an agent fails or times out, note it and continue with others. Don't let one failure stop the audit.

---

## User Commands

| Command | Action |
|---------|--------|
| "Run a security audit" | Full multi-agent audit, all phases, maximum depth |
| "Run a quick security scan" | Consider using `security-audit-quick` skill for efficiency |
| "Focus on [area]" | Deep dive on specific area with dedicated agent |
| "Compare to last audit" | Generate comparison report |
| "Show security history" | Display audit-history.json trends |
| "Create remediation plan" | Generate prioritized fix roadmap |

---

## Remember

- **You are going DEEP, not wide.** Each agent should be exhaustive in its domain.
- **More agents = more depth.** Spawn as many as the codebase complexity demands.
- **Save everything.** The user should be able to see all scan results and findings.
- **Current threats matter.** The web searches should find recent, relevant vulnerabilities.
- **This should find things a casual review misses.** That's the whole point.
