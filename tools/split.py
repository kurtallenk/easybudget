#!/usr/bin/env python3
"""Lossless split of the original single-file Budget Planner SPA.

Extracts the <style> block to assets/css/app.css and the nine IIFE modules
inside the single <script> block to assets/js/*.js. No source line is edited;
the concatenation of the nine modules must equal the original script body.
"""
import os, hashlib

SRC = "/data/source/budget-planner.html"
ROOT = "/data/budget-planner"

lines = open(SRC, encoding="utf-8").read().split("\n")

def find(tag, start=0):
    for i in range(start, len(lines)):
        if lines[i].strip() == tag:
            return i
    raise SystemExit("tag not found: " + tag)

style_open  = find("<style>")
style_close = find("</style>", style_open)
script_open = find("<script>", style_close)
script_close = find("</script>", script_open)

css = lines[style_open + 1:style_close]
js  = lines[script_open + 1:script_close]
js_first_line = script_open + 2          # 1-based file line of js[0]

MODULES = [
    ("core.js",         453,  650),
    ("store.legacy.js", 651, 1177),
    ("compute.js",     1178, 1448),
    ("charts.js",      1449, 1703),
    ("ui.js",          1704, 1855),
    ("forms.js",       1856, 2169),
    ("views-a.js",     2170, 2567),
    ("views-b.js",     2568, 3014),
    ("app.js",         3015, 3345),
]

os.makedirs(ROOT + "/assets/css", exist_ok=True)
os.makedirs(ROOT + "/assets/js", exist_ok=True)
open(ROOT + "/assets/css/app.css", "w", encoding="utf-8").write("\n".join(css) + "\n")

expect = js_first_line
for name, a, b in MODULES:
    if a != expect:
        raise SystemExit("gap/overlap before %s: expected %d got %d" % (name, expect, a))
    expect = b + 1
if expect != script_close + 1:
    raise SystemExit("module map ends at %d, script body ends at %d" % (expect - 1, script_close))

rejoined = []
for name, a, b in MODULES:
    body = lines[a - 1:b]
    rejoined.extend(body)
    open(ROOT + "/assets/js/" + name, "w", encoding="utf-8").write("\n".join(body) + "\n")
    print("%-16s lines %5d-%5d  (%d)" % (name, a, b, len(body)))

assert rejoined == js, "ROUND-TRIP FAILED"
print("css lines  :", len(css))
print("js lines   :", len(js))
print("round-trip : OK  sha256(body)=%s" % hashlib.sha256("\n".join(js).encode()).hexdigest()[:16])
