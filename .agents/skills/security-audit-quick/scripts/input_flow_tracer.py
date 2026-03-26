#!/usr/bin/env python3
"""
Input Flow Tracer

Traces user input from entry points through code to identify
unsanitized paths that may lead to injection vulnerabilities.

Usage: python3 input_flow_tracer.py [directory]
Output: JSON to stdout
"""

import json
import os
import re
import sys
from pathlib import Path
from typing import List, Dict, Any, Optional, Set


# User input sources (entry points)
INPUT_SOURCES = {
    'javascript': {
        'patterns': [
            r'req\.body',
            r'req\.query',
            r'req\.params',
            r'req\.headers',
            r'req\.cookies',
            r'request\.body',
            r'request\.query',
            r'request\.params',
            r'event\.body',
            r'ctx\.request\.body',
            r'ctx\.query',
            r'ctx\.params',
        ],
        'description': 'HTTP request input',
    },
    'python': {
        'patterns': [
            r'request\.form',
            r'request\.args',
            r'request\.json',
            r'request\.data',
            r'request\.files',
            r'request\.headers',
            r'request\.cookies',
            r'request\.GET',
            r'request\.POST',
            r'request\.body',
        ],
        'description': 'HTTP request input',
    },
    'java': {
        'patterns': [
            r'request\.getParameter',
            r'request\.getHeader',
            r'@RequestParam',
            r'@PathVariable',
            r'@RequestBody',
            r'@RequestHeader',
            r'@CookieValue',
        ],
        'description': 'HTTP request input',
    },
    'csharp': {
        'patterns': [
            r'Request\.Form',
            r'Request\.Query',
            r'Request\.Headers',
            r'Request\.Cookies',
            r'\[FromBody\]',
            r'\[FromQuery\]',
            r'\[FromRoute\]',
            r'\[FromForm\]',
        ],
        'description': 'HTTP request input',
    },
    'ruby': {
        'patterns': [
            r'params\[',
            r'request\.params',
            r'request\.headers',
            r'cookies\[',
        ],
        'description': 'HTTP request input',
    },
    'go': {
        'patterns': [
            r'r\.FormValue',
            r'r\.URL\.Query',
            r'r\.Header\.Get',
            r'c\.Param',
            r'c\.Query',
            r'c\.PostForm',
            r'c\.GetHeader',
        ],
        'description': 'HTTP request input',
    },
}

# Dangerous sinks where unsanitized input causes vulnerabilities
DANGEROUS_SINKS = {
    'sql_injection': {
        'patterns': [
            # Raw SQL
            r'execute\s*\(',
            r'raw\s*\(',
            r'rawQuery',
            r'createQuery',
            r'executeQuery',
            r'executeSql',
            r'query\s*\([^)]*\+',
            r'query\s*\([^)]*\$\{',
            r'query\s*\([^)]*%s',
            r'query\s*\([^)]*\.format',
            r'cursor\.execute\s*\([^)]*%',
            r'cursor\.execute\s*\([^)]*\+',
            r'cursor\.execute\s*\([^)]*f[\'"]',
            # String concatenation in SQL
            r'SELECT.*\+.*FROM',
            r'INSERT.*\+.*INTO',
            r'UPDATE.*\+.*SET',
            r'DELETE.*\+.*FROM',
            r'WHERE.*\+',
        ],
        'severity': 'CRITICAL',
        'description': 'Potential SQL injection',
    },
    'command_injection': {
        'patterns': [
            r'exec\s*\(',
            r'execSync\s*\(',
            r'spawn\s*\(',
            r'system\s*\(',
            r'popen\s*\(',
            r'subprocess\.run',
            r'subprocess\.call',
            r'subprocess\.Popen',
            r'os\.system',
            r'os\.popen',
            r'child_process',
            r'Runtime\.getRuntime\(\)\.exec',
            r'ProcessBuilder',
            r'Process\.Start',
        ],
        'severity': 'CRITICAL',
        'description': 'Potential command injection',
    },
    'xss': {
        'patterns': [
            r'innerHTML\s*=',
            r'outerHTML\s*=',
            r'document\.write',
            r'\.html\s*\(',
            r'dangerouslySetInnerHTML',
            r'v-html',
            r'\[innerHTML\]',
            r'raw\s*%>',
            r'<%=.*raw',
            r'safe\s*}}',
            r'\|safe',
            r'mark_safe',
            r'Markup\s*\(',
            r'Html\.Raw',
        ],
        'severity': 'HIGH',
        'description': 'Potential XSS vulnerability',
    },
    'path_traversal': {
        'patterns': [
            r'readFile\s*\(',
            r'writeFile\s*\(',
            r'createReadStream',
            r'createWriteStream',
            r'sendFile\s*\(',
            r'open\s*\([^)]*\+',
            r'Path\.Combine.*\+',
            r'file_get_contents',
            r'fopen\s*\(',
            r'File\.read',
            r'File\.open',
            r'os\.path\.join.*\+',
            r'path\.join.*\+',
        ],
        'severity': 'HIGH',
        'description': 'Potential path traversal',
    },
    'deserialization': {
        'patterns': [
            r'JSON\.parse\s*\(',
            r'pickle\.loads',
            r'yaml\.load\s*\(',
            r'marshal\.loads',
            r'unserialize\s*\(',
            r'ObjectInputStream',
            r'readObject\s*\(',
            r'JsonConvert\.DeserializeObject',
            r'BinaryFormatter',
        ],
        'severity': 'HIGH',
        'description': 'Potential insecure deserialization',
    },
    'ssrf': {
        'patterns': [
            r'fetch\s*\(',
            r'axios\s*\(',
            r'http\.get\s*\(',
            r'https\.get\s*\(',
            r'requests\.get',
            r'requests\.post',
            r'urllib\.request',
            r'HttpClient',
            r'WebClient',
            r'RestTemplate',
            r'http\.NewRequest',
        ],
        'severity': 'HIGH',
        'description': 'Potential SSRF vulnerability',
    },
    'ldap_injection': {
        'patterns': [
            r'ldap_search',
            r'ldapsearch',
            r'LdapConnection',
            r'DirectorySearcher',
        ],
        'severity': 'HIGH',
        'description': 'Potential LDAP injection',
    },
    'xpath_injection': {
        'patterns': [
            r'xpath\s*\(',
            r'XPathExpression',
            r'selectNodes',
            r'selectSingleNode',
        ],
        'severity': 'HIGH',
        'description': 'Potential XPath injection',
    },
    'template_injection': {
        'patterns': [
            r'render_template_string',
            r'Template\s*\(.*\+',
            r'Jinja2.*\+',
            r'eval\s*\(',
            r'new Function\s*\(',
        ],
        'severity': 'CRITICAL',
        'description': 'Potential template injection',
    },
    'regex_dos': {
        'patterns': [
            r'new RegExp\s*\([^)]*\+',
            r're\.compile\s*\([^)]*\+',
            r'Regex\s*\([^)]*\+',
        ],
        'severity': 'MEDIUM',
        'description': 'Potential ReDoS via user-controlled regex',
    },
}

# Sanitization functions that mitigate risks
SANITIZERS = {
    'javascript': [
        r'escape', r'encode', r'sanitize', r'validate',
        r'parseInt', r'parseFloat', r'Number\(',
        r'encodeURIComponent', r'encodeURI',
        r'DOMPurify', r'xss-filters', r'validator\.',
    ],
    'python': [
        r'escape', r'quote', r'sanitize', r'clean',
        r'bleach\.', r'html\.escape', r'markupsafe',
        r'validate', r'int\(', r'float\(',
    ],
    'sql': [
        r'\?', r'%s', r'\$\d+', r':[\w]+',  # Parameterized query markers
        r'prepared', r'parameterized',
    ],
}

# File extensions by language
LANGUAGE_EXTENSIONS = {
    'javascript': ['.js', '.ts', '.jsx', '.tsx', '.mjs'],
    'python': ['.py'],
    'java': ['.java', '.kt'],
    'csharp': ['.cs'],
    'ruby': ['.rb'],
    'go': ['.go'],
    'php': ['.php'],
}

# Directories to skip
SKIP_DIRS = {
    'node_modules', 'venv', '.venv', 'vendor', 'target',
    'build', 'dist', '.git', '__pycache__', 'test', 'tests',
    'spec', 'coverage', '.next', '.nuxt',
}


def find_files(root_dir: str, extensions: List[str]) -> List[Path]:
    """Find files with given extensions."""
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


def detect_language(filepath: Path) -> Optional[str]:
    """Detect language from file extension."""
    ext = filepath.suffix.lower()
    for lang, extensions in LANGUAGE_EXTENSIONS.items():
        if ext in extensions:
            return lang
    return None


def find_input_sources(content: str, language: str) -> List[Dict[str, Any]]:
    """Find user input sources in code."""
    sources = []

    if language not in INPUT_SOURCES:
        return sources

    patterns = INPUT_SOURCES[language]['patterns']
    lines = content.split('\n')

    for line_num, line in enumerate(lines, 1):
        for pattern in patterns:
            if re.search(pattern, line, re.IGNORECASE):
                sources.append({
                    'line': line_num,
                    'pattern': pattern,
                    'code': line.strip()[:200],
                })
                break

    return sources


def find_dangerous_sinks(content: str, filepath: Path) -> List[Dict[str, Any]]:
    """Find dangerous sinks in code."""
    sinks = []
    lines = content.split('\n')

    for sink_type, config in DANGEROUS_SINKS.items():
        for line_num, line in enumerate(lines, 1):
            for pattern in config['patterns']:
                if re.search(pattern, line, re.IGNORECASE):
                    sinks.append({
                        'line': line_num,
                        'type': sink_type,
                        'severity': config['severity'],
                        'description': config['description'],
                        'pattern': pattern,
                        'code': line.strip()[:200],
                    })
                    break

    return sinks


def check_sanitization(content: str, line_num: int, language: str) -> bool:
    """Check if there's sanitization near a dangerous sink."""
    lines = content.split('\n')
    # Check 10 lines before the sink
    start = max(0, line_num - 10)
    context = '\n'.join(lines[start:line_num])

    sanitizers = SANITIZERS.get(language, []) + SANITIZERS.get('sql', [])

    for sanitizer in sanitizers:
        if re.search(sanitizer, context, re.IGNORECASE):
            return True

    return False


def analyze_file(filepath: Path) -> Dict[str, Any]:
    """Analyze a file for input flow vulnerabilities."""
    content = read_file_safe(filepath)
    if not content:
        return None

    language = detect_language(filepath)
    if not language:
        return None

    findings = []

    # Find input sources
    input_sources = find_input_sources(content, language)

    # Find dangerous sinks
    sinks = find_dangerous_sinks(content, filepath)

    # For each sink, check if it might be connected to user input
    for sink in sinks:
        # Check if there's sanitization
        has_sanitization = check_sanitization(content, sink['line'], language)

        # If there are input sources in the same file and no sanitization, flag it
        if input_sources and not has_sanitization:
            findings.append({
                'file': str(filepath),
                'line': sink['line'],
                'type': sink['type'],
                'severity': sink['severity'],
                'description': sink['description'],
                'code': sink['code'],
                'has_input_sources': True,
                'has_sanitization': False,
                'input_source_lines': [s['line'] for s in input_sources[:5]],
            })
        elif not has_sanitization:
            # Still flag sinks without sanitization, lower confidence
            findings.append({
                'file': str(filepath),
                'line': sink['line'],
                'type': sink['type'],
                'severity': 'MEDIUM' if sink['severity'] == 'CRITICAL' else 'LOW',
                'description': f"{sink['description']} (no input sources detected in file)",
                'code': sink['code'],
                'has_input_sources': False,
                'has_sanitization': False,
            })

    return {
        'file': str(filepath),
        'language': language,
        'input_sources': len(input_sources),
        'findings': findings,
    }


def scan_directory(root_dir: str) -> Dict[str, Any]:
    """Scan directory for input flow vulnerabilities."""
    all_findings = []
    files_scanned = 0
    files_with_issues = 0

    # Get all extensions to scan
    all_extensions = []
    for exts in LANGUAGE_EXTENSIONS.values():
        all_extensions.extend(exts)

    files = find_files(root_dir, all_extensions)

    for filepath in files:
        files_scanned += 1
        result = analyze_file(filepath)

        if result and result['findings']:
            files_with_issues += 1
            all_findings.extend(result['findings'])

    # Sort by severity
    severity_order = {'CRITICAL': 0, 'HIGH': 1, 'MEDIUM': 2, 'LOW': 3}
    all_findings.sort(key=lambda x: severity_order.get(x['severity'], 4))

    return {
        'findings': all_findings,
        'summary': {
            'total_findings': len(all_findings),
            'critical': len([f for f in all_findings if f['severity'] == 'CRITICAL']),
            'high': len([f for f in all_findings if f['severity'] == 'HIGH']),
            'medium': len([f for f in all_findings if f['severity'] == 'MEDIUM']),
            'low': len([f for f in all_findings if f['severity'] == 'LOW']),
            'files_scanned': files_scanned,
            'files_with_issues': files_with_issues,
            'by_type': {},
        }
    }


def main():
    """Main function to run input flow tracer."""
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
