<?php
declare(strict_types=1);

/** Recurring rules plus the projected monthly load. */

require_once __DIR__ . '/../../includes/api.php';

$uid = api_guard(['GET']);

Response::ok(RecurringRepo::all($uid), [
    'outlook' => Reports::recurringOutlook($uid, Request::queryInt('days', 45, 1, 365)),
    'due'     => RecurringEngine::preview($uid),
]);
