<?php
declare(strict_types=1);

/** Delete an account. mode=keep detaches its transactions instead of deleting them. */

require_once __DIR__ . '/../../includes/api.php';

$uid = api_guard(['POST', 'DELETE']);
$id  = api_id();

$mode = (new Validator(Request::body()))->enum('mode', ['delete', 'keep'])->values()['mode'] ?? 'delete';

AccountRepo::delete($uid, $id, $mode);
Response::noContent();
