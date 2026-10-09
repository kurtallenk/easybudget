<?php
declare(strict_types=1);

/** List accounts with their computed balances. */

require_once __DIR__ . '/../../includes/api.php';

$uid = api_guard(['GET']);

$accounts = AccountRepo::all($uid, Request::queryBool('includeArchived', true));
$balances = AccountRepo::balances($uid);

foreach ($accounts as $i => $account) {
    $accounts[$i]['balance'] = $balances[$account['id']] ?? $account['openingBalance'];
}

Response::ok($accounts);
