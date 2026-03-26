# Authentication & Authorization Patterns

Security patterns and anti-patterns for authentication and authorization.

---

## Authentication Vulnerabilities

### 1. Credential Storage

**Vulnerable Patterns:**
```python
# Plain text password storage
user.password = request.password

# Weak hashing
user.password = md5(request.password)
user.password = sha1(request.password)

# Reversible encryption
user.password = encrypt(request.password, key)
```

**Secure Patterns:**
```python
# bcrypt with appropriate cost factor
import bcrypt
user.password_hash = bcrypt.hashpw(password.encode(), bcrypt.gensalt(rounds=12))

# Argon2 (recommended for new applications)
from argon2 import PasswordHasher
ph = PasswordHasher()
user.password_hash = ph.hash(password)

# scrypt
import hashlib
user.password_hash = hashlib.scrypt(password.encode(), salt=salt, n=16384, r=8, p=1)
```

### 2. Session Management

**Vulnerable Patterns:**
```javascript
// Session ID in URL
res.redirect(`/dashboard?sessionId=${session.id}`)

// Predictable session IDs
const sessionId = `user_${userId}_${Date.now()}`

// No session regeneration after auth
req.session.userId = user.id  // Same session before/after login

// Sessions that never expire
const session = { userId: user.id }  // No expiry

// Session not invalidated on logout
app.post('/logout', (req, res) => {
  res.clearCookie('session')  // Cookie cleared but session still valid
})
```

**Secure Patterns:**
```javascript
// Cryptographically secure session IDs
const crypto = require('crypto')
const sessionId = crypto.randomBytes(32).toString('hex')

// Session regeneration after authentication
app.post('/login', (req, res) => {
  req.session.regenerate(() => {
    req.session.userId = user.id
    req.session.cookie.maxAge = 3600000  // 1 hour
  })
})

// Proper logout with session destruction
app.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    res.clearCookie('connect.sid')
    res.redirect('/login')
  })
})
```

### 3. Password Reset

**Vulnerable Patterns:**
```python
# Predictable reset tokens
token = base64.encode(f"{user.email}:{timestamp}")

# Token that doesn't expire
reset_token = generate_token()
db.save(user_id=user.id, token=reset_token)  # No expiry

# Token reusable after password change
# (old token still works after reset)

# Username enumeration through reset
if not user_exists(email):
    return "User not found"  # Reveals valid emails
```

**Secure Patterns:**
```python
# Cryptographically secure token with expiry
import secrets
token = secrets.token_urlsafe(32)
expiry = datetime.utcnow() + timedelta(hours=1)
db.save(user_id=user.id, token=hash(token), expires=expiry, used=False)

# Invalidate token after use
def reset_password(token, new_password):
    record = db.find(token=hash(token), used=False, expires__gt=now())
    if not record:
        raise InvalidTokenError()
    user.password = hash_password(new_password)
    record.used = True  # Invalidate token
    db.invalidate_all_sessions(user.id)  # Force re-login

# Consistent response (no enumeration)
def request_reset(email):
    user = find_user(email)
    if user:
        send_reset_email(user)
    # Always same response, same timing
    return "If account exists, reset email sent"
```

### 4. Multi-Factor Authentication Bypass

**Vulnerable Patterns:**
```javascript
// MFA check can be skipped
app.post('/verify-mfa', (req, res) => {
  if (verifyCode(req.body.code)) {
    req.session.mfaVerified = true
  }
  res.redirect('/dashboard')  // Redirects even if MFA failed!
})

// MFA state stored client-side
res.cookie('mfaComplete', 'true')  // Can be forged

// No rate limiting on MFA attempts
// Allows brute forcing 6-digit codes (1 million attempts max)
```

**Secure Patterns:**
```javascript
// Strict MFA verification
app.post('/verify-mfa', rateLimiter, (req, res) => {
  if (!verifyCode(req.user.id, req.body.code)) {
    req.session.mfaAttempts = (req.session.mfaAttempts || 0) + 1
    if (req.session.mfaAttempts >= 3) {
      req.session.destroy()
      return res.status(401).json({ error: 'Too many attempts' })
    }
    return res.status(401).json({ error: 'Invalid code' })
  }
  req.session.mfaVerified = true
  req.session.mfaAttempts = 0
  res.redirect('/dashboard')
})

// Middleware requiring MFA
const requireMFA = (req, res, next) => {
  if (!req.session.mfaVerified) {
    return res.redirect('/mfa')
  }
  next()
}
```

---

## Authorization Vulnerabilities

### 1. Insecure Direct Object Reference (IDOR)

**Vulnerable Patterns:**
```javascript
// No ownership verification
app.get('/api/orders/:orderId', (req, res) => {
  const order = db.orders.find(req.params.orderId)
  res.json(order)  // Any user can view any order
})

// Hidden but guessable IDs
app.get('/api/documents/:id', (req, res) => {
  // IDs are sequential: 1, 2, 3, 4...
  const doc = db.documents.find(req.params.id)
  res.json(doc)
})
```

**Secure Patterns:**
```javascript
// Ownership verification
app.get('/api/orders/:orderId', authenticate, (req, res) => {
  const order = db.orders.find({
    id: req.params.orderId,
    userId: req.user.id  // Scope to current user
  })
  if (!order) return res.status(404).json({ error: 'Not found' })
  res.json(order)
})

// Use UUIDs instead of sequential IDs
const { v4: uuidv4 } = require('uuid')
const document = { id: uuidv4(), ... }
```

### 2. Privilege Escalation

**Vulnerable Patterns:**
```javascript
// Role stored client-side
const user = { role: req.cookies.role }

// Role modifiable in request
app.put('/api/user', (req, res) => {
  db.users.update(req.user.id, {
    name: req.body.name,
    role: req.body.role  // User can set their own role!
  })
})

// Admin check bypassable
if (req.query.admin === 'true') {
  // Grant admin access
}
```

**Secure Patterns:**
```javascript
// Role from trusted source only
app.put('/api/user', authenticate, (req, res) => {
  const { name, email } = req.body  // Whitelist allowed fields
  db.users.update(req.user.id, { name, email })
})

// Separate admin endpoints with middleware
const requireAdmin = (req, res, next) => {
  const user = db.users.find(req.user.id)  // From DB, not request
  if (user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden' })
  }
  next()
}

app.get('/admin/users', authenticate, requireAdmin, (req, res) => {
  // Admin-only endpoint
})
```

### 3. Horizontal Privilege Escalation

**Vulnerable Patterns:**
```python
# User can modify other users' data
@app.route('/api/user/<user_id>/settings', methods=['PUT'])
def update_settings(user_id):
    # No check that current user == user_id
    db.update_settings(user_id, request.json)
```

**Secure Patterns:**
```python
@app.route('/api/user/<user_id>/settings', methods=['PUT'])
@require_auth
def update_settings(user_id):
    if current_user.id != user_id and not current_user.is_admin:
        abort(403)
    db.update_settings(user_id, request.json)
```

### 4. Function Level Access Control

**Vulnerable Patterns:**
```javascript
// Admin functions accessible to all authenticated users
app.delete('/api/users/:id', authenticate, (req, res) => {
  db.users.delete(req.params.id)  // Any user can delete any user!
})

// Relying on UI to hide admin features
// (API still accessible)
```

**Secure Patterns:**
```javascript
// Explicit role check
app.delete('/api/users/:id', authenticate, requireRole('admin'), (req, res) => {
  db.users.delete(req.params.id)
})

// Permission-based access control
app.delete('/api/users/:id', authenticate, requirePermission('users:delete'), (req, res) => {
  db.users.delete(req.params.id)
})
```

---

## JWT Security

### Vulnerable Patterns

```javascript
// No algorithm verification (allows 'none' algorithm)
const decoded = jwt.decode(token)  // Doesn't verify!

// Algorithm confusion (RS256 -> HS256 attack)
const decoded = jwt.verify(token, publicKey)  // Vulnerable

// Sensitive data in JWT
const token = jwt.sign({
  userId: user.id,
  password: user.password,  // Never put secrets in JWT
  ssn: user.ssn
}, secret)

// No expiration
const token = jwt.sign({ userId: user.id }, secret)  // Never expires

// Secret in code
const token = jwt.sign(payload, 'hardcoded-secret-123')
```

### Secure Patterns

```javascript
// Explicit algorithm specification
const decoded = jwt.verify(token, secret, { algorithms: ['HS256'] })

// Short expiration with refresh tokens
const accessToken = jwt.sign(
  { userId: user.id, type: 'access' },
  process.env.JWT_SECRET,
  { algorithm: 'HS256', expiresIn: '15m' }
)
const refreshToken = jwt.sign(
  { userId: user.id, type: 'refresh' },
  process.env.JWT_REFRESH_SECRET,
  { algorithm: 'HS256', expiresIn: '7d' }
)

// Minimal payload
const token = jwt.sign({
  sub: user.id,  // Subject (user ID)
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + (15 * 60)
}, process.env.JWT_SECRET, { algorithm: 'HS256' })

// Token revocation tracking
const tokenBlacklist = new Set()
function isTokenRevoked(token) {
  return tokenBlacklist.has(token)
}
```

---

## OAuth/OIDC Security

### Vulnerable Patterns

```javascript
// Missing state parameter (CSRF)
const authUrl = `${provider}/authorize?client_id=${clientId}&redirect_uri=${redirect}`

// Open redirect in callback
app.get('/callback', (req, res) => {
  res.redirect(req.query.redirect_to)  // Attacker controlled
})

// Token in URL fragment exposed to JavaScript
// Using implicit flow for sensitive apps
```

### Secure Patterns

```javascript
// State parameter for CSRF protection
const state = crypto.randomBytes(32).toString('hex')
req.session.oauthState = state
const authUrl = `${provider}/authorize?client_id=${clientId}&redirect_uri=${redirect}&state=${state}`

// Validate state on callback
app.get('/callback', (req, res) => {
  if (req.query.state !== req.session.oauthState) {
    return res.status(403).send('Invalid state')
  }
  // Exchange code for tokens
})

// Use authorization code flow with PKCE
const codeVerifier = crypto.randomBytes(32).toString('base64url')
const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url')
// Include code_challenge in auth request
// Include code_verifier in token request
```

---

## Detection Checklist

| Area | What to Look For |
|------|------------------|
| Password Storage | MD5, SHA1, plain text, reversible encryption |
| Sessions | URL tokens, predictable IDs, no expiry, no regeneration |
| Password Reset | Predictable tokens, no expiry, enumeration |
| MFA | Bypassable, no rate limiting, client-side state |
| IDOR | Missing ownership checks, sequential IDs |
| Privilege | Client-side roles, modifiable in request |
| JWT | No algorithm check, no expiry, secrets in payload |
| OAuth | Missing state, open redirects, implicit flow |
