<?php
declare(strict_types=1);

/** Contribution history for one goal. */

require_once __DIR__ . '/../../includes/api.php';

$uid = api_guard(['GET']);
Response::ok(GoalRepo::contributions($uid, api_id('goalId')));
