<?php
declare(strict_types=1);

/** Undo the most recent payment and restore the due date it was paid against. */

require_once __DIR__ . '/../../includes/api.php';

$uid = api_guard(['POST']);
Response::ok(BillRepo::unpay($uid, api_id()));
