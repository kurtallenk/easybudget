<?php
declare(strict_types=1);

/**
 * Confirm an email address. The link opens pages/verify-email.html, which
 * POSTs the token here (with CSRF), so link scanners that merely fetch the
 * URL cannot consume it.
 */

require_once __DIR__ . '/../../includes/api.php';

api_public(['POST']);

$body  = Request::body();
$token = isset($body['token']) && is_string($body['token']) ? strtolower(trim($body['token'])) : null;

$result = EmailVerification::confirm($token);

$messages = [
    'verified'         => 'Your email address is confirmed. You can now sign in.',
    'already_verified' => 'Your email address is already confirmed. You can sign in.',
    'expired'          => 'This verification link has expired. Enter your email below and we will send you a new one.',
    'invalid'          => 'This verification link is not valid. It may have been replaced by a newer email. Request a new link below.',
];

Response::ok(['status' => $result['status'], 'message' => $messages[$result['status']]]);
