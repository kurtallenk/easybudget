<?php
declare(strict_types=1);

/** Delete a month's budget along with its lines and plans. */

require_once __DIR__ . '/../../includes/api.php';

$uid = api_guard(['POST', 'DELETE']);

$clean = (new Validator(Request::body()))->required('month')->monthKey('month')->values();

BudgetRepo::delete($uid, $clean['month']);
Response::noContent();
