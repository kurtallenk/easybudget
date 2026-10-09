<?php
declare(strict_types=1);

/** Delete a goal. Its transactions survive with the link cleared. */

require_once __DIR__ . '/../../includes/api.php';

$uid = api_guard(['POST', 'DELETE']);
$id  = api_id();
GoalRepo::delete($uid, $id);
Response::noContent();
