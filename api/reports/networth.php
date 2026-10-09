<?php
declare(strict_types=1);

/** Balances per account plus assets, liabilities and the totals. */

require_once __DIR__ . '/../../includes/api.php';

$uid = api_guard(['GET']);
Response::ok(Reports::netWorth($uid, Request::queryBool('includeArchived', false)));
