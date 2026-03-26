# Python Web Security

Security patterns for Django, Flask, and FastAPI applications.

---

## Django

### Common Vulnerabilities

**1. SQL Injection via raw() and extra()**
```python
# VULNERABLE: Raw SQL with string formatting
User.objects.raw(f"SELECT * FROM users WHERE name = '{name}'")
User.objects.extra(where=[f"name = '{name}'"])

# SECURE: Use parameters
User.objects.raw("SELECT * FROM users WHERE name = %s", [name])
User.objects.filter(name=name)  # ORM is safe by default
```

**2. Template Injection**
```python
# VULNERABLE: mark_safe with user input
from django.utils.safestring import mark_safe
def view(request):
    return render(request, 'page.html', {
        'content': mark_safe(request.GET.get('content'))  # XSS!
    })

# SECURE: Let Django auto-escape, or sanitize first
import bleach
content = bleach.clean(request.GET.get('content'))
```

**3. Mass Assignment**
```python
# VULNERABLE: Updating model with all request data
user = User.objects.get(id=request.user.id)
for key, value in request.POST.items():
    setattr(user, key, value)  # Can set is_admin=True!
user.save()

# SECURE: Whitelist allowed fields
ALLOWED_FIELDS = ['name', 'email', 'bio']
for key, value in request.POST.items():
    if key in ALLOWED_FIELDS:
        setattr(user, key, value)
user.save()

# BEST: Use Django Forms
class ProfileForm(forms.ModelForm):
    class Meta:
        model = User
        fields = ['name', 'email', 'bio']  # Only these
```

**4. Insecure Deserialization**
```python
# VULNERABLE: Pickle with user data
import pickle
data = pickle.loads(request.body)  # RCE!

# SECURE: Use JSON
import json
data = json.loads(request.body)
```

### Django Security Settings

```python
# settings.py - Production security settings

DEBUG = False
ALLOWED_HOSTS = ['myapp.com', 'www.myapp.com']

# HTTPS
SECURE_SSL_REDIRECT = True
SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')

# Cookies
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
SESSION_COOKIE_HTTPONLY = True
CSRF_COOKIE_HTTPONLY = True

# HSTS
SECURE_HSTS_SECONDS = 31536000
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SECURE_HSTS_PRELOAD = True

# Content Security
SECURE_CONTENT_TYPE_NOSNIFF = True
X_FRAME_OPTIONS = 'DENY'

# CSRF
CSRF_TRUSTED_ORIGINS = ['https://myapp.com']

# Password validation
AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator', 'OPTIONS': {'min_length': 12}},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]
```

---

## Flask

### Common Vulnerabilities

**1. SSTI (Server-Side Template Injection)**
```python
# VULNERABLE: User input in template string
@app.route('/greet')
def greet():
    template = f"Hello {request.args.get('name')}"
    return render_template_string(template)  # SSTI!
    # Attack: name={{config.SECRET_KEY}}

# SECURE: Pass as variable
@app.route('/greet')
def greet():
    return render_template_string("Hello {{name}}", name=request.args.get('name'))

# BEST: Use template files
return render_template('greet.html', name=request.args.get('name'))
```

**2. Insecure Secret Key**
```python
# VULNERABLE
app.secret_key = 'development'  # Weak, predictable

# SECURE
import os
app.secret_key = os.environ.get('SECRET_KEY')
# Generate with: python -c "import secrets; print(secrets.token_hex(32))"
```

**3. Open Redirect**
```python
# VULNERABLE
@app.route('/redirect')
def redirect_page():
    return redirect(request.args.get('url'))  # Open redirect!

# SECURE: Validate redirect URL
from urllib.parse import urlparse
@app.route('/redirect')
def redirect_page():
    url = request.args.get('url', '/')
    parsed = urlparse(url)
    # Only allow relative URLs or same-host
    if parsed.netloc and parsed.netloc != request.host:
        return redirect('/')
    return redirect(url)
```

**4. SQL Injection with raw SQL**
```python
# VULNERABLE
@app.route('/user/<user_id>')
def get_user(user_id):
    conn = get_db()
    cursor = conn.execute(f"SELECT * FROM users WHERE id = {user_id}")
    return jsonify(cursor.fetchone())

# SECURE: Parameterized query
cursor = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,))
```

### Flask Security Configuration

```python
from flask import Flask
from flask_talisman import Talisman
from flask_seasurf import SeaSurf

app = Flask(__name__)

# Security headers via Talisman
Talisman(app, content_security_policy={
    'default-src': "'self'",
    'script-src': "'self'",
    'style-src': "'self' 'unsafe-inline'"
})

# CSRF protection
csrf = SeaSurf(app)

# Session configuration
app.config.update(
    SESSION_COOKIE_SECURE=True,
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE='Lax',
    PERMANENT_SESSION_LIFETIME=3600
)
```

---

## FastAPI

### Common Vulnerabilities

**1. Missing Authentication**
```python
# VULNERABLE: No auth on sensitive endpoint
@app.delete("/users/{user_id}")
async def delete_user(user_id: int):
    await db.users.delete(user_id)

# SECURE: Use dependency injection for auth
from fastapi import Depends, HTTPException
from fastapi.security import OAuth2PasswordBearer

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")

async def get_current_user(token: str = Depends(oauth2_scheme)):
    user = verify_token(token)
    if not user:
        raise HTTPException(status_code=401)
    return user

@app.delete("/users/{user_id}")
async def delete_user(user_id: int, current_user: User = Depends(get_current_user)):
    if not current_user.is_admin:
        raise HTTPException(status_code=403)
    await db.users.delete(user_id)
```

**2. IDOR (Insecure Direct Object Reference)**
```python
# VULNERABLE: No ownership check
@app.get("/documents/{doc_id}")
async def get_document(doc_id: int, user: User = Depends(get_current_user)):
    return await db.documents.get(doc_id)  # Any user can access any doc

# SECURE: Check ownership
@app.get("/documents/{doc_id}")
async def get_document(doc_id: int, user: User = Depends(get_current_user)):
    doc = await db.documents.get(doc_id)
    if doc.owner_id != user.id:
        raise HTTPException(status_code=403)
    return doc
```

**3. Response Model Data Leakage**
```python
# VULNERABLE: Returning full model (includes password_hash)
@app.get("/users/me")
async def get_me(user: User = Depends(get_current_user)):
    return user  # Includes all fields!

# SECURE: Use response model
class UserResponse(BaseModel):
    id: int
    email: str
    name: str

@app.get("/users/me", response_model=UserResponse)
async def get_me(user: User = Depends(get_current_user)):
    return user  # Only UserResponse fields returned
```

### FastAPI Security Best Practices

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware

app = FastAPI()

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://myapp.com"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["*"],
)

# Trusted hosts
app.add_middleware(
    TrustedHostMiddleware,
    allowed_hosts=["myapp.com", "*.myapp.com"]
)

# Rate limiting (via slowapi or similar)
from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter

@app.get("/api/resource")
@limiter.limit("10/minute")
async def resource(request: Request):
    return {"status": "ok"}
```

---

## Common Python Vulnerabilities

### Unsafe YAML Loading
```python
# VULNERABLE
import yaml
data = yaml.load(user_input)  # Arbitrary code execution!

# SECURE
data = yaml.safe_load(user_input)
```

### Unsafe Pickle
```python
# VULNERABLE
import pickle
data = pickle.loads(user_data)  # RCE!

# SECURE: Use JSON or validate source
import json
data = json.loads(user_data)
```

### Command Injection
```python
# VULNERABLE
import os
os.system(f"convert {filename} output.pdf")

# SECURE
import subprocess
subprocess.run(["convert", filename, "output.pdf"], check=True)
```

### Path Traversal
```python
# VULNERABLE
def get_file(filename):
    return open(f"/uploads/{filename}").read()

# SECURE
import os
def get_file(filename):
    base = "/uploads"
    filepath = os.path.realpath(os.path.join(base, filename))
    if not filepath.startswith(base):
        raise ValueError("Invalid path")
    return open(filepath).read()
```

---

## Detection Checklist

| Issue | What to Look For |
|-------|------------------|
| SQL Injection | raw(), extra(), f-strings in queries |
| SSTI | render_template_string with user input |
| XSS | mark_safe(), Markup() with user data |
| Deserialization | pickle.loads, yaml.load (not safe_load) |
| Command Injection | os.system, subprocess with shell=True |
| Path Traversal | open() with user input in path |
| Mass Assignment | setattr in loop, **kwargs to model |
| Open Redirect | redirect() with user URL |
| Weak Secrets | Hardcoded SECRET_KEY, DEBUG=True |
| Missing Auth | Endpoints without auth decorators |
