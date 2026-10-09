<?php
declare(strict_types=1);

/** Pay the current occurrence. Retrying returns 409 instead of paying twice. */

require_once __DIR__ . '/../../includes/api.php';

$uid = api_guard(['POST']);
$id  = api_id();

$clean = (new Validator(Request::body()))
    ->nullableId('accountId')
    ->nullableDate('date')
    ->values();

Response::created(BillRepo::pay($uid, $id, $clean));
