# Architecture

Budget Planner is a single-page app served as static files, talking to a small PHP
JSON API over the same origin, backed by MySQL.

```
browser                         server (PHP 8.1+)                MySQL 8.0+
────────                        ─────────────────                ──────────
index.html                      api/*.php          ── thin endpoints
 ├─ assets/js/core.js            └─ includes/api.php  guard + error envelope
 ├─ assets/js/api.js  ──fetch──▶     ├─ Request / Validator
 ├─ assets/js/store.js               ├─ Session / Csrf / Auth
 ├─ assets/js/compute.js             ├─ Repositories.php ──PDO──▶ tables
 ├─ assets/js/charts.js              ├─ Reports.php
 ├─ assets/js/ui|forms|views-*       ├─ RecurringEngine.php
 └─ assets/js/app.js                 └─ Response
```

## Request path

Every endpoint is the same five steps:

1. `api_guard([...])` - method allow-list, session start, same-origin check, CSRF
   verification, authentication. Returns the authenticated `user_id`.
2. `Validator` - a whitelist of accepted fields. Anything else in the body is dropped,
   which closes mass assignment: a client cannot smuggle `user_id`, `is_sample` or a
   foreign `id` into an update.
3. A repository or report call, scoped by that `user_id`.
4. `Response::ok()` / `created()` / `noContent()`.
5. Anything thrown becomes the standard error envelope through the handler registered
   in `includes/api.php`. An endpoint never needs its own try/catch.

## Layers

| Layer | Files | Rule |
|---|---|---|
| Endpoints | `api/**.php` | No SQL, no business rules. Guard, validate, delegate, respond. |
| Repositories | `includes/Repositories.php` | The only place that writes SQL for user data. |
| Reports | `includes/Reports.php` | Read-only aggregates, computed in SQL. |
| Recurring | `includes/RecurringEngine.php` | Transactional, guarded, idempotent posting. |
| Infrastructure | `Support`, `Database`, `Request`, `Response`, `Validator`, `Session`, `Auth`, `Defaults` | Cross-cutting concerns. |

## Data model notes

- **Money is always an integer in minor units** (`BIGINT`). Never `FLOAT`, never
  `DECIMAL`. ₱1,250.75 is `125075`.
- **Composite ownership keys.** User-owned rows use `PRIMARY KEY (user_id, id)` and keep
  the client-generated string id from the original SPA. Two users can hold the same id
  without colliding and every lookup is naturally scoped to its owner, which makes IDOR
  a structural impossibility rather than something each query must remember.
- **Idempotency keys.** `uq_tx_recurring_day (user_id, recurring_id, tx_date)` and
  `uq_bill_occurrence (user_id, bill_id, due_date)` are the real duplicate protection;
  application checks are only an optimisation.
- **Derived values.** `savings_goals.current_amount` is recalculated from
  `SUM(goal_contributions.amount)`; it is never incremented in place.

## Frontend

`assets/js/store.js` presents the same surface the original localStorage store did, so
the views, forms and the `Compute` module did not change. Writes are optimistic: the
document is updated and emitted at once, the API call follows on a serialised queue, and
a failure rolls back, resyncs and reports. `Compute` still runs client-side over the
hydrated document; `Reports.php` provides the same figures for months outside the
hydration window and for the one-request dashboard bundle.

`api/bootstrap.php` hydrates 18 months of transactions capped at 5,000 rows
(`limits.hydration_months`, `limits.hydration_cap`). The `meta.hydration` block reports
`truncated`, so the UI can page older data through `api/transactions/list.php`.

## Deliberate deviations from the original SPA

1. Goal contributions are a ledger; the goal total is derived. The original created a
   transaction *and* incremented the goal, double counting every contribution.
2. An unknown bill repeat value falls back to monthly. The original returned the same
   date, so paying a bill could leave it due on the day it was paid.
3. Posting recurring transactions happens on the server, because only the server can
   make it transactional and idempotent.

## Deleting rows, and why the foreign keys are RESTRICT

Every user-owned table is keyed on `(user_id, id)`, so the child foreign keys are
composite: `(user_id, category_id) REFERENCES categories (user_id, id)`. MySQL cannot
`ON DELETE SET NULL` such a key, because `user_id` is `NOT NULL` on the child side - it
rejects the table outright with errno 150. The constraints are therefore
`ON DELETE RESTRICT`, and each repository clears the references it owns inside the same
transaction as the delete:

| Deleting | Detached first |
|---|---|
| Category (hard delete, only when unused) | `bills.category_id`, `recurring_transactions.category_id`, `transaction_splits.category_id`; budget lines are removed |
| Account, `mode=keep` | transfers that touched it are deleted (`ck_tx_transfer` needs both legs); `transactions.account_id`/`to_account_id`, `bills.account_id`, `recurring_transactions.account_id`, `savings_goals.account_id` are nulled |
| Account, `mode=delete` | bill occurrences and goal contributions that point at the doomed transactions are released or removed, affected goals are recalculated, then the transactions go |
| Transaction | its goal contribution is removed and the goal recalculated; the bill occurrence is released and the bill returns to unpaid |
| Bill | `transactions.bill_id`; `bill_payments` cascade |
| Recurring rule | `transactions.recurring_id` |
| Goal | `transactions.goal_id`; `goal_contributions` cascade |

A category that is still referenced by a transaction is archived rather than deleted, so
historical rows keep their label.
