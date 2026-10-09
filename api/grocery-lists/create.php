<?php
declare(strict_types=1);

/**
 * Save the current grocery list as a reusable template.
 *
 * Body: { id?, name?, items: [{ name, categoryId? }] }
 * Only what to buy is stored - no price, no purchase state. An empty name
 * falls back to grocery-list-YYYY-MM-DD-HH-MM; an empty list is rejected.
 */

require_once __DIR__ . '/../../includes/api.php';

$uid = api_guard(['POST']);

$clean = (new Validator(Request::body()))
    ->required('items')
    ->id('id')
    ->nullableString('name', 80)
    ->listOf('items', static function (Validator $row): array {
        return $row->required('name')->string('name', 120)->nullableId('categoryId')->values();
    }, 300)
    ->values();

Response::created(GroceryListRepo::create($uid, $clean));
