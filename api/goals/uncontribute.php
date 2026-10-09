<?php
declare(strict_types=1);

/** Remove a contribution and its transaction. */

require_once __DIR__ . '/../../includes/api.php';

$uid = api_guard(['POST', 'DELETE']);
Response::ok(GoalRepo::removeContribution($uid, api_id('contributionId')));
