<?php
declare(strict_types=1);

/**
 * Create an account. With email verification on (the default) the account
 * starts unverified, a confirmation link is emailed, and nobody is signed in.
 * The response is the same for new and already-registered addresses.
 */

require_once __DIR__ . '/../../includes/api.php';

api_public(['POST']);

$body = Request::body();
$clean = (new Validator($body))
    ->required('email', 'password')
    ->email('email')
    ->nullableString('displayName', 80)
    ->values();

$password = $body['password'] ?? '';
if (!is_string($password)) {
    throw new ApiException('Please enter a password.', 422, 'validation_failed');
}
// Optional for API clients; the sign-up form always sends it.
if (array_key_exists('passwordConfirm', $body) && (!is_string($body['passwordConfirm']) || !hash_equals($password, $body['passwordConfirm']))) {
    $msg = 'The passwords do not match.';
    throw new ApiException($msg, 422, 'validation_failed', ['fields' => ['passwordConfirm' => $msg]]);
}

$result = Auth::register($clean['email'], $password, $clean['displayName'] ?? null);

Response::created($result + ['csrfToken' => (function_exists('api_csrf_token') ? api_csrf_token() : Csrf::token())]);
