# Audit of the original `budget-planner.html`

3,348 lines, 227 KB, one file. Everything below was read out of the source, not assumed.

## 1. File layout

| Region | Lines |
|---|---|
| `<head>` + `<style>` | 1-448 (style block 11-447) |
| `<body>` | 449-451 (a `<noscript>` only - the UI is rendered entirely by JS) |
| `<script>` | 452-3346 (body 453-3345) |

The script holds nine IIFE modules, split 1:1 into `assets/js/`:

| Module | Lines | Responsibility |
|---|---|---|
| Core | 453-650 | money, dates, formatting, DOM helpers, icons, currency table |
| Store | 651-1177 | localStorage document, CRUD, sample data, change bus |
| Compute | 1178-1448 | balances, budget performance, analytics aggregates |
| Charts | 1449-1703 | hand-rolled SVG charts |
| UI | 1704-1855 | toasts, modals, confirm dialogs |
| Forms | 1856-2169 | form builders for every entity |
| ViewsA | 2170-2567 | dashboard, transactions, budget |
| ViewsB | 2568-3014 | accounts, goals, bills, recurring, analytics, settings |
| App | 3015-3345 | router, layout, boot |

## 2. Data model (localStorage key `budgetplanner.v1`, VERSION 1)

These camelCase shapes are the API contract: the server returns exactly these keys so
no view code has to change.

```
settings    { currency, dateFormat, firstDayOfWeek, theme, brandHue, hideSampleBanner, onboarded }
categories  { id, name, kind(income|expense|both), color, emoji, system, archived }
accounts    { id, name, type, openingBalance, color, note, archived, sample, createdAt }
transactions{ id, type(income|expense|transfer), amount, description, categoryId, date,
              accountId, toAccountId, method, notes, recurringId, billId, goalId,
              sample, createdAt, updatedAt }
budgets     { id, month, lines[{ id, categoryId, amount }],
              incomePlan[{ id, label, amount }], savingsPlan[...], createdAt }
goals       { id, name, target, current, targetDate, accountId, description, emoji,
              color, archived, sample, createdAt }
recurring   { id, name, type, amount, categoryId, accountId, method, frequency,
              nextDate, endDate, autoPost, paused, notes, lastPosted, sample, createdAt }
bills       { id, name, amount, dueDate, categoryId, accountId, method, repeat, notes,
              paidOn, paidTxId, sample, createdAt }
```

Amounts are already integer minor units in the original (`Core.toMinor`), which is why
the database can store `BIGINT` without converting any existing behaviour.

## 3. Reference constants

- Account types: `cash, bank, ewallet, savings, credit, other`
- Payment methods: Cash, Debit Card, Credit Card, Bank Transfer, E-Wallet, Cheque, Auto-Debit, Other
- Frequencies: `daily, weekly, biweekly, monthly, quarterly, yearly` (bills additionally allow `once`)
- Default categories: 22 (7 income, 15 expense)
- Currencies: PHP (default), USD, EUR, GBP, JPY, SGD, AUD, CAD, INR

All are reproduced verbatim in `includes/Defaults.php` and `database/seeds/001_reference_data.sql`.

## 4. Routes

`dashboard, transactions, budget, accounts, goals, bills, recurring, analytics, summary, settings`.
`App.boot()` is currently synchronous; it must become async to await hydration and to
apply the auth gate.

## 5. Pre-existing bugs found (fixed server-side, deliberately)

1. **`Store.contributeGoal` double counts.** It creates a transaction *and* increments
   `goal.current`, so a contribution shows up twice in reporting. The server makes
   `goal_contributions` the single source of truth and recalculates
   `savings_goals.current_amount` from `SUM(amount)`.
2. **`Store.payBill` rollover drift.** For an unrecognised `repeat` value the helper
   returned the same date, so paying a bill could leave it due on the day it was paid.
   `Dates::advance()` falls back to monthly and the `(user_id, bill_id, due_date)`
   unique key stops a duplicate occurrence being recorded.

## 6. Known limitations carried forward

- **JPY minor unit.** The frontend divides every currency by 100. `currencies.minor_unit`
  for JPY is therefore seeded as 2, not 0, to preserve existing behaviour. Changing it
  requires a frontend change plus a data migration.
- **Client-generated ids.** Ids stay `VARCHAR(40)` strings created by the browser, which
  avoids rewriting every foreign-key reference in the view layer. Collisions are scoped
  per user by the composite primary key.
