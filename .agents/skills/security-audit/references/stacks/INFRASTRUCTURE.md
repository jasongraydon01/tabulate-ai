# Infrastructure Security

Security patterns for Docker, Kubernetes, and Infrastructure as Code.

---

## Docker

### Image Security

```dockerfile
# VULNERABLE: Running as root
FROM node:18
COPY . /app
CMD ["node", "server.js"]  # Runs as root!

# SECURE: Non-root user
FROM node:18-slim

# Create non-root user
RUN groupadd -r appgroup && useradd -r -g appgroup appuser

WORKDIR /app
COPY --chown=appuser:appgroup . .

# Drop privileges
USER appuser

CMD ["node", "server.js"]
```

### Base Image Security

```dockerfile
# VULNERABLE: Using latest tag
FROM node:latest

# VULNERABLE: Using full image with unnecessary packages
FROM ubuntu:22.04

# SECURE: Pinned version, minimal base
FROM node:18.19.0-alpine3.18

# SECURE: Distroless for production
FROM gcr.io/distroless/nodejs18-debian11
```

### Secret Management

```dockerfile
# VULNERABLE: Secrets in Dockerfile
ENV DATABASE_PASSWORD=MySecretPassword123
COPY .env /app/.env

# VULNERABLE: Secret in build arg
ARG API_KEY
ENV API_KEY=$API_KEY

# SECURE: Use Docker secrets (Swarm) or mount at runtime
# docker run -v /secrets/db_password:/run/secrets/db_password myapp

# SECURE: Multi-stage build to exclude secrets
FROM node:18-alpine AS builder
COPY . .
RUN npm ci && npm run build

FROM node:18-alpine
COPY --from=builder /app/dist /app
# Source code with potential secrets not in final image
```

### Docker Compose Security

```yaml
# docker-compose.yml
version: '3.8'

services:
  app:
    image: myapp:1.0.0
    read_only: true  # Read-only filesystem
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL  # Drop all capabilities
    cap_add:
      - NET_BIND_SERVICE  # Add only what's needed
    tmpfs:
      - /tmp  # Writable tmp in memory
    secrets:
      - db_password

  db:
    image: postgres:15-alpine
    environment:
      POSTGRES_PASSWORD_FILE: /run/secrets/db_password
    networks:
      - backend
    # Don't expose ports publicly
    # ports:
    #   - "5432:5432"  # NEVER in production

secrets:
  db_password:
    external: true

networks:
  backend:
    internal: true  # No external access
```

---

## Kubernetes

### Pod Security

```yaml
# VULNERABLE: No security context
apiVersion: v1
kind: Pod
spec:
  containers:
    - name: app
      image: myapp

# SECURE: Restricted security context
apiVersion: v1
kind: Pod
spec:
  securityContext:
    runAsNonRoot: true
    runAsUser: 1000
    runAsGroup: 1000
    fsGroup: 1000
    seccompProfile:
      type: RuntimeDefault
  containers:
    - name: app
      image: myapp:1.0.0
      securityContext:
        allowPrivilegeEscalation: false
        readOnlyRootFilesystem: true
        capabilities:
          drop:
            - ALL
      resources:
        limits:
          cpu: "500m"
          memory: "256Mi"
        requests:
          cpu: "100m"
          memory: "128Mi"
```

### Secret Management

```yaml
# VULNERABLE: Plain secrets in manifests
apiVersion: v1
kind: Secret
metadata:
  name: db-credentials
type: Opaque
stringData:
  password: MySecretPassword123  # Visible in git!

# SECURE: Use external secrets management
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: db-credentials
spec:
  refreshInterval: 1h
  secretStoreRef:
    name: vault-backend
    kind: SecretStore
  target:
    name: db-credentials
  data:
    - secretKey: password
      remoteRef:
        key: prod/db/password
```

### Network Policies

```yaml
# SECURE: Deny all by default, allow specific traffic
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-all
  namespace: production
spec:
  podSelector: {}
  policyTypes:
    - Ingress
    - Egress

---
# Allow app to reach database only
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: app-to-db
  namespace: production
spec:
  podSelector:
    matchLabels:
      app: myapp
  policyTypes:
    - Egress
  egress:
    - to:
        - podSelector:
            matchLabels:
              app: postgres
      ports:
        - port: 5432
```

### RBAC

```yaml
# SECURE: Minimal permissions
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: app-role
  namespace: production
rules:
  - apiGroups: [""]
    resources: ["configmaps"]
    resourceNames: ["app-config"]  # Specific resource
    verbs: ["get"]  # Read only

---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: app-role-binding
  namespace: production
subjects:
  - kind: ServiceAccount
    name: app-sa
    namespace: production
roleRef:
  kind: Role
  name: app-role
  apiGroup: rbac.authorization.k8s.io
```

---

## Terraform / Infrastructure as Code

### Secrets in State

```hcl
# VULNERABLE: Secrets in plain state
resource "aws_db_instance" "main" {
  password = "MySecretPassword123"  # Stored in state file!
}

# SECURE: Use secrets manager
data "aws_secretsmanager_secret_version" "db_password" {
  secret_id = "prod/db/password"
}

resource "aws_db_instance" "main" {
  password = data.aws_secretsmanager_secret_version.db_password.secret_string
}

# SECURE: Use encrypted state backend
terraform {
  backend "s3" {
    bucket         = "terraform-state"
    key            = "prod/terraform.tfstate"
    region         = "us-east-1"
    encrypt        = true
    kms_key_id     = "alias/terraform-state"
    dynamodb_table = "terraform-locks"
  }
}
```

### S3 Bucket Security

```hcl
# VULNERABLE: Public bucket
resource "aws_s3_bucket" "data" {
  bucket = "my-data-bucket"
}

resource "aws_s3_bucket_acl" "data" {
  bucket = aws_s3_bucket.data.id
  acl    = "public-read"  # Never do this!
}

# SECURE: Private bucket with encryption
resource "aws_s3_bucket" "data" {
  bucket = "my-data-bucket"
}

resource "aws_s3_bucket_public_access_block" "data" {
  bucket = aws_s3_bucket.data.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "data" {
  bucket = aws_s3_bucket.data.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.s3.arn
    }
  }
}

resource "aws_s3_bucket_versioning" "data" {
  bucket = aws_s3_bucket.data.id
  versioning_configuration {
    status = "Enabled"
  }
}
```

### IAM Security

```hcl
# VULNERABLE: Overly permissive policy
resource "aws_iam_policy" "app" {
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = "*"  # Never use wildcard!
      Resource = "*"
    }]
  })
}

# SECURE: Least privilege
resource "aws_iam_policy" "app" {
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject"
        ]
        Resource = "${aws_s3_bucket.data.arn}/*"
      },
      {
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:Query"
        ]
        Resource = aws_dynamodb_table.main.arn
      }
    ]
  })
}
```

---

## CI/CD Security

### GitHub Actions

```yaml
# SECURE: Pin actions to SHA
- uses: actions/checkout@8ade135a41bc03ea155e62e844d188df1ea18608  # v4.1.0

# SECURE: Use OIDC for cloud auth (no long-lived secrets)
permissions:
  id-token: write
  contents: read

- uses: aws-actions/configure-aws-credentials@v4
  with:
    role-to-assume: arn:aws:iam::123456789:role/github-actions
    aws-region: us-east-1

# SECURE: Minimal permissions
permissions:
  contents: read
  packages: write  # Only if needed

# Secrets from GitHub Secrets, not hardcoded
env:
  API_KEY: ${{ secrets.API_KEY }}
```

### Secret Scanning

```yaml
# .github/workflows/security.yml
name: Security Scan

on: [push, pull_request]

jobs:
  secrets:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: TruffleHog Secret Scan
        uses: trufflesecurity/trufflehog@main
        with:
          path: ./
          extra_args: --only-verified
```

---

## Detection Checklist

| Issue | What to Look For |
|-------|------------------|
| Root Containers | Missing USER directive, runAsNonRoot:false |
| Latest Tags | FROM image:latest |
| Secrets in Code | Passwords in Dockerfiles, .env files committed |
| Public Buckets | S3 ACL public-read, missing block_public_access |
| Overprivileged IAM | Action: "*", Resource: "*" |
| Unencrypted State | Terraform state without encryption |
| No Network Policies | Missing K8s NetworkPolicy |
| Privileged Pods | privileged: true, capabilities not dropped |
| Exposed Ports | Database ports exposed publicly |
| Missing Resource Limits | No CPU/memory limits on containers |
