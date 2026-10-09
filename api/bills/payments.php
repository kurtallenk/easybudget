<?php
declare(strict_types=1);

/** Payment history for one bill. */

require_once __DIR__ . '/../../includes/api.php';

$uid = api_guard(['GET']);
Response::ok(BillRepo::payments($uid, api_id('billId')));
