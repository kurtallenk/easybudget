<?php
declare(strict_types=1);

/** Super Admin dashboard: counts + every message and News & Updates item. Super Admin only. */

require_once __DIR__ . '/../../includes/api.php';

api_admin_guard(['GET']);
Response::ok(['stats' => AdminRepo::stats(), 'posts' => AdminRepo::posts()]);
