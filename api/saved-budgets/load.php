<?php
declare(strict_types=1);

/**
 * Load a saved budget into a month, replacing that month's plan.
 *
 * Body: { id, month }
 * Only budget_lines / budget_plan_lines are rewritten: loading a template
 * never creates a transaction and never changes the template.
 */

require_once __DIR__ . '/../../includes/api.php';

$uid = api_guard(['POST']);
$id  = api_id();

$clean = (new Validator(Request::body()))->required('month')->monthKey('month')->values();

Response::ok(SavedBudgetRepo::load($uid, $id, $clean['month']));
