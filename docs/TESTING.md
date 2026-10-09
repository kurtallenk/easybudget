# Testing

## What has actually been verified

Against PHP 8.5.9 (CLI, `pdo_mysql`) and MariaDB 10.5:

| Check | Tool | Result |
|---|---|---|
| PHP syntax, every file | `php -l` over all 72 PHP files | PASS - 0 failures |
| Schema executes | `mysql budget_planner < database/schema.sql` | PASS - 23 tables |
| Reference seed executes | `mysql budget_planner < database/seeds/001_reference_data.sql` | PASS - 9/6/8/6 rows |
| API behaviour over live HTTP | `tools/runtime_tests.sh` | PASS - 63 assertions, 0 failures |
| Frontend auth gate | headless Chromium on `index.html` | PASS - redirects to sign-in |
| No SQL call binds an unused placeholder | scan over every `Database::*` call | PASS |
| PHP structural sanity (delimiters, opening tag, no `?>`) | `python3 tools/php_lint.py .` | PASS |
| Every user-owned SQL statement carries `user_id` | static audit over the SQL literals | PASS |
| JavaScript syntax, all modules | `node --check assets/js/*.js` | PASS |
| JavaScript syntax, inline page scripts | `python3 tools/check_html_js.py .` | PASS |
| Recovery files present and `TASK_STATE.json` parses | `tools/milestone.sh` | PASS |
| ZIP integrity and contents | `tools/milestone.sh` | PASS |

## Round 11 - email verification, forgot password, password reset

Run against the dev server (`RELAX_THROTTLE=1 tools/dev_server.sh`, emails go to `storage/mail/`):

```bash
DB_CLI="mysql -u root -p... budget_planner" python3 tools/auth_runtime_tests.py http://127.0.0.1:8080
DB_CLI="mysql -u root -p... budget_planner" BASE=http://127.0.0.1:8080 SHOTS=/tmp/auth-shots \
  NODE_PATH=/path/to/node_modules node tools/auth_ui_tests.js
```

- `auth_runtime_tests.py` (124 checks): invalid email, weak password, mismatch, duplicate
  (generic answer, owner notified), unverified state, hashed token storage, verify /
  expired / invalid / reused links, resend + cooldown + old-link invalidation, login
  (verified, unverified, wrong password, unknown email, logout), protected endpoints,
  forgot password (valid, invalid format, unknown, identical answers, email content),
  reset (valid, expired, invalid, reused, mismatch, weak, same password), sessions
  signed out after reset/change, per-address cap, CSRF/origin on every new endpoint,
  session id rotation, email header injection.
- `auth_ui_tests.js` (178 checks): the same flows through the real pages, then every auth
  screen at 1440x900, 1280x720, 834x1112, 1112x834, 390x844, 320x568, 844x390 and
  568x320 for horizontal overflow and tap-target size.
- `tools/runtime_tests.sh` now confirms accounts through the emailed link before signing
  in; `admin_runtime_tests.sh` and `grocery-tests/e2e-real-server.js` mark test accounts
  verified by SQL.
- SMTP transport: `tools/fake_smtp.py` (STARTTLS + AUTH LOGIN, plain, bad certificate
  refused, connection refused handled).

## Round 10 - notification sync + Super Admin

- `tools/admin_runtime_tests.sh` (real PHP + MySQL/MariaDB, needs migration 008):
  `DB_CLI="mysql -u root -p… budget_planner" tools/admin_runtime_tests.sh http://127.0.0.1:8080`
  - 66 checks: DB-backed read state, second-device login, Mark all, logout/login, per-user
  isolation, every admin endpoint 403 for normal users / 401 signed out / 419 without CSRF /
  403 cross-origin, validation, delivery to all vs selected users, edit/delete, demotion.
- Browser: `tools/grocery-tests/run.sh` includes `?only=inbox` (server-backed state, legacy
  localStorage migration, rollback, offline fallback) and `?only=admin` at 4 sizes.

## Running the suite

```bash
# 1. database
mysql -u root -p budget_planner < database/schema.sql
mysql -u root -p budget_planner < database/seeds/001_reference_data.sql

# 2. app - loopback HTTP, relaxed sign-up throttle so the suite can create users
DB_PASSWORD=your-password RELAX_THROTTLE=1 tools/dev_server.sh 8080

# 3. tests
tools/runtime_tests.sh http://127.0.0.1:8080
```

The suite prints one line per assertion and exits non-zero if anything fails. It creates
two throwaway users per run (`alice<stamp>@example.com`, `bob<stamp>@example.com`) and
leaves them behind, so point it at a scratch database. Without `RELAX_THROTTLE=1` the
`register_max_per_ip` limit (5/hour) stops the third run.

### What the suite covers

CSRF and same-origin rejection · registration validation, duplicate email, and the
session that sign-up opens · default category provisioning · account and transaction
validation including transfers and negative amounts · balance arithmetic in minor units
· all seven report endpoints · budget lines · the goal double-count regression · bill
pay / unpay / re-pay and occurrence idempotency · recurring run idempotency · tenant
isolation with two users (404, never 403, on another user's ids) · the sign-out /
sign-in lifecycle · referential integrity across every delete path · the data tools.

### Still manual

The browser-side flows below are not automated; the headless check only confirms that
`index.html` redirects an anonymous visitor to the sign-in page.

## Manual smoke test

1. **Register** on `pages/register.html` → redirected to the app, 22 categories exist.
2. **Account** → create one with an opening balance; the dashboard net worth matches.
3. **Transaction** → add income and an expense; the month summary and balances move by
   the right amounts.
4. **Duplicate guard** → submit the same expense twice; the second attempt returns 409
   until `allowDuplicate` is sent.
5. **Transfer** → between two accounts; neither income nor expense changes, both
   balances do.
6. **Budget** → set a line, spend past it, confirm the state goes `ok → warn → over`.
7. **Bill** → pay one; the transaction appears, the due date rolls forward, and paying
   the same due date again returns 409. Unpay restores the previous due date and deletes
   the transaction.
8. **Goal** → contribute twice; the goal total equals the sum of contributions exactly
   once (this is the legacy double-count bug - watch it specifically).
9. **Recurring** → set a rule with a past next date, run it, then run it again
   immediately: the second run must post nothing.
10. **Reload** → everything survives; the browser's localStorage holds only the paint
    cache.
11. **Sign out** → the app redirects to login and `api/bootstrap.php` returns 401.

## Security checks to run by hand

- **Isolation:** with two accounts, take an id from user A and call every
  `update`/`delete`/`get` endpoint as user B. Every one must return 404.
- **CSRF:** repeat a write without `X-CSRF-Token` → 419.
- **Cross-origin:** send a write with a foreign `Origin` header → 403.
- **Throttle:** nine wrong passwords in a row → locked out.
- **Mass assignment:** send `user_id`, `is_sample` and a foreign `id` in an update body
  → all ignored.
- **SQL injection:** `sort=amount);DROP TABLE users;--` → falls back to the default
  sort, nothing breaks.
- **Body size:** post over 512 KB → 413.

## Concurrency checks

- Two browser tabs paying the same bill occurrence: exactly one transaction, the other
  gets 409.
- Two simultaneous `recurring/run.php` calls: the total posted count must equal the
  number of due occurrences, not double it.

## Live Grocery List and shared dialogs

`tools/grocery-tests/run.sh` runs the SPA in headless Chromium against a mock of the PHP API.
It executes the functional suite once at a desktop viewport and then repeats a shared-modal
geometry pass (`?only=modals`) at 1280x900, 834x1112, 390x844 and 320x568. The geometry pass
opens one dialog of every kind in the app and asserts that each is inside the viewport,
centred, above the backdrop, scrollable when tall, with reachable footer buttons, a dialog
role/accessible name, working Escape and backdrop close, and a locked background scroll.

A `?only=budget` pass (`tests-budget.js`) covers the Budget page end to end: saving a named
budget (default `budget-YYYY-MM-DD-HH-MM`), the Saved Budgets table columns, the read-only
Quick Preview (no inputs, Close / Load Budget only), loading with and without a confirmation,
Save / Save as New, deleting a template and clearing the working budget - including the proof
that saved budgets, expenses and other months are never touched.

The functional suite also covers the Saved Grocery List Quick Preview (`tests-preview.js`):
the Preview button, that clicking a saved list never loads it, every preview field, the
read-only guarantees and Load List going through the existing replace confirmation.

A fourth pass (`?only=rows`, `tests-rows.js`) runs at the same four sizes and covers the Bills
and Recurring action buttons: 12 bills and 12 recurring rules (several with very long names)
are rendered and every Mark paid / Undo / Edit / Delete / Pause-Resume button is checked for
viewport containment, containment inside its row, visibility, a >=34px touch target on small
screens, no overlap with the row text, no horizontal page or card overflow, the unchanged
desktop layout above 860px and the stacked action line below it.

## Suggested further automated coverage

`tools/runtime_tests.sh` covers the API end to end. Unit-level coverage is still worth
adding, in this order:

1. `Repositories.php` ownership: every method must refuse another user's id.
2. `RecurringEngine`: idempotency, the guard, and the schedule advancing exactly once.
3. `BillRepo::pay`/`unpay` round trip.
4. `GoalRepo` totals against the contribution ledger.
5. `Reports` figures against hand-computed fixtures.
6. `Validator` rejections for each field type.

## Round 12: mobile API and Android app (Phase 2)

Backend (dev server on port 8080, `MAIL_DRIVER=log`):

```bash
DB_CLI="mysql -u USER -pPASS budget_planner" python3 tools/mobile_api_tests.py   # 117/117
```

Covers app registration and verification, token login, unverified and wrong-password logins,
bearer access, forged/tampered tokens, refresh-token-as-access rejection, `X-EBP-Token` fallback,
every feature endpoint, IDOR (10 cross-user checks return 404), spoofed `user_id` ignored, expiry
(`token_expired`), refresh rotation and reuse detection, per-device revoke, password change and
reset revoking other devices, suspended users, and web sessions being unaffected.

Android (JDK 17, Android SDK 35; Robolectric, no emulator needed):

```bash
DB_CLI="..." SHOTS=/tmp/shots bash tools/android_tests.sh http://127.0.0.1:8080/   # 42/42
```

- Unit: money parsing/formatting, dates, validation, InfinityFree challenge solver (8).
- ApiClient with MockWebServer: headers, envelopes, refresh, sign-out, challenge retry (13).
- Live API against the dev server (4), launch test (1).
- UI flows against the dev server: sign in, register, forgot password, dashboard, transactions,
  budget, bills, recurring, grocery list, accounts and profile (10).
- Responsive screenshots, 6 sizes from 320x568 to 1280x800 landscape (6). PNGs go to `$SHOTS`.
  In these screenshots the grey bar at the top is the test host activity title, not part of the app.

Web regressions after the backend changes: runtime 65/65, admin 65/66 (known intermittent
ordering check), auth_runtime 124/124, auth_ui 178/178, e2e 47/47, grocery-tests 0 failed.
