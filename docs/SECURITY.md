# Security

What is implemented, and what is deliberately still open. Nothing here has been
penetration-tested; it has not even been executed. See "Verification status".

## Identity and isolation

- **Identity comes from the session only.** No endpoint reads `user_id` from a request
  body or query string. `api_guard()` returns the authenticated id and every repository
  method takes it as its first argument.
- **Ownership is structural.** User-owned tables use `PRIMARY KEY (user_id, id)`, and
  every statement carries `user_id = :uid` - including `UPDATE` and `DELETE`. A
  cross-tenant id therefore matches zero rows rather than someone else's row.
- **Missing and forbidden look identical.** `Auth::ownsOrFail()` throws 404, never 403,
  so the API never confirms that another user's id exists.

## Sessions

- Cookie is `HttpOnly`, `SameSite=Lax`, and `Secure` when `session.cookie_secure` is on.
- Absolute lifetime 12h, idle timeout 2h, session id rotated every 15 minutes and on
  login and password change.
- A fingerprint mismatch (user agent / IP class) destroys the session and forces a new
  sign-in.

## CSRF and origin

- Per-session token, submitted in `X-CSRF-Token` (a `csrf_token` body field is also
  accepted). Verified on every write, compared with `hash_equals`.
- Writes additionally require a same-origin `Origin`/`Referer` when one is present.
- `credentials: 'same-origin'` on the client; there is no CORS allowance at all.

## Passwords

- `password_hash()` with the configured algorithm, cost 12, rehashed on login when the
  parameters change.
- Minimum 10 characters, with the strength rules in `Auth::assertPasswordStrength()`.
- Login compares against a dummy hash when the account does not exist, so response time
  does not reveal which emails are registered.
- Failures are throttled per email + IP: 8 attempts in a 15-minute rolling window,
  15-minute lockout. Registration is capped at 5 per IP per hour.

## Input handling

- `Validator` is a whitelist: undeclared fields are dropped, which closes mass
  assignment.
- Bodies are capped at `limits.max_body_bytes` (512 KB) and JSON depth 32.
- Per-user row caps (`max_accounts`, `max_categories`, `max_goals`, `max_bills`,
  `max_recurring`) and an amount ceiling (`max_amount_minor`).
- Control characters are stripped from text; lengths are enforced in PHP as well as by
  the column types.

## SQL

- PDO with `ATTR_EMULATE_PREPARES => false`, so placeholders are real server-side
  parameters.
- **No client value is ever concatenated into SQL.** The only interpolated identifiers
  are table names taken from internal allow-lists (`Auth::OWNED_TABLES`,
  `DataRepo::PURGE_ORDER`, `Repo::assertUnderLimit`) and sort columns from
  `TransactionRepo::SORTS`. A sort key the client invents falls back to the default.
- `LIKE` search escapes `%`, `_` and `\` in the parameter.

## Output

- Security headers on every response: `nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy: same-origin`, COOP/CORP `same-origin`, a restrictive
  `Permissions-Policy`, and `Cache-Control: no-store`.
- `display_errors` is off; an unexpected throwable is logged and answered with a generic
  500. Debug details appear only when `app.debug` is on.
- The logger scrubs passwords, tokens and hashes before writing.

## Files

`config/`, `includes/`, `database/` and `storage/` each ship an `.htaccess` that denies
all access; `api/.htaccess` disables indexes and non-PHP files. On nginx these must be
reproduced in the server block - see `docs/INSTALL.md`.

## Roles / Super Admin (Round 10)

- One role column: `users.role` ENUM('user','super_admin'), default `user`. Promotion is SQL-only.
- `api_admin_guard()` (includes/api.php) = `api_guard()` + `Auth::requireSuperAdmin()`, which
  re-reads role **and** `status='active'` from the database on every request (demotion/suspension
  is immediate; nothing is cached in the session). It fails closed: a missing column or any error = 403.
  Denials are logged (`security.admin_denied`) and audited (`admin.denied`).
- Every file in `api/admin/` starts with `api_admin_guard()`; client-sent `role`/`isSuperAdmin`
  fields are never read. `isSuperAdmin` in the session payload only decides whether the menu is shown.
- Admin writes are audited (`admin.post_created|updated|deleted`). Recipients are re-validated
  against active users server-side. Admin text is rendered with `esc()`; links are limited to app
  page names or http(s) URLs and opened with `noopener,noreferrer`.
- Inbox read state is written only for ids that are in the caller's own inbox, keyed by the
  session user id, so one user can neither read nor create another user's deliveries.

## Email verification and password reset (round 11)

See `docs/AUTH.md`. Summary of the controls:

- Tokens: `random_bytes` selector + validator, only SHA-256(validator) stored, constant-time
  compare, expiry checked in SQL, atomic single use, older links revoked on re-issue.
- Token pages POST the token (CSRF-protected) and strip it from the address bar;
  `Referrer-Policy: no-referrer` on those pages.
- No enumeration: register, resend and forgot-password answer identically for known and
  unknown addresses, mail is sent after the response, and rate limits count the submitted
  address. Login reveals "unverified" only after a correct password.
- Every authenticated request re-checks the account (active, verified, `auth_version`).
  Password reset and password change bump `auth_version`, signing out all other sessions;
  suspended or deleted accounts lose their sessions on the next request.
- Email links use the configured `APP_URL` only (Host-header poisoning is not possible in
  production). Header values are stripped of CR/LF. Emails never contain passwords.

## Mobile API tokens (round 12)

- The Android app holds no database credentials or server secrets; it knows only the site URL
  (`BuildConfig.API_BASE_URL`). All data access goes through the same PHP endpoints, so the same
  validation, ownership checks and limits apply.
- Bearer tokens (`api_tokens`): random 256-bit validators, stored as SHA-256 only, constant-time
  compare, 1 hour access / 60 day rotating refresh, family revocation on refresh reuse,
  re-validation of account status, verification and `auth_version` on every request.
- Requests marked `X-EBP-Client` never create or read cookie sessions, so CSRF does not apply;
  a bearer request ignores any cookie. Browser requests keep the full CSRF + Origin checks.
- On the device, tokens are kept in EncryptedSharedPreferences (AES-256-GCM, master key in the
  Android Keystore) and excluded from backups; release builds allow HTTPS only.

## Known gaps

| Gap | Impact | Suggested fix |
|---|---|---|
| No Content-Security-Policy header | XSS would be easier to exploit | Add a CSP; the app uses inline `<style>` on the auth pages, so start there |
| No rate limit on non-auth endpoints | A logged-in client could hammer the API | Add a per-user token bucket |
| Sample/import bulk writes missing | Feature gap, not a risk | Add a bulk endpoint with its own caps |
| No unit tests | Regressions inside a repository method are invisible until a route breaks | `tools/runtime_tests.sh` covers the API end to end (63 assertions); unit coverage is still pending. See `docs/TESTING.md` |
| CSRF token lives for the whole session | Slightly wider window if one leaks | Rotate on privilege change |

## Verification status

**Not verified by execution.** The environment used to write this code had no PHP binary
and no MySQL server. What was actually run: a structural PHP check
(`tools/php_lint.py`), a static audit confirming every user-owned SQL statement carries
`user_id`, `node --check` on all frontend modules and inline page scripts, and ZIP
integrity checks. No PHP has ever run, and no SQL has ever executed.
