<?php
declare(strict_types=1);

/** Removes every row flagged as sample data. */

require_once __DIR__ . '/../../includes/api.php';

$uid = api_guard(['POST']);
Response::ok(DataRepo::clearSample($uid));
