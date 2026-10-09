<?php
declare(strict_types=1);

/**
 * Delete a saved grocery list. Idempotent, and deliberately harmless to money:
 * expenses created from that list earlier are ordinary transactions and stay.
 */

require_once __DIR__ . '/../../includes/api.php';

$uid = api_guard(['POST', 'DELETE']);
GroceryListRepo::delete($uid, api_id());
Response::noContent();
