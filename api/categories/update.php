<?php
declare(strict_types=1);

/** Update a category. */

require_once __DIR__ . '/../../includes/api.php';

$uid = api_guard(['POST']);
$id  = api_id();

$clean = (new Validator(Request::body()))
    ->string('name', 40)
    ->enum('kind', Defaults::CATEGORY_KINDS)
    ->hexColor('color')
    ->emoji('emoji')
    ->bool('archived')
    ->values();

Response::ok(CategoryRepo::update($uid, $id, $clean));
