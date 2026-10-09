<?php
declare(strict_types=1);

/** Create a bill. */

require_once __DIR__ . '/../../includes/api.php';

$uid = api_guard(['POST']);

$clean = (new Validator(Request::body()))
    ->required('name', 'amount', 'dueDate')
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

Response::created(BillRepo::create($uid, $clean));
