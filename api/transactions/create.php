<?php
declare(strict_types=1);

/** Create a transaction. */

require_once __DIR__ . '/../../includes/api.php';

$uid = api_guard(['POST']);

$body  = Request::body();
$clean = (new Validator($body))
    ->required('amount', 'date')
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

$allowDuplicate = isset($body['allowDuplicate']) && $body['allowDuplicate'] === true;
if (!$allowDuplicate && TransactionRepo::isDuplicate($uid, $clean)) {
    throw new ApiException(
        'That looks like a transaction you already recorded. Send allowDuplicate to keep both.',
        409,
        'duplicate_transaction'
    );
}

Response::created(TransactionRepo::create($uid, $clean));
