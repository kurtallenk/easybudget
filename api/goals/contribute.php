<?php
declare(strict_types=1);

/** Add money to a goal: one transaction, one contribution row, one recalculation. */

require_once __DIR__ . '/../../includes/api.php';

$uid = api_guard(['POST']);

$clean = (new Validator(Request::body()))
    ->required('goalId', 'amount')
    ->id('goalId')
    ->amount('amount')
    ->nullableId('accountId')
    ->nullableId('categoryId')
    ->nullableDate('date')
    ->nullableString('note', 160)
    ->values();

Response::created(GoalRepo::contribute(
    $uid,
    $clean['goalId'],
    (int) $clean['amount'],
    $clean['accountId'] ?? null,
    $clean['date'] ?? null,
    $clean['note'] ?? null,
    $clean['categoryId'] ?? null
));
