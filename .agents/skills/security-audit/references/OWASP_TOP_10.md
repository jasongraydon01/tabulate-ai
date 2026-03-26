# OWASP Top 10:2025 Reference

This document covers the OWASP Top 10 Web Application Security Risks for 2025.

---

## A01:2025 - Broken Access Control

### Description
Access control enforces policy so users cannot act outside their intended permissions. Failures lead to unauthorized information disclosure, modification, or destruction of data.

### How It Manifests
- Missing access control checks on sensitive endpoints
- Bypassing access control by modifying URLs, parameters, or API requests
- IDOR (Insecure Direct Object Reference) allowing access to others' data
- Elevation of privilege (acting as admin without being logged in as admin)
- Metadata manipulation (JWT tampering, cookie modification)
- CORS misconfiguration allowing unauthorized API access

### Detection Patterns
```
# Look for:
- Endpoints without authentication middleware
- Direct database ID usage in URLs without ownership verification
- Missing role checks before sensitive operations
- Permissive CORS configurations (Access-Control-Allow-Origin: *)
- JWT tokens without proper validation
```

### Vulnerable Example
```javascript
// VULNERABLE: No ownership check
app.get('/api/user/:id/documents', (req, res) => {
  const docs = db.getDocuments(req.params.id);  // Any user can access any user's docs
  res.json(docs);
});
```

### Secure Example
```javascript
// SECURE: Verify ownership
app.get('/api/user/:id/documents', authenticate, (req, res) => {
  if (req.user.id !== req.params.id && !req.user.isAdmin) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const docs = db.getDocuments(req.params.id);
  res.json(docs);
});
```

### CWE References
- CWE-200: Exposure of Sensitive Information
- CWE-284: Improper Access Control
- CWE-285: Improper Authorization
- CWE-639: Authorization Bypass Through User-Controlled Key

---

## A02:2025 - Cryptographic Failures

### Description
Failures related to cryptography that often lead to exposure of sensitive data. Includes using weak algorithms, improper key management, and insufficient encryption.

### How It Manifests
- Transmitting data in clear text (HTTP, FTP, SMTP without TLS)
- Using deprecated cryptographic algorithms (MD5, SHA1 for passwords, DES)
- Weak or default encryption keys
- Improper certificate validation
- Using encryption modes incorrectly (ECB mode)
- Storing passwords in plain text or with reversible encryption

### Detection Patterns
```
# Look for:
- MD5 or SHA1 used for password hashing
- Hardcoded encryption keys or IVs
- HTTP URLs for sensitive operations
- Self-signed certificates in production
- Disabled certificate validation
- ECB mode encryption
- Random number generation using Math.random() for security
```

### Vulnerable Example
```python
# VULNERABLE: Weak hashing
import hashlib
password_hash = hashlib.md5(password.encode()).hexdigest()
```

### Secure Example
```python
# SECURE: Use bcrypt with proper cost factor
import bcrypt
password_hash = bcrypt.hashpw(password.encode(), bcrypt.gensalt(rounds=12))
```

### CWE References
- CWE-259: Use of Hard-coded Password
- CWE-327: Use of Broken Crypto Algorithm
- CWE-328: Reversible One-Way Hash
- CWE-330: Use of Insufficiently Random Values

---

## A03:2025 - Software Supply Chain Failures (NEW)

### Description
Failures related to the security of the software supply chain, including vulnerable dependencies, compromised build systems, and malicious packages.

### How It Manifests
- Using packages with known vulnerabilities
- Dependency confusion attacks
- Typosquatting (malicious packages with similar names)
- Compromised build pipelines
- Unsigned or unverified packages
- Lack of Software Bill of Materials (SBOM)

### Detection Patterns
```
# Look for:
- Outdated dependencies with known CVEs
- Packages from untrusted sources
- Missing lockfiles (package-lock.json, yarn.lock)
- Build scripts that download external resources
- Lack of integrity checks on dependencies
- Over-permissive package permissions
```

### Vulnerable Example
```json
{
  "dependencies": {
    "lodash": "^3.0.0",  // Old version with prototype pollution
    "event-stream": "*"   // Was compromised in 2018
  }
}
```

### Secure Example
```json
{
  "dependencies": {
    "lodash": "4.17.21"  // Pinned to specific secure version
  }
}
// Plus: Use lockfile, run `npm audit`, enable Dependabot
```

### CWE References
- CWE-1104: Use of Unmaintained Third-Party Components
- CWE-494: Download of Code Without Integrity Check
- CWE-829: Inclusion of Functionality from Untrusted Control Sphere

---

## A04:2025 - Security Misconfiguration

### Description
Missing or incorrect security configurations at any level of the application stack, including cloud services, frameworks, and servers.

### How It Manifests
- Default credentials left unchanged
- Unnecessary features enabled (debug mode, directory listing)
- Cloud storage publicly accessible
- Missing security headers
- Overly permissive IAM policies
- Verbose error messages exposing stack traces

### Detection Patterns
```
# Look for:
- DEBUG=True or NODE_ENV=development in production
- Default admin passwords
- S3 buckets without proper ACLs
- Missing headers: CSP, X-Frame-Options, HSTS
- Open ports not required for operation
- Overly verbose error responses
```

### Vulnerable Example
```python
# VULNERABLE: Debug mode in production
DEBUG = True
ALLOWED_HOSTS = ['*']
```

### Secure Example
```python
# SECURE: Production configuration
DEBUG = False
ALLOWED_HOSTS = ['myapp.example.com']
SECURE_SSL_REDIRECT = True
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
```

### CWE References
- CWE-16: Configuration
- CWE-260: Password in Configuration File
- CWE-732: Incorrect Permission Assignment

---

## A05:2025 - Injection

### Description
User-supplied data is not validated, filtered, or sanitized before being used in interpreters. Includes SQL, NoSQL, OS command, LDAP, and XSS injection.

### How It Manifests
- Concatenating user input into SQL queries
- Executing shell commands with user data
- Rendering user input in HTML without escaping
- Building LDAP queries from user input
- Deserializing untrusted data

### Detection Patterns
```
# Look for:
- String concatenation in SQL: "SELECT * FROM users WHERE id=" + userId
- Template literals with user data: `rm ${filename}`
- innerHTML or dangerouslySetInnerHTML with user content
- eval(), exec(), system() with user input
- Regular expressions built from user input
```

### Vulnerable Example
```javascript
// VULNERABLE: SQL Injection
const query = `SELECT * FROM users WHERE email = '${email}'`;
db.query(query);
```

### Secure Example
```javascript
// SECURE: Parameterized query
const query = 'SELECT * FROM users WHERE email = $1';
db.query(query, [email]);
```

### CWE References
- CWE-79: Cross-site Scripting (XSS)
- CWE-89: SQL Injection
- CWE-78: OS Command Injection
- CWE-94: Code Injection

---

## A06:2025 - Insecure Design

### Description
Risks related to design and architectural flaws. Cannot be fixed by perfect implementation - requires threat modeling and secure design patterns.

### How It Manifests
- Missing rate limiting on sensitive operations
- No account lockout after failed attempts
- Predictable resource IDs
- Lack of defense in depth
- Trust boundaries not defined
- Missing business logic validation

### Detection Patterns
```
# Look for:
- Password reset without rate limiting
- Sequential/predictable IDs for sensitive resources
- Single point of security control
- Missing audit logging for sensitive operations
- Business rules enforced only on client side
```

### Vulnerable Example
```javascript
// VULNERABLE: No rate limiting on login
app.post('/login', (req, res) => {
  // Allows unlimited attempts - brute force possible
  if (checkPassword(req.body.email, req.body.password)) {
    createSession(req, res);
  }
});
```

### Secure Example
```javascript
// SECURE: Rate limiting and account lockout
const rateLimiter = rateLimit({ windowMs: 15*60*1000, max: 5 });
app.post('/login', rateLimiter, async (req, res) => {
  const attempts = await getFailedAttempts(req.body.email);
  if (attempts >= 5) {
    return res.status(429).json({ error: 'Account locked. Try again later.' });
  }
  // ... authentication logic with attempt tracking
});
```

### CWE References
- CWE-840: Business Logic Errors
- CWE-841: Improper Enforcement of Behavioral Workflow
- CWE-799: Improper Control of Interaction Frequency

---

## A07:2025 - Authentication Failures

### Description
Confirmation of user identity, authentication, and session management are critical. Weaknesses allow attackers to assume other users' identities.

### How It Manifests
- Weak password requirements
- Credential stuffing (no protection against automated attacks)
- Session IDs in URLs
- Sessions not invalidated on logout
- Missing MFA on sensitive operations
- Password storage without proper hashing

### Detection Patterns
```
# Look for:
- Password policies < 8 characters or no complexity
- Session tokens in URL parameters
- Remember-me tokens that don't expire
- Missing session regeneration after login
- JWT tokens that never expire
- Passwords transmitted over non-HTTPS
```

### Vulnerable Example
```python
# VULNERABLE: Weak session management
session['user_id'] = user.id  # Session not regenerated after login
# Token never expires, not invalidated on logout
```

### Secure Example
```python
# SECURE: Proper session management
session.regenerate()  # New session ID after auth change
session['user_id'] = user.id
session.set_expiry(3600)  # 1 hour expiry
# On logout: session.destroy()
```

### CWE References
- CWE-287: Improper Authentication
- CWE-384: Session Fixation
- CWE-613: Insufficient Session Expiration
- CWE-620: Unverified Password Change

---

## A08:2025 - Software and Data Integrity Failures

### Description
Code and infrastructure that does not protect against integrity violations. Includes insecure CI/CD pipelines, auto-update without verification, and deserialization of untrusted data.

### How It Manifests
- Downloading updates without signature verification
- Insecure deserialization
- CI/CD pipelines without integrity checks
- CDN resources without Subresource Integrity (SRI)
- Unsigned code or packages

### Detection Patterns
```
# Look for:
- pickle.loads(), yaml.load(), JSON.parse() on untrusted data
- External scripts without integrity attributes
- Auto-update mechanisms without verification
- CI/CD with writable build artifacts
```

### Vulnerable Example
```python
# VULNERABLE: Insecure deserialization
import pickle
data = pickle.loads(user_provided_data)  # RCE possible
```

### Secure Example
```python
# SECURE: Use safe formats, validate schemas
import json
data = json.loads(user_provided_data)
schema.validate(data)  # Validate structure
```

### CWE References
- CWE-502: Deserialization of Untrusted Data
- CWE-494: Download Without Integrity Check
- CWE-345: Insufficient Verification of Data Authenticity

---

## A09:2025 - Security Logging and Alerting Failures

### Description
Without logging and monitoring, breaches cannot be detected. Insufficient logging, detection, monitoring, and active response allows attackers to persist.

### How It Manifests
- Logins, failed logins not logged
- No logging of high-value transactions
- Logs not protected from tampering
- No alerting on suspicious activity
- Application errors not logged properly
- Sensitive data in logs

### Detection Patterns
```
# Look for:
- Missing logging on authentication events
- Logs without timestamps or user identification
- Sensitive data (passwords, tokens) in logs
- No centralized logging
- Missing alerting for security events
```

### Vulnerable Example
```javascript
// VULNERABLE: No logging
app.post('/login', (req, res) => {
  // No record of login attempts
});
```

### Secure Example
```javascript
// SECURE: Comprehensive logging
app.post('/login', (req, res) => {
  const result = authenticate(req.body);
  logger.info('Login attempt', {
    email: req.body.email,
    success: result.success,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
    timestamp: new Date().toISOString()
  });
  // Alert on multiple failures
  if (!result.success) alertOnThreshold(req.body.email);
});
```

### CWE References
- CWE-778: Insufficient Logging
- CWE-223: Omission of Security-relevant Information
- CWE-532: Insertion of Sensitive Information into Log File

---

## A10:2025 - Mishandling of Exceptional Conditions (NEW)

### Description
Improper handling of errors, edge cases, and exceptional conditions that can lead to security vulnerabilities.

### How It Manifests
- Fail-open behavior (granting access on error)
- Stack traces exposed to users
- Error messages revealing system information
- Unhandled exceptions causing denial of service
- Race conditions in error handling
- Resource exhaustion not handled

### Detection Patterns
```
# Look for:
- catch blocks that grant access or skip validation
- Empty catch blocks
- Error messages containing file paths or SQL
- Missing try-catch around critical operations
- Default case in switch granting access
```

### Vulnerable Example
```javascript
// VULNERABLE: Fail-open on error
try {
  const isAuthorized = await checkPermission(user, resource);
  if (!isAuthorized) return res.status(403).send('Forbidden');
} catch (error) {
  // Fails open - if check fails, access granted!
}
return res.send(sensitiveData);
```

### Secure Example
```javascript
// SECURE: Fail-closed on error
try {
  const isAuthorized = await checkPermission(user, resource);
  if (!isAuthorized) return res.status(403).send('Forbidden');
  return res.send(sensitiveData);
} catch (error) {
  logger.error('Authorization check failed', { error, user, resource });
  return res.status(500).send('Access denied');  // Fail closed
}
```

### CWE References
- CWE-754: Improper Check for Unusual or Exceptional Conditions
- CWE-755: Improper Handling of Exceptional Conditions
- CWE-209: Information Exposure Through Error Message
- CWE-390: Detection of Error Condition Without Action

---

## Quick Reference Checklist

| Category | Key Question |
|----------|--------------|
| A01 | Can users access resources they shouldn't? |
| A02 | Is sensitive data properly encrypted at rest and in transit? |
| A03 | Are dependencies up-to-date and from trusted sources? |
| A04 | Are default configs changed and unnecessary features disabled? |
| A05 | Is all user input validated and parameterized? |
| A06 | Does the design include rate limiting and defense in depth? |
| A07 | Is authentication strong with proper session management? |
| A08 | Is code integrity verified and serialization safe? |
| A09 | Are security events logged and monitored? |
| A10 | Do errors fail securely without exposing information? |
