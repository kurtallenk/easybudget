<?php
declare(strict_types=1);

/** Totals for one month. */

require_once __DIR__ . '/../../includes/api.php';

$uid = api_guard(['GET']);
Response::ok(Reports::monthTotals($uid, (string) Request::query('month', Dates::monthKey(Dates::today()))));
