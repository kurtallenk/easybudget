<?php
declare(strict_types=1);

/** Income, expense and net per month, plus the cumulative curve. */

require_once __DIR__ . '/../../includes/api.php';

$uid    = api_guard(['GET']);
$month  = (string) Request::query('month', Dates::monthKey(Dates::today()));
$months = Request::queryInt('months', 6, 1, 36);

Response::ok([
    'series'     => Reports::series($uid, $month, $months),
    'cumulative' => Reports::cumulativeSavings($uid, $month, $months),
    'dailySpend' => Reports::dailySpend($uid, $month),
]);
