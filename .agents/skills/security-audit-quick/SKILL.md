---
name: security-audit-quick
description: |
  Fast, token-efficient security audit for any codebase. Discovers the tech stack,
  runs automated vulnerability scans, researches current threats, and performs
  targeted code review in a single pass.

  Use when: quick security checks, regular scans, CI integration, or when you want
  a faster audit with lower token usage. For deeper multi-agent analysis, use
  the full `security-audit` skill instead.
---

# Security Audit Skill (Quick)

You are performing a security audit. This is the **quick, single-pass version** optimized for speed and token efficiency.

> **Note:** For comprehensive multi-agent deep dives, use the full `security-audit` skill instead. This quick version is ideal for regular checks and when token budget matters.

## Principles

1. **Discovery over assumption**: Never assume the tech stack. Discover it first.
2. **Run scripts, use outputs**: Execute scripts in `scripts/` and use their JSON output.
3. **Progressive loading**: Only read reference files relevant to the discovered stack.
4. **Persistence**: Save all findings to `.security-audit/` for historical tracking.
5. **Efficiency**: Complete a thorough audit in a single coherent pass.

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
- Patterns that suggest areas for code review
- False positives to filter out

---

## Phase 2: Threat Intelligence

Search for current threats relevant to the discovered stack.

### Required Searches

- "[Primary framework] security vulnerabilities [current year]"
- "[Primary framework] CVE [current year]"
- "[Database/backend] security bypass [current year]"

### If AI/LLM Components Detected

- "LLM prompt injection vulnerabilities [current year]"
- "AI agent security exploits [current year]"

Note specific vulnerabilities to look for during code review.

---

## Phase 3: Targeted Code Review

Load relevant reference files based on the discovered stack, then review code systematically.

### Load References

Based on `stack-profile.json`, read appropriate files from `references/`:

**Always load:**
- `references/OWASP_TOP_10.md`
- `references/SEVERITY_GUIDE.md`

**Load based on stack:**
- For web apps: `AUTH_PATTERNS.md`, `INPUT_VALIDATION.md`
- For AI/LLM: `AI_LLM_SECURITY.md`
- Stack-specific: `references/stacks/[RELEVANT_STACK].md`

### Review Priority Order

1. **Authentication & Authorization**
   - Login/logout flows, session management
   - Permission checks, role enforcement
   - Token handling (JWT, API keys)

2. **Data Access Patterns**
   - Check for IDOR vulnerabilities
   - Verify user ID comes from auth, not request body
   - Row-level security policy gaps

3. **Input Validation**
   - SQL/NoSQL injection points
   - XSS vulnerabilities
   - Command injection risks

4. **Secrets & Configuration**
   - Hardcoded credentials
   - Environment variable handling
   - Debug modes in production

5. **Stack-Specific Issues**
   - Framework misconfigurations
   - Known dangerous patterns for this stack

---

## Phase 4: Report Generation

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
mkdir -p .security-audit/findings
# Save main report to .security-audit/findings/audit-YYYY-MM-DD.md
# Save executive summary to .security-audit/findings/summary-YYYY-MM-DD.md
```

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

---

## User Commands

| Command | Action |
|---------|--------|
| "Run a quick security scan" | This skill - fast single-pass audit |
| "Run a security audit" | Consider using full `security-audit` skill for depth |
| "Focus on [area]" | Targeted review of specific area |
| "Compare to last audit" | Generate comparison report |
| "Show security history" | Display audit-history.json trends |

---

## Remember

- **Single pass, comprehensive coverage**: Cover all major security areas efficiently.
- **Save everything**: Persist scan results and findings for tracking.
- **Recommend deep audit when needed**: If you find concerning patterns, suggest the full `security-audit` skill for deeper analysis.
