<?php
declare(strict_types=1);

/** Create a category. */

require_once __DIR__ . '/../../includes/api.php';

$uid = api_guard(['POST']);

$clean = (new Validator(Request::body()))
    ->required('name')
    ->string('name', 40)
    ->enum('kind', Defaults::CATEGORY_KINDS)
    ->hexColor('color')
    ->emoji('emoji')
    ->values();

Response::created(CategoryRepo::create($uid, $clean));
