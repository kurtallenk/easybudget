<?php
declare(strict_types=1);

/**
 * Rename a saved budget and/or overwrite its contents ("Save" over a loaded one).
 *
 * Body: { id, name?, sourceMonth?, lines?, incomePlan?, savingsPlan? }
 */

require_once __DIR__ . '/../../includes/api.php';

$uid = api_guard(['POST', 'PATCH']);
$id  = api_id();

$clean = (new Validator(Request::body()))
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

Response::ok(SavedBudgetRepo::update($uid, $id, $clean));
