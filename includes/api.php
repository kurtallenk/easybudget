<?php
declare(strict_types=1);

/**
 * Single bootstrap for every file under /api.
 *
 * Endpoints look like:
 *
 *   require_once __DIR__ . '/../../includes/api.php';
 *   $uid = api_guard(['GET']);            // authenticated + CSRF + same origin
 *   Response::ok(AccountRepo::all($uid));
 *
 * or, for sign-in and registration:
 *
 *   api_public(['POST']);
 */

require_once __DIR__ . '/Support.php';
require_once __DIR__ . '/Database.php';
require_once __DIR__ . '/Response.php';
require_once __DIR__ . '/Request.php';
require_once __DIR__ . '/Validator.php';
require_once __DIR__ . '/Session.php';
require_once __DIR__ . '/Defaults.php';
require_once __DIR__ . '/Auth.php';
require_once __DIR__ . '/Mailer.php';
require_once __DIR__ . '/MailTemplates.php';
require_once __DIR__ . '/AuthFlows.php';
// Android app support (bearer tokens). Optional at runtime: if this file were
// ever missing, the website keeps working and only the app is unavailable.
if (is_file(__DIR__ . '/ApiTokens.php')) {
    require_once __DIR__ . '/ApiTokens.php';
}
require_once __DIR__ . '/Repositories.php';
require_once __DIR__ . '/Notifications.php';
require_once __DIR__ . '/RecurringEngine.php';
require_once __DIR__ . '/Reports.php';

Config::load();
date_default_timezone_set((string) Config::get('app.timezone', 'UTC'));

// Errors are logged, never printed: a PHP notice in the output stream would
// both corrupt the JSON and leak paths.
ini_set('display_errors', '0');
ini_set('log_errors', '1');
error_reporting(E_ALL);

Response::securityHeaders();

/**
 * Converts any uncaught throwable into the standard JSON error envelope.
 * Registered once, so an endpoint never needs its own try/catch.
 */
set_exception_handler(static function (Throwable $e): void {
    if ($e instanceof ApiException) {
        Response::exception($e);
        return;
    }
    Response::serverError($e);
});

set_error_handler(static function (int $severity, string $message, string $file = '', int $line = 0): bool {
    if ((error_reporting() & $severity) === 0) {
        return false;
    }
    throw new ErrorException($message, 0, $severity, $file, $line);
});

register_shutdown_function(static function (): void {
    $err = error_get_last();
    if ($err !== null && in_array($err['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR], true)) {
        Logger::error('php.fatal', $err);
        if (!headers_sent()) {
            http_response_code(500);
            header('Content-Type: application/json; charset=utf-8');
            echo json_encode(['ok' => false, 'error' => [
                'code'    => 'server_error',
                'message' => 'Something went wrong on our side. Please try again.',
            ]]);
        }
    }
});

/**
 * Guard for authenticated endpoints.
 *
 * @param string[] $methods HTTP methods this endpoint accepts.
 * @return int the authenticated user id
 */
function api_guard(array $methods = ['GET']): int
{
    Request::assertMethod($methods);

    // Android app: bearer token only, never the cookie session (no CSRF needed,
    // see MobileApi). Browsers never send a bearer token or the app headers, so
    // the website takes exactly the Phase 1 path below.
    if (class_exists('MobileApi', false)) {
        $bearer = MobileApi::bearerToken();
        if ($bearer !== null || MobileApi::isClient()) {
            if ($bearer === null) {
                throw new ApiException('Please sign in to continue.', 401, 'unauthenticated');
            }
            return ApiToken::authenticate($bearer);
        }
    }

    Session::start();
    Request::assertSameOrigin();
    Csrf::verify();
    return Auth::requireUser();
}

/**
 * Guard for Super Admin endpoints (api/admin/*): everything api_guard checks,
 * plus users.role = 'super_admin' read from the database on every request.
 * A normal user gets a 403 before any admin code runs.
 *
 * @param string[] $methods
 * @return int the authenticated Super Admin's user id
 */
function api_admin_guard(array $methods = ['GET']): int
{
    return Auth::requireSuperAdmin(api_guard($methods));
}

/**
 * Guard for endpoints that must work while signed out (login, register,
 * session probe). CSRF still applies to writes.
 *
 * @param string[] $methods
 */
function api_public(array $methods = ['POST']): void
{
    Request::assertMethod($methods);
    if (api_is_mobile()) {
        return; // no cookie session for the app, so there is nothing for CSRF to protect
    }
    Session::start();
    Request::assertSameOrigin();
    Csrf::verify();
}

/** True when this request comes from the Android app (handled without cookies or CSRF). */
function api_is_mobile(): bool
{
    return class_exists('MobileApi', false) && MobileApi::active();
}

/**
 * CSRF token for responses. The app has no cookie session, so it gets '' and no
 * session is started for it; the website gets exactly what Phase 1 returned.
 */
function api_csrf_token(): string
{
    return api_is_mobile() ? '' : Csrf::token();
}

/** Path segment helper: /api/accounts/update.php?id=acc_1 -> validated id. */
function api_id(string $param = 'id'): string
{
    $value = Request::query($param);
    if ($value === null) {
        $body = Request::body();
        $value = isset($body[$param]) && is_string($body[$param]) ? $body[$param] : null;
    }
    if ($value === null || !preg_match('/^[A-Za-z0-9_-]{1,40}$/', $value)) {
        throw new ApiException('That identifier is not valid.', 422, 'validation_failed', ['param' => $param]);
    }
    return $value;
}

/** Pagination parameters, clamped to the configured maximum. @return array{0:int,1:int} */
function api_pagination(): array
{
    $default = (int) Config::get('limits.per_page_default', 50);
    $max     = (int) Config::get('limits.per_page_max', 200);
    return [
        Request::queryInt('page', 1, 1, 100000),
        Request::queryInt('perPage', $default, 1, $max),
    ];
}
