<?php
declare(strict_types=1);

/** Row counts per entity, shown in Settings. */

require_once __DIR__ . '/../../includes/api.php';

$uid = api_guard(['GET']);
Response::ok(DataRepo::counts($uid));
