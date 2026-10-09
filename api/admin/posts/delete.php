<?php
declare(strict_types=1);

/** Delete a message / News & Updates item from every inbox. Super Admin only. */

require_once __DIR__ . '/../../../includes/api.php';

$adminId = api_admin_guard(['POST', 'DELETE']);
AdminRepo::delete($adminId, api_id());
Response::noContent();
