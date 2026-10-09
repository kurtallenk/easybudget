<?php
declare(strict_types=1);

/** Add an item to the grocery list. */

require_once __DIR__ . '/../../includes/api.php';

$uid = api_guard(['POST']);

$clean = (new Validator(Request::body()))
    ->required('name')
    ->id('id')
    ->string('name', 120)
    ->nullableId('categoryId')
    ->bool('checked')
    ->values();

Response::created(GroceryRepo::create($uid, $clean));
