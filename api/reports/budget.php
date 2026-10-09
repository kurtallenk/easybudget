<?php
declare(strict_types=1);

/** Planned vs actual for a month. */

require_once __DIR__ . '/../../includes/api.php';

$uid = api_guard(['GET']);
Response::ok(Reports::budgetPerformance($uid, (string) Request::query('month', Dates::monthKey(Dates::today()))));
