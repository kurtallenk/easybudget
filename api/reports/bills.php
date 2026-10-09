<?php
declare(strict_types=1);

/** Bill status buckets and the upcoming window. */

require_once __DIR__ . '/../../includes/api.php';

$uid = api_guard(['GET']);
Response::ok(Reports::billStatus($uid, Request::queryInt('days', 45, 1, 365)));
