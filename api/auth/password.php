<?php
declare(strict_types=1);

/** Change the signed-in user's password. */

require_once __DIR__ . '/../../includes/api.php';

$uid = api_guard(['POST']);

$body = Request::body();
foreach (['currentPassword', 'newPassword'] as $field) {
    if (!isset($body[$field]) || !is_string($body[$field]) || $body[$field] === '') {
        throw new ApiException('Please check the highlighted fields.', 422, 'validation_failed', [
            'fields' => [$field => 'This field is required.'],
        ]);
    }
}

Auth::changePassword($uid, $body['currentPassword'], $body['newPassword']);

// Android app: the password change re-issues its tokens (every other device is
// signed out by the auth_version bump). Website: unchanged Phase 1 answer.
Response::ok(property_exists('Auth', 'reissued') && Auth::$reissued !== null
    ? ['csrfToken' => '', 'tokens' => Auth::$reissued]
    : ['csrfToken' => (function_exists('api_csrf_token') ? api_csrf_token() : Csrf::token())]);
