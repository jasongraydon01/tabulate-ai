#!/usr/bin/env python3
"""
Stack Discovery Script

Detects languages, frameworks, architecture patterns, and technologies
used in a codebase. Outputs JSON for use by the security audit skill.

Usage: python3 discover_stack.py [directory]
Output: JSON to stdout
"""

import json
import os
import re
import sys
from pathlib import Path
from collections import defaultdict


def find_files(root_dir, patterns, exclude_dirs=None):
    """Find files matching patterns, excluding specified directories."""
    if exclude_dirs is None:
        exclude_dirs = {
            'node_modules', 'venv', '.venv', 'env', '.env',
            'vendor', 'target', 'build', 'dist', '.git',
            '__pycache__', '.pytest_cache', 'coverage'
        }

    matches = []
    root_path = Path(root_dir)

    for pattern in patterns:
        for path in root_path.rglob(pattern):
            # Check if any parent is in exclude list
            if not any(part in exclude_dirs for part in path.parts):
                matches.append(path)

    return matches


def read_file_safe(filepath, max_size=1024*1024):
    """Safely read a file with size limit."""
    try:
        if os.path.getsize(filepath) > max_size:
            return None
        with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
            return f.read()
    except (IOError, OSError):
        return None


def detect_languages(root_dir):
    """Detect programming languages by file extensions and content."""
    languages = set()
    extension_map = {
        '.js': 'javascript',
        '.jsx': 'javascript',
        '.ts': 'typescript',
        '.tsx': 'typescript',
        '.py': 'python',
        '.rb': 'ruby',
        '.go': 'go',
        '.rs': 'rust',
        '.java': 'java',
        '.kt': 'kotlin',
        '.kts': 'kotlin',
        '.cs': 'csharp',
        '.swift': 'swift',
        '.m': 'objective-c',
        '.mm': 'objective-c',
        '.dart': 'dart',
        '.php': 'php',
        '.scala': 'scala',
        '.ex': 'elixir',
        '.exs': 'elixir',
    }

    for ext, lang in extension_map.items():
        files = find_files(root_dir, [f'*{ext}'])
        if files:
            languages.add(lang)

    return list(languages)


def detect_package_managers(root_dir):
    """Detect package managers by their config files."""
    managers = []
    root_path = Path(root_dir)

    manager_files = {
        'package.json': 'npm',
        'yarn.lock': 'yarn',
        'pnpm-lock.yaml': 'pnpm',
        'requirements.txt': 'pip',
        'Pipfile': 'pipenv',
        'pyproject.toml': 'poetry',
        'Gemfile': 'bundler',
        'go.mod': 'go',
        'Cargo.toml': 'cargo',
        'pom.xml': 'maven',
        'build.gradle': 'gradle',
        'build.gradle.kts': 'gradle',
        'composer.json': 'composer',
        'pubspec.yaml': 'pub',
        'Podfile': 'cocoapods',
        'Package.swift': 'swift-pm',
    }

    for filename, manager in manager_files.items():
        if list(root_path.rglob(filename)):
            managers.append(manager)

    return list(set(managers))


def detect_frameworks(root_dir):
    """Detect web and mobile frameworks."""
    frameworks = []
    root_path = Path(root_dir)

    # Check package.json for JS frameworks
    package_files = find_files(root_dir, ['package.json'])
    for pf in package_files:
        content = read_file_safe(pf)
        if content:
            try:
                pkg = json.loads(content)
                deps = {**pkg.get('dependencies', {}), **pkg.get('devDependencies', {})}

                if 'next' in deps:
                    frameworks.append('next.js')
                if 'react' in deps:
                    frameworks.append('react')
                if 'vue' in deps:
                    frameworks.append('vue')
                if '@angular/core' in deps:
                    frameworks.append('angular')
                if 'express' in deps:
                    frameworks.append('express')
                if 'fastify' in deps:
                    frameworks.append('fastify')
                if 'koa' in deps:
                    frameworks.append('koa')
                if 'hapi' in deps or '@hapi/hapi' in deps:
                    frameworks.append('hapi')
                if 'react-native' in deps:
                    frameworks.append('react-native')
                if 'electron' in deps:
                    frameworks.append('electron')
                if 'svelte' in deps:
                    frameworks.append('svelte')
                if 'nuxt' in deps:
                    frameworks.append('nuxt')
            except json.JSONDecodeError:
                pass

    # Check requirements.txt and pyproject.toml for Python frameworks
    req_files = find_files(root_dir, ['requirements.txt', 'requirements/*.txt'])
    for rf in req_files:
        content = read_file_safe(rf)
        if content:
            content_lower = content.lower()
            if 'django' in content_lower:
                frameworks.append('django')
            if 'flask' in content_lower:
                frameworks.append('flask')
            if 'fastapi' in content_lower:
                frameworks.append('fastapi')
            if 'tornado' in content_lower:
                frameworks.append('tornado')

    # Check pyproject.toml
    pyproject_files = find_files(root_dir, ['pyproject.toml'])
    for pf in pyproject_files:
        content = read_file_safe(pf)
        if content:
            if 'django' in content.lower():
                frameworks.append('django')
            if 'flask' in content.lower():
                frameworks.append('flask')
            if 'fastapi' in content.lower():
                frameworks.append('fastapi')

    # Check Gemfile for Ruby frameworks
    gemfiles = find_files(root_dir, ['Gemfile'])
    for gf in gemfiles:
        content = read_file_safe(gf)
        if content:
            if 'rails' in content.lower():
                frameworks.append('rails')
            if 'sinatra' in content.lower():
                frameworks.append('sinatra')

    # Check go.mod for Go frameworks
    go_mods = find_files(root_dir, ['go.mod'])
    for gm in go_mods:
        content = read_file_safe(gm)
        if content:
            if 'gin-gonic' in content:
                frameworks.append('gin')
            if 'labstack/echo' in content:
                frameworks.append('echo')
            if 'gofiber' in content:
                frameworks.append('fiber')

    # Check for Java/Kotlin frameworks
    build_files = find_files(root_dir, ['pom.xml', 'build.gradle', 'build.gradle.kts'])
    for bf in build_files:
        content = read_file_safe(bf)
        if content:
            if 'spring-boot' in content.lower():
                frameworks.append('spring-boot')
            if 'spring-security' in content.lower():
                frameworks.append('spring-security')

    # Check for Flutter
    if find_files(root_dir, ['pubspec.yaml']):
        for pf in find_files(root_dir, ['pubspec.yaml']):
            content = read_file_safe(pf)
            if content and 'flutter' in content.lower():
                frameworks.append('flutter')

    # Check for iOS/Android native
    if find_files(root_dir, ['*.xcodeproj', '*.xcworkspace']):
        frameworks.append('ios-native')
    if find_files(root_dir, ['AndroidManifest.xml']):
        frameworks.append('android-native')

    # Check for .NET
    csproj_files = find_files(root_dir, ['*.csproj'])
    for cf in csproj_files:
        content = read_file_safe(cf)
        if content:
            if 'Microsoft.AspNetCore' in content:
                frameworks.append('aspnet-core')

    return list(set(frameworks))


def detect_databases(root_dir):
    """Detect database technologies."""
    databases = []

    # Look for database indicators in config and code
    all_files = find_files(root_dir, ['*.py', '*.js', '*.ts', '*.rb', '*.go', '*.java', '*.cs', '*.env', '*.yaml', '*.yml', '*.json', '*.toml'])

    db_patterns = {
        'postgresql': [r'postgres', r'pg_', r'psycopg', r'5432'],
        'mysql': [r'mysql', r'3306', r'mariadb'],
        'mongodb': [r'mongodb', r'mongoose', r'27017'],
        'redis': [r'redis', r'6379'],
        'sqlite': [r'sqlite', r'\.db'],
        'elasticsearch': [r'elasticsearch', r'9200'],
        'dynamodb': [r'dynamodb', r'aws.*dynamo'],
        'cassandra': [r'cassandra', r'9042'],
        'neo4j': [r'neo4j', r'7687'],
    }

    searched_content = ""
    for f in all_files[:100]:  # Limit to prevent slowness
        content = read_file_safe(f, max_size=100*1024)
        if content:
            searched_content += content.lower() + "\n"

    for db, patterns in db_patterns.items():
        for pattern in patterns:
            if re.search(pattern, searched_content, re.IGNORECASE):
                databases.append(db)
                break

    # Check docker-compose for databases
    compose_files = find_files(root_dir, ['docker-compose*.yml', 'docker-compose*.yaml'])
    for cf in compose_files:
        content = read_file_safe(cf)
        if content:
            content_lower = content.lower()
            if 'postgres' in content_lower:
                databases.append('postgresql')
            if 'mysql' in content_lower or 'mariadb' in content_lower:
                databases.append('mysql')
            if 'mongo' in content_lower:
                databases.append('mongodb')
            if 'redis' in content_lower:
                databases.append('redis')

    return list(set(databases))


def detect_architecture(root_dir):
    """Detect architecture type."""
    root_path = Path(root_dir)

    # Check for monorepo indicators
    has_lerna = (root_path / 'lerna.json').exists()
    has_nx = (root_path / 'nx.json').exists()
    has_workspaces = False

    pkg_json = root_path / 'package.json'
    if pkg_json.exists():
        content = read_file_safe(pkg_json)
        if content:
            try:
                pkg = json.loads(content)
                has_workspaces = 'workspaces' in pkg
            except json.JSONDecodeError:
                pass

    if has_lerna or has_nx or has_workspaces:
        return 'monorepo'

    # Check for microservices indicators
    docker_compose_files = find_files(root_dir, ['docker-compose*.yml', 'docker-compose*.yaml'])
    if docker_compose_files:
        for dcf in docker_compose_files:
            content = read_file_safe(dcf)
            if content:
                # Count services
                services_match = re.findall(r'^\s+\w+:\s*$', content, re.MULTILINE)
                if len(services_match) > 3:
                    return 'microservices'

    # Check for serverless
    serverless_files = find_files(root_dir, ['serverless.yml', 'serverless.yaml', 'template.yaml', 'sam.yaml'])
    if serverless_files:
        return 'serverless'

    # Check for Lambda functions
    if find_files(root_dir, ['lambda_function.py', 'handler.js', 'handler.ts']):
        return 'serverless'

    return 'monolith'


def detect_deployment(root_dir):
    """Detect deployment technologies."""
    deployment = []
    root_path = Path(root_dir)

    if (root_path / 'Dockerfile').exists() or find_files(root_dir, ['Dockerfile*']):
        deployment.append('docker')

    if find_files(root_dir, ['docker-compose*.yml', 'docker-compose*.yaml']):
        deployment.append('docker-compose')

    if find_files(root_dir, ['*.tf']):
        deployment.append('terraform')

    if find_files(root_dir, ['k8s/*.yaml', 'kubernetes/*.yaml', 'helm/*']):
        deployment.append('kubernetes')

    if (root_path / '.github' / 'workflows').exists():
        deployment.append('github-actions')

    if (root_path / '.gitlab-ci.yml').exists():
        deployment.append('gitlab-ci')

    if find_files(root_dir, ['serverless.yml', 'serverless.yaml']):
        deployment.append('serverless-framework')

    if find_files(root_dir, ['vercel.json']):
        deployment.append('vercel')

    if find_files(root_dir, ['netlify.toml']):
        deployment.append('netlify')

    return deployment


def detect_ai_components(root_dir):
    """Detect AI/LLM components."""
    ai_indicators = []

    all_files = find_files(root_dir, ['*.py', '*.js', '*.ts', '*.json', '*.yaml', '*.yml'])

    ai_patterns = {
        'openai': [r'openai', r'gpt-4', r'gpt-3', r'chatgpt'],
        'anthropic': [r'anthropic', r'claude'],
        'langchain': [r'langchain'],
        'huggingface': [r'huggingface', r'transformers'],
        'tensorflow': [r'tensorflow', r'tf\.'],
        'pytorch': [r'torch', r'pytorch'],
        'llm-general': [r'llm', r'large.?language.?model', r'embedding'],
    }

    searched_content = ""
    for f in all_files[:100]:
        content = read_file_safe(f, max_size=100*1024)
        if content:
            searched_content += content.lower() + "\n"

    for component, patterns in ai_patterns.items():
        for pattern in patterns:
            if re.search(pattern, searched_content, re.IGNORECASE):
                ai_indicators.append(component)
                break

    return list(set(ai_indicators))


def detect_entry_points(root_dir):
    """Detect main entry points."""
    entry_points = []
    root_path = Path(root_dir)

    common_entries = [
        'src/index.js', 'src/index.ts', 'src/main.js', 'src/main.ts',
        'src/app.js', 'src/app.ts', 'index.js', 'index.ts',
        'app.py', 'main.py', 'app/main.py', 'src/main.py',
        'main.go', 'cmd/main.go',
        'src/main/java', 'src/main/kotlin',
        'lib/main.dart',
        'App.js', 'App.tsx',
    ]

    for entry in common_entries:
        if (root_path / entry).exists():
            entry_points.append(entry)
        elif find_files(root_dir, [entry]):
            entry_points.append(entry)

    # Check package.json for main entry
    pkg_json = root_path / 'package.json'
    if pkg_json.exists():
        content = read_file_safe(pkg_json)
        if content:
            try:
                pkg = json.loads(content)
                if 'main' in pkg:
                    entry_points.append(pkg['main'])
            except json.JSONDecodeError:
                pass

    return list(set(entry_points))


def detect_config_files(root_dir):
    """Detect configuration files."""
    config_patterns = [
        'next.config.js', 'next.config.mjs',
        'nuxt.config.js', 'nuxt.config.ts',
        'vue.config.js', 'vite.config.js', 'vite.config.ts',
        'angular.json',
        'webpack.config.js',
        'tsconfig.json', 'jsconfig.json',
        'pyproject.toml', 'setup.py', 'setup.cfg',
        'settings.py', 'config.py',
        'application.properties', 'application.yml',
        'appsettings.json',
        '.env', '.env.local', '.env.production',
    ]

    found_configs = []
    for pattern in config_patterns:
        files = find_files(root_dir, [pattern, f'**/{pattern}'])
        for f in files:
            found_configs.append(str(f.relative_to(root_dir)))

    return found_configs[:20]  # Limit output


def has_mobile_components(root_dir):
    """Check if project has mobile components."""
    mobile_indicators = [
        'android/', 'ios/',
        'AndroidManifest.xml',
        'Info.plist',
        'pubspec.yaml',  # Flutter
    ]

    root_path = Path(root_dir)
    for indicator in mobile_indicators:
        if (root_path / indicator).exists() or find_files(root_dir, [indicator]):
            return True

    # Check for React Native
    pkg_files = find_files(root_dir, ['package.json'])
    for pf in pkg_files:
        content = read_file_safe(pf)
        if content and 'react-native' in content:
            return True

    return False


def main():
    """Main function to run stack discovery."""
    root_dir = sys.argv[1] if len(sys.argv) > 1 else '.'
    root_dir = os.path.abspath(root_dir)

    if not os.path.isdir(root_dir):
        print(json.dumps({"error": f"Directory not found: {root_dir}"}))
        sys.exit(1)

    result = {
        "languages": detect_languages(root_dir),
        "frameworks": detect_frameworks(root_dir),
        "architecture": detect_architecture(root_dir),
        "package_managers": detect_package_managers(root_dir),
        "databases": detect_databases(root_dir),
        "deployment": detect_deployment(root_dir),
        "has_ai_components": bool(detect_ai_components(root_dir)),
        "ai_components": detect_ai_components(root_dir),
        "has_mobile": has_mobile_components(root_dir),
        "entry_points": detect_entry_points(root_dir),
        "config_files": detect_config_files(root_dir),
    }

    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
