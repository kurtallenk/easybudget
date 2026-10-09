# Easy Budget Planner: project progress

## Current status

**Phase 1 (web): email verification, forgot password and password reset. COMPLETE and tested.**

**Phase 2 (native Android app): COMPLETE and tested.** Mobile API 117/117, Android tests 42/42,
debug APK built and verified. See "Phase 2" below.

Stack: native PHP 8.1+ (no framework, no Composer), PDO MySQL/MariaDB, vanilla JS SPA
(`index.html` + `assets/js/*`), standalone auth pages in `pages/`. Hosted on InfinityFree
(`config/config.local.php`). Sessions: hardened PHP sessions + per-session CSRF token.

## Phase 1 implemented

- Registration creates an **unverified** account, emails a single-use 24 h link, and does
  not sign the user in. Duplicate addresses get the same response (owner is emailed instead).
- `pages/verify-email.html` confirms the address (success, already confirmed, expired,
  invalid states, with resend form).
- Login blocks unverified accounts with a clear message and a resend button.
- Resend verification: new token, old token invalidated, 60 s cooldown, 3/hour per address,
  10/hour per IP, generic answer.
- Forgot password (`pages/forgot-password.html`, linked from login) and reset password
  (`pages/reset-password.html`) with requirements checklist, strength meter, show/hide,
  confirmation, expired/used/invalid link screens, success screen back to sign in.
- Reset: bcrypt (`password_hash`) re-hash, token burned, all sessions signed out
  (`users.auth_version`), "password changed" notice email.
- Password change (existing settings feature) now also signs out other sessions.
- Every authenticated request re-validates the account (active, verified, auth_version).
- Dependency-free mailer with SMTP (STARTTLS/SSL, AUTH LOGIN/PLAIN), `mail()` and dev `log`
  drivers; professional HTML + plain-text templates; mail sent after the response.
- Unified, responsive auth UI (`assets/css/auth.css`, `assets/js/auth.js`).
- Every em dash removed project-wide (also the one en dash in the pagination label).

## Files changed / added

Added: `includes/Mailer.php`, `includes/MailTemplates.php`, `includes/AuthFlows.php`,
`api/auth/{resend-verification,verify-email,forgot-password,reset-check,reset-password}.php`,
`pages/{verify-email,forgot-password,reset-password}.html`, `assets/css/auth.css`,
`assets/js/auth.js`, `database/migrations/009_email_verification_password_reset.sql`,
`docs/AUTH.md`, `tools/auth_runtime_tests.py`, `tools/auth_ui_tests.js`, `tools/fake_smtp.py`,
`storage/mail/` (dev outbox).

Changed: `includes/Auth.php`, `includes/Session.php`, `includes/api.php`,
`api/auth/{register,session}.php`, `pages/{login,register}.html`, `config/config.php`
(`auth` + `mail` sections), `config/config.local.php` (commented mail example),
`database/schema.sql`, `database/schema_fixed.sql`, `tools/dev_server.sh`,
`tools/runtime_tests.sh`, `tools/admin_runtime_tests.sh`,
`tools/grocery-tests/e2e-real-server.js`, docs (`API`, `INSTALL`, `SECURITY`, `TESTING`),
plus em dash cleanup across JS, CSS, PHP, SQL, docs and tools.

## Database changes

Migration 009 (fresh installs: already in `schema.sql`): `users.auth_version`,
`users.password_changed_at`, `login_attempts.purpose` + `'verify'`, `auth_tokens` expiry
index; existing users marked verified. Reuses existing `auth_tokens` and
`users.email_verified_at`. Tested on a copy of a pre-009 database (existing users sign in).

## Email configuration

`APP_URL` (required in production) + `MAIL_*` settings, see `docs/AUTH.md`. InfinityFree has
no `mail()`; configure an external SMTP provider in `config/config.local.php`.

## Tests (PHP 8.5.9 + MariaDB 10.5.29, headless Chromium)

| Suite | Result |
|---|---|
| `php -l` on every PHP file | clean |
| fresh `schema.sql` + seeds | loads |
| migration 009 on pre-existing DB | applies, existing users can log in |
| `tools/auth_runtime_tests.py` | 124 passed, 0 failed |
| `tools/auth_ui_tests.js` (flows + 8 viewports) | 178 passed, 0 failed |
| `tools/runtime_tests.sh` (existing API) | 65 passed, 0 failed |
| `tools/admin_runtime_tests.sh` | 66/66 (one pre-existing intermittent check, see below) |
| `tools/grocery-tests/e2e-real-server.js` | 47 passed, 0 failed |
| `tools/grocery-tests/run.sh` (SPA, all features, 4 sizes) | all passes 0 failed |
| SMTP transport vs `tools/fake_smtp.py` | STARTTLS+AUTH ok, plain ok, bad cert refused |

## Known issues

- `admin_runtime_tests.sh` "newest first" fails intermittently when two admin posts are
  created in the same second (ordering by `created_at` only). Pre-existing, unrelated.
- Real SMTP delivery depends on credentials the owner must add to `config.local.php`.
- `config/config.local.php` in the delivered ZIP contains the live database password, as
  it did in the uploaded ZIP. Keep the ZIP private and consider rotating that password.

## Phase 2: Android app (complete)

### Backend (mobile API)
- `database/migrations/010_api_tokens.sql` (table `api_tokens`; also in `schema.sql`/`schema_fixed.sql`).
- `includes/ApiTokens.php`: tokens `ebp_<selector>.<validator>`, only sha256 of validator stored,
  access 1 h, refresh 60 d rotating, refresh reuse revokes the whole family, every use re-checks
  user status, email verified and `auth_version`.
- `includes/Request.php`: `isApiClient()` (header `X-EBP-Client`), `bearerToken()` (Authorization,
  REDIRECT_HTTP_AUTHORIZATION, fallback `X-EBP-Token`). `api_guard` accepts bearer (no CSRF for bearer).
- New endpoints `api/auth/token.php`, `api/auth/refresh.php`, `api/auth/revoke.php`; `session.php`
  token-aware; `password.php` returns new tokens and signs out other devices; reset revokes all
  tokens; `api/.htaccess` passes the Authorization header.
- Fixed pre-existing 500 in `AccountRepo::create` when `type` was omitted.
- Docs: `docs/API.md`, `docs/AUTH.md`, `docs/INSTALL.md`, `docs/SECURITY.md`, `docs/ANDROID.md`, `docs/TESTING.md` (round 12).

### Android app (`EasyBudgetPlanner/`, delivered as a separate ZIP)
Kotlin + Jetpack Compose Material 3, AGP 8.7.3, Kotlin 2.0.21, compileSdk/targetSdk 35, minSdk 24,
applicationId `app.freedev.easybudgetplanner`. All features of the web app, encrypted token storage,
offline bar, duplicate-submit guards, validation, back handling, splash + adaptive icon, phone and
tablet layouts. Full details in the Android ZIP's own PROJECT_PROGRESS.md and `docs/ANDROID.md`.

### Tests (Phase 2)
- `tools/mobile_api_tests.py`: **117/117** (incl. 10 IDOR checks).
- Android `tools/android_tests.sh`: **42/42** (unit 8, ApiClient 13, live API 4, launch 1, UI flows 10, responsive screenshots 6).
- Web regression: runtime 65/65, admin 65/66 (known flaky), auth_runtime 124/124, auth_ui 178/178, e2e 47/47, grocery 0 failed.
- APK verified: label "Easy Budget Planner", no database host/user/password strings. Release R8 build succeeds. Em dash scan: 0.

### Phase 2 known issues
- Live server must get the Phase 2 PHP files, `api/.htaccess` and migration 010 before the app can sign in there.
- No emulator/physical device here (no KVM): UI tested with Robolectric only. Test on a real phone before publishing.
- Writes need a connection (no offline queue); data is read-only while offline.
- Release signing needs the owner's keystore (`keystore.properties`, not included).
