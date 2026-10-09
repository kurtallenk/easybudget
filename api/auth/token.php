<?php
declare(strict_types=1);

/**
 * Mobile sign-in. Same rules as auth/login.php (throttling, timing-safe check,
 * verified + active account) but answers with bearer tokens instead of a
 * cookie session. Requires the X-EBP-Client header (or the app's User-Agent).
 *
 * Response: { user, tokens: { tokenType, accessToken, accessExpiresIn,
 *                              refreshToken, refreshExpiresIn } }
 */

require_once __DIR__ . '/../../includes/api.php';

api_public(['POST']);
if (!api_is_mobile()) {
    throw new ApiException('This sign-in method is for the mobile app.', 400, 'bad_request');
}

$body = Request::body();
$clean = (new Validator($body))->required('email', 'password')->email('email')->values();
$password = $body['password'] ?? '';
if (!is_string($password)) {
    throw new ApiException('Please enter your password.', 422, 'validation_failed');
}
$device = isset($body['deviceName']) && is_string($body['deviceName']) ? $body['deviceName'] : null;

Response::ok(Auth::loginForToken($clean['email'], $password, $device));
