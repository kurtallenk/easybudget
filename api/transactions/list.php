<?php
declare(strict_types=1);

/** Paginated, filtered transactions. The client never receives the whole ledger. */

require_once __DIR__ . '/../../includes/api.php';

$uid = api_guard(['GET']);
[$page, $perPage] = api_pagination();

$filters = [
    'search'      => Request::query('search'),
    'type'        => Request::query('type'),
    'categoryId'  => Request::query('categoryId'),
    'accountId'   => Request::query('accountId'),
    'goalId'      => Request::query('goalId'),
    'billId'      => Request::query('billId'),
    'recurringId' => Request::query('recurringId'),
    'month'       => Request::query('month'),
    'from'        => Request::query('from'),
    'to'          => Request::query('to'),
    'sort'        => Request::query('sort'),
    'dir'         => Request::query('dir'),
];

$min = Request::query('minAmount');
$max = Request::query('maxAmount');
if ($min !== null && preg_match('/^\d+$/', $min)) {
    $filters['minAmount'] = (int) $min;
}
if ($max !== null && preg_match('/^\d+$/', $max)) {
    $filters['maxAmount'] = (int) $max;
}

$result = TransactionRepo::paginate($uid, $filters, $page, $perPage);

Response::ok($result['rows'], [
    'page'    => $result['page'],
    'perPage' => $result['perPage'],
    'total'   => $result['total'],
    'pages'   => $result['pages'],
]);
