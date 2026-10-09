<?php
declare(strict_types=1);

/** Update a recurring rule. */

require_once __DIR__ . '/../../includes/api.php';

$uid = api_guard(['POST']);
$id  = api_id();

$clean = (new Validator(Request::body()))
    ->string('name', 80)
    ->enum('type', ['income', 'expense'])
    ->amount('amount')
    ->nullableId('categoryId')
    ->nullableId('accountId')
    ->enum('method', Defaults::PAYMENT_METHODS)
    ->enum('frequency', Defaults::FREQUENCIES)
    ->date('nextDate')
    ->nullableDate('endDate')
    ->bool('autoPost')
    ->bool('paused')
    ->nullableString('notes', 300)
    ->values();

Response::ok(RecurringRepo::update($uid, $id, $clean));
