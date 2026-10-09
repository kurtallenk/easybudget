#!/bin/bash
# Runs the Android unit, live-API, UI-flow and responsive screenshot tests
# (Robolectric, no emulator needed) against a local PHP dev server.
#   tools/android_tests.sh [server-url]
# Needs: JDK 17, Android SDK (ANDROID_HOME), the dev server running with
# MAIL_DRIVER=log and relaxed throttles, DB_CLI for the same database.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="${ANDROID_PROJECT:-$ROOT/../android/EasyBudgetPlanner}"
URL="${1:-http://127.0.0.1:8080/}"
cd "$APP"
./gradlew --no-daemon testDebugUnitTest \
  -Debp.testServer="$URL" \
  -Debp.mailDir="$ROOT/storage/mail" \
  -Debp.dbCli="${DB_CLI:-}" \
  -Debp.shotsDir="${SHOTS:-$APP/app/build/screenshots}" "${@:2}"
