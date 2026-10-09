<?php
declare(strict_types=1);

/** Create an account. */

require_once __DIR__ . '/../../includes/api.php';

$uid = api_guard(['POST']);

$clean = (new Validator(Request::body()))
    ->required('name')
    ->string('name', 60)
    ->enum('type', Defaults::ACCOUNT_TYPES)
    ->int('openingBalance', -999999999999, 999999999999)
    ->hexColor('color')
    ->nullableString('note', 200)
    ->values();

Response::created(AccountRepo::create($uid, $clean));
