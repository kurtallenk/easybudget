<?php
declare(strict_types=1);

/** Delete a category, or archive it when transactions still reference it. */

require_once __DIR__ . '/../../includes/api.php';

$uid = api_guard(['POST', 'DELETE']);
$id  = api_id();
Response::ok(CategoryRepo::delete($uid, $id));
