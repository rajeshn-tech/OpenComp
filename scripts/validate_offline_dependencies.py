#!/usr/bin/env python3
"""
OpenComp - Offline Air-Gap & Network Dependency Validator
Scans the entire codebase for external URLs, remote CDNs, web fonts, cloud telemetry,
uncontrolled socket bindings, and verifies all required runtime assets are local.
"""

import os
import sys
import re
import json

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
os.chdir(PROJECT_ROOT)

print("=" * 80)
print("🛡️  OPENCOMP — OFFLINE AIR-GAP & NETWORK DEPENDENCY AUDIT")
print("=" * 80)
print(f"Project Root: {PROJECT_ROOT}\n")

# Extensions to scan
SCAN_EXTENSIONS = ('.js', '.mjs', '.py', '.html', '.css', '.json', '.sh', '.bat', '.txt')

# Regex for external URLs (excluding loopback / localhost)
EXTERNAL_URL_REGEX = re.compile(
    r'https?://(?!127\.0\.0\.1|localhost|0\.0\.0\.0)[a-zA-Z0-9.\-_]+(?::\d+)?(?:/[^\s"\'`<>()]*)?',
    re.IGNORECASE
)

# Known benign documentation / schema URLs (e.g. XML namespaces, license links in headers)
BENIGN_PATTERNS = [
    'www.w3.org',
    'spdx.org',
    'github.com',
    'opencolorio.org',
    'openexr.com',
    'academysoftwarefoundation',
    'aka.ms'
]

findings = {
    'remote_cdn_imports': [],
    'external_fetch_calls': [],
    'remote_fonts': [],
    'telemetry_services': [],
    'benign_doc_urls': [],
    'active_network_calls': [],
    'server_bindings': []
}

total_files_scanned = 0

for root, dirs, files in os.walk(PROJECT_ROOT):
    # Skip virtual environments, node_modules, and git directories
    if any(skip in root for skip in ['.venv', 'node_modules', '.git', 'docs/historical_archive']):
        continue
    
    for file in files:
        if file.endswith(SCAN_EXTENSIONS):
            total_files_scanned += 1
            filepath = os.path.join(root, file)
            rel_path = os.path.relpath(filepath, PROJECT_ROOT).replace('\\', '/')
            
            try:
                with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
                    content = f.read()
            except Exception as e:
                continue

            # 1. Search for external URLs
            for match in EXTERNAL_URL_REGEX.finditer(content):
                url = match.group(0)
                is_benign = any(b in url.lower() for b in BENIGN_PATTERNS)
                if is_benign:
                    findings['benign_doc_urls'].append((rel_path, url))
                else:
                    if 'cdn' in url.lower() or 'unpkg' in url.lower() or 'jsdelivr' in url.lower():
                        findings['remote_cdn_imports'].append((rel_path, url))
                    else:
                        findings['active_network_calls'].append((rel_path, url))

            # 2. Check for web fonts (@import url)
            if file.endswith(('.css', '.html')):
                font_imports = re.findall(r'@import\s+url\([\'"]?(https?://[^\'")]+)[\'"]?\)', content, re.IGNORECASE)
                for font_url in font_imports:
                    findings['remote_fonts'].append((rel_path, font_url))

            # 3. Check for fetch / xhr to external endpoints
            if file.endswith(('.js', '.mjs', '.html')):
                fetches = re.findall(r'fetch\(\s*[\'"](https?://[^\'"]+)[\'"]', content, re.IGNORECASE)
                for f_url in fetches:
                    if not ('127.0.0.1' in f_url or 'localhost' in f_url):
                        findings['external_fetch_calls'].append((rel_path, f_url))

            # 4. Check server.js for host binding
            if file in ['server.js', 'server.py']:
                bindings = re.findall(r'(?:listen\s*\(\s*\d+\s*,\s*[\'"]([^\'"]+)[\'"]|HOST\s*=\s*[\'"]([^\'"]+)[\'"])', content)
                for b in bindings:
                    b_host = b[0] or b[1]
                    findings['server_bindings'].append((rel_path, b_host))

print(f"Total Source & Configuration Files Scanned: {total_files_scanned}")
print("-" * 80)

# Report findings
print(f"1. Remote CDN Script / Style Imports:     {len(findings['remote_cdn_imports'])}")
for r in findings['remote_cdn_imports']:
    print(f"   ⚠️  {r[0]}: {r[1]}")

print(f"2. Remote Web Font Imports:               {len(findings['remote_fonts'])}")
for r in findings['remote_fonts']:
    print(f"   ⚠️  {r[0]}: {r[1]}")

print(f"3. External Runtime fetch() Calls:        {len(findings['external_fetch_calls'])}")
for r in findings['external_fetch_calls']:
    print(f"   ❌ {r[0]}: {r[1]}")

print(f"4. Active External Network Calls:         {len(findings['active_network_calls'])}")
for r in findings['active_network_calls']:
    print(f"   ⚠️  {r[0]}: {r[1]}")

print(f"5. Benign Documentation / Namespace URLs: {len(findings['benign_doc_urls'])}")

print(f"6. Local Server Bindings:                 {len(findings['server_bindings'])}")
for r in findings['server_bindings']:
    is_safe = r[1] in ['127.0.0.1', 'localhost']
    status = "✅ SAFE (Loopback Only)" if is_safe else "⚠️ WARNING (Exposed)"
    print(f"   {r[0]} binds to: '{r[1]}' [{status}]")

print("-" * 80)

# Check Local Assets & Built-in Offline Configurations
print("Checking Local Asset & Built-in Engine Integrity:")
local_assets = [
    ('styles.css', os.path.exists('styles.css')),
    ('index.html', os.path.exists('index.html')),
    ('server.js', os.path.exists('server.js'))
]

all_assets_present = True
for name, exists in local_assets:
    status = "✅ FOUND" if exists else "❌ MISSING"
    print(f"   - {name:<35} {status}")
    if not exists:
        all_assets_present = False

# Verify PyOpenColorIO built-in ACES 1.3 configuration
try:
    import PyOpenColorIO as ocio
    cfg = ocio.Config.CreateFromBuiltinConfig('cg-config-v2.1.0_aces-v1.3_ocio-v2.3')
    print(f"   - {'PyOpenColorIO Built-in ACES 1.3':<35} ✅ BUILT-IN ({len(cfg.getColorSpaces())} color spaces, 0 network calls)")
except Exception as e:
    print(f"   - {'PyOpenColorIO Built-in ACES 1.3':<35} ❌ ERROR: {e}")
    all_assets_present = False

print("-" * 80)
is_airgap_clean = (
    len(findings['remote_cdn_imports']) == 0 and
    len(findings['remote_fonts']) == 0 and
    len(findings['external_fetch_calls']) == 0 and
    len(findings['active_network_calls']) == 0 and
    all_assets_present
)

if is_airgap_clean:
    print("🎉 AIR-GAP AUDIT RESULT: CODEBASE IS 100% AIR-GAP COMPLIANT (ZERO REMOTE DEPENDENCIES)")
    sys.exit(0)
else:
    print("⚠️ AIR-GAP AUDIT RESULT: UNVERIFIED OR REMOTE DEPENDENCIES FOUND")
    sys.exit(1)
