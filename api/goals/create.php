<?php
declare(strict_types=1);

/** Create a savings goal. */

require_once __DIR__ . '/../../includes/api.php';

$uid = api_guard(['POST']);

$clean = (new Validator(Request::body()))
    ->required('name', 'target')
    ->string('name', 60)
    ->amount('target')
    ->amount('current', true)
    ->nullableDate('targetDate')
    ->nullableId('accountId')
    ->nullableString('description', 300)
    ->emoji('emoji')
    ->hexColor('color')
    ->values();

Response::created(GoalRepo::create($uid, $clean));
