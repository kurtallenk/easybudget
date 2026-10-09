#!/usr/bin/env bash
# Runs the Live Grocery List tests in headless Chromium against the mock API
# in tools/grocery-tests/mock-api.js (no PHP or MySQL needed).
#
#   tools/grocery-tests/run.sh            # full suite + responsive modal pass
#
# The full suite runs once at a desktop viewport; the shared-modal geometry
# pass (?only=modals) then repeats at tablet, mobile and small-mobile sizes.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PORT="${PORT:-8731}"
python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$ROOT" >/dev/null 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null || true' EXIT
sleep 1

FAILED=0

run_pass () {  # $1 = window size, $2 = query string, $3 = label, $4 = extra chromium flags
  local out results
  # `timeout` turns a stalled pass into "DID NOT FINISH" instead of hanging the suite.
  out="$(timeout 300 chromium --headless --disable-gpu --no-sandbox --hide-scrollbars ${4:-}     --virtual-time-budget=180000 --window-size="$1"     --dump-dom "http://127.0.0.1:$PORT/tools/grocery-tests/runner.html$2" 2>/dev/null)"
  results="$(printf '%s\n' "$out" \
    | sed -n '/__RESULTS_START__/,/__RESULTS_END__/p' \
    | sed 's/&lt;/</g; s/&gt;/>/g; s/&quot;/"/g; s/&amp;/\&/g')"
  echo "======== $3 ($1) ========"
  if [ -z "$results" ]; then echo "TEST RUNNER DID NOT FINISH"; FAILED=1; return; fi
  printf '%s\n' "$results"
  printf '%s\n' "$results" | grep -qE '^[0-9]+ passed, 0 failed' || FAILED=1
}

run_pass "1280,900"  ""              "full suite · desktop"
run_pass "1280,900"  "?only=modals"  "modals · desktop"
run_pass "834,1112"  "?only=modals"  "modals · tablet"
run_pass "390,844"   "?only=modals"  "modals · mobile"
run_pass "320,568"   "?only=modals"  "modals · small mobile"
run_pass "1280,900"  "?only=budget"  "budget save/load/clear/preview"
run_pass "1280,900"  "?only=onboarding" "greeting/onboarding/tooltips · desktop"
run_pass "390,844"   "?only=onboarding" "greeting/onboarding/tooltips · mobile"
run_pass "320,568"   "?only=onboarding" "greeting/onboarding/tooltips · small mobile"
run_pass "1280,900"  "?only=inbox" "notifications inbox · desktop"
run_pass "390,844"   "?only=inbox" "notifications inbox · mobile"
run_pass "320,568"   "?only=inbox" "notifications inbox · small mobile"
run_pass "1280,900"  "?only=admin" "super admin · desktop"
run_pass "834,1112"  "?only=admin" "super admin · tablet"
run_pass "390,844"   "?only=admin" "super admin · mobile"
run_pass "320,568"   "?only=admin" "super admin · small mobile"
# Template passes use reduced motion: the Futuristic panel/chart animations stall
# Chromium's --virtual-time-budget clock. Animated mode is covered in real time by
# tools/grocery-tests/realtime.js (Playwright).
run_pass "1280,900"  "?only=template" "design templates + shell · desktop" "--force-prefers-reduced-motion"
run_pass "834,1112"  "?only=template" "design templates + shell · tablet" "--force-prefers-reduced-motion"
run_pass "390,844"   "?only=template" "design templates + shell · mobile" "--force-prefers-reduced-motion"
run_pass "1280,900"  "?only=rows"    "bills/recurring rows · desktop"
run_pass "834,1112"  "?only=rows"    "bills/recurring rows · tablet"
run_pass "390,844"   "?only=rows"    "bills/recurring rows · mobile"
run_pass "320,568"   "?only=rows"    "bills/recurring rows · small mobile"

[ "$FAILED" = 0 ] || { echo "SOME PASSES FAILED"; exit 1; }
echo "ALL PASSES OK"
