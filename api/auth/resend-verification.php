<?php
declare(strict_types=1);

/**
 * Send a new verification link. Always answers the same way for a valid
 * address (registered, unknown or already verified) so it cannot be used to
 * probe accounts. Rate limited per address and per IP.
 */

require_once __DIR__ . '/../../includes/api.php';

api_public(['POST']);

$clean = (new Validator(Request::body()))->required('email')->email('email')->values();

EmailVerification::resend($clean['email']);

Response::ok([
    'sent'    => true,
    'message' => 'If that address has an account waiting for confirmation, we have sent a new verification link. It may take a minute to arrive.',
]);
