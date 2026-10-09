<?php
declare(strict_types=1);

/** Delete a transaction; linked bill payments and goal contributions are unwound. */

require_once __DIR__ . '/../../includes/api.php';

$uid = api_guard(['POST', 'DELETE']);
$id  = api_id();
TransactionRepo::delete($uid, $id);
Response::noContent();
