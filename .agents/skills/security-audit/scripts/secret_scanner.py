#!/usr/bin/env python3
"""
Secret Scanner

Scans codebase for hardcoded secrets, API keys, tokens, and credentials.
Outputs JSON with findings including file, line, pattern type, and redacted match.

Usage: python3 secret_scanner.py [directory]
Output: JSON to stdout
"""

import json
import os
import re
import sys
from pathlib import Path
from typing import List, Dict, Any


# Patterns for detecting secrets
SECRET_PATTERNS = {
    "aws_access_key": {
        "pattern": r"(?:A3T[A-Z0-9]|AKIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA)[A-Z0-9]{16}",
        "description": "AWS Access Key ID"
    },
    "aws_secret_key": {
        "pattern": r"(?i)aws[_\-]?secret[_\-]?(?:access)?[_\-]?key['\"]?\s*[:=]\s*['\"]?([A-Za-z0-9/+=]{40})",
        "description": "AWS Secret Access Key"
    },
    "github_token": {
        "pattern": r"(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{36,}",
        "description": "GitHub Token"
    },
    "github_oauth": {
        "pattern": r"(?i)github[_\-]?(?:oauth|token|key)['\"]?\s*[:=]\s*['\"]?([a-f0-9]{40})",
        "description": "GitHub OAuth Token"
    },
    "google_api_key": {
        "pattern": r"AIza[0-9A-Za-z\-_]{35}",
        "description": "Google API Key"
    },
    "google_oauth": {
        "pattern": r"[0-9]+-[0-9A-Za-z_]{32}\.apps\.googleusercontent\.com",
        "description": "Google OAuth Client ID"
    },
    "slack_token": {
        "pattern": r"xox[baprs]-[0-9]{10,13}-[0-9]{10,13}[a-zA-Z0-9-]*",
        "description": "Slack Token"
    },
    "slack_webhook": {
        "pattern": r"https://hooks\.slack\.com/services/T[a-zA-Z0-9_]+/B[a-zA-Z0-9_]+/[a-zA-Z0-9_]+",
        "description": "Slack Webhook URL"
    },
    "stripe_key": {
        "pattern": r"(?:sk|pk)_(?:live|test)_[0-9a-zA-Z]{24,}",
        "description": "Stripe API Key"
    },
    "twilio_key": {
        "pattern": r"SK[0-9a-fA-F]{32}",
        "description": "Twilio API Key"
    },
    "sendgrid_key": {
        "pattern": r"SG\.[a-zA-Z0-9_-]{22}\.[a-zA-Z0-9_-]{43}",
        "description": "SendGrid API Key"
    },
    "mailchimp_key": {
        "pattern": r"[0-9a-f]{32}-us[0-9]{1,2}",
        "description": "Mailchimp API Key"
    },
    "jwt_secret": {
        "pattern": r"(?i)(?:jwt|token)[_\-]?secret['\"]?\s*[:=]\s*['\"]?([A-Za-z0-9+/=_\-]{16,})",
        "description": "JWT Secret"
    },
    "private_key": {
        "pattern": r"-----BEGIN (?:RSA |DSA |EC |OPENSSH )?PRIVATE KEY-----",
        "description": "Private Key"
    },
    "ssh_private_key": {
        "pattern": r"-----BEGIN OPENSSH PRIVATE KEY-----",
        "description": "SSH Private Key"
    },
    "pgp_private_key": {
        "pattern": r"-----BEGIN PGP PRIVATE KEY BLOCK-----",
        "description": "PGP Private Key"
    },
    "generic_api_key": {
        "pattern": r"(?i)(?:api[_\-]?key|apikey)['\"]?\s*[:=]\s*['\"]?([A-Za-z0-9_\-]{20,})",
        "description": "Generic API Key"
    },
    "generic_secret": {
        "pattern": r"(?i)(?:secret|password|passwd|pwd)['\"]?\s*[:=]\s*['\"]?([^\s'\"]{8,})",
        "description": "Generic Secret/Password"
    },
    "connection_string": {
        "pattern": r"(?i)(?:mongodb|postgres|mysql|redis|amqp):\/\/[^\s'\"]+:[^\s'\"]+@[^\s'\"]+",
        "description": "Database Connection String"
    },
    "bearer_token": {
        "pattern": r"(?i)bearer\s+[a-zA-Z0-9_\-\.=]{20,}",
        "description": "Bearer Token"
    },
    "basic_auth": {
        "pattern": r"(?i)basic\s+[A-Za-z0-9+/=]{20,}",
        "description": "Basic Auth Credentials"
    },
    "azure_key": {
        "pattern": r"(?i)(?:azure|subscription)[_\-]?(?:key|secret|password)['\"]?\s*[:=]\s*['\"]?([A-Za-z0-9+/=]{20,})",
        "description": "Azure Key/Secret"
    },
    "heroku_api_key": {
        "pattern": r"(?i)heroku[_\-]?api[_\-]?key['\"]?\s*[:=]\s*['\"]?([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})",
        "description": "Heroku API Key"
    },
    "openai_key": {
        "pattern": r"sk-[A-Za-z0-9]{48}",
        "description": "OpenAI API Key"
    },
    "anthropic_key": {
        "pattern": r"sk-ant-[A-Za-z0-9_\-]{40,}",
        "description": "Anthropic API Key"
    },
    "discord_token": {
        "pattern": r"(?:mfa\.[a-z0-9_-]{20,}|[a-z0-9_-]{23,28}\.[a-z0-9_-]{6}\.[a-z0-9_-]{27})",
        "description": "Discord Token",
        "case_insensitive": True
    },
    "npm_token": {
        "pattern": r"npm_[A-Za-z0-9]{36}",
        "description": "NPM Access Token"
    },
    "firebase_key": {
        "pattern": r"(?i)firebase[_\-]?(?:api)?[_\-]?key['\"]?\s*[:=]\s*['\"]?([A-Za-z0-9_\-]{20,})",
        "description": "Firebase Key"
    },
}

# File extensions to scan
SCANNABLE_EXTENSIONS = {
    '.py', '.js', '.ts', '.jsx', '.tsx', '.java', '.kt', '.go', '.rb',
    '.php', '.cs', '.swift', '.m', '.rs', '.scala', '.dart',
    '.json', '.yaml', '.yml', '.xml', '.toml', '.ini', '.cfg', '.conf',
    '.env', '.sh', '.bash', '.zsh', '.ps1',
    '.tf', '.hcl',
    '.md', '.txt',  # Documentation might contain secrets
}

# Directories to skip
SKIP_DIRS = {
    'node_modules', 'venv', '.venv', 'env', '.env', 'vendor',
    'target', 'build', 'dist', '.git', '__pycache__',
    '.pytest_cache', 'coverage', '.next', '.nuxt',
    'bower_components', 'jspm_packages',
}

# Files to skip
SKIP_FILES = {
    'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
    'Gemfile.lock', 'poetry.lock', 'Pipfile.lock',
    'composer.lock', 'Cargo.lock', 'go.sum',
}

# Patterns that are likely false positives
FALSE_POSITIVE_PATTERNS = [
    r'example',
    r'sample',
    r'test',
    r'dummy',
    r'fake',
    r'placeholder',
    r'xxx+',
    r'your[_\-]?(?:api)?[_\-]?key',
    r'<.*>',  # Template placeholders
    r'\$\{.*\}',  # Variable interpolation
    r'process\.env\.',
    r'os\.environ',
    r'ENV\[',
]


def should_scan_file(filepath: Path) -> bool:
    """Determine if a file should be scanned."""
    # Check if in skip directory
    for part in filepath.parts:
        if part in SKIP_DIRS:
            return False

    # Check filename
    if filepath.name in SKIP_FILES:
        return False

    # Check extension
    if filepath.suffix.lower() in SCANNABLE_EXTENSIONS:
        return True

    # Check for dotfiles that might contain secrets
    if filepath.name.startswith('.env'):
        return True

    # Check for files without extensions that might be config
    if filepath.suffix == '' and filepath.name in {'Dockerfile', 'Makefile', 'Procfile'}:
        return True

    return False


def is_likely_false_positive(match: str, line: str) -> bool:
    """Check if a match is likely a false positive."""
    combined = (match + " " + line).lower()

    for pattern in FALSE_POSITIVE_PATTERNS:
        if re.search(pattern, combined, re.IGNORECASE):
            return True

    # Check for common non-secret patterns
    if match.startswith('http://localhost') or match.startswith('https://localhost'):
        return True

    # Very short matches are often false positives
    if len(match) < 8:
        return True

    return False


def redact_secret(secret: str, visible_chars: int = 4) -> str:
    """Redact a secret, showing only first few characters."""
    if len(secret) <= visible_chars * 2:
        return '*' * len(secret)
    return secret[:visible_chars] + '*' * (len(secret) - visible_chars * 2) + secret[-visible_chars:]


def scan_file(filepath: Path) -> List[Dict[str, Any]]:
    """Scan a single file for secrets."""
    findings = []

    try:
        # Check file size (skip very large files)
        if filepath.stat().st_size > 1024 * 1024:  # 1MB limit
            return []

        with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
            lines = f.readlines()

        for line_num, line in enumerate(lines, 1):
            # Skip comment lines (basic heuristic)
            stripped = line.strip()
            if stripped.startswith('#') or stripped.startswith('//') or stripped.startswith('*'):
                # Still scan for private keys even in comments
                if 'PRIVATE KEY' not in line:
                    continue

            for secret_type, config in SECRET_PATTERNS.items():
                pattern = config['pattern']
                flags = re.IGNORECASE if config.get('case_insensitive') else 0

                matches = re.finditer(pattern, line, flags)
                for match in matches:
                    # Get the actual secret (either group 1 or full match)
                    secret = match.group(1) if match.lastindex and match.lastindex >= 1 else match.group(0)

                    # Skip false positives
                    if is_likely_false_positive(secret, line):
                        continue

                    findings.append({
                        "file": str(filepath),
                        "line": line_num,
                        "type": secret_type,
                        "description": config['description'],
                        "match": redact_secret(secret),
                        "context": line.strip()[:100]  # First 100 chars of line
                    })

    except (IOError, OSError) as e:
        pass  # Skip files we can't read

    return findings


def scan_env_file(filepath: Path) -> List[Dict[str, Any]]:
    """Specifically scan .env files for secrets."""
    findings = []

    try:
        with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
            lines = f.readlines()

        sensitive_keys = [
            'password', 'secret', 'key', 'token', 'credential',
            'api_key', 'apikey', 'auth', 'private',
        ]

        for line_num, line in enumerate(lines, 1):
            stripped = line.strip()
            if not stripped or stripped.startswith('#'):
                continue

            if '=' in stripped:
                key, _, value = stripped.partition('=')
                key_lower = key.lower()
                value = value.strip().strip('"').strip("'")

                # Skip empty values or variable references
                if not value or value.startswith('$') or value.startswith('${'):
                    continue

                # Check if key suggests a secret
                for sensitive in sensitive_keys:
                    if sensitive in key_lower:
                        findings.append({
                            "file": str(filepath),
                            "line": line_num,
                            "type": "env_secret",
                            "description": f"Potential secret in environment variable: {key}",
                            "match": f"{key}={redact_secret(value)}",
                            "context": f"{key}=****"
                        })
                        break

    except (IOError, OSError):
        pass

    return findings


def scan_directory(root_dir: str) -> Dict[str, Any]:
    """Scan a directory for secrets."""
    root_path = Path(root_dir)
    all_findings = []
    files_scanned = 0
    files_skipped = 0

    for filepath in root_path.rglob('*'):
        if not filepath.is_file():
            continue

        if should_scan_file(filepath):
            files_scanned += 1
            findings = scan_file(filepath)
            all_findings.extend(findings)

            # Special handling for .env files
            if filepath.name.startswith('.env'):
                env_findings = scan_env_file(filepath)
                all_findings.extend(env_findings)
        else:
            files_skipped += 1

    # Deduplicate findings
    seen = set()
    unique_findings = []
    for finding in all_findings:
        key = (finding['file'], finding['line'], finding['type'])
        if key not in seen:
            seen.add(key)
            unique_findings.append(finding)

    # Sort by severity (private keys first, then by type)
    severity_order = {
        'private_key': 0,
        'ssh_private_key': 0,
        'pgp_private_key': 0,
        'aws_secret_key': 1,
        'aws_access_key': 2,
        'openai_key': 2,
        'anthropic_key': 2,
        'stripe_key': 2,
        'connection_string': 3,
    }
    unique_findings.sort(key=lambda x: severity_order.get(x['type'], 10))

    return {
        "findings": unique_findings,
        "summary": {
            "total_findings": len(unique_findings),
            "files_scanned": files_scanned,
            "files_skipped": files_skipped,
            "by_type": {}
        }
    }


def main():
    """Main function to run secret scanner."""
    root_dir = sys.argv[1] if len(sys.argv) > 1 else '.'
    root_dir = os.path.abspath(root_dir)

    if not os.path.isdir(root_dir):
        print(json.dumps({"error": f"Directory not found: {root_dir}"}))
        sys.exit(1)

    result = scan_directory(root_dir)

    # Count by type
    for finding in result['findings']:
        ftype = finding['type']
        result['summary']['by_type'][ftype] = result['summary']['by_type'].get(ftype, 0) + 1

    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
