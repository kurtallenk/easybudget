<?php
declare(strict_types=1);

/** Category breakdown for a month, and an optional multi-category trend. */

require_once __DIR__ . '/../../includes/api.php';

$uid   = api_guard(['GET']);
$month = (string) Request::query('month', Dates::monthKey(Dates::today()));
$type  = (string) Request::query('type', 'expense');

$ids   = array_filter(explode(',', (string) Request::query('ids', '')));
$trend = $ids === []
    ? []
    : Reports::categoryTrend($uid, $month, Request::queryInt('months', 6, 1, 36), array_values($ids));

Response::ok([
    'breakdown' => Reports::byCategory($uid, $month, $type, Request::queryInt('limit', 0, 0, 100)),
    'trend'     => $trend,
]);
