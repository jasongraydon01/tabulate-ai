#!/usr/bin/env python3
"""
Authentication Finder

Discovers routes and endpoints in web applications and identifies
those that may be missing authentication/authorization checks.

Usage: python3 auth_finder.py [directory]
Output: JSON to stdout
"""

import json
import os
import re
import sys
from pathlib import Path
from typing import List, Dict, Any, Optional


# Patterns for common framework route definitions
ROUTE_PATTERNS = {
    # Express.js / Node.js
    'express': {
        'route': r"(?:app|router)\.(get|post|put|patch|delete|all)\s*\(\s*['\"]([^'\"]+)['\"]",
        'auth_indicators': ['authenticate', 'requireAuth', 'isAuthenticated', 'verifyToken', 'authMiddleware', 'passport', 'jwt', 'protect'],
    },
    # FastAPI / Flask / Python
    'python_decorators': {
        'route': r"@(?:app|router|blueprint)\.(route|get|post|put|patch|delete)\s*\(\s*['\"]([^'\"]+)['\"]",
        'auth_indicators': ['login_required', 'requires_auth', 'jwt_required', 'token_required', 'authenticate', 'Depends', 'HTTPBearer', 'OAuth2PasswordBearer'],
    },
    # Django
    'django': {
        'route': r"(?:path|url)\s*\(\s*['\"]([^'\"]+)['\"]",
        'auth_indicators': ['login_required', 'permission_required', 'user_passes_test', 'LoginRequiredMixin', 'PermissionRequiredMixin', '@login_required'],
    },
    # Rails
    'rails': {
        'route': r"(?:get|post|put|patch|delete|resources?|match)\s+['\"]([^'\"]+)['\"]",
        'auth_indicators': ['authenticate_user', 'before_action.*authenticate', 'authorize', 'current_user', 'devise'],
    },
    # Spring Boot
    'spring': {
        'route': r"@(?:Get|Post|Put|Patch|Delete|Request)Mapping\s*\(\s*(?:value\s*=\s*)?['\"]([^'\"]+)['\"]",
        'auth_indicators': ['@PreAuthorize', '@Secured', '@RolesAllowed', 'SecurityConfig', 'authenticated', 'hasRole', 'hasAuthority'],
    },
    # ASP.NET
    'aspnet': {
        'route': r'\[(?:Http(?:Get|Post|Put|Patch|Delete)|Route)\s*\(\s*["\']([^"\']+)["\']\s*\)',
        'auth_indicators': ['[Authorize]', '[AllowAnonymous]', 'RequireAuthorization', 'AuthorizeAttribute'],
    },
    # Go (Gin, Echo, etc.)
    'go': {
        'route': r'(?:GET|POST|PUT|PATCH|DELETE|Handle|HandleFunc)\s*\(\s*["\']([^"\']+)["\']',
        'auth_indicators': ['AuthMiddleware', 'JWTMiddleware', 'RequireAuth', 'Authenticate', 'AuthRequired'],
    },
}

# Patterns that suggest sensitive endpoints
SENSITIVE_PATTERNS = [
    r'/admin',
    r'/api/admin',
    r'/user',
    r'/users',
    r'/account',
    r'/profile',
    r'/settings',
    r'/dashboard',
    r'/delete',
    r'/edit',
    r'/update',
    r'/create',
    r'/modify',
    r'/payment',
    r'/billing',
    r'/order',
    r'/checkout',
    r'/cart',
    r'/reset',
    r'/password',
    r'/token',
    r'/session',
    r'/upload',
    r'/download',
    r'/export',
    r'/import',
    r'/private',
    r'/internal',
    r'/config',
    r'/webhook',
]

# Patterns that typically don't need auth
PUBLIC_PATTERNS = [
    r'^/health',
    r'^/healthz',
    r'^/ready',
    r'^/readyz',
    r'^/live',
    r'^/livez',
    r'^/ping',
    r'^/status',
    r'^/version',
    r'^/public',
    r'^/static',
    r'^/assets',
    r'^/favicon',
    r'^/robots',
    r'^/sitemap',
    r'^/login$',
    r'^/register$',
    r'^/signup$',
    r'^/signin$',
    r'^/auth/callback',
    r'^/oauth',
    r'^/\.well-known',
]

# Directories to skip
SKIP_DIRS = {
    'node_modules', 'venv', '.venv', 'vendor', 'target',
    'build', 'dist', '.git', '__pycache__', 'test', 'tests',
    'spec', 'coverage', '.next', '.nuxt',
}


def find_files(root_dir: str, extensions: List[str]) -> List[Path]:
    """Find files with given extensions, excluding skip directories."""
    root_path = Path(root_dir)
    files = []

    for ext in extensions:
        for filepath in root_path.rglob(f'*{ext}'):
            if not any(part in SKIP_DIRS for part in filepath.parts):
                files.append(filepath)

    return files


def read_file_safe(filepath: Path, max_size: int = 512 * 1024) -> Optional[str]:
    """Safely read a file with size limit."""
    try:
        if filepath.stat().st_size > max_size:
            return None
        with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
            return f.read()
    except (IOError, OSError):
        return None


def get_context_lines(content: str, line_num: int, context: int = 5) -> str:
    """Get lines before the target line for context checking."""
    lines = content.split('\n')
    start = max(0, line_num - context - 1)
    end = line_num
    return '\n'.join(lines[start:end])


def is_sensitive_endpoint(path: str) -> bool:
    """Check if an endpoint path suggests sensitive functionality."""
    path_lower = path.lower()
    for pattern in SENSITIVE_PATTERNS:
        if re.search(pattern, path_lower):
            return True
    return False


def is_public_endpoint(path: str) -> bool:
    """Check if an endpoint is typically public."""
    path_lower = path.lower()
    for pattern in PUBLIC_PATTERNS:
        if re.search(pattern, path_lower):
            return True
    return False


def has_auth_indicator(context: str, auth_indicators: List[str]) -> bool:
    """Check if context contains authentication indicators."""
    context_lower = context.lower()
    for indicator in auth_indicators:
        if indicator.lower() in context_lower:
            return True
    return False


def analyze_file(filepath: Path, framework: str, config: Dict) -> List[Dict[str, Any]]:
    """Analyze a single file for routes and authentication."""
    content = read_file_safe(filepath)
    if not content:
        return []

    findings = []
    route_pattern = config['route']
    auth_indicators = config['auth_indicators']

    for match in re.finditer(route_pattern, content, re.MULTILINE | re.IGNORECASE):
        # Get route path
        groups = match.groups()
        if len(groups) >= 2:
            method = groups[0].upper() if groups[0] else 'ALL'
            path = groups[1]
        else:
            method = 'GET'
            path = groups[0]

        # Find line number
        line_num = content[:match.start()].count('\n') + 1

        # Get context (lines before the route definition)
        context = get_context_lines(content, line_num, context=10)

        # Check for auth indicators
        has_auth = has_auth_indicator(context, auth_indicators)

        # Determine if this is concerning
        is_sensitive = is_sensitive_endpoint(path)
        is_public = is_public_endpoint(path)

        # Skip public endpoints
        if is_public:
            continue

        # Flag endpoints missing auth
        if not has_auth and is_sensitive:
            findings.append({
                "file": str(filepath),
                "line": line_num,
                "method": method,
                "path": path,
                "has_auth": False,
                "is_sensitive": True,
                "severity": "HIGH",
                "message": f"Sensitive endpoint may be missing authentication: {method} {path}"
            })
        elif not has_auth:
            findings.append({
                "file": str(filepath),
                "line": line_num,
                "method": method,
                "path": path,
                "has_auth": False,
                "is_sensitive": False,
                "severity": "MEDIUM",
                "message": f"Endpoint may be missing authentication: {method} {path}"
            })

    return findings


def detect_framework(root_dir: str) -> List[str]:
    """Detect which frameworks are in use."""
    frameworks = []
    root_path = Path(root_dir)

    # Check package.json for Node frameworks
    pkg_json = root_path / 'package.json'
    if pkg_json.exists():
        content = read_file_safe(pkg_json)
        if content and 'express' in content.lower():
            frameworks.append('express')

    # Check for Python frameworks
    req_files = list(root_path.rglob('requirements.txt'))
    pyproject = root_path / 'pyproject.toml'
    if req_files or pyproject.exists():
        for f in req_files + ([pyproject] if pyproject.exists() else []):
            content = read_file_safe(f)
            if content:
                if 'django' in content.lower():
                    frameworks.append('django')
                if 'flask' in content.lower() or 'fastapi' in content.lower():
                    frameworks.append('python_decorators')

    # Check for Rails
    if (root_path / 'Gemfile').exists():
        content = read_file_safe(root_path / 'Gemfile')
        if content and 'rails' in content.lower():
            frameworks.append('rails')

    # Check for Spring
    if list(root_path.rglob('*.java')) and list(root_path.rglob('pom.xml')):
        frameworks.append('spring')

    # Check for ASP.NET
    if list(root_path.rglob('*.cs')) and list(root_path.rglob('*.csproj')):
        frameworks.append('aspnet')

    # Check for Go
    if (root_path / 'go.mod').exists():
        frameworks.append('go')

    # If nothing detected, try all patterns
    if not frameworks:
        frameworks = list(ROUTE_PATTERNS.keys())

    return frameworks


def scan_directory(root_dir: str) -> Dict[str, Any]:
    """Scan directory for endpoints and authentication issues."""
    frameworks = detect_framework(root_dir)
    all_findings = []
    files_scanned = 0

    # Map frameworks to file extensions
    extension_map = {
        'express': ['.js', '.ts', '.mjs'],
        'python_decorators': ['.py'],
        'django': ['.py'],
        'rails': ['.rb'],
        'spring': ['.java', '.kt'],
        'aspnet': ['.cs'],
        'go': ['.go'],
    }

    for framework in frameworks:
        if framework not in ROUTE_PATTERNS:
            continue

        config = ROUTE_PATTERNS[framework]
        extensions = extension_map.get(framework, [])

        files = find_files(root_dir, extensions)
        for filepath in files:
            files_scanned += 1
            findings = analyze_file(filepath, framework, config)
            all_findings.extend(findings)

    # Deduplicate and sort by severity
    seen = set()
    unique_findings = []
    for finding in all_findings:
        key = (finding['file'], finding['line'], finding['path'])
        if key not in seen:
            seen.add(key)
            unique_findings.append(finding)

    severity_order = {'HIGH': 0, 'MEDIUM': 1, 'LOW': 2}
    unique_findings.sort(key=lambda x: severity_order.get(x['severity'], 3))

    return {
        "findings": unique_findings,
        "summary": {
            "total_endpoints_flagged": len(unique_findings),
            "high_severity": len([f for f in unique_findings if f['severity'] == 'HIGH']),
            "medium_severity": len([f for f in unique_findings if f['severity'] == 'MEDIUM']),
            "files_scanned": files_scanned,
            "frameworks_detected": frameworks
        }
    }


def main():
    """Main function to run auth finder."""
    root_dir = sys.argv[1] if len(sys.argv) > 1 else '.'
    root_dir = os.path.abspath(root_dir)

    if not os.path.isdir(root_dir):
        print(json.dumps({"error": f"Directory not found: {root_dir}"}))
        sys.exit(1)

    result = scan_directory(root_dir)
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
