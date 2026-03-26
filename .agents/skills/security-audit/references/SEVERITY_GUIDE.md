# Severity Classification Guide

Calibration guide for consistent severity ratings aligned with CVSS principles.

---

## Severity Levels Overview

| Severity | CVSS Range | Response Time | Characteristics |
|----------|------------|---------------|-----------------|
| CRITICAL | 9.0 - 10.0 | Immediate | Actively exploitable, catastrophic impact |
| HIGH | 7.0 - 8.9 | < 7 days | Exploitable, significant impact |
| MEDIUM | 4.0 - 6.9 | < 30 days | Requires effort, moderate impact |
| LOW | 0.1 - 3.9 | Track | Best practice, minimal impact |

---

## CRITICAL (9.0 - 10.0)

### Characteristics
- Remotely exploitable without authentication
- No user interaction required
- Complete system compromise possible
- Data breach imminent or already occurring
- Widely known exploit or trivial to exploit

### Examples

**SQL Injection in Authentication**
```python
# CRITICAL: Unauthenticated SQL injection allowing auth bypass
query = f"SELECT * FROM users WHERE username='{username}' AND password='{password}'"
# Attack: username = "admin'--" bypasses password check
```
*Why Critical*: No auth required, trivial to exploit, complete account takeover.

**Hardcoded Production Credentials**
```javascript
// CRITICAL: Database credentials in source code
const db = mysql.createConnection({
  host: 'prod-db.company.com',
  user: 'admin',
  password: 'Pr0d_S3cr3t_2024!'
})
```
*Why Critical*: Anyone with code access has database admin access.

**Remote Code Execution**
```javascript
// CRITICAL: Unauthenticated RCE
app.get('/run', (req, res) => {
  exec(req.query.cmd)  // Any command executes on server
})
```
*Why Critical*: No auth, trivial exploit, complete server compromise.

**Exposed Admin Panel Without Auth**
```javascript
// CRITICAL: Admin endpoints without authentication
app.delete('/api/admin/users/:id', (req, res) => {
  db.users.delete(req.params.id)  // Anyone can delete any user
})
```
*Why Critical*: No authentication on destructive operation.

---

## HIGH (7.0 - 8.9)

### Characteristics
- Exploitable with moderate effort
- May require authentication but has auth bypass
- Significant data exposure or modification
- Privilege escalation possible
- Known vulnerability in dependencies

### Examples

**IDOR on Sensitive Data**
```javascript
// HIGH: Authenticated users can access any user's data
app.get('/api/user/:id/medical-records', authenticate, (req, res) => {
  const records = db.getMedicalRecords(req.params.id)  // No ownership check
  res.json(records)
})
```
*Why High*: Requires auth, but any auth user can access any records.

**Stored XSS**
```javascript
// HIGH: User comments rendered without sanitization
app.get('/comments', (req, res) => {
  const comments = db.getComments()
  res.send(`<div>${comments.map(c => c.body).join('')}</div>`)  // XSS
})
```
*Why High*: Affects all users viewing content, session hijacking possible.

**Vulnerable Dependency with Known Exploit**
```json
{
  "dependencies": {
    "log4j": "2.14.0"  // Log4Shell vulnerable version
  }
}
```
*Why High*: Known RCE, but exploitation may require specific conditions.

**JWT Algorithm Confusion**
```javascript
// HIGH: Accepts 'none' algorithm
const payload = jwt.decode(token)  // No verification!
```
*Why High*: Allows forged tokens, but attacker needs to understand JWT.

---

## MEDIUM (4.0 - 6.9)

### Characteristics
- Requires specific conditions or user interaction
- Defense-in-depth issue
- Information disclosure (non-critical)
- Missing security control that has alternatives
- Requires privileged access to exploit

### Examples

**Reflected XSS**
```javascript
// MEDIUM: XSS requires user to click malicious link
app.get('/search', (req, res) => {
  res.send(`Results for: ${req.query.q}`)  // Reflected XSS
})
```
*Why Medium*: Requires victim to click crafted link, impacts only that user.

**Missing Rate Limiting**
```javascript
// MEDIUM: No rate limit on login
app.post('/login', (req, res) => {
  // Allows brute force, but passwords may be strong
})
```
*Why Medium*: Enables brute force, but other controls may exist.

**CSRF on Non-Critical Function**
```javascript
// MEDIUM: Profile update without CSRF token
app.post('/profile', authenticate, (req, res) => {
  db.updateProfile(req.user.id, req.body)  // Display name change via CSRF
})
```
*Why Medium*: Requires user to visit attacker site, limited impact.

**Verbose Error Messages**
```python
# MEDIUM: Stack traces exposed
@app.errorhandler(Exception)
def handle_error(e):
    return str(e), 500  # Exposes internal details
```
*Why Medium*: Information useful to attackers, but not directly exploitable.

**Missing Security Headers**
```javascript
// MEDIUM: No CSP header
// Increases XSS impact if XSS vulnerability exists
```
*Why Medium*: Defense-in-depth, not directly exploitable alone.

---

## LOW (0.1 - 3.9)

### Characteristics
- Best practice improvement
- Theoretical risk without practical exploit
- Requires significant existing access
- Minor information disclosure
- Quality/maintainability more than security

### Examples

**Cookies Without Secure Flag (HTTPS Site)**
```javascript
// LOW: Secure flag missing, but site is HTTPS-only
res.cookie('prefs', value)  // Missing { secure: true }
```
*Why Low*: HTTPS enforced via HSTS, cookie exposure unlikely.

**Minor Information Disclosure**
```html
<!-- LOW: Server version exposed -->
<meta name="generator" content="Apache 2.4.51">
```
*Why Low*: Provides minor reconnaissance info, no direct exploit.

**Outdated Dependency Without Known Vulnerabilities**
```json
{
  "lodash": "4.17.19"  // One version behind, no CVEs
}
```
*Why Low*: Best practice to update, but no known security issue.

**Console.log in Production**
```javascript
// LOW: Debug logging in production
console.log('Processing user:', userId)
```
*Why Low*: Minor info leak to browser console, not exploitable.

**Password Policy Slightly Weak**
```javascript
// LOW: 8 character minimum instead of recommended 12
if (password.length < 8) throw new Error('Too short')
```
*Why Low*: Below best practice, but still provides protection.

---

## Factors That Increase Severity

| Factor | Impact |
|--------|--------|
| No authentication required | +1-2 levels |
| Public internet exposure | +1 level |
| Handles PII/financial data | +1 level |
| Automated exploitation possible | +1 level |
| Known exploit in the wild | +1 level |
| Affects all users | +1 level |

## Factors That Decrease Severity

| Factor | Impact |
|--------|--------|
| Requires admin access | -1-2 levels |
| Internal network only | -1 level |
| Requires user interaction | -1 level |
| Other controls mitigate | -1 level |
| Theoretical/no known exploit | -1 level |
| Affects only attacker | -1-2 levels |

---

## Severity Decision Tree

```
Is it remotely exploitable without authentication?
├─ Yes → Does it allow RCE, data breach, or full compromise?
│        ├─ Yes → CRITICAL
│        └─ No → HIGH
└─ No → Does it require only low-privilege authentication?
         ├─ Yes → Can it access/modify other users' sensitive data?
         │        ├─ Yes → HIGH
         │        └─ No → MEDIUM
         └─ No (requires admin/special conditions) →
                  Does exploitation have real impact?
                  ├─ Yes → MEDIUM
                  └─ No → LOW
```

---

## Documentation Format

When documenting findings, include:

```markdown
### [SEVERITY] Title

**Location:** file.js:123

**Description:** What the vulnerability is.

**Impact:** What could happen if exploited.

**Evidence:**
```code
vulnerable code here
```

**Severity Justification:**
- Factor 1 that influences severity
- Factor 2 that influences severity
- CVSS estimate: X.X

**Remediation:**
```code
fixed code here
```

**References:** CWE-XXX, OWASP Category
```
