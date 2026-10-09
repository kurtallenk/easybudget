# Authentication: email verification, forgot password, password reset

## Flows

**Registration**: `pages/register.html` -> `POST api/auth/register.php` creates the
account with `email_verified_at = NULL` and emails a confirmation link. The user is
**not** signed in. The page switches to "Check your inbox" with a Resend button.

**Verification**: the link opens `pages/verify-email.html?token=...`. The page removes the
token from the address bar and POSTs it (with CSRF) to `api/auth/verify-email.php`, so
link scanners that only fetch the URL cannot consume it. Results: `verified`,
`already_verified` (reused link for a confirmed address), `expired`, `invalid`. Expired
and invalid states show a resend form. Verification does not sign the user in.

**Login**: an unverified account with the correct password gets `403 email_unverified`
and the login page offers "Send a new verification link". Wrong password and unknown
email return the same `401` message.

**Forgot password**: "Forgot password?" on the login page -> `pages/forgot-password.html`
-> `POST api/auth/forgot-password.php`. The answer is identical for registered and
unknown addresses.

**Reset**: the email links to `pages/reset-password.html?token=...`. The page checks the
link with `api/auth/reset-check.php` (does not consume it), then submits
`{token, password, passwordConfirm}` to `api/auth/reset-password.php`. On success the
password is re-hashed, the token is burned, every session for the account is signed out
(`users.auth_version` is bumped), the address counts as verified, a "password changed"
notice is emailed, and the user is sent back to sign in.

## Endpoints (all `POST`, JSON, CSRF header required, same-origin)

| Endpoint | Body | Response `data` |
|---|---|---|
| `auth/register.php` | `email, password, passwordConfirm?, displayName?` | `201 {verificationRequired, email, csrfToken}` (same for duplicates) |
| `auth/resend-verification.php` | `email` | `{sent, message}` (generic) |
| `auth/verify-email.php` | `token` | `{status, message}` |
| `auth/login.php` | `email, password, remember?` | `{user, csrfToken}`; `403 email_unverified` |
| `auth/forgot-password.php` | `email` | `{sent, message}` (generic) |
| `auth/reset-check.php` | `token` | `{status: valid\|expired\|used\|invalid}` |
| `auth/reset-password.php` | `token, password, passwordConfirm` | `{reset, message}`; `410 token_expired\|token_used`, `400 token_invalid`, `422` validation |

`429 rate_limited` carries `details.retryAfter` (seconds).

## Tokens and expiry

- `auth_tokens` row per link: `selector` (16 random bytes, hex) + `validator_hash`
  (SHA-256 of 32 random bytes). The link carries `selector + validator` (96 hex chars);
  the database never holds a usable link.
- Verification links expire after **24 hours** (`AUTH_VERIFY_TTL`), reset links after
  **1 hour** (`AUTH_RESET_TTL`). Expiry is checked in SQL against `UTC_TIMESTAMP()`.
- Single use: an atomic `UPDATE ... WHERE used_at IS NULL`. Requesting a new link deletes
  the older unused ones. Used/expired rows are pruned after 7 days.

## Rate limits (rolling hour, stored in `login_attempts`)

- One auth email per address per **60 s** (`AUTH_EMAIL_COOLDOWN`), at most **3** per address
  (`AUTH_EMAIL_MAX_PER_ADDRESS`) and **10** per IP (`AUTH_EMAIL_MAX_PER_IP`), counted by the
  submitted address whether or not it exists, so limits do not reveal accounts.
- Existing limits remain: 5 sign-ups per IP per hour, 8 failed logins per email/IP per 15 min.

## Database changes

Migration `database/migrations/009_email_verification_password_reset.sql` (existing
databases only; `schema.sql` already contains it for fresh installs):

- `users.auth_version INT UNSIGNED DEFAULT 1`, `users.password_changed_at DATETIME NULL`
- `login_attempts.purpose` gains `'verify'`
- `auth_tokens` index on `expires_at`
- existing users are marked verified so nobody is locked out

```bash
mysqldump -u root -p budget_planner > backup.sql
mysql -u root -p budget_planner < database/migrations/009_email_verification_password_reset.sql
```

## Email / SMTP configuration

Set in `config/config.local.php` (`'mail' => [...]`, see the commented example there) or
as environment variables. Never commit real credentials.

| Setting | Env var | Default | Notes |
|---|---|---|---|
| `app.url` | `APP_URL` | (empty) | **Required in production.** Base for every email link, e.g. `https://easybudgetplanner.freedev.app`. Never taken from the request Host header outside development. |
| `mail.driver` | `MAIL_DRIVER` | `smtp` | `smtp`, `mail` (PHP `mail()`), or `log` (dev: writes `.eml` files to `storage/mail/`) |
| `mail.host` | `MAIL_HOST` | | e.g. `smtp.gmail.com`, `smtp-relay.brevo.com` |
| `mail.port` | `MAIL_PORT` | `587` | `587` with `tls`, `465` with `ssl` |
| `mail.encryption` | `MAIL_ENCRYPTION` | `tls` | `tls` (STARTTLS), `ssl` (implicit TLS), `none` |
| `mail.username` / `mail.password` | `MAIL_USERNAME` / `MAIL_PASSWORD` | | SMTP login (Gmail: an App Password) |
| `mail.from_address` / `mail.from_name` | `MAIL_FROM_ADDRESS` / `MAIL_FROM_NAME` | / `Easy Budget Planner` | Must be allowed by the SMTP provider |
| `mail.reply_to` | `MAIL_REPLY_TO` | | optional |
| `mail.verify_peer` | `MAIL_VERIFY_PEER` | `true` | keep `true` in production |
| `auth.require_verification` | `AUTH_REQUIRE_VERIFICATION` | `true` | `false` restores instant sign-in after registration |

If `smtp` is selected but `mail.host`/`mail.from_address` are empty, messages are written
to `storage/mail/` and `mail.not_configured` is logged, so nothing is silently dropped.
Failures are logged as `mail.send_failed` in `storage/logs/` (never the password).

**InfinityFree**: PHP `mail()` is not available on free hosting. Use `smtp` with an external
provider (Gmail App Password on port 587/tls or 465/ssl, Brevo, Mailjet, etc.). The SMTP
client is built in, so no Composer install is needed.

Emails are sent after the HTTP response is finished (`fastcgi_finish_request` /
`litespeed_finish_request` when available), so response time does not depend on whether an
email was sent.

## Testing email locally

```bash
tools/dev_server.sh                 # MAIL_DRIVER=log by default: emails land in storage/mail/*.eml
python3 tools/fake_smtp.py 2525 /tmp/mail   # optional: exercise the real SMTP client
MAIL_DRIVER=smtp MAIL_HOST=127.0.0.1 MAIL_PORT=2525 MAIL_ENCRYPTION=none \
  MAIL_FROM_ADDRESS=noreply@example.com tools/dev_server.sh
```

Test suites: `tools/auth_runtime_tests.py` (API, 124 checks) and `tools/auth_ui_tests.js`
(browser + responsive, 178 checks). See `docs/TESTING.md`.

## Mobile app sign-in (bearer tokens, round 12)

The Android app signs in with `auth/token.php` and receives an access token (1 hour) and a
rotating refresh token (60 days). Rules, endpoints and storage are documented in
`docs/API.md` ("Mobile clients"). Interaction with the flows above:

- Unverified accounts cannot get tokens (`403 email_unverified`); the app offers "Resend".
- Changing the password from the app revokes every token of the user and returns a new pair
  for the current device; web sessions are invalidated through `auth_version` as before.
- Completing a password reset (on the website) revokes every app token.
- Suspending a user blocks their tokens on the next request.

Migration `database/migrations/010_api_tokens.sql` creates `api_tokens`:

```bash
mysql -u root -p budget_planner < database/migrations/010_api_tokens.sql
```
