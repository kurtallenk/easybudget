<?php
declare(strict_types=1);

/** The whole dashboard in one round trip. */

require_once __DIR__ . '/../../includes/api.php';

$uid = api_guard(['GET']);
Response::ok(Reports::dashboard($uid, Request::query('month'), Request::queryInt('months', 6, 1, 36)));
