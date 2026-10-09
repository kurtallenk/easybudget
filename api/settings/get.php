<?php
declare(strict_types=1);

/** Read the signed-in user's settings. */

require_once __DIR__ . '/../../includes/api.php';

$uid = api_guard(['GET']);
Response::ok(SettingsRepo::get($uid));
