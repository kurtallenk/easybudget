<?php
declare(strict_types=1);

/** Update a bill. */

require_once __DIR__ . '/../../includes/api.php';

$uid = api_guard(['POST']);
$id  = api_id();

$clean = (new Validator(Request::body()))
    ->string('name', 80)
    ->amount('amount')
    ->date('dueDate')
    ->nullableId('categoryId')
    ->nullableId('accountId')
    ->enum('method', Defaults::PAYMENT_METHODS)
    ->enum('repeat', Defaults::BILL_REPEATS)
    ->nullableString('notes', 300)
    ->int('reminderDays', 0, 90)
    ->values();

Response::ok(BillRepo::update($uid, $id, $clean));
