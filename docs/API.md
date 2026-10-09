# API reference

Base path: `api/`. All requests and responses are JSON, UTF-8. The web app is same-origin
(cookie session + CSRF); the Android app uses bearer tokens (see "Mobile clients" below).

## Envelope

Success:

```json
{ "ok": true, "data": { }, "meta": { } }
```

Failure:

```json
{ "ok": false, "error": { "code": "validation_failed", "message": "Please check the highlighted fields.",
                          "details": { "fields": { "amount": "Please enter an amount greater than zero." } } } }
```

`message` is always safe to show a user. Driver text, stack traces and paths never
appear; they go to `storage/logs/`.

| Status | Code | Meaning |
|---|---|---|
| 400 | `bad_request`, `invalid_json` | Malformed request |
| 401 | `unauthenticated` | No session / no valid token - sign in again |
| 401 | `token_expired` | Mobile access token expired - call `auth/refresh.php`, then retry |
| 403 | `cross_origin`, `invalid_credentials`, `account_inactive`, `email_unverified` | Rejected |
| 410 | `token_expired`, `token_used` | Email link can no longer be used |
| 404 | `not_found` | Missing, or owned by someone else (never distinguished) |
| 405 | `method_not_allowed` | Wrong HTTP method |
| 409 | `duplicate_transaction`, `already_paid`, `rule_paused` | Conflict the client can resolve |
| 413 | `payload_too_large` | Body over `limits.max_body_bytes` |
| 419 | `csrf_failed` | Stale CSRF token - refresh |
| 422 | `validation_failed`, `limit_reached` | Field errors in `details.fields` |
| 500 | `server_error` | Logged; generic message returned |

## Conventions

- **Money** is an integer in minor units, in both directions.
- **Dates** are `YYYY-MM-DD`; months are `YYYY-MM`.
- **Writes** are `POST` (some deletes also accept `DELETE`) and must send
  `X-CSRF-Token`. Get the token from `GET api/auth/session.php` or `api/bootstrap.php`.
- **Identity** always comes from the session. A `user_id` in a request body is ignored.
- **Ids** in the path are passed as `?id=`; the endpoint validates the format.

## Mobile clients (Android app)

The Android app talks to the same endpoints with the same rules and the same database.
It never sees database credentials: it only knows the site URL.

- Send `X-EBP-Client: android` on every request. For such requests the API does not start a
  cookie session, does not set cookies, and skips the CSRF and Origin checks (they defend
  cookies, which a bearer client does not use). `csrfToken` is returned as `""`.
- Authenticate with `Authorization: Bearer <accessToken>`. Because some shared hosts drop that
  header, `X-EBP-Token: <accessToken>` is accepted too (`api/.htaccess` also forwards it).
- A request with a bearer token is authenticated only by the token; a cookie is ignored.

| Method | Path | Body | Response `data` |
|---|---|---|---|
| POST | `auth/token.php` | `email, password, deviceName?` | `{ user, tokens: { tokenType, accessToken, accessExpiresIn, refreshToken, refreshExpiresIn } }`. Same throttling, timing-safe check and `403 email_unverified` / `account_inactive` as `login.php`; wrong credentials are `401 invalid_credentials`. |
| POST | `auth/refresh.php` | `refreshToken` | `{ tokens }` - a new pair; the old refresh token is spent. |
| POST | `auth/revoke.php` | `refreshToken?` (+ bearer) | `{ revoked: true }` - sign out this device. Idempotent. |
| POST | `auth/password.php` | `currentPassword, newPassword` | `{ tokens }` - every other device is signed out; this one gets a fresh pair. |
| GET | `auth/session.php` | - | `{ authenticated, user }` for the bearer token (`401 token_expired` if it needs a refresh). |

`register.php`, `resend-verification.php`, `verify-email.php`, `forgot-password.php`,
`reset-check.php` and `reset-password.php` work unchanged for the app. The links in emails open
the website (`pages/verify-email.html`, `pages/reset-password.html`).

Token rules (`includes/ApiTokens.php`, table `api_tokens`, migration `010`):

- Format `ebp_` + 32 hex selector + 64 hex validator. Only `SHA-256(validator)` is stored; the
  selector finds the row, the hash is compared with `hash_equals`.
- Access tokens live 1 hour; refresh tokens 60 days and rotate on every use. Re-using a spent
  refresh token revokes the whole token family (theft detection).
- Every request re-checks the account: `status = 'active'`, email verified, and the token's
  `auth_version` equal to the user's. A password change or reset bumps `auth_version`
  and revokes all tokens; suspending the account blocks them immediately.
- Ownership is unchanged: every repository query is scoped by the token's user id, so ids of
  another user's rows answer `404` (covered by `tools/mobile_api_tests.py`).

## Endpoints

### Bootstrap

| Method | Path | Notes |
|---|---|---|
| GET | `bootstrap.php` | Settings, categories, accounts, budgets, goals, bills, recurring rules, bounded transaction history, CSRF token, reference lists. `meta.hydration` reports `from`, `count`, `total`, `truncated`. |

### Auth

| Method | Path | Notes |
|---|---|---|
| GET | `auth/session.php` | Works signed out; mints the CSRF token |
| POST | `auth/register.php` | `email`, `password`, `displayName?` |
| POST | `auth/login.php` | Throttled per email + IP |
| POST | `auth/logout.php` | Destroys the session |
| POST | `auth/password.php` | `currentPassword`, `newPassword`; rotates the session |

### Settings

`GET settings/get.php`, `POST settings/update.php`
(`currency`, `dateFormat`, `firstDayOfWeek`, `theme`, `brandHue`, `designTemplate` (modern|classic|minimal|futuristic - needs migrations 006 + 007; omitted until applied), `hideSampleBanner`, `onboarded`).

### Categories / Accounts

`list.php`, `create.php`, `update.php?id=`, `delete.php`.
A category still used by a transaction is archived instead of deleted
(`{"archived": true}` in the response). `accounts/list.php` includes each account's
computed `balance`; `accounts/delete.php` accepts `mode: "delete" | "keep"`.

### Transactions

| Method | Path | Notes |
|---|---|---|
| GET | `transactions/list.php` | `page`, `perPage`, `search`, `type`, `categoryId`, `accountId`, `goalId`, `billId`, `recurringId`, `month`, `from`, `to`, `minAmount`, `maxAmount`, `sort` (`date\|amount\|createdAt\|description\|type`), `dir`. Pagination in `meta`. |
| GET | `transactions/recent.php` | `limit` (default 10) |
| POST | `transactions/create.php` | 409 `duplicate_transaction` unless `allowDuplicate: true` |
| POST | `transactions/update.php?id=` | `recurringId`/`billId` are provenance and cannot be changed |
| POST/DELETE | `transactions/delete.php` | Unwinds a linked bill payment and goal contribution |

### Budgets

`list.php`, `get.php?month=`, `line.php` (amount `0` removes the line), `plan.php`
(`kind: income\|savings`, replaces the rows), `copy.php` (`from`, `to`), `delete.php`.

### Goals

`list.php` (includes progress), `create.php`, `update.php?id=`, `delete.php`,
`contribute.php`, `contributions.php?goalId=`, `uncontribute.php`.
`current` is derived from contributions and cannot be set directly. A contribution
becomes a transfer when the goal has its own account, otherwise an expense - pass
`categoryId` for that case.

### Grocery list (Live Grocery List)

All endpoints are session + CSRF guarded and scoped to the signed-in user. The list is also
returned by `bootstrap.php` as `grocery`.

| Endpoint | Method | Body / query | Result |
|---|---|---|---|
| `grocery/list.php` | GET | - | `[{ id, name, categoryId, price, checked, checkedAt, createdAt, updatedAt }]` |
| `grocery/create.php` | POST | `{ id?, name, categoryId?, checked? }` | `201` the item. `categoryId` must be an owned category of kind `expense` or `both`. |
| `grocery/update.php?id=` | POST | `{ name?, categoryId?, price?, checked? }` | the item. See the purchase rules below. |
| `grocery/delete.php?id=` | POST / DELETE | - | `204`. Idempotent. |
| `grocery/clear.php` | POST / DELETE | - | `{ cleared }` - empties the current shopping session |
| `grocery/submit.php` | POST | `{ accountId, date, method?, items: [{ id, categoryId?, amount? }] }` | `{ transactions, submitted }` |

**Clearing the list.** `clear.php` deletes every `grocery_items` row of the signed-in user,
purchased or not, and returns how many were removed. It is deliberately narrow: saved grocery
lists (`grocery_lists`, `grocery_list_items`) and `transactions` are never touched, so expenses
submitted earlier survive and templates can still be loaded. Idempotent.

**Purchase state and price.** `price` is the amount actually paid, in integer minor units, and
is collected by the "Get Item" price dialogue while shopping. `update.php` enforces:

- `checked: true` requires a `price` greater than zero (`422` with field `price` otherwise);
- `checked: false` clears the price - a stored price always belongs to a real purchase.

`submit.php` turns every **purchased** item into an ordinary `expense` through
`TransactionRepo::create` using that stored price, then deletes the item, all in one database
transaction. Nobody is asked for an amount twice: `amount` on a line is an optional override
kept for older clients. Submitting an item that is not purchased, or has no price, returns
`422` with field `items.N.amount`. Unpurchased items are left out by the SPA and stay on the
list for the next trip. Any failure rolls everything back, so the list is never lost. A retry or
second tab that submits already-submitted items receives `409 grocery_changed` rather than
duplicate expenses.

### Saved budgets (reusable budget templates)

Session + CSRF guarded and scoped to the signed-in user; also returned by `bootstrap.php` as
`savedBudgets`. A saved budget is a **plan snapshot** - the category allocations plus the
income and savings plan rows of a month - and never ledger data.

| Endpoint | Method | Body / query | Result |
|---|---|---|---|
| `saved-budgets/list.php` | GET | - | `[{ id, name, sourceMonth, lines: [{ id, categoryId, amount }], incomePlan, savingsPlan, total, createdAt, updatedAt }]` |
| `saved-budgets/create.php` | POST | `{ id?, name?, sourceMonth?, lines: [{ categoryId, amount }], incomePlan?, savingsPlan? }` | `201` the saved budget |
| `saved-budgets/update.php?id=` | POST / PATCH | `{ name?, sourceMonth?, lines?, incomePlan?, savingsPlan? }` | the saved budget. Sending `lines` replaces the whole snapshot ("Save" over a loaded budget). |
| `saved-budgets/delete.php?id=` | POST / DELETE | - | `204`. Idempotent. Months already loaded from it are kept. |
| `saved-budgets/load.php?id=` | POST | `{ month }` | `{ budget, savedBudgetId, name }` |

Amounts are minor units. Lines with no category or an amount `<= 0` are dropped, exactly as
the working budget drops them; a snapshot with no category at all is rejected (`422`, field
`lines`). An empty `name` falls back to `budget-YYYY-MM-DD-HH-MM`. `load.php` rewrites only
`budget_lines` and `budget_plan_lines` for the target month, in one transaction - it never
creates a transaction and never modifies the template. Clearing the working budget reuses the
existing `budgets/delete.php`. Per-user cap: `limits.max_saved_budgets`.

### Saved grocery lists (reusable templates)

Session + CSRF guarded and scoped to the signed-in user; also returned by `bootstrap.php` as
`groceryLists`. A saved list is a **shopping template** - what the user wants to buy - and is
never an expense record.

| Endpoint | Method | Body / query | Result |
|---|---|---|---|
| `grocery-lists/list.php` | GET | - | `[{ id, name, items: [{ id, name, categoryId }], createdAt, updatedAt }]` |
| `grocery-lists/create.php` | POST | `{ id?, name?, items: [{ name, categoryId? }] }` | `201` the saved list |
| `grocery-lists/update.php?id=` | POST | `{ name?, items? }` | the saved list. Sending `items` replaces them all ("Save" over a loaded list). |
| `grocery-lists/delete.php?id=` | POST / DELETE | - | `204`. Idempotent. Expenses created from the list earlier are kept. |
| `grocery-lists/load.php?id=` | POST | `{ replace? }` (default `true`) | `{ grocery, listId, name }` |

Only the item name and category are stored: a template has no price and no purchase state.
An empty `items` array is rejected (`422`, field `items`); an empty `name` falls back to
`grocery-list-YYYY-MM-DD-HH-MM`. `load.php` clears the working list (unless `replace:false`)
and recreates every item **unpurchased and without a price**, in one database transaction, so
loading a template never creates an expense. Per-user cap: `limits.max_grocery_lists`.

### Bills

`list.php`, `create.php`, `update.php?id=`, `delete.php`, `pay.php?id=`,
`unpay.php?id=`, `payments.php?billId=`.
`pay` records the occurrence, then advances a repeating bill's due date. Paying the same
due date twice returns 409 `already_paid`. `unpay` reverses the latest payment and
restores the due date it was paid against.

### Recurring

`list.php`, `create.php`, `update.php?id=`, `delete.php`, `pause.php?id=`,
`run.php` (optional `ruleId`, `asOf`, `autoOnly`), `preview.php`.
`run` is safe to retry: the unique key prevents a duplicate post, and the response
reports `posted`, `skipped` and `guardHit`.

### Reports

`dashboard.php`, `month.php`, `series.php`, `categories.php`, `budget.php`,
`networth.php`, `bills.php` - all accept `month=YYYY-MM` where relevant.

### Data

`data/counts.php`, `data/export.php`, `data/clear-sample.php`,
`data/reset.php` (requires `{"confirm": "RESET"}`).

### Notifications (Round 10)

- `GET notifications/list.php` - the signed-in user's inbox: static feed
  (`assets/data/announcements.json`) + Super Admin items, newest first. Each item:
  `{ id, source: feed|admin, kind, type, title, description, details, route, url, createdAt, read }`.
  `read` comes from the `notifications` table, so it is the same on every device.
- `POST notifications/read.php` - `{ "ids": ["…"] }` marks those items read,
  `{ "all": true }` marks everything read. Ids not in the caller's own inbox are ignored.
  Returns the inbox.

### Super Admin (Round 10) - `api_admin_guard()`: session + CSRF + origin + `users.role='super_admin'` re-read from the DB on every request; otherwise **403**

- `GET admin/overview.php` - `{ stats: {users, active, admins, messages, news}, posts: [...] }`
- `GET admin/users.php?q=` - user directory for the recipient picker (id, email, displayName,
  status, role, createdAt, lastLoginAt; never password data)
- `POST admin/posts/create.php`
  - message: `{ kind:"message", type: message|important|announcement, title (≤120), body (≤500), audience: all|selected, userIds: [ids] }`
  - news: `{ kind:"news", type: feature|update|announcement, title, body, details?, link? }` - always all users.
    `link` = an app page name (`goals`) or an `http(s)://` URL; anything else is a 422.
- `POST admin/posts/update.php` - `{ id, type?, title?, body?, details?, link? }` (recipients never change)
- `POST admin/posts/delete.php` - `{ id }`; removes it from every inbox.

## Not implemented yet

- **Backup import** and **sample-data seeding** have no endpoint. They need a bulk-write
  endpoint with its own validation and row caps. The client reports this clearly instead
  of failing silently.
- Email verification and password reset endpoints are documented in `docs/AUTH.md`.
