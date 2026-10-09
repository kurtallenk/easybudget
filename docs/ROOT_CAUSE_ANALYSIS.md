# Phase 2 API: root cause analysis (2026-10-05)

All findings below were reproduced locally (PHP 8.3 + MariaDB 10.11, Phase 1 database schema
without migration 010, same PHP session directory shared between versions) and/or observed on
the live server with harmless requests. Scripts: `tools/repair-tests/rca.py`, `tools/repair-tests/mixed.py`.

## Summary
The Phase 2 *logic* is sound: with every Phase 2 file deployed together AND migration 010 applied,
Phase 2's own mobile suite passes 117/117 and an existing Phase 1 browser session stays signed in.
What breaks production is how Phase 2 depends on being deployed perfectly:

| # | Root cause | Symptom it explains |
|---|---|---|
| RC1 | Phase 2 edits shared core files (`includes/Session.php`, `includes/Request.php`, `includes/api.php`, `api/auth/session.php`) so they call new code (`Request::isApiClient()`, `Request::bearerToken()`, class `ApiToken`). If those files are not all replaced in one go (partial upload, upload interrupted, files landing in the wrong folder because the Phase 2 ZIP has an extra top-level `easybudgetplanner/` folder, or a later partial restore of Phase 1), PHP dies with a fatal "undefined method/class" error. | `api/auth/session.php` answers HTTP 500, so the website treats every visitor as signed out ("existing users appear offline"). `Csrf::token()` dies inside the session probe, so no CSRF token is ever issued and web **registration / password reset** fail with "Your session expired. Please refresh the page and try again." When `api.php`/`Request.php`/`ApiTokens.php` are mismatched, *every* API call fails with 500 ("database stops working"). |
| RC2 | Migration 010 (`api_tokens` table) is mandatory for Phase 2 but nothing checks for it. `PasswordReset::complete()` calls `ApiToken::revokeAllForUser()` inside its transaction. | Without the table: **website password reset fails with HTTP 500** (and is rolled back); the app's sign-in (`api/auth/token.php`) fails with HTTP 500. |
| RC3 | The live server currently runs the Phase 1 `includes/api.php` (it still enforces CSRF for app requests) but also has the Phase 2 `api/auth/token.php` (left over after restoring Phase 1). With pure Phase 1, `token.php` does not exist and InfinityFree answers with a 302 redirect to an HTML 404 page. | App **login**: "The server sent an unexpected response" (HTML redirect instead of JSON; the app does not follow redirects). App **registration / password reset**: Phase 1 `api_public()` requires a browser CSRF token, so the app gets `csrf_failed` "Your session expired. Please refresh the page and try again." (Reproduced exactly: see table below.) |
| RC4 | The app is recognised only by the custom header `X-EBP-Client`, and its token only travels in `Authorization` / `X-EBP-Token`. Shared hosts can drop such headers (Phase 2's own `.htaccess` comment says so). This could not be verified on the live host without deploying, so it is a risk, not a proven cause. | Would produce the same `csrf_failed` / "Please sign in" errors even after a correct deployment. |

Not a cause (verified): session cookie name/params/lifetime/storage are identical in Phase 1 and Phase 2;
config files are byte-identical; the schema change is purely additive (`CREATE TABLE IF NOT EXISTS`);
no SQL file drops or truncates anything.

Pre-existing (Phase 1, unchanged, documented only): sessions are bound to the browser's User-Agent
(`Session::fingerprintMatches`). A browser update changes the User-Agent and signs that user out once.
Production logs show 15 such events before Phase 2 existed.

## Reproduction: Android requests against Phase 1 (what the live server runs)
| Request | Result | App shows |
|---|---|---|
| `POST api/auth/token.php` | 404 HTML (live: 302 to errors.infinityfree.net) | "The server sent an unexpected response. Please try again." |
| `POST api/auth/register.php` | 419 `csrf_failed` (live: HTTP 500 with the same JSON) | "Your session expired. Please refresh the page and try again." |
| `POST api/auth/forgot-password.php` | 419 `csrf_failed` | "Your session expired. Please refresh the page and try again." |

## Reproduction: partial deployments (existing logged-in web user)
| Deployed state | Existing session | Signed-in API call | Web registration |
|---|---|---|---|
| Phase 1 + Phase 2 `includes/api.php` | OUT (500) | 500 | 500 |
| Phase 1 + Phase 2 `includes/Session.php` | OUT (500) | 200 | 419 csrf_failed |
| Phase 1 + Phase 2 `api/auth/session.php` | OUT (500) | 200 | 419 csrf_failed |
| Phase 2 + Phase 1 `includes/api.php` | OUT (500) | 200 | 419 csrf_failed |
| Phase 2 + Phase 1 `includes/Request.php` | OUT (500) | 500 | 500 |
| Phase 2 without `includes/ApiTokens.php` | OUT (500) | 500 | 500 |
| Phase 2 complete, no migration 010 | stays in | 200 | 201 (but password reset 500, app login 500) |
| Phase 2 complete + migration 010 | stays in | 200 | 201 (mobile suite 117/117) |

## Repair strategy (Phase 2 of the repair)
1. Leave `includes/Session.php` and `includes/Request.php` byte-identical to Phase 1, and keep the web
   code path of `api_guard()`/`api_public()`/`session.php` identical to Phase 1. All mobile code lives
   in `includes/ApiTokens.php`; core files only call it after checking it is loaded.
2. Make missing migration 010 harmless for the website (reset/change password keep working) and give
   the app a clear JSON 503 instead of a 500.
3. Recognise the app by `X-EBP-Client` **or** its User-Agent, and accept its token from
   `Authorization`, `X-EBP-Token` or an `ebp_at` cookie (mobile requests only).
4. Add `api/health.php` so the deployment can be verified in one request.
5. Ship a flat deploy ZIP (no extra folder, no `config.local.php`) with an exact file list.
