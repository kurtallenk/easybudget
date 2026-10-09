<?php
declare(strict_types=1);

/** Delete a bill. */

require_once __DIR__ . '/../../includes/api.php';

$uid = api_guard(['POST', 'DELETE']);
BillRepo::delete($uid, api_id());
Response::noContent();
