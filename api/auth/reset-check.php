<?php
declare(strict_types=1);

/** Tells the reset page whether its link is still usable, without consuming it. */

require_once __DIR__ . '/../../includes/api.php';

api_public(['POST']);

$body  = Request::body();
$token = isset($body['token']) && is_string($body['token']) ? strtolower(trim($body['token'])) : null;

Response::ok(['status' => PasswordReset::check($token)]);
