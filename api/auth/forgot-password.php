<?php
declare(strict_types=1);

/**
 * Start a password reset. The answer never reveals whether the address is
 * registered; the email itself is sent after the response (Deferred), so the
 * timing does not reveal it either. Rate limited per address and per IP.
 */

require_once __DIR__ . '/../../includes/api.php';

api_public(['POST']);

$clean = (new Validator(Request::body()))->required('email')->email('email')->values();

PasswordReset::request($clean['email']);

Response::ok([
    'sent'    => true,
    'message' => 'If an account exists for that email, we have sent a link to reset your password. It may take a minute to arrive.',
]);
