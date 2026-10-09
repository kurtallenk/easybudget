<?php
declare(strict_types=1);

/** List categories. */

require_once __DIR__ . '/../../includes/api.php';

$uid = api_guard(['GET']);
Response::ok(CategoryRepo::all($uid, Request::queryBool('includeArchived', true)));
