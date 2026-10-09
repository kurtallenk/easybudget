<?php
declare(strict_types=1);

/**
 * Load a saved grocery list into the working Live Grocery List.
 *
 * Body: { id, replace? }   replace defaults to true (start a fresh shopping run)
 * Items arrive unpurchased and without a price: loading a template never
 * creates an expense. Returns the rebuilt working list.
 */

require_once __DIR__ . '/../../includes/api.php';

$uid = api_guard(['POST']);
$id  = api_id();

$clean = (new Validator(Request::body()))->bool('replace')->values();

Response::ok(GroceryListRepo::load($uid, $id, $clean['replace'] ?? true));
