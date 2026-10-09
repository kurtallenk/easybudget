<?php
declare(strict_types=1);

/**
 * Finish a password reset: validates the token and the new password, stores
 * the new hash, burns the token and signs out every session for the account.
 */

require_once __DIR__ . '/../../includes/api.php';

api_public(['POST']);

$body = Request::body();
$token = isset($body['token']) && is_string($body['token']) ? strtolower(trim($body['token'])) : null;
$password = $body['password'] ?? null;
$confirm  = $body['passwordConfirm'] ?? null;

if (!is_string($password) || $password === '') {
    $msg = 'Please enter a new password.';
    throw new ApiException($msg, 422, 'validation_failed', ['fields' => ['password' => $msg]]);
}
if (!is_string($confirm) || !hash_equals($password, $confirm)) {
    $msg = 'The passwords do not match.';
    throw new ApiException($msg, 422, 'validation_failed', ['fields' => ['passwordConfirm' => $msg]]);
}

PasswordReset::complete($token, $password);

Response::ok(['reset' => true, 'message' => 'Your password has been changed. Please sign in with your new password.']);
