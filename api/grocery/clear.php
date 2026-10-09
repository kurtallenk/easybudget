<?php
declare(strict_types=1);

/**
 * Clear the current grocery list: removes every item of the signed-in user's
 * working shopping session, purchased or not.
 *
 * Deliberately narrow. It does NOT touch saved grocery lists
 * (`grocery_lists`, `grocery_list_items`) or any `transactions`: expenses that
 * were already submitted are ordinary ledger rows and stay.
 */

require_once __DIR__ . '/../../includes/api.php';

$uid = api_guard(['POST', 'DELETE']);
Response::ok(['cleared' => GroceryRepo::clear($uid)]);
