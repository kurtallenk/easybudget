<?php
declare(strict_types=1);

/** Copy one month's plan onto another month. */

require_once __DIR__ . '/../../includes/api.php';

$uid = api_guard(['POST']);

$clean = (new Validator(Request::body()))
    ->required('from', 'to')
    ->monthKey('from')
    ->monthKey('to')
    ->values();

Response::ok(BudgetRepo::copy($uid, $clean['from'], $clean['to']));
