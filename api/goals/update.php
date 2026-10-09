<?php
declare(strict_types=1);

/** Update a goal. current is derived from contributions and cannot be set here. */

require_once __DIR__ . '/../../includes/api.php';

$uid = api_guard(['POST']);
$id  = api_id();

$clean = (new Validator(Request::body()))
    ->string('name', 60)
    ->amount('target')
    ->nullableDate('targetDate')
    ->nullableId('accountId')
    ->nullableString('description', 300)
    ->emoji('emoji')
    ->hexColor('color')
    ->enum('status', Defaults::GOAL_STATUSES)
    ->bool('archived')
    ->values();

Response::ok(GoalRepo::update($uid, $id, $clean));
