<?php
declare(strict_types=1);

/**
 * Delete a saved budget template.
 * The month budgets it was loaded into, and every transaction, are kept.
 */

require_once __DIR__ . '/../../includes/api.php';

$uid = api_guard(['POST', 'DELETE']);
$id  = api_id();

SavedBudgetRepo::delete($uid, $id);
Response::noContent();
