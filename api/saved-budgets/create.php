<?php
declare(strict_types=1);

/**
 * Save the current month's budget as a reusable template.
 *
 * Body: { id?, name?, sourceMonth?, lines: [{ categoryId, amount }],
 *         incomePlan?: [{ label, amount }], savingsPlan?: [{ label, amount }] }
 * Only the plan is stored - never a transaction. An empty name falls back to
 * budget-YYYY-MM-DD-HH-MM; a budget without a single category is rejected.
 */

require_once __DIR__ . '/../../includes/api.php';

$uid = api_guard(['POST']);

$clean = (new Validator(Request::body()))
    ->required('lines')
    ->id('id')
    ->nullableString('name', 80)
    ->monthKey('sourceMonth')
    ->listOf('lines', static function (Validator $row): array {
        return $row->required('categoryId')->id('categoryId')->amount('amount')->values();
    }, 200)
    ->listOf('incomePlan', static function (Validator $row): array {
        return $row->string('label', 80)->amount('amount', true)->values();
    }, 100)
    ->listOf('savingsPlan', static function (Validator $row): array {
        return $row->string('label', 80)->amount('amount', true)->values();
    }, 100)
    ->values();

Response::created(SavedBudgetRepo::create($uid, $clean));
