#!/usr/bin/env python3
"""
Context Generator

Creates a structured summary of a codebase including directory tree,
key files, dependencies, and external integrations. Helps Claude
understand the codebase structure for security auditing.

Usage: python3 generate_context.py [directory]
Output: JSON to stdout
"""

import json
import os
import re
import sys
from pathlib import Path
from typing import List, Dict, Any, Optional, Set
from collections import defaultdict


# Directories to skip in tree generation
SKIP_DIRS = {
    'node_modules', 'venv', '.venv', 'vendor', 'target',
    'build', 'dist', '.git', '__pycache__', '.pytest_cache',
    'coverage', '.next', '.nuxt', 'bower_components',
    '.idea', '.vscode', 'tmp', 'temp', 'logs',
}

# Important file patterns
IMPORTANT_FILES = {
    'config': [
        'package.json', 'pyproject.toml', 'requirements.txt',
        'Gemfile', 'go.mod', 'Cargo.toml', 'pom.xml',
        'build.gradle', 'composer.json', 'pubspec.yaml',
        'tsconfig.json', 'webpack.config.js', 'vite.config.js',
        'next.config.js', 'nuxt.config.js', 'angular.json',
        'settings.py', 'config.py', 'application.yml',
        'appsettings.json', 'web.config',
    ],
    'security': [
        '.env', '.env.example', '.env.local', '.env.production',
        'auth.js', 'auth.ts', 'authentication.py', 'auth.py',
        'middleware.js', 'middleware.ts',
        'security.py', 'security.js', 'security.ts',
        'permissions.py', 'permissions.js',
        'csrf.py', 'cors.py',
    ],
    'entry_points': [
        'index.js', 'index.ts', 'main.js', 'main.ts',
        'app.js', 'app.ts', 'app.py', 'main.py',
        'server.js', 'server.ts', 'server.py',
        'main.go', 'Application.java', 'Program.cs',
        'lib/main.dart', 'App.js', 'App.tsx',
    ],
    'routes': [
        'routes.js', 'routes.ts', 'routes.py', 'routes.rb',
        'urls.py', 'router.js', 'router.ts',
        'api.js', 'api.ts', 'api.py',
        'controllers/', 'handlers/',
    ],
    'database': [
        'models.py', 'models.js', 'models.ts',
        'schema.prisma', 'schema.sql', 'migrations/',
        'db.js', 'db.ts', 'database.py',
        'entities/', 'repositories/',
    ],
    'deployment': [
        'Dockerfile', 'docker-compose.yml', 'docker-compose.yaml',
        'kubernetes/', 'k8s/', 'helm/',
        '.github/workflows/', '.gitlab-ci.yml',
        'serverless.yml', 'template.yaml',
        'terraform/', '*.tf',
        'vercel.json', 'netlify.toml',
    ],
}


def read_file_safe(filepath: Path, max_size: int = 100 * 1024) -> Optional[str]:
    """Safely read a file with size limit."""
    try:
        if filepath.stat().st_size > max_size:
            return None
        with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
            return f.read()
    except (IOError, OSError):
        return None


def generate_tree(root_dir: str, max_depth: int = 4) -> List[str]:
    """Generate a directory tree representation."""
    tree_lines = []
    root_path = Path(root_dir)

    def walk_dir(path: Path, prefix: str = '', depth: int = 0):
        if depth > max_depth:
            return

        try:
            entries = sorted(path.iterdir(), key=lambda e: (not e.is_dir(), e.name.lower()))
        except PermissionError:
            return

        # Filter entries
        entries = [e for e in entries if e.name not in SKIP_DIRS and not e.name.startswith('.')]

        for i, entry in enumerate(entries[:30]):  # Limit entries per directory
            is_last = i == len(entries[:30]) - 1
            connector = '└── ' if is_last else '├── '

            if entry.is_dir():
                tree_lines.append(f"{prefix}{connector}{entry.name}/")
                next_prefix = prefix + ('    ' if is_last else '│   ')
                walk_dir(entry, next_prefix, depth + 1)
            else:
                tree_lines.append(f"{prefix}{connector}{entry.name}")

    tree_lines.append(f"{root_path.name}/")
    walk_dir(root_path)

    return tree_lines[:200]  # Limit total lines


def find_important_files(root_dir: str) -> Dict[str, List[str]]:
    """Find important files by category."""
    root_path = Path(root_dir)
    found_files = defaultdict(list)

    for category, patterns in IMPORTANT_FILES.items():
        for pattern in patterns:
            if pattern.endswith('/'):
                # Directory pattern
                for dirpath in root_path.rglob(pattern.rstrip('/')):
                    if dirpath.is_dir() and not any(part in SKIP_DIRS for part in dirpath.parts):
                        found_files[category].append(str(dirpath.relative_to(root_path)))
            elif '*' in pattern:
                # Glob pattern
                for filepath in root_path.rglob(pattern):
                    if filepath.is_file() and not any(part in SKIP_DIRS for part in filepath.parts):
                        found_files[category].append(str(filepath.relative_to(root_path)))
            else:
                # Exact filename
                for filepath in root_path.rglob(pattern):
                    if filepath.is_file() and not any(part in SKIP_DIRS for part in filepath.parts):
                        found_files[category].append(str(filepath.relative_to(root_path)))

    # Limit results per category
    for category in found_files:
        found_files[category] = found_files[category][:10]

    return dict(found_files)


def extract_dependencies(root_dir: str) -> Dict[str, List[str]]:
    """Extract dependencies from package files."""
    root_path = Path(root_dir)
    dependencies = {}

    # package.json
    pkg_json = root_path / 'package.json'
    if pkg_json.exists():
        content = read_file_safe(pkg_json)
        if content:
            try:
                pkg = json.loads(content)
                deps = list(pkg.get('dependencies', {}).keys())[:30]
                dev_deps = list(pkg.get('devDependencies', {}).keys())[:20]
                dependencies['npm'] = {
                    'production': deps,
                    'development': dev_deps,
                }
            except json.JSONDecodeError:
                pass

    # requirements.txt
    req_txt = root_path / 'requirements.txt'
    if req_txt.exists():
        content = read_file_safe(req_txt)
        if content:
            deps = []
            for line in content.split('\n'):
                line = line.strip()
                if line and not line.startswith('#') and not line.startswith('-'):
                    # Extract package name (before ==, >=, etc.)
                    pkg = re.split(r'[=<>~!]', line)[0].strip()
                    if pkg:
                        deps.append(pkg)
            dependencies['pip'] = deps[:30]

    # pyproject.toml
    pyproject = root_path / 'pyproject.toml'
    if pyproject.exists() and 'pip' not in dependencies:
        content = read_file_safe(pyproject)
        if content:
            # Simple extraction (not full TOML parsing)
            deps = re.findall(r'^\s*"?([a-zA-Z0-9_-]+)"?\s*[=<>]', content, re.MULTILINE)
            if deps:
                dependencies['pip'] = deps[:30]

    # Gemfile
    gemfile = root_path / 'Gemfile'
    if gemfile.exists():
        content = read_file_safe(gemfile)
        if content:
            deps = re.findall(r"gem\s+['\"]([^'\"]+)['\"]", content)
            dependencies['bundler'] = deps[:30]

    # go.mod
    go_mod = root_path / 'go.mod'
    if go_mod.exists():
        content = read_file_safe(go_mod)
        if content:
            deps = re.findall(r'^\s*([a-zA-Z0-9._/-]+)\s+v', content, re.MULTILINE)
            dependencies['go'] = deps[:30]

    return dependencies


def detect_external_services(root_dir: str) -> List[Dict[str, str]]:
    """Detect external service integrations."""
    root_path = Path(root_dir)
    services = []

    service_patterns = {
        'AWS': [r'aws-sdk', r'boto3', r'AWS_', r'amazon', r's3://', r'dynamodb'],
        'Google Cloud': [r'@google-cloud', r'google-cloud-', r'GOOGLE_', r'firebase'],
        'Azure': [r'azure', r'@azure/', r'AZURE_'],
        'Stripe': [r'stripe', r'STRIPE_'],
        'Twilio': [r'twilio', r'TWILIO_'],
        'SendGrid': [r'sendgrid', r'SENDGRID_'],
        'Auth0': [r'auth0', r'AUTH0_'],
        'Okta': [r'okta', r'OKTA_'],
        'Sentry': [r'sentry', r'@sentry/', r'SENTRY_'],
        'DataDog': [r'datadog', r'DD_'],
        'Redis': [r'redis', r'REDIS_'],
        'Elasticsearch': [r'elasticsearch', r'ELASTIC_'],
        'MongoDB Atlas': [r'mongodb\+srv', r'MONGODB_'],
        'PostgreSQL': [r'postgresql', r'postgres', r'POSTGRES_', r'PG_'],
        'MySQL': [r'mysql', r'MYSQL_'],
        'OpenAI': [r'openai', r'OPENAI_'],
        'Anthropic': [r'anthropic', r'ANTHROPIC_'],
    }

    # Search in common files
    search_files = ['.env.example', '.env', 'docker-compose.yml', 'package.json', 'requirements.txt']
    all_content = ""

    for filename in search_files:
        for filepath in root_path.rglob(filename):
            if not any(part in SKIP_DIRS for part in filepath.parts):
                content = read_file_safe(filepath)
                if content:
                    all_content += content + "\n"

    # Also search some source files
    for ext in ['*.js', '*.ts', '*.py']:
        for filepath in list(root_path.rglob(ext))[:20]:
            if not any(part in SKIP_DIRS for part in filepath.parts):
                content = read_file_safe(filepath)
                if content:
                    all_content += content + "\n"

    for service, patterns in service_patterns.items():
        for pattern in patterns:
            if re.search(pattern, all_content, re.IGNORECASE):
                services.append({
                    'name': service,
                    'type': 'external_service',
                })
                break

    return services


def get_file_statistics(root_dir: str) -> Dict[str, int]:
    """Get statistics about files in the project."""
    root_path = Path(root_dir)
    stats = defaultdict(int)

    extension_map = {
        '.js': 'javascript',
        '.jsx': 'javascript',
        '.ts': 'typescript',
        '.tsx': 'typescript',
        '.py': 'python',
        '.rb': 'ruby',
        '.go': 'go',
        '.java': 'java',
        '.kt': 'kotlin',
        '.cs': 'csharp',
        '.swift': 'swift',
        '.dart': 'dart',
        '.php': 'php',
        '.rs': 'rust',
    }

    for filepath in root_path.rglob('*'):
        if filepath.is_file() and not any(part in SKIP_DIRS for part in filepath.parts):
            ext = filepath.suffix.lower()
            if ext in extension_map:
                stats[extension_map[ext]] += 1

    return dict(stats)


def detect_security_relevant_features(root_dir: str) -> Dict[str, bool]:
    """Detect security-relevant features in the codebase."""
    root_path = Path(root_dir)
    features = {
        'has_authentication': False,
        'has_authorization': False,
        'has_csrf_protection': False,
        'has_rate_limiting': False,
        'has_input_validation': False,
        'has_logging': False,
        'has_testing': False,
        'has_ci_cd': False,
        'has_docker': False,
        'has_env_file': False,
    }

    # Check for common patterns
    search_patterns = {
        'has_authentication': [r'passport', r'auth', r'login', r'jwt', r'session', r'bcrypt', r'OAuth'],
        'has_authorization': [r'permission', r'role', r'authorize', r'isAdmin', r'canAccess'],
        'has_csrf_protection': [r'csrf', r'xsrf', r'csrfToken'],
        'has_rate_limiting': [r'rateLimit', r'throttle', r'rate-limit'],
        'has_input_validation': [r'validator', r'validate', r'sanitize', r'zod', r'yup', r'joi'],
        'has_logging': [r'winston', r'pino', r'bunyan', r'logging', r'logger', r'sentry'],
    }

    # Search in source files
    all_content = ""
    for ext in ['*.js', '*.ts', '*.py', '*.rb', '*.go']:
        for filepath in list(root_path.rglob(ext))[:50]:
            if not any(part in SKIP_DIRS for part in filepath.parts):
                content = read_file_safe(filepath, max_size=50*1024)
                if content:
                    all_content += content + "\n"

    for feature, patterns in search_patterns.items():
        for pattern in patterns:
            if re.search(pattern, all_content, re.IGNORECASE):
                features[feature] = True
                break

    # Check for specific files/directories
    features['has_testing'] = bool(
        list(root_path.rglob('test*.py')) or
        list(root_path.rglob('*.test.js')) or
        list(root_path.rglob('*.spec.ts')) or
        (root_path / 'tests').exists() or
        (root_path / '__tests__').exists() or
        (root_path / 'spec').exists()
    )

    features['has_ci_cd'] = bool(
        (root_path / '.github' / 'workflows').exists() or
        (root_path / '.gitlab-ci.yml').exists() or
        (root_path / '.circleci').exists() or
        (root_path / 'Jenkinsfile').exists()
    )

    features['has_docker'] = bool(
        (root_path / 'Dockerfile').exists() or
        list(root_path.rglob('docker-compose*.yml'))
    )

    features['has_env_file'] = bool(
        list(root_path.glob('.env*'))
    )

    return features


def main():
    """Main function to generate codebase context."""
    root_dir = sys.argv[1] if len(sys.argv) > 1 else '.'
    root_dir = os.path.abspath(root_dir)

    if not os.path.isdir(root_dir):
        print(json.dumps({"error": f"Directory not found: {root_dir}"}))
        sys.exit(1)

    result = {
        "root": os.path.basename(root_dir),
        "tree": generate_tree(root_dir),
        "important_files": find_important_files(root_dir),
        "dependencies": extract_dependencies(root_dir),
        "external_services": detect_external_services(root_dir),
        "file_statistics": get_file_statistics(root_dir),
        "security_features": detect_security_relevant_features(root_dir),
    }

    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
