# Database Security

Security patterns for SQL and NoSQL databases.

---

## SQL Databases

### Connection Security

```python
# VULNERABLE: Connection string with credentials in code
conn_string = "postgresql://admin:Password123@db.example.com:5432/mydb"

# SECURE: Use environment variables
import os
conn_string = os.environ.get('DATABASE_URL')

# SECURE: Use secrets manager
from aws_secretsmanager import get_secret
db_creds = get_secret('prod/db/credentials')
```

### Parameterized Queries

```python
# PostgreSQL (psycopg2)
# VULNERABLE
cursor.execute(f"SELECT * FROM users WHERE id = {user_id}")

# SECURE
cursor.execute("SELECT * FROM users WHERE id = %s", (user_id,))

# MySQL (mysql-connector)
# SECURE
cursor.execute("SELECT * FROM users WHERE id = %s", (user_id,))

# SQLite
# SECURE
cursor.execute("SELECT * FROM users WHERE id = ?", (user_id,))
```

```javascript
// Node.js - pg
// VULNERABLE
client.query(`SELECT * FROM users WHERE id = ${userId}`)

// SECURE
client.query('SELECT * FROM users WHERE id = $1', [userId])

// Node.js - mysql2
// SECURE
connection.execute('SELECT * FROM users WHERE id = ?', [userId])
```

### Stored Procedures

```sql
-- VULNERABLE: Dynamic SQL in procedure
CREATE PROCEDURE GetUser(IN userName VARCHAR(100))
BEGIN
    SET @sql = CONCAT('SELECT * FROM users WHERE name = ''', userName, '''');
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
END;

-- SECURE: Parameterized procedure
CREATE PROCEDURE GetUser(IN userName VARCHAR(100))
BEGIN
    SELECT * FROM users WHERE name = userName;
END;
```

### Least Privilege

```sql
-- Create application user with minimal permissions
CREATE USER 'app_user'@'%' IDENTIFIED BY 'secure_password';

-- Grant only necessary permissions
GRANT SELECT, INSERT, UPDATE ON mydb.users TO 'app_user'@'%';
GRANT SELECT ON mydb.products TO 'app_user'@'%';

-- Never grant:
-- GRANT ALL PRIVILEGES ON *.* TO 'app_user'@'%';
-- GRANT DROP, ALTER, CREATE ON mydb.* TO 'app_user'@'%';
```

### Encryption

```sql
-- PostgreSQL: Encrypt sensitive columns
CREATE EXTENSION pgcrypto;

-- Encrypt
INSERT INTO users (email, ssn_encrypted)
VALUES (
    'user@example.com',
    pgp_sym_encrypt('123-45-6789', 'encryption_key')
);

-- Decrypt
SELECT email, pgp_sym_decrypt(ssn_encrypted::bytea, 'encryption_key') as ssn
FROM users;

-- MySQL: Column encryption
INSERT INTO users (email, ssn_encrypted)
VALUES (
    'user@example.com',
    AES_ENCRYPT('123-45-6789', 'encryption_key')
);
```

---

## MongoDB

### Authentication & Authorization

```javascript
// VULNERABLE: No authentication
const client = new MongoClient('mongodb://localhost:27017');

// SECURE: With authentication
const client = new MongoClient(
  'mongodb://user:password@localhost:27017/mydb?authSource=admin',
  {
    tls: true,
    tlsCAFile: '/path/to/ca.pem'
  }
);
```

### Query Injection Prevention

```javascript
// VULNERABLE: Object injection
app.post('/login', (req, res) => {
  // If req.body.password = { $ne: null }, returns any user!
  db.collection('users').findOne({
    email: req.body.email,
    password: req.body.password
  });
});

// SECURE: Type validation
app.post('/login', (req, res) => {
  // Validate types
  if (typeof req.body.email !== 'string' || typeof req.body.password !== 'string') {
    return res.status(400).send('Invalid input');
  }

  db.collection('users').findOne({
    email: String(req.body.email),
    password: String(req.body.password)
  });
});

// SECURE: Use mongo-sanitize
const sanitize = require('mongo-sanitize');
db.collection('users').findOne(sanitize(req.body));
```

### Aggregation Injection

```javascript
// VULNERABLE: User input in $where
db.collection('users').find({
  $where: `this.name == '${userName}'`  // Code injection!
});

// SECURE: Use query operators
db.collection('users').find({
  name: userName
});
```

### Field Level Encryption

```javascript
// MongoDB Client-Side Field Level Encryption
const { MongoClient, ClientEncryption } = require('mongodb');

const client = new MongoClient(uri, {
  autoEncryption: {
    keyVaultNamespace: 'encryption.__keyVault',
    kmsProviders: {
      aws: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
      }
    },
    schemaMap: {
      'mydb.users': {
        bsonType: 'object',
        encryptMetadata: { keyId: [dataKeyId] },
        properties: {
          ssn: {
            encrypt: {
              bsonType: 'string',
              algorithm: 'AEAD_AES_256_CBC_HMAC_SHA_512-Deterministic'
            }
          }
        }
      }
    }
  }
});
```

---

## Redis

### Authentication

```python
# VULNERABLE: No authentication
r = redis.Redis(host='localhost', port=6379)

# SECURE: With authentication and TLS
r = redis.Redis(
    host='redis.example.com',
    port=6379,
    password=os.environ.get('REDIS_PASSWORD'),
    ssl=True,
    ssl_cert_reqs='required',
    ssl_ca_certs='/path/to/ca.pem'
)
```

### Command Restriction

```
# In redis.conf - Disable dangerous commands
rename-command FLUSHDB ""
rename-command FLUSHALL ""
rename-command CONFIG ""
rename-command DEBUG ""
rename-command SHUTDOWN ""
rename-command KEYS ""  # Use SCAN instead
```

### Data Expiration

```python
# SECURE: Always set TTL for session/cache data
r.setex('session:user123', 3600, session_data)  # 1 hour TTL

# For sensitive data, ensure it expires
r.set('temp_token', token)
r.expire('temp_token', 300)  # 5 minutes
```

---

## Elasticsearch

### Authentication & Encryption

```python
# SECURE: With authentication and TLS
from elasticsearch import Elasticsearch

es = Elasticsearch(
    ['https://es.example.com:9200'],
    http_auth=(os.environ['ES_USER'], os.environ['ES_PASSWORD']),
    use_ssl=True,
    verify_certs=True,
    ca_certs='/path/to/ca.pem'
)
```

### Query Injection

```python
# VULNERABLE: User input in query string
query = {
    "query": {
        "query_string": {
            "query": user_input  # Can manipulate query
        }
    }
}

# SECURE: Use term queries or sanitize
query = {
    "query": {
        "term": {
            "email": user_input  # Exact match, no parsing
        }
    }
}
```

---

## Common Database Security Issues

### Backup Security

```bash
# VULNERABLE: Unencrypted backups
pg_dump mydb > backup.sql

# SECURE: Encrypted backups
pg_dump mydb | gpg --encrypt --recipient backup@company.com > backup.sql.gpg

# SECURE: Use built-in encryption (varies by database)
```

### Audit Logging

```sql
-- PostgreSQL: Enable logging
ALTER SYSTEM SET log_statement = 'all';
ALTER SYSTEM SET log_connections = on;
ALTER SYSTEM SET log_disconnections = on;

-- MySQL: Enable audit log
INSTALL PLUGIN audit_log SONAME 'audit_log.so';
SET GLOBAL audit_log_policy = ALL;
```

### Network Security

```yaml
# Docker Compose - Isolate database
services:
  db:
    image: postgres:15
    networks:
      - backend  # Only accessible from backend network
    ports: []  # Don't expose ports publicly

  app:
    image: myapp
    networks:
      - backend
      - frontend

networks:
  backend:
    internal: true  # No external access
  frontend:
```

---

## Detection Checklist

| Issue | What to Look For |
|-------|------------------|
| SQL Injection | String concat/interpolation in queries |
| NoSQL Injection | User objects in MongoDB queries |
| Hardcoded Credentials | Connection strings in code |
| No Encryption | Cleartext connections (no TLS) |
| Excessive Privileges | ALL PRIVILEGES, admin users for app |
| Missing Auth | Anonymous access enabled |
| Unencrypted Backups | Plain SQL dump files |
| Missing Audit | No query logging enabled |
| Public Exposure | Database ports exposed to internet |
| Sensitive Data Unencrypted | PII/secrets in plain columns |
