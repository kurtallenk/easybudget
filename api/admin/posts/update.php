<?php
declare(strict_types=1);

/** Edit a message / News & Updates item (content only; recipients never change). Super Admin only. */

require_once __DIR__ . '/../../../includes/api.php';

$adminId = api_admin_guard(['POST']);
$id      = api_id();
$body    = Request::body();

$clean = (new Validator($body))
    ->string('type', 20)
    ->string('title', 120, 1)
    ->string('body', 500, 1)
    ->nullableString('details', 2000)
    ->values();
unset($clean['id']);
if (array_key_exists('link', $body)) {
    $clean['link'] = AdminRepo::cleanLink($body['link']);
}

Response::ok(AdminRepo::update($adminId, $id, $clean));
