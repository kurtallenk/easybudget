<?php
declare(strict_types=1);

/** One month's budget. Returns null when the month has no budget yet. */

require_once __DIR__ . '/../../includes/api.php';

$uid   = api_guard(['GET']);
$month = Request::query('month', Dates::monthKey(Dates::today()));
Response::ok(BudgetRepo::forMonth($uid, (string) $month));
