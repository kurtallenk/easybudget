<?php
declare(strict_types=1);

/** The signed-in user's inbox (feed + Super Admin items) with read state from the database. */

require_once __DIR__ . '/../../includes/api.php';

$uid = api_guard(['GET']);
Response::ok(NotificationRepo::all($uid));
