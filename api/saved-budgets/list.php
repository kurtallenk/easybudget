<?php
declare(strict_types=1);

/** All saved budgets (templates), newest change first. */

require_once __DIR__ . '/../../includes/api.php';

$uid = api_guard(['GET']);

Response::ok(SavedBudgetRepo::all($uid));
