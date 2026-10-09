<?php
declare(strict_types=1);

/** Rename a saved grocery list and/or replace its items ("Save" over a loaded list). */

require_once __DIR__ . '/../../includes/api.php';

$uid = api_guard(['POST']);
$id  = api_id();

$clean = (new Validator(Request::body()))
    ->nullableString('name', 80)
    ->listOf('items', static function (Validator $row): array {
        return $row->required('name')->string('name', 120)->nullableId('categoryId')->values();
    }, 300)
    ->values();

Response::ok(GroceryListRepo::update($uid, $id, $clean));
