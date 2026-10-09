<?php
declare(strict_types=1);

/**
 * Exchange a refresh token for a new access + refresh pair (rotation).
 * Reusing an already-rotated refresh token revokes that device's tokens.
 */

require_once __DIR__ . '/../../includes/api.php';

api_public(['POST']);
if (!api_is_mobile()) {
    throw new ApiException('This endpoint is for the mobile app.', 400, 'bad_request');
}

$body = Request::body();
$token = isset($body['refreshToken']) && is_string($body['refreshToken']) ? trim($body['refreshToken']) : '';
if ($token === '') {
    throw new ApiException('Please sign in again.', 401, 'unauthenticated');
}

Response::ok(['tokens' => ApiToken::refresh($token)]);
