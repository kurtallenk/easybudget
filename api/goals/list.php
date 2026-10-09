<?php
declare(strict_types=1);

/** List goals with progress. */

require_once __DIR__ . '/../../includes/api.php';

$uid = api_guard(['GET']);
Response::ok(Reports::goalProgress($uid));
