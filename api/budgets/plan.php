<?php
declare(strict_types=1);

/** Replace the income or savings plan rows for a month. */

require_once __DIR__ . '/../../includes/api.php';

$uid = api_guard(['POST']);

$clean = (new Validator(Request::body()))
    ->required('month', 'kind')
    ->monthKey('month')
    ->enum('kind', ['income', 'savings'])
    ->listOf('rows', static function (Validator $row): array {
        return $row->required('label')->string('label', 80)->amount('amount', true)->values();
    }, 100)
    ->values();

Response::ok(BudgetRepo::setPlan($uid, $clean['month'], $clean['kind'], $clean['rows'] ?? []));
