<?php
declare(strict_types=1);

/** Post due occurrences. Idempotent: the unique key prevents a duplicate post. */

require_once __DIR__ . '/../../includes/api.php';

$uid = api_guard(['POST']);

$clean = (new Validator(Request::body()))
    ->nullableId('ruleId')
    ->nullableDate('asOf')
    ->bool('autoOnly')
    ->values();

$asOf = $clean['asOf'] ?? null;

if (!empty($clean['ruleId'])) {
    Response::ok(RecurringEngine::runRule($uid, (string) $clean['ruleId'], $asOf));
    return;   // one response per request
}

Response::ok(RecurringEngine::run($uid, $asOf, $clean['autoOnly'] ?? true));
