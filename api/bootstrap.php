<?php
declare(strict_types=1);

/** Hydration endpoint: everything the SPA needs for its first paint, in one request. */

require_once __DIR__ . '/../includes/api.php';

$uid = api_guard(['GET']);

SettingsRepo::ensure($uid);
$history = TransactionRepo::hydrationWindow($uid);

Response::ok([
    'user'         => Auth::user($uid),
    'csrfToken'    => (function_exists('api_csrf_token') ? api_csrf_token() : Csrf::token()),
    'settings'     => SettingsRepo::get($uid),
    'categories'   => CategoryRepo::all($uid),
    'accounts'     => AccountRepo::all($uid),
    'budgets'      => BudgetRepo::all($uid),
    'goals'        => GoalRepo::all($uid),
    'bills'        => BillRepo::all($uid),
    'recurring'    => RecurringRepo::all($uid),
    'grocery'      => GroceryRepo::all($uid),
    'groceryLists' => GroceryListRepo::all($uid),
    'savedBudgets' => SavedBudgetRepo::all($uid),
    'transactions' => $history['rows'],
    'reference'    => [
        'accountTypes'   => Defaults::ACCOUNT_TYPES,
        'paymentMethods' => Defaults::PAYMENT_METHODS,
        'frequencies'    => Defaults::FREQUENCIES,
        'billRepeats'    => Defaults::BILL_REPEATS,
        'currencies'     => Defaults::CURRENCIES,
        'dateFormats'    => Defaults::DATE_FORMATS,
    ],
], [
    'hydration' => [
        'from'      => $history['from'],
        'count'     => count($history['rows']),
        'total'     => $history['total'],
        'truncated' => $history['truncated'],
        'months'    => (int) Config::get('limits.hydration_months', 18),
        'cap'       => (int) Config::get('limits.hydration_cap', 5000),
    ],
    'serverTime' => Dates::today(),
]);
