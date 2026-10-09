<?php
declare(strict_types=1);

/** Remove a grocery item, checked or not. */

require_once __DIR__ . '/../../includes/api.php';

$uid = api_guard(['POST', 'DELETE']);
GroceryRepo::delete($uid, api_id());
Response::noContent();
