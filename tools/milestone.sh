#!/usr/bin/env bash
# milestone.sh <MILESTONE_NAME>
# Runs every validation available in this environment, builds the complete
# project ZIP, re-opens it and verifies the recovery files are inside.
set -euo pipefail
PROJECT_DIR="${PROJECT_DIR:-/data/budget-planner}"
OUT_DIR="${OUT_DIR:-/data/out}"
NAME="${1:?usage: milestone.sh <MILESTONE_NAME>}"
ZIP="$OUT_DIR/budget-planner_${NAME}.zip"
LATEST="$OUT_DIR/budget-planner_HANDOFF_LATEST.zip"
MANDATORY=(PROJECT_PROGRESS.md CONTINUE_WORK.md TASK_STATE.json index.html)

cd "$PROJECT_DIR"; mkdir -p "$OUT_DIR"

echo "== validation"
if command -v php >/dev/null 2>&1; then
  FAILED="$(find . -name '*.php' -not -path './node_modules/*' -print0 \
            | xargs -0 -n1 php -l | grep -v '^No syntax errors' || true)"
  [[ -z "$FAILED" ]] || { echo "FAILED php -l:"; echo "$FAILED"; exit 1; }
  echo "ok: php -l clean across $(find . -name '*.php' -not -path './node_modules/*' | wc -l) files"
else
  echo "skip: no php binary, structural check only"
fi
python3 tools/php_lint.py "$PROJECT_DIR" | tail -2
for f in assets/js/*.js; do node --check "$f" || { echo "FAIL $f"; exit 1; }; done
echo "ok: node --check passed for all frontend modules"
python3 tools/check_html_js.py "$PROJECT_DIR" | tail -1
python3 -c "import json;json.load(open('TASK_STATE.json'))" || { echo "FAILED: TASK_STATE.json"; exit 1; }
echo "ok: TASK_STATE.json parses"

for f in "${MANDATORY[@]}"; do [[ -s "$f" ]] || { echo "MISSING/EMPTY: $f"; exit 1; }; done
echo "ok: mandatory recovery files present"

# Live API suite, when a server is already up. RUNTIME_BASE=skip to opt out.
BASE="${RUNTIME_BASE:-http://127.0.0.1:8080}"
if [[ "$BASE" != "skip" ]] && curl -fsS -m 3 -o /dev/null "$BASE/api/auth/session.php" 2>/dev/null; then
  bash tools/runtime_tests.sh "$BASE" > /tmp/runtime_tests.out 2>&1 \
    && tail -2 /tmp/runtime_tests.out | tr -d '\033' \
    || { echo "FAILED runtime tests:"; grep FAIL /tmp/runtime_tests.out; exit 1; }
  echo "ok: runtime API suite passed against $BASE"
else
  echo "skip: no server on $BASE, runtime API suite not run"
fi

echo "== packaging"
rm -f "$ZIP"
zip -qr "$ZIP" . -x '*.git/*' '*/node_modules/*' 'storage/logs/*' '*.DS_Store' 'config/config.local.php'
unzip -t "$ZIP" >/dev/null || { echo "FAILED: zip integrity"; exit 1; }
LISTING="$(unzip -l "$ZIP")"
for f in "${MANDATORY[@]}"; do printf '%s\n' "$LISTING" | grep -qE "(^| |/)$f$" || { echo "FAILED: $f not in archive"; exit 1; }; done
cp "$ZIP" "$LATEST"
echo "ok: $ZIP ($(du -h "$ZIP" | cut -f1), $(printf '%s\n' "$LISTING" | tail -1 | awk '{print $2}') files) verified; latest copy refreshed"
