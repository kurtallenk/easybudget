<?php
declare(strict_types=1);

/** Set or clear one category line. An amount of zero removes the line. */

require_once __DIR__ . '/../../includes/api.php';

$uid = api_guard(['POST']);

$clean = (new Validator(Request::body()))
    ->required('month', 'categoryId')
    ->monthKey('month')
    ->id('categoryId')
    ->amount('amount', true)
    ->values();

Response::ok(BudgetRepo::setLine($uid, $clean['month'], $clean['categoryId'], (int) ($clean['amount'] ?? 0)));
