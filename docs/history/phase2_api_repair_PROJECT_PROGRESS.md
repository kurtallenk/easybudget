# Easy Budget Planner: Phase 2 API Repair, Project Progress

## Current status
- Current phase: **Phase 5: Final Verification (complete). Repair finished locally; waiting for deployment to the live host.**
- Final ZIP: `easybudgetplanner_phase2_api_repair_final.zip`. Upload package: `easybudgetplanner_phase2_api_repair_DEPLOY.zip`. APK: `android/apk/EasyBudgetPlanner-1.0.1-debug.apk`.
- Checkpoints: `..._checkpoint0_baseline.zip`, `..._checkpoint1_rca.zip`, `..._checkpoint2_backend.zip`, `..._checkpoint3_android.zip`, `..._checkpoint4_testing.zip`, `..._final.zip`,
  plus `easybudgetplanner_phase2_api_repair_DEPLOY.zip` (flat upload package, no config file).

## Workspace layout (same inside every checkpoint ZIP)
| Path | What it is |
|---|---|
| `website/` | PHP + JS website; contents go into the host's `htdocs/`. Phase 1 baseline + repaired Phase 2 API. |
| `android/` | Android Studio project. |
| `PROJECT_PROGRESS.md`, `CONTINUE_WORK.md`, `TASK_STATE.json` | Checkpoint files (also copied into `website/`). |
| `website/docs/ROOT_CAUSE_ANALYSIS.md` | Full root cause analysis with reproduction tables. |
| `website/docs/DEPLOY_PHASE2_REPAIR.md` | Step-by-step deployment for InfinityFree. |
| `website/tools/repair-tests/` | Test harness + logs of the last full run. |
| `website/docs/history/` | Progress files from the earlier Phase 1 / Phase 2 deliveries. |

## Root causes (detail: `website/docs/ROOT_CAUSE_ANALYSIS.md`)
- **RC1** Phase 2 changed shared core files (`Session.php`, `Request.php`, `api.php`, `session.php`) to call new code. Any partial or mixed upload (made likely by the extra `easybudgetplanner/` folder in the Phase 2 ZIP) = PHP fatal in `api/auth/session.php` -> every user looks logged out; no CSRF token is issued -> web register/reset say "Your session expired". 7 of 15 simulated upload states broke the website.
- **RC2** Migration 010 (`api_tokens`) was mandatory and unchecked: without it website password reset = HTTP 500 and app sign-in = HTTP 500.
- **RC3** Live server = Phase 1 `api.php` + leftover Phase 2 `token.php`. App login gets HTML (404/302) -> "unexpected response"; app register/reset hit Phase 1 CSRF -> "Your session expired". Reproduced exactly.
- **RC4** (risk) app identified only by custom headers, which shared hosts may drop.
- Not causes: session cookie/storage/lifetime, config, schema (additive only). Phase 2 logic itself passes 117/117 when deployed completely with the migration.

## Fixes (Phase 2 of the repair)
- `includes/Request.php`, `includes/Session.php`: **byte-identical to Phase 1** (Phase 2 edits reverted). Session handling is exactly the baseline.
- `includes/ApiTokens.php`: Phase 2 token code + new `MobileApi` class (app detection by `X-EBP-Client` **or** User-Agent `EasyBudgetPlanner-Android*`; token from `Authorization`, `REDIRECT_HTTP_AUTHORIZATION`, `X-EBP-Token`, or `ebp_at` cookie for app requests only). Missing `api_tokens` table -> JSON 503 `service_unavailable` for the app, never a 500; `revokeAllForUser()`/`prune()` tolerate the missing table.
- `includes/api.php`: loads `ApiTokens.php` only if present; mobile branch in `api_guard()`/`api_public()` runs only when `MobileApi` is loaded and the request is from the app; website path identical to Phase 1. New helpers `api_is_mobile()`, `api_csrf_token()` (app gets `''`, no session started).
- `includes/Auth.php`: Phase 2 `loginForToken()` refactor kept; `ApiToken` use guarded with `class_exists`.
- `includes/AuthFlows.php`: reset revokes app tokens only if the module exists, tolerant of a missing table.
- `includes/Repositories.php`: Phase 2 one-line fix (account `type` omitted -> no 500).
- `api/auth/session.php`, `password.php`, `register.php`, `login.php`, `api/bootstrap.php`: mobile-aware, guarded with `function_exists`/`property_exists` so they work with any upload order.
- `api/auth/token.php`, `refresh.php`, `revoke.php`: Phase 2 endpoints using `api_is_mobile()`.
- `api/health.php` (new): deployment self-check (modules, endpoints, DB, `api_tokens` table, which app signals reached PHP). No secrets.
- `api/.htaccess`: Phase 2 `Authorization` pass-through.
- `database/migrations/010_api_tokens.sql` (+ `schema.sql`, `schema_fixed.sql`): additive `CREATE TABLE IF NOT EXISTS api_tokens`.
- Docs: Phase 2 docs + `DEPLOY_PHASE2_REPAIR.md`, `ROOT_CAUSE_ANALYSIS.md`.

## Fixes (Phase 3: Android, `android/`)
- `app/src/main/java/.../data/ApiClient.kt`: token also sent as cookie `ebp_at` (combined with the `__test` challenge cookie); 3xx answers -> "The server is not ready for the app yet. Please try again later." (was the generic "unexpected response"). Endpoints, request bodies, headers, token storage/refresh, JSON parsing were verified correct and left unchanged.
- `app/build.gradle.kts`: version 1.0.1 (versionCode 2). Base URL unchanged `https://easybudgetplanner.freedev.app/`, package `app.freedev.easybudgetplanner.debug` (debug).
- Tests: `ApiClientTest` updated for the cookie + new `signedOutCallsSendNoCookie`; `TestServer` uses the real UA prefix so the live tests also pass when headers are stripped.
- Built `EasyBudgetPlanner-1.0.1-debug.apk` (JDK 21, AGP 8.7.3, SDK 35), signature verified, no DB credentials inside.
- App flow traced: LoginScreen -> `BudgetApi.login` -> `POST api/auth/token.php` (`X-EBP-Client`, UA, JSON `{email,password,deviceName}`) -> `Auth::loginForToken` -> `api_tokens` -> `{ok,data:{user,tokens}}` -> `EncryptedTokenStore`; every call `Authorization`/`X-EBP-Token`/`ebp_at`; 401 `token_expired` -> `api/auth/refresh.php` once; logout -> `api/auth/revoke.php`.

## Database migration
Required for the app only: `010_api_tokens.sql`. Why: bearer tokens must be stored server-side (hashes) to be revocable.
Backward compatible: new empty table, no change to existing tables, idempotent, Phase 1 ignores it. Website works with or without it (tested).

## Tests performed (local: PHP 8.3.33, MariaDB 10.11, production-like DB without migration 010, then with it)
| Suite | Result |
|---|---|
| `repair_tests.py pre` (existing session kept, web register/verify/login/logout/change pw/forgot/reset, app register/forgot/resend, app login = clear 503, JSON-only errors) | 37/37 |
| `repair_tests.py post` (+ app login, session, bootstrap, write, invalid/expired token, refresh rotation, header-stripping fallbacks, browser cookie not accepted, change pw, revoke, re-login, reset revokes app, web+app same user) | 58/58 |
| `resilience.py` (website survives any single old/missing repaired file) | 10/10 |
| `tools/runtime_tests.sh` (existing web API) | 65/65 |
| `tools/auth_runtime_tests.py` (default rate limits) | 124/124 |
| `tools/admin_runtime_tests.sh` | 65/66 (known flaky "newest first" same-second ordering, pre-existing; 66/66 on previous run) |
| `tools/mobile_api_tests.py` | 117/117 |

### Android tests (Robolectric on JVM, no emulator: the sandbox has no KVM)
| Run | Result |
|---|---|
| All 43 tests (unit 7, ApiClient 14, HostChallenge 2, LiveApi 4 against the repaired PHP backend, launch 1, UI flows 10, responsive 6) | 43/43 |
| LiveApiTest + UiFlowTest through `infinityfree_proxy.py` (aes.js challenge on every new client, `Authorization`/`X-EBP-Client`/`X-EBP-Token` stripped, missing file -> 302 HTML, 419 -> 500) | 14/14 (one UI test timed out once under CPU load, passed on rerun both through the proxy and direct) |

### Phase 4 end-to-end (real headless Chromium + real PHP + MariaDB)
| Suite | Result |
|---|---|
| `ui_existing_session.js`: sign in on Phase 1 UI ("Keep me logged in"), switch the same browser to the repaired code: still on the dashboard, session + bootstrap OK, logout -> login page, login again via UI | 7/7 (screenshot `logs/existing_session_after_deploy.png`) |
| `tools/auth_ui_tests.js` (register, verify, login, forgot, reset pages; 8 viewports) | 178/178 |
| `tools/grocery-tests/e2e-real-server.js` (SPA against real server) | 47/47 |
| Website -> backend -> DB and App -> API -> backend -> DB -> API -> App | covered by `repair_tests.py` (95 checks), Android LiveApi/UiFlow (14) and the suites above |

### Phase 5 final verification
| Check | Result |
|---|---|
| Final re-run of all backend suites | repair pre 37/37, post 58/58, resilience 10/10, runtime 65/65, admin 66/66, mobile 117/117, auth 124/124 |
| Migration 010 on a copy of the Phase-1 DB, run twice: `CHECKSUM TABLE` of all 29 existing tables before/after | identical (only `schema_migrations` gained the `010_api_tokens` row) |
| Phase 1 baseline copy vs uploaded Phase 1 ZIP | identical (never modified) |
| Website UI/JS/pages/config vs Phase 1 | unchanged (`assets/`, `pages/`, `index.html`, `config/`, `includes/Session.php`, `includes/Request.php` byte-identical) |
| `php -l` on every PHP file | clean |
| Final ZIP extracted and re-verified | see CONTINUE_WORK.md |

## Not tested here (must be done after deployment)
- The real InfinityFree host (cannot deploy from here). Emulated instead: anti-bot challenge, stripped headers, 302 for missing files, 419->500. After upload, open `api/health.php` (all checks true).
- A physical phone / emulator (no KVM in the sandbox). Covered with Robolectric UI tests + the live API tests. Install the APK and run login, register, reset, logout on a real phone.
- Real email delivery (SMTP credentials are not configured in `config.local.php`; tests used the log mail driver). If SMTP is not set up on the live site, verification/reset emails are not sent: this is a pre-existing configuration gap, not part of this repair.

## Remaining work
- Deploy (see `website/docs/DEPLOY_PHASE2_REPAIR.md`) and run the post-deployment checks.

## Known issues / notes
- Real InfinityFree behaviour (header stripping, anti-bot challenge for POST) can only be confirmed after deployment: use `api/health.php` with the app's headers.
- InfinityFree turns HTTP 419 into 500 (observed live); the JSON body is intact, clients read the body.
- Pre-existing Phase 1 behaviour kept: a User-Agent change (browser update) signs that browser out once.
- `config/config.local.php` holds the live DB password; it is kept in the full project ZIP (as delivered) but excluded from the DEPLOY ZIP. Consider rotating it.
