<?php
declare(strict_types=1);

/** Delete a recurring rule. Posted transactions keep their history. */

require_once __DIR__ . '/../../includes/api.php';

$uid = api_guard(['POST', 'DELETE']);
RecurringRepo::delete($uid, api_id());
Response::noContent();
