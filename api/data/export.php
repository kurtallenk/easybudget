<?php
declare(strict_types=1);

/** Full dataset for the JSON backup in Settings. */

require_once __DIR__ . '/../../includes/api.php';

$uid = api_guard(['GET']);
Response::ok(DataRepo::export($uid));
