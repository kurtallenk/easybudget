<?php
declare(strict_types=1);

/** Super Admin user directory / recipient picker (?q= search). Super Admin only. */

require_once __DIR__ . '/../../includes/api.php';

api_admin_guard(['GET']);
$q = Request::query('q');
$q = $q === null ? null : mb_substr(trim($q), 0, 100);
Response::ok(AdminRepo::users($q, Request::queryInt('limit', 100, 1, 200)));
