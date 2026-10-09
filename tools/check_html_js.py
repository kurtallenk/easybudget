#!/usr/bin/env python3
"""Extract inline <script> bodies from HTML files and syntax-check them with Node.

The auth pages carry their own small script because they load before the app
bundle. This keeps them under the same syntax check as assets/js/*.js.
"""
import re, subprocess, sys, tempfile, pathlib

root = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else '.')
bad = 0
checked = 0
for html in sorted(root.rglob('*.html')):
    src = html.read_text(encoding='utf-8')
    for i, body in enumerate(re.findall(r'<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>', src, re.S)):
        if not body.strip():
            continue
        checked += 1
        with tempfile.NamedTemporaryFile('w', suffix='.js', delete=False) as fh:
            fh.write(body)
            tmp = fh.name
        r = subprocess.run(['node', '--check', tmp], capture_output=True, text=True)
        rel = html.relative_to(root)
        if r.returncode:
            bad += 1
            print(f'FAIL {rel} (inline script {i + 1})')
            print(r.stderr.strip()[:400])
        else:
            print(f'ok   {rel} (inline script {i + 1})')

print(f'\n{checked} inline script(s) checked, {bad} with syntax errors')
sys.exit(1 if bad else 0)
