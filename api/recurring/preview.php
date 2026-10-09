<?php
declare(strict_types=1);

/** Count the occurrences a run would create, without writing anything. */

require_once __DIR__ . '/../../includes/api.php';

$uid = api_guard(['GET']);
Response::ok(RecurringEngine::preview($uid, Request::query('asOf'), Request::queryBool('autoOnly', false)));
