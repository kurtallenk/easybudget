<?php
declare(strict_types=1);

/**
 * Deployment self-check. Public, read-only, no session, no secrets.
 *
 *   GET /api/health.php
 *
 * Answers whether the code that is deployed is complete and consistent, whether
 * the database is reachable, whether migration 010 (api_tokens) is applied, and
 * which of the app's signals reached PHP (useful on shared hosts that drop
 * headers). Open it in a browser right after uploading files: every value in
 * "checks" should be true.
 */

require_once __DIR__ . '/../includes/api.php';

Request::assertMethod(['GET']);

$checks = [
    'apiTokensModule'  => class_exists('MobileApi', false) && class_exists('ApiToken', false),
    'authModule'       => method_exists('Auth', 'loginForToken'),
    'mobileEndpoints'  => is_file(__DIR__ . '/auth/token.php') && is_file(__DIR__ . '/auth/refresh.php') && is_file(__DIR__ . '/auth/revoke.php'),
    'database'         => false,
    'apiTokensTable'   => false,
];

try {
    $checks['database'] = (int) Database::scalar('SELECT 1') === 1;
    if ($checks['apiTokensModule']) {
        $checks['apiTokensTable'] = ApiToken::tableExists();
    }
} catch (Throwable $e) {
    Logger::error('health.database', ['type' => get_class($e)]);
}

$mobile = $checks['apiTokensModule'] && MobileApi::isClient();
if ($checks['apiTokensModule']) {
    MobileApi::bearerToken(); // sets the channel; the token itself is never echoed
}

$healthy = !in_array(false, $checks, true);

Response::json(['ok' => $healthy, 'data' => [
    'version' => 'phase2-api-repair-1',
    'checks'  => $checks,
    'request' => [
        // What this server saw from the caller. For the Android app all three should be true/non-"none".
        'mobileClientDetected' => $mobile,
        'clientHeaderReceived' => isset($_SERVER['HTTP_X_EBP_CLIENT']),
        'tokenChannel'         => $checks['apiTokensModule'] ? (string) MobileApi::$channel : 'unavailable',
    ],
]] + ($healthy ? [] : ['error' => ['code' => 'not_ready', 'message' => 'The server is missing an update. See docs/DEPLOY_PHASE2_REPAIR.md.']]), $healthy ? 200 : 503);
