<?php
declare(strict_types=1);

/** Mobile sign-out: revokes this device's access and refresh tokens. Idempotent. */

require_once __DIR__ . '/../../includes/api.php';

api_public(['POST']);
if (!api_is_mobile()) {
    throw new ApiException('This endpoint is for the mobile app.', 400, 'bad_request');
}

$body = Request::body();
foreach ([MobileApi::bearerToken(), $body['refreshToken'] ?? null] as $t) {
    if (is_string($t) && $t !== '') {
        ApiToken::revokeByToken(trim($t));
    }
}

Response::ok(['revoked' => true]);
