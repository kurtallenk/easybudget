<?php
declare(strict_types=1);

/** All budgets with their lines and plans. */

require_once __DIR__ . '/../../includes/api.php';

$uid = api_guard(['GET']);
Response::ok(BudgetRepo::all($uid));
