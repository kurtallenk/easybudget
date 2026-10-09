<?php
declare(strict_types=1);

/** Newest transactions for the dashboard. */

require_once __DIR__ . '/../../includes/api.php';

$uid = api_guard(['GET']);
Response::ok(TransactionRepo::recent($uid, Request::queryInt('limit', 10, 1, 100)));
