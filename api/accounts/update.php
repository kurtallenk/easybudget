<?php
declare(strict_types=1);

/** Update an account. */

require_once __DIR__ . '/../../includes/api.php';

$uid = api_guard(['POST']);
$id  = api_id();

$clean = (new Validator(Request::body()))
    ->string('name', 60)
    ->enum('type', Defaults::ACCOUNT_TYPES)
    ->int('openingBalance', -999999999999, 999999999999)
    ->hexColor('color')
    ->nullableString('note', 200)
    ->bool('archived')
    ->values();

Response::ok(AccountRepo::update($uid, $id, $clean));
