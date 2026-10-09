<?php
declare(strict_types=1);

/**
 * Rename, re-categorise, or mark a grocery item purchased / not purchased.
 *
 * `price` is the amount actually paid (minor units), collected by the purchase
 * dialogue. Marking an item purchased requires one; moving it back to the
 * active list clears it (see GroceryRepo::update).
 */

require_once __DIR__ . '/../../includes/api.php';

$uid = api_guard(['POST']);
$id  = api_id();

$clean = (new Validator(Request::body()))
    ->string('name', 120)
    ->nullableId('categoryId')
    ->nullableAmount('price')
    ->bool('checked')
    ->values();

Response::ok(GroceryRepo::update($uid, $id, $clean));
