#!/usr/bin/env python3
"""Structural sanity checks for the PHP sources.

This sandbox has NO PHP binary, so `php -l` cannot be run. This script is a
weak substitute: it catches unbalanced braces/parens/brackets, stray or missing
opening tags, and obvious quoting mistakes. It does NOT prove the code runs.
Treat a clean run as "not obviously broken", never as "tested".

Usage: python3 tools/php_lint.py [root]
"""
import os, re, sys

root = sys.argv[1] if len(sys.argv) > 1 else "/data/budget-planner"

PAIRS = {"{": "}", "(": ")", "[": "]"}
CLOSERS = {v: k for k, v in PAIRS.items()}


def strip_noise(src: str):
    """Remove comments and string literals so delimiters inside them are ignored."""
    out, i, n = [], 0, len(src)
    while i < n:
        c = src[i]
        two = src[i:i + 2]
        if two == "//" or c == "#":
            j = src.find("\n", i)
            i = n if j == -1 else j
        elif two == "/*":
            j = src.find("*/", i + 2)
            i = n if j == -1 else j + 2
        elif c in "'\"":
            quote, i = c, i + 1
            while i < n:
                if src[i] == "\\":
                    i += 2
                    continue
                if src[i] == quote:
                    i += 1
                    break
                i += 1
            out.append('""')
        elif two == "<<":
            m = re.match(r"<<<\s*'?\"?([A-Za-z_]\w*)'?\"?\r?\n", src[i:])
            if m:
                label = m.group(1)
                end = re.search(r"\n\s*" + label + r"\b", src[i:])
                i = n if not end else i + end.end()
            else:
                out.append(c)
                i += 1
        else:
            out.append(c)
            i += 1
    return "".join(out)


def check(path: str):
    src = open(path, encoding="utf-8").read()
    problems = []

    if not src.startswith("<?php"):
        problems.append("does not start with <?php")
    if "?>" in strip_noise(src):
        problems.append("contains a closing ?> tag (trailing output risk)")

    stack, line = [], 1
    for ch in strip_noise(src):
        if ch == "\n":
            line += 1
        elif ch in PAIRS:
            stack.append((ch, line))
        elif ch in CLOSERS:
            if not stack:
                problems.append(f"line {line}: unexpected '{ch}'")
                break
            opener, oline = stack.pop()
            if PAIRS[opener] != ch:
                problems.append(f"line {line}: '{ch}' closes '{opener}' opened on line {oline}")
                break
    if stack:
        opener, oline = stack[-1]
        problems.append(f"unclosed '{opener}' opened on line {oline}")

    return problems


files, bad = [], 0
for base, _dirs, names in os.walk(root):
    if "/.git" in base or "/node_modules" in base:
        continue
    for name in sorted(names):
        if name.endswith(".php"):
            files.append(os.path.join(base, name))

for f in sorted(files):
    problems = check(f)
    rel = os.path.relpath(f, root)
    if problems:
        bad += 1
        print(f"FAIL {rel}")
        for p in problems:
            print(f"     {p}")
    else:
        print(f"ok   {rel}")

print(f"\n{len(files)} file(s) checked, {bad} with structural problems")
print("NOTE: structural check only. Run `php -l` for a real syntax check.")
sys.exit(1 if bad else 0)
