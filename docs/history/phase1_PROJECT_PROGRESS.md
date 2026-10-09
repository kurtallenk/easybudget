# Easy Budget Planner: project progress

## Current status

**Phase 1 (web): email verification, forgot password and password reset. COMPLETE and tested.**

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
