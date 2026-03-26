#!/bin/bash
#
# Dependency Audit Script
#
# Detects package managers and runs appropriate vulnerability audits.
# Normalizes output to JSON format regardless of source.
#
# Usage: bash dependency_audit.sh [directory]
# Output: JSON to stdout
#

set -e

ROOT_DIR="${1:-.}"
cd "$ROOT_DIR"

# Initialize results
RESULTS='{"audits": [], "errors": [], "summary": {"total_vulnerabilities": 0, "critical": 0, "high": 0, "medium": 0, "low": 0}}'

# Helper function to add audit result
add_audit() {
    local manager="$1"
    local status="$2"
    local vulnerabilities="$3"
    local raw_output="$4"

    RESULTS=$(echo "$RESULTS" | python3 -c "
import sys, json
data = json.load(sys.stdin)
data['audits'].append({
    'package_manager': '$manager',
    'status': '$status',
    'vulnerabilities': $vulnerabilities,
    'raw_output_preview': '''$raw_output'''[:500]
})
print(json.dumps(data))
" 2>/dev/null || echo "$RESULTS")
}

# Helper function to add error
add_error() {
    local message="$1"
    RESULTS=$(echo "$RESULTS" | python3 -c "
import sys, json
data = json.load(sys.stdin)
data['errors'].append('$message')
print(json.dumps(data))
" 2>/dev/null || echo "$RESULTS")
}

# Check for npm/yarn/pnpm
if [ -f "package.json" ]; then
    if command -v npm &> /dev/null; then
        echo "Running npm audit..." >&2
        NPM_OUTPUT=$(npm audit --json 2>/dev/null || true)

        if [ -n "$NPM_OUTPUT" ]; then
            # Parse npm audit output
            VULN_COUNT=$(echo "$NPM_OUTPUT" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    if 'metadata' in data and 'vulnerabilities' in data['metadata']:
        v = data['metadata']['vulnerabilities']
        print(v.get('total', 0))
    elif 'vulnerabilities' in data:
        print(len(data['vulnerabilities']))
    else:
        print(0)
except:
    print(0)
" 2>/dev/null || echo "0")

            CRITICAL=$(echo "$NPM_OUTPUT" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    if 'metadata' in data and 'vulnerabilities' in data['metadata']:
        print(data['metadata']['vulnerabilities'].get('critical', 0))
    else:
        print(0)
except:
    print(0)
" 2>/dev/null || echo "0")

            HIGH=$(echo "$NPM_OUTPUT" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    if 'metadata' in data and 'vulnerabilities' in data['metadata']:
        print(data['metadata']['vulnerabilities'].get('high', 0))
    else:
        print(0)
except:
    print(0)
" 2>/dev/null || echo "0")

            RESULTS=$(echo "$RESULTS" | python3 -c "
import sys, json
data = json.load(sys.stdin)
data['audits'].append({
    'package_manager': 'npm',
    'status': 'completed',
    'vulnerability_count': $VULN_COUNT,
    'critical': $CRITICAL,
    'high': $HIGH
})
data['summary']['total_vulnerabilities'] += $VULN_COUNT
data['summary']['critical'] += $CRITICAL
data['summary']['high'] += $HIGH
print(json.dumps(data))
" 2>/dev/null || echo "$RESULTS")
        else
            add_error "npm audit returned no output"
        fi
    else
        add_error "npm not found but package.json exists"
    fi
fi

# Check for pip/Python
if [ -f "requirements.txt" ] || [ -f "pyproject.toml" ] || [ -f "Pipfile" ]; then
    # Try pip-audit first
    if command -v pip-audit &> /dev/null; then
        echo "Running pip-audit..." >&2
        PIP_OUTPUT=$(pip-audit --format=json 2>/dev/null || true)

        if [ -n "$PIP_OUTPUT" ]; then
            VULN_COUNT=$(echo "$PIP_OUTPUT" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    print(len(data))
except:
    print(0)
" 2>/dev/null || echo "0")

            RESULTS=$(echo "$RESULTS" | python3 -c "
import sys, json
data = json.load(sys.stdin)
data['audits'].append({
    'package_manager': 'pip',
    'status': 'completed',
    'vulnerability_count': $VULN_COUNT
})
data['summary']['total_vulnerabilities'] += $VULN_COUNT
print(json.dumps(data))
" 2>/dev/null || echo "$RESULTS")
        fi
    # Try safety as fallback
    elif command -v safety &> /dev/null; then
        echo "Running safety check..." >&2
        SAFETY_OUTPUT=$(safety check --json 2>/dev/null || true)

        if [ -n "$SAFETY_OUTPUT" ]; then
            VULN_COUNT=$(echo "$SAFETY_OUTPUT" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    if isinstance(data, list):
        print(len(data))
    else:
        print(0)
except:
    print(0)
" 2>/dev/null || echo "0")

            RESULTS=$(echo "$RESULTS" | python3 -c "
import sys, json
data = json.load(sys.stdin)
data['audits'].append({
    'package_manager': 'pip',
    'status': 'completed',
    'vulnerability_count': $VULN_COUNT
})
data['summary']['total_vulnerabilities'] += $VULN_COUNT
print(json.dumps(data))
" 2>/dev/null || echo "$RESULTS")
        fi
    else
        add_error "pip-audit or safety not found - install with: pip install pip-audit"
    fi
fi

# Check for bundler/Ruby
if [ -f "Gemfile" ]; then
    if command -v bundle &> /dev/null && command -v bundle-audit &> /dev/null; then
        echo "Running bundle audit..." >&2
        BUNDLE_OUTPUT=$(bundle audit check --format=json 2>/dev/null || bundle audit check 2>/dev/null || true)

        if [ -n "$BUNDLE_OUTPUT" ]; then
            # Try to count vulnerabilities from output
            VULN_COUNT=$(echo "$BUNDLE_OUTPUT" | grep -c "Vulnerabilities found" 2>/dev/null || echo "0")

            RESULTS=$(echo "$RESULTS" | python3 -c "
import sys, json
data = json.load(sys.stdin)
data['audits'].append({
    'package_manager': 'bundler',
    'status': 'completed',
    'vulnerability_count': $VULN_COUNT,
    'note': 'Run bundle audit for detailed output'
})
print(json.dumps(data))
" 2>/dev/null || echo "$RESULTS")
        fi
    elif command -v bundle &> /dev/null; then
        add_error "bundle-audit not found - install with: gem install bundle-audit"
    else
        add_error "bundler not found but Gemfile exists"
    fi
fi

# Check for Go
if [ -f "go.mod" ]; then
    if command -v govulncheck &> /dev/null; then
        echo "Running govulncheck..." >&2
        GO_OUTPUT=$(govulncheck -json ./... 2>/dev/null || true)

        if [ -n "$GO_OUTPUT" ]; then
            VULN_COUNT=$(echo "$GO_OUTPUT" | grep -c '"osv"' 2>/dev/null || echo "0")

            RESULTS=$(echo "$RESULTS" | python3 -c "
import sys, json
data = json.load(sys.stdin)
data['audits'].append({
    'package_manager': 'go',
    'status': 'completed',
    'vulnerability_count': $VULN_COUNT
})
data['summary']['total_vulnerabilities'] += $VULN_COUNT
print(json.dumps(data))
" 2>/dev/null || echo "$RESULTS")
        fi
    else
        add_error "govulncheck not found - install with: go install golang.org/x/vuln/cmd/govulncheck@latest"
    fi
fi

# Check for Cargo/Rust
if [ -f "Cargo.toml" ]; then
    if command -v cargo &> /dev/null && cargo audit --help &> /dev/null; then
        echo "Running cargo audit..." >&2
        CARGO_OUTPUT=$(cargo audit --json 2>/dev/null || true)

        if [ -n "$CARGO_OUTPUT" ]; then
            VULN_COUNT=$(echo "$CARGO_OUTPUT" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    print(len(data.get('vulnerabilities', {}).get('list', [])))
except:
    print(0)
" 2>/dev/null || echo "0")

            RESULTS=$(echo "$RESULTS" | python3 -c "
import sys, json
data = json.load(sys.stdin)
data['audits'].append({
    'package_manager': 'cargo',
    'status': 'completed',
    'vulnerability_count': $VULN_COUNT
})
data['summary']['total_vulnerabilities'] += $VULN_COUNT
print(json.dumps(data))
" 2>/dev/null || echo "$RESULTS")
        fi
    else
        add_error "cargo audit not found - install with: cargo install cargo-audit"
    fi
fi

# Check for Composer/PHP
if [ -f "composer.json" ]; then
    if command -v composer &> /dev/null; then
        echo "Running composer audit..." >&2
        COMPOSER_OUTPUT=$(composer audit --format=json 2>/dev/null || true)

        if [ -n "$COMPOSER_OUTPUT" ]; then
            VULN_COUNT=$(echo "$COMPOSER_OUTPUT" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    print(len(data.get('advisories', [])))
except:
    print(0)
" 2>/dev/null || echo "0")

            RESULTS=$(echo "$RESULTS" | python3 -c "
import sys, json
data = json.load(sys.stdin)
data['audits'].append({
    'package_manager': 'composer',
    'status': 'completed',
    'vulnerability_count': $VULN_COUNT
})
data['summary']['total_vulnerabilities'] += $VULN_COUNT
print(json.dumps(data))
" 2>/dev/null || echo "$RESULTS")
        fi
    else
        add_error "composer not found but composer.json exists"
    fi
fi

# Check for Maven/Java
if [ -f "pom.xml" ]; then
    if command -v mvn &> /dev/null; then
        echo "Note: Maven OWASP dependency-check plugin recommended" >&2
        RESULTS=$(echo "$RESULTS" | python3 -c "
import sys, json
data = json.load(sys.stdin)
data['audits'].append({
    'package_manager': 'maven',
    'status': 'skipped',
    'note': 'Install OWASP dependency-check-maven plugin for vulnerability scanning'
})
print(json.dumps(data))
" 2>/dev/null || echo "$RESULTS")
    fi
fi

# Check for Gradle/Java
if [ -f "build.gradle" ] || [ -f "build.gradle.kts" ]; then
    if command -v gradle &> /dev/null; then
        echo "Note: Gradle OWASP dependency-check plugin recommended" >&2
        RESULTS=$(echo "$RESULTS" | python3 -c "
import sys, json
data = json.load(sys.stdin)
data['audits'].append({
    'package_manager': 'gradle',
    'status': 'skipped',
    'note': 'Install OWASP dependency-check-gradle plugin for vulnerability scanning'
})
print(json.dumps(data))
" 2>/dev/null || echo "$RESULTS")
    fi
fi

# Output final results
echo "$RESULTS" | python3 -c "
import sys, json
data = json.load(sys.stdin)
print(json.dumps(data, indent=2))
" 2>/dev/null || echo "$RESULTS"
