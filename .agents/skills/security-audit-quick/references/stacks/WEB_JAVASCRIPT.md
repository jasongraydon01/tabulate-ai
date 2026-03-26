# JavaScript/TypeScript Web Security

Security patterns for Node.js, Express, Next.js, React, Vue, and Angular applications.

---

## Node.js / Express

### Common Vulnerabilities

**1. Prototype Pollution**
```javascript
// VULNERABLE: Deep merge without protection
function merge(target, source) {
  for (let key in source) {
    if (typeof source[key] === 'object') {
      target[key] = merge(target[key] || {}, source[key])
    } else {
      target[key] = source[key]
    }
  }
  return target
}
// Attack: { "__proto__": { "admin": true } }
```

```javascript
// SECURE: Check for prototype keys
function safeMerge(target, source) {
  for (let key in source) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      continue
    }
    // ...
  }
}
// Or use: Object.create(null) for objects
```

**2. Path Traversal in Static Files**
```javascript
// VULNERABLE
app.get('/files/:name', (req, res) => {
  res.sendFile('/uploads/' + req.params.name)
})

// SECURE
const path = require('path')
app.get('/files/:name', (req, res) => {
  const safeName = path.basename(req.params.name)
  const filePath = path.join('/uploads', safeName)
  res.sendFile(filePath)
})
```

**3. NoSQL Injection**
```javascript
// VULNERABLE: MongoDB query injection
app.post('/login', (req, res) => {
  User.findOne({
    email: req.body.email,
    password: req.body.password  // Could be { $ne: null }
  })
})

// SECURE: Validate types
app.post('/login', (req, res) => {
  if (typeof req.body.password !== 'string') {
    return res.status(400).send('Invalid input')
  }
  User.findOne({
    email: String(req.body.email),
    password: String(req.body.password)
  })
})
```

### Express Security Middleware

```javascript
const helmet = require('helmet')
const rateLimit = require('express-rate-limit')
const mongoSanitize = require('express-mongo-sanitize')

app.use(helmet())  // Security headers
app.use(helmet.contentSecurityPolicy({
  directives: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'"],
    styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", "data:", "https:"],
  }
}))

app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100
}))

app.use(mongoSanitize())  // Prevent NoSQL injection

// Disable x-powered-by
app.disable('x-powered-by')

// CORS configuration
app.use(cors({
  origin: ['https://myapp.com'],
  credentials: true
}))
```

---

## Next.js

### Common Vulnerabilities

**1. Server Actions Without Auth**
```typescript
// VULNERABLE: No auth check in server action (CVE-2025-55182 related)
'use server'
export async function deleteUser(userId: string) {
  await db.users.delete(userId)  // Anyone can call this!
}

// SECURE: Verify authentication
'use server'
export async function deleteUser(userId: string) {
  const session = await getServerSession()
  if (!session?.user?.isAdmin) {
    throw new Error('Unauthorized')
  }
  await db.users.delete(userId)
}
```

**2. SSRF in Server Components**
```typescript
// VULNERABLE: Fetching user-provided URLs
export default async function Page({ searchParams }) {
  const data = await fetch(searchParams.url)  // SSRF
  return <div>{data}</div>
}

// SECURE: Validate URLs
const ALLOWED_HOSTS = ['api.example.com']
export default async function Page({ searchParams }) {
  const url = new URL(searchParams.url)
  if (!ALLOWED_HOSTS.includes(url.hostname)) {
    return <div>Invalid URL</div>
  }
  // ...
}
```

**3. Exposed API Routes**
```typescript
// VULNERABLE: API route without auth
// pages/api/admin/users.ts
export default function handler(req, res) {
  const users = db.getAllUsers()  // No auth!
  res.json(users)
}

// SECURE: Add authentication middleware
import { getServerSession } from 'next-auth'
export default async function handler(req, res) {
  const session = await getServerSession(req, res, authOptions)
  if (!session?.user?.isAdmin) {
    return res.status(403).json({ error: 'Forbidden' })
  }
  // ...
}
```

### Next.js Security Configuration

```javascript
// next.config.js
module.exports = {
  headers: async () => [
    {
      source: '/(.*)',
      headers: [
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=()' }
      ]
    }
  ],
  // Disable x-powered-by
  poweredByHeader: false
}
```

---

## React

### Common Vulnerabilities

**1. XSS via dangerouslySetInnerHTML**
```jsx
// VULNERABLE
function Comment({ body }) {
  return <div dangerouslySetInnerHTML={{ __html: body }} />
}

// SECURE: Sanitize HTML
import DOMPurify from 'dompurify'
function Comment({ body }) {
  return <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(body) }} />
}

// BEST: Avoid if possible, use text content
function Comment({ body }) {
  return <div>{body}</div>  // Auto-escaped
}
```

**2. URL-Based XSS**
```jsx
// VULNERABLE: javascript: URLs
function Link({ href, children }) {
  return <a href={href}>{children}</a>  // href="javascript:alert(1)"
}

// SECURE: Validate URL scheme
function Link({ href, children }) {
  const isValidUrl = href.startsWith('http://') || href.startsWith('https://')
  return isValidUrl ? <a href={href}>{children}</a> : <span>{children}</span>
}
```

**3. Secrets in Client Bundle**
```jsx
// VULNERABLE: API keys in frontend
const API_KEY = 'sk-secret-key'
fetch(`/api?key=${API_KEY}`)

// SECURE: Use environment variables (NEXT_PUBLIC_ only for public)
// Keep secrets server-side only
```

### React Security Best Practices

```jsx
// Content Security Policy with React
// In index.html or via helmet
<meta http-equiv="Content-Security-Policy"
  content="default-src 'self'; script-src 'self' 'nonce-RANDOM'">

// Avoid eval and new Function
// Don't use: eval(userInput), new Function(userInput)

// Validate props
import PropTypes from 'prop-types'
Component.propTypes = {
  url: PropTypes.string.isRequired,
  // ...
}
```

---

## Vue.js

### Common Vulnerabilities

**1. v-html XSS**
```vue
<!-- VULNERABLE -->
<template>
  <div v-html="userContent"></div>
</template>

<!-- SECURE: Sanitize first -->
<script>
import DOMPurify from 'dompurify'
export default {
  computed: {
    safeContent() {
      return DOMPurify.sanitize(this.userContent)
    }
  }
}
</script>
<template>
  <div v-html="safeContent"></div>
</template>
```

**2. Interpolation in Attributes**
```vue
<!-- VULNERABLE: URL injection -->
<template>
  <a :href="userUrl">Link</a>
</template>

<!-- SECURE: Validate URL -->
<script>
export default {
  computed: {
    safeUrl() {
      try {
        const url = new URL(this.userUrl)
        return ['http:', 'https:'].includes(url.protocol) ? this.userUrl : '#'
      } catch {
        return '#'
      }
    }
  }
}
</script>
```

---

## Angular

### Common Vulnerabilities

**1. Bypassing Sanitization**
```typescript
// VULNERABLE: Bypassing Angular's sanitizer
@Component({
  template: `<div [innerHTML]="trustedHtml"></div>`
})
export class MyComponent {
  constructor(private sanitizer: DomSanitizer) {}

  trustedHtml = this.sanitizer.bypassSecurityTrustHtml(userInput)  // Dangerous!
}

// SECURE: Let Angular sanitize, or sanitize yourself first
import DOMPurify from 'dompurify'
trustedHtml = this.sanitizer.bypassSecurityTrustHtml(DOMPurify.sanitize(userInput))
```

**2. Template Injection**
```typescript
// VULNERABLE: Dynamic template compilation with user input
const template = `<div>${userInput}</div>`
// Using JIT compiler with user input

// SECURE: Use property binding, not string interpolation in templates
```

### Angular Security Configuration

```typescript
// Enable strict CSP
// In angular.json, set "budgets" to enforce size limits

// Use HttpClient with interceptors for auth
@Injectable()
export class AuthInterceptor implements HttpInterceptor {
  intercept(req: HttpRequest<any>, next: HttpHandler) {
    const authReq = req.clone({
      setHeaders: { Authorization: `Bearer ${this.auth.token}` }
    })
    return next.handle(authReq)
  }
}
```

---

## npm/yarn Security

### Dependency Vulnerabilities

```bash
# Audit dependencies
npm audit
yarn audit

# Fix automatically where possible
npm audit fix

# Check for outdated packages
npm outdated
```

### Package.json Security

```json
{
  "scripts": {
    "preinstall": "npx npm-force-resolutions",
    "audit": "npm audit --audit-level=high"
  },
  "resolutions": {
    "vulnerable-package": "^2.0.0"
  }
}
```

### Lockfile Importance

- Always commit `package-lock.json` or `yarn.lock`
- Review lockfile changes in PRs
- Use `npm ci` in CI/CD (respects lockfile exactly)

---

## Detection Checklist

| Issue | What to Look For |
|-------|------------------|
| XSS | dangerouslySetInnerHTML, v-html, bypassSecurityTrust |
| Prototype Pollution | Object.assign, spread with user input, lodash merge |
| Path Traversal | req.params in file paths, sendFile, readFile |
| SSRF | fetch/axios with user URLs |
| NoSQL Injection | MongoDB queries with req.body directly |
| Secrets | API keys in frontend code, .env in bundle |
| Missing Headers | No helmet, no CSP, no CORS config |
| Auth Bypass | Unprotected API routes, missing middleware |
