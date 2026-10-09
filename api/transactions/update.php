<?php
declare(strict_types=1);

/** Update a transaction. recurringId and billId are provenance and stay fixed. */

require_once __DIR__ . '/../../includes/api.php';

$uid = api_guard(['POST']);
$id  = api_id();

$clean = (new Validator(Request::body()))
    ->enum('type', Defaults::TX_TYPES)
    ->amount('amount')
    ->date('date')
    ->nullableString('description', 160)
    ->nullableId('categoryId')
    ->nullableId('accountId')
    ->nullableId('toAccountId')
    ->enum('method', Defaults::PAYMENT_METHODS)
    ->nullableText('notes')
    ->nullableId('goalId')
    ->values();

Response::ok(TransactionRepo::update($uid, $id, $clean));
