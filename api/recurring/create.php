<?php
declare(strict_types=1);

/** Create a recurring rule. */

require_once __DIR__ . '/../../includes/api.php';

$uid = api_guard(['POST']);

$clean = (new Validator(Request::body()))
    ->required('name', 'amount', 'nextDate', 'accountId', 'categoryId')
    ->string('name', 80)
    ->enum('type', ['income', 'expense'])
    ->amount('amount')
    ->id('categoryId')
    ->id('accountId')
    ->enum('method', Defaults::PAYMENT_METHODS)
    ->enum('frequency', Defaults::FREQUENCIES)
    ->date('nextDate')
    ->nullableDate('endDate')
    ->bool('autoPost')
    ->bool('paused')
    ->nullableString('notes', 300)
    ->values();

Response::created(RecurringRepo::create($uid, $clean));
