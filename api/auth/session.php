<?php
declare(strict_types=1);

/** Session probe. Safe while signed out; also mints the CSRF token the login form needs. */

require_once __DIR__ . '/../../includes/api.php';

Request::assertMethod(['GET']);

// function_exists: stays safe even if an older includes/api.php is still on the server.
if (function_exists('api_is_mobile') && api_is_mobile()) {
    // Android app: no cookie session. A valid bearer token means signed in; an
    // expired one answers 401 token_expired so the app refreshes and retries.
    $uid = null;
    $bearer = MobileApi::bearerToken();
    if ($bearer !== null && $bearer !== '') {
        try {
            $uid = ApiToken::authenticate($bearer);
        } catch (ApiException $e) {
            if ($e->errorCode() === 'token_expired' || $e->getCode() === 503) {
                throw $e;
            }
            $uid = null;
        }
    }
} else {
    // Website: exactly the Phase 1 behaviour.
    Session::start();
    // Fully re-validated (active, verified, auth_version), not just "has a uid".
    $uid = Auth::currentValidUser();
}

Response::ok([
    'authenticated' => $uid !== null,
    'user'          => $uid === null ? null : Auth::user($uid),
    'csrfToken'     => (function_exists('api_csrf_token') ? api_csrf_token() : Csrf::token()),
]);
