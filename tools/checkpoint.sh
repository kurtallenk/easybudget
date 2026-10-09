#!/usr/bin/env bash
# ===========================================================================
# checkpoint.sh [milestone-name]
#
# Builds the recoverability bundle:
#   1. verifies the four mandatory recovery files exist and are non-empty
#   2. validates TASK_STATE.json actually parses
#   3. zips the COMPLETE project (not just changed files) to
#      /data/out/PROJECT_HANDOFF_LATEST.zip
#   4. re-opens the zip and verifies the mandatory files are inside it
#   5. optionally writes a milestone copy: PROJECT_<MILESTONE>.zip
#
# Exits non-zero if any step fails, so a broken checkpoint is never reported
# as a good one.
# ===========================================================================
set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-/data/budget-planner}"
OUT_DIR="${OUT_DIR:-/data/out}"
LATEST="$OUT_DIR/PROJECT_HANDOFF_LATEST.zip"
MILESTONE="${1:-}"

MANDATORY=(
  "PROJECT_PROGRESS.md"
  "TASK_STATE.json"
  "CONTINUE_WORK.md"
  "index.html"
)

echo "== checkpoint: $(date -u '+%Y-%m-%d %H:%M:%SZ')"
cd "$PROJECT_DIR"
mkdir -p "$OUT_DIR"

# ---- 1. mandatory files -----------------------------------------------------
fail=0
for f in "${MANDATORY[@]}"; do
  if [[ ! -s "$f" ]]; then
    echo "MISSING or EMPTY: $f"
    fail=1
  fi
done
[[ $fail -eq 0 ]] || { echo "FAILED: mandatory recovery files are incomplete"; exit 1; }

# ---- 2. TASK_STATE.json must parse -----------------------------------------
if ! python3 -c "import json,sys; json.load(open('TASK_STATE.json'))" 2>/dev/null; then
  echo "FAILED: TASK_STATE.json is not valid JSON"
  exit 1
fi
echo "ok: mandatory files present, TASK_STATE.json parses"

# ---- 3. build the full snapshot --------------------------------------------
rm -f "$LATEST"
zip -qr "$LATEST" . \
  -x '*.git/*' '*/node_modules/*' 'storage/logs/*' '*.DS_Store' 'config/config.local.php'
echo "ok: wrote $LATEST ($(du -h "$LATEST" | cut -f1), $(unzip -l "$LATEST" | tail -1 | awk '{print $2}') files)"

# ---- 4. verify the archive --------------------------------------------------
if ! unzip -t "$LATEST" >/dev/null; then
  echo "FAILED: zip integrity test did not pass"
  exit 1
fi
for f in "${MANDATORY[@]}"; do
  if ! unzip -Z1 "$LATEST" | grep -x -- "$f" >/dev/null; then
    echo "FAILED: $f is not inside the archive"
    exit 1
  fi
done
echo "ok: archive integrity verified, all mandatory files inside"

# ---- 5. milestone copy ------------------------------------------------------
if [[ -n "$MILESTONE" ]]; then
  SAFE=$(echo "$MILESTONE" | tr '[:lower:] ' '[:upper:]_' | tr -cd 'A-Z0-9_')
  cp "$LATEST" "$OUT_DIR/PROJECT_${SAFE}.zip"
  echo "ok: milestone copy $OUT_DIR/PROJECT_${SAFE}.zip"
fi

echo "== checkpoint complete"
