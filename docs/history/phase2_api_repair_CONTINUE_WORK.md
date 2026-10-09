# Continue work: Easy Budget Planner Phase 2 API repair

## What is being fixed
Phase 2 (Android app API) broke the live website (users looked logged out, register/reset "session expired",
reset 500) and the app could not sign in / register / reset. Goal: repair on top of the Phase 1 baseline.

## Done
- Phase 0 baseline + diff, Phase 1 RCA (`website/docs/ROOT_CAUSE_ANALYSIS.md`), Phase 2 backend repair, Phase 3 Android repair (APK 1.0.1 built, 43/43 tests), all tested (see PROJECT_PROGRESS.md).

## Remaining (exact next steps)
1. (done) Phase 3 Android. Build: JDK 21 + Android SDK 35, `./gradlew assembleDebug testDebugUnitTest -Debp.testServer=http://127.0.0.1:PORT/ -Debp.mailDir=... -Debp.dbCli=...`.
2. (done) Phase 4 full E2E: all suites green (see PROJECT_PROGRESS.md).
3. (done) Phase 5 final verification + final ZIP + DEPLOY ZIP.
4. NEXT: deploy to InfinityFree following `website/docs/DEPLOY_PHASE2_REPAIR.md`, check `https://easybudgetplanner.freedev.app/api/health.php`,
   then test the APK on a real phone. If `request.tokenChannel` is `cookie` or `clientHeaderReceived` is false for the app, the host strips headers and the fallbacks are in use (expected to work).

## Architecture
- PHP 8.x, no framework. Every endpoint requires `includes/api.php` then calls `api_guard()` (signed-in) or `api_public()`.
- Website: PHP file sessions (`bp_session`), CSRF via `X-CSRF-Token` from `api/auth/session.php`. UNCHANGED from Phase 1.
- App: `api/auth/token.php` -> `{user, tokens{accessToken(1h), refreshToken(60d, rotating)}}`; requests carry
  `X-EBP-Client: android`, `Authorization: Bearer`, `X-EBP-Token` (and `ebp_at` cookie after Phase 3). `api/auth/refresh.php`,
  `api/auth/revoke.php`. Errors: `{ok:false,error:{code,message,details?}}`; `token_expired` -> refresh.
- All mobile code: `includes/ApiTokens.php` (`MobileApi`, `ApiToken`). Health: `GET api/health.php`.
- Host: InfinityFree, `https://easybudgetplanner.freedev.app`, anti-bot `__test` cookie (app solves it in `HostChallenge.kt`).

## Database
Production MySQL on InfinityFree. Only migration needed: `database/migrations/010_api_tokens.sql` (additive). Never import `schema.sql` into production.

## Testing
`website/tools/repair-tests/run_all.sh` (sandbox paths `/data/ebp/...`). Local MariaDB on port 3307 (user ebp/ebp).

## Do NOT change
- `includes/Session.php`, `includes/Request.php` (must stay identical to Phase 1), session cookie name/params.
- Never run tests with `website/config/config.local.php` present (live DB credentials).
- Never drop/reset tables. Make a checkpoint ZIP after every milestone.
