# Input Validation & Injection Prevention

Comprehensive patterns for validating input and preventing injection attacks.

---

## SQL Injection

### How It Works
Attacker-controlled input is concatenated into SQL queries, allowing them to modify query logic, extract data, or execute administrative operations.

### Vulnerable Patterns

```javascript
// String concatenation
const query = "SELECT * FROM users WHERE email = '" + email + "'"

// Template literals
const query = `SELECT * FROM users WHERE id = ${userId}`

// String formatting (Python)
query = "SELECT * FROM users WHERE email = '%s'" % email
query = f"SELECT * FROM users WHERE email = '{email}'"
```

### Secure Patterns

```javascript
// Parameterized queries (Node.js - pg)
const query = 'SELECT * FROM users WHERE email = $1'
client.query(query, [email])

// Parameterized queries (Python - psycopg2)
cursor.execute("SELECT * FROM users WHERE email = %s", (email,))

// ORM (safe by default)
User.findOne({ where: { email: email } })  // Sequelize
User.objects.filter(email=email)  # Django

// Stored procedures with parameters
CALL get_user_by_email(?)
```

### Detection Patterns
```
# Look for string operations in SQL context:
- "SELECT" + variable
- "WHERE.*=.*" + variable
- f"SELECT.*{variable}"
- "SELECT".format(variable)
- `SELECT ... ${variable}`
```

---

## NoSQL Injection

### How It Works
Object injection into NoSQL queries allows attackers to modify query operators and bypass authentication or access unauthorized data.

### Vulnerable Patterns

```javascript
// MongoDB - object injection
app.post('/login', (req, res) => {
  // If req.body.password = { $ne: null }, this returns any user!
  db.users.findOne({
    email: req.body.email,
    password: req.body.password
  })
})

// Query operators from user input
db.users.find({ age: req.query.age })  // age[$gt]=0 returns all
```

### Secure Patterns

```javascript
// Type validation
app.post('/login', (req, res) => {
  if (typeof req.body.password !== 'string') {
    return res.status(400).send('Invalid input')
  }
  // Force string comparison
  db.users.findOne({
    email: String(req.body.email),
    password: String(req.body.password)
  })
})

// Schema validation (Mongoose)
const userSchema = new Schema({
  email: { type: String, required: true },
  password: { type: String, required: true }
})

// Sanitize operators
const mongo = require('mongo-sanitize')
db.users.findOne(mongo(req.body))
```

---

## Command Injection

### How It Works
User input is passed to shell commands, allowing attackers to execute arbitrary system commands.

### Vulnerable Patterns

```javascript
// Direct shell execution
exec(`convert ${filename} output.pdf`)
exec('ping ' + hostname)

// Using shell=True (Python)
subprocess.run(f'convert {filename} output.pdf', shell=True)
os.system('ping ' + hostname)
```

### Secure Patterns

```javascript
// Use arrays (no shell interpolation)
execFile('convert', [filename, 'output.pdf'])
spawn('ping', [hostname])

// Python - avoid shell=True
subprocess.run(['convert', filename, 'output.pdf'])  # No shell=True

// Validate and sanitize input
const allowedChars = /^[a-zA-Z0-9._-]+$/
if (!allowedChars.test(filename)) {
  throw new Error('Invalid filename')
}

// Use libraries instead of shell commands
const sharp = require('sharp')
sharp(inputFile).toFile(outputFile)  // Instead of ImageMagick CLI
```

### Detection Patterns
```
# Look for:
- exec(), execSync(), spawn() with string arguments
- child_process with user input
- os.system(), subprocess with shell=True
- backticks or $() with variables
```

---

## Cross-Site Scripting (XSS)

### Types
1. **Reflected XSS**: Malicious script in URL/request reflected in response
2. **Stored XSS**: Malicious script stored in database, served to users
3. **DOM XSS**: Client-side JavaScript insecurely handles user input

### Vulnerable Patterns

```javascript
// Reflected XSS
res.send(`<h1>Hello ${req.query.name}</h1>`)

// Stored XSS (comment saved without sanitization)
db.comments.insert({ body: req.body.comment })
// Later rendered: <div>${comment.body}</div>

// DOM XSS
document.getElementById('output').innerHTML = location.hash.slice(1)

// React dangerouslySetInnerHTML
<div dangerouslySetInnerHTML={{ __html: userContent }} />
```

### Secure Patterns

```javascript
// HTML encoding
const escapeHtml = require('escape-html')
res.send(`<h1>Hello ${escapeHtml(req.query.name)}</h1>`)

// React (auto-escapes by default)
<div>{userName}</div>  // Safe - auto-escaped

// If HTML needed, sanitize first
const DOMPurify = require('dompurify')
const clean = DOMPurify.sanitize(userContent)
<div dangerouslySetInnerHTML={{ __html: clean }} />

// Content Security Policy header
res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'")

// DOM manipulation without innerHTML
element.textContent = userInput  // Safe - no parsing
```

### Detection Patterns
```
# Look for:
- innerHTML = userInput
- dangerouslySetInnerHTML with user data
- document.write() with user input
- Template strings/concatenation in HTML context
- v-html (Vue), [innerHTML] (Angular) with user data
```

---

## Path Traversal

### How It Works
Attacker manipulates file paths to access files outside intended directories using sequences like `../`.

### Vulnerable Patterns

```javascript
// Direct path concatenation
const filePath = '/uploads/' + req.params.filename
fs.readFile(filePath)  // ../../../etc/passwd works!

// URL decoding bypass
// %2e%2e%2f = ../
app.get('/files/:name', (req, res) => {
  res.sendFile('/data/' + decodeURIComponent(req.params.name))
})
```

### Secure Patterns

```javascript
const path = require('path')

// Resolve and validate path
const baseDir = '/uploads'
const filePath = path.join(baseDir, req.params.filename)
const resolved = path.resolve(filePath)

// Ensure resolved path is within base directory
if (!resolved.startsWith(baseDir)) {
  return res.status(403).send('Access denied')
}

// Use path.basename to get just the filename
const safeName = path.basename(req.params.filename)
const filePath = path.join(baseDir, safeName)

// Whitelist allowed files
const allowedFiles = ['report.pdf', 'guide.pdf']
if (!allowedFiles.includes(req.params.filename)) {
  return res.status(404).send('Not found')
}
```

---

## Server-Side Request Forgery (SSRF)

### How It Works
Attacker tricks server into making requests to unintended locations, accessing internal services or cloud metadata.

### Vulnerable Patterns

```javascript
// Fetching user-provided URLs
app.get('/fetch', async (req, res) => {
  const response = await fetch(req.query.url)  // SSRF!
  res.send(await response.text())
})

// URL in image processing
await sharp(req.body.imageUrl).toFile('output.jpg')

// PDF generation with external resources
pdf.create(`<img src="${req.body.logo}">`)
```

### Secure Patterns

```javascript
const url = require('url')
const dns = require('dns').promises

// URL validation and restriction
async function isAllowedUrl(urlString) {
  const parsed = new URL(urlString)

  // Only allow HTTPS
  if (parsed.protocol !== 'https:') return false

  // Block internal IPs
  const addresses = await dns.resolve(parsed.hostname)
  for (const addr of addresses) {
    if (isInternalIP(addr)) return false
  }

  // Allowlist domains
  const allowedDomains = ['example.com', 'cdn.example.com']
  if (!allowedDomains.includes(parsed.hostname)) return false

  return true
}

function isInternalIP(ip) {
  return ip.startsWith('10.') ||
         ip.startsWith('192.168.') ||
         ip.startsWith('172.16.') ||
         ip.startsWith('127.') ||
         ip === '169.254.169.254'  // Cloud metadata
}

// Use with validation
app.get('/fetch', async (req, res) => {
  if (!await isAllowedUrl(req.query.url)) {
    return res.status(400).send('URL not allowed')
  }
  // Proceed with fetch
})
```

---

## XML External Entity (XXE)

### How It Works
XML parsers process external entity declarations, allowing attackers to read files, perform SSRF, or cause denial of service.

### Vulnerable Patterns

```python
# Python - lxml with default settings
from lxml import etree
doc = etree.parse(user_xml)

# Java - default DocumentBuilder
DocumentBuilder db = DocumentBuilderFactory.newInstance().newDocumentBuilder()
Document doc = db.parse(userInput)
```

### Secure Patterns

```python
# Python - disable external entities
from lxml import etree
parser = etree.XMLParser(resolve_entities=False, no_network=True)
doc = etree.parse(user_xml, parser)

# Or use defusedxml
from defusedxml import ElementTree
doc = ElementTree.parse(user_xml)
```

```java
// Java - disable DTDs and external entities
DocumentBuilderFactory dbf = DocumentBuilderFactory.newInstance();
dbf.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
dbf.setFeature("http://xml.org/sax/features/external-general-entities", false);
dbf.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
```

---

## Deserialization

### How It Works
Deserializing untrusted data can lead to remote code execution if the serialization format supports object instantiation.

### Vulnerable Patterns

```python
# Python pickle
import pickle
data = pickle.loads(user_input)  # RCE possible

# Python yaml
import yaml
data = yaml.load(user_input)  # Unsafe loader

# Java ObjectInputStream
ObjectInputStream ois = new ObjectInputStream(userInput);
Object obj = ois.readObject();  # RCE possible

# PHP unserialize
$data = unserialize($_POST['data']);
```

### Secure Patterns

```python
# Use JSON instead
import json
data = json.loads(user_input)

# If YAML needed, use safe loader
import yaml
data = yaml.safe_load(user_input)

# Validate schema after parsing
from jsonschema import validate
validate(instance=data, schema=expected_schema)
```

---

## Regular Expression Denial of Service (ReDoS)

### How It Works
Poorly written regex can have exponential backtracking on certain inputs, causing CPU exhaustion.

### Vulnerable Patterns

```javascript
// Nested quantifiers
const pattern = /^(a+)+$/
pattern.test('aaaaaaaaaaaaaaaaaaaaaaaaaaaaab')  // Hangs!

// Overlapping alternatives
const pattern = /^(a|a)+$/

// From user input
const userPattern = req.query.pattern
new RegExp(userPattern).test(input)  // ReDoS and injection
```

### Secure Patterns

```javascript
// Use atomic groups or possessive quantifiers if available
// Limit input length before regex
if (input.length > 1000) {
  throw new Error('Input too long')
}

// Use timeout
const { RE2 } = require('re2')  // Safe regex engine
const pattern = new RE2('^[a-z]+$')

// Validate user-provided patterns
const safePatternChars = /^[a-zA-Z0-9\s\-_.]+$/
if (!safePatternChars.test(userPattern)) {
  throw new Error('Invalid pattern')
}
```

---

## Input Validation Checklist

| Input Type | Validation |
|------------|------------|
| Email | Regex + length limit + domain validation |
| URL | Protocol whitelist + domain whitelist + no internal IPs |
| File path | Normalize + check within base directory |
| Filename | Basename only + extension whitelist |
| Numbers | Parse explicitly + range check |
| Dates | Parse to Date object + range check |
| JSON | Parse + schema validation |
| HTML | Sanitize with DOMPurify or equivalent |
| SQL params | Use parameterized queries only |
| Shell args | Use array form + validate characters |

## Defense in Depth

1. **Validate input** - Check type, length, format, range
2. **Sanitize/encode output** - Context-appropriate encoding
3. **Use parameterized APIs** - Prevent injection at the source
4. **Limit privileges** - Least privilege for database users, file access
5. **Monitor and log** - Detect and respond to attacks
