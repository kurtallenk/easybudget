<?php
declare(strict_types=1);

/** The signed-in user's grocery list (checked and unchecked). */

require_once __DIR__ . '/../../includes/api.php';

$uid = api_guard(['GET']);
Response::ok(GroceryRepo::all($uid));
