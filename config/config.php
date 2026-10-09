<?php
declare(strict_types=1);

/**
 * Application configuration.
 *
 * Values here are safe defaults. Anything environment-specific (DB password,
 * app URL, cookie domain) belongs in config/config.local.php, which is
 * git-ignored and blocked from the web by config/.htaccess.
 *
 * Resolution order:  config.local.php  >  environment variable  >  default.
 */

$env = static function (string $key, $default = null) {
    $v = getenv($key);
    if ($v === false || $v === '') {
        return $default;
    }
    if ($v === 'true')  { return true; }
    if ($v === 'false') { return false; }
    return is_numeric($v) ? $v + 0 : $v;
};

$config = [
    'app' => [
        'name'     => 'Budget Planner',
        'env'      => $env('APP_ENV', 'production'),   // production | development
        'debug'    => $env('APP_DEBUG', false),        // NEVER true in production
        // Public base URL used in email links, e.g. https://budget.example.com
        // (no trailing slash). Required in production: links are never built
        // from the request's Host header there.
        'url'      => $env('APP_URL', ''),
        'timezone' => $env('APP_TIMEZONE', 'Asia/Manila'),
        'log_path' => dirname(__DIR__) . '/storage/logs',
    ],

    'db' => [
        'host'     => $env('DB_HOST', '127.0.0.1'),
        'port'     => (int) $env('DB_PORT', 3307),
        'name'     => $env('DB_NAME', 'budget_planner'),
        'user'     => $env('DB_USER', 'root'),
        'password' => $env('DB_PASSWORD', ''),
        'charset'  => 'utf8mb4',
        'socket'   => $env('DB_SOCKET', ''),
    ],

    'session' => [
        'name'             => 'bp_session',
        'lifetime'         => 60 * 60 * 12,   // 12h absolute
        'idle_timeout'     => 60 * 60 * 2,    // 2h inactivity
        'regenerate_after' => 60 * 15,        // rotate session id every 15m
        // "Keep me logged in": a longer-lived cookie + longer absolute/idle
        // windows, applied only when the user opts in at login.
        'remember_lifetime'     => 60 * 60 * 24 * 30, // 30d absolute
        'remember_idle_timeout' => 60 * 60 * 24 * 30, // 30d inactivity
        'cookie_path'      => '/',
        'cookie_domain'    => $env('SESSION_DOMAIN', ''),
        'cookie_secure'    => $env('SESSION_SECURE', true),
        'cookie_samesite'  => 'Lax',
    ],

    'security' => [
        'password_min'          => 10,
        'password_algo'         => PASSWORD_DEFAULT,
        'password_cost'         => (int) $env('PASSWORD_COST', 12),
        'csrf_token_bytes'      => 32,
        'csrf_header'           => 'X-CSRF-Token',
        // Overridable so a test run can raise the ceiling without editing
        // this file. Leave the defaults alone in production.
        'login_max_attempts'    => (int) $env('LOGIN_MAX_ATTEMPTS', 8),    // per email + IP
        'login_window_seconds'  => (int) $env('LOGIN_WINDOW_SECONDS', 900), // 15m rolling window
        'login_lockout_seconds' => (int) $env('LOGIN_LOCKOUT_SECONDS', 900),
        'register_max_per_ip'   => (int) $env('REGISTER_MAX_PER_IP', 5),   // per hour
        'require_same_origin'   => true,
        'trusted_proxies'       => [],       // set when behind a load balancer
    ],

    // Email verification + password reset (see docs/AUTH.md).
    'auth' => [
        // When true, new accounts must confirm their email before signing in.
        // Turn off only on a host that genuinely cannot send mail.
        'require_verification'   => $env('AUTH_REQUIRE_VERIFICATION', true),
        'verify_ttl_seconds'     => (int) $env('AUTH_VERIFY_TTL', 60 * 60 * 24), // 24h
        'reset_ttl_seconds'      => (int) $env('AUTH_RESET_TTL', 60 * 60),       // 1h
        // Verification / reset emails: per address and per IP, rolling hour.
        'email_cooldown_seconds' => (int) $env('AUTH_EMAIL_COOLDOWN', 60),
        'email_max_per_address'  => (int) $env('AUTH_EMAIL_MAX_PER_ADDRESS', 3),
        'email_max_per_ip'       => (int) $env('AUTH_EMAIL_MAX_PER_IP', 10),
    ],

    // Outgoing mail. Credentials belong in config.local.php or the environment,
    // never in this file. driver: smtp | mail (PHP mail()) | log (dev only:
    // writes each message to storage/mail/ instead of sending it).
    'mail' => [
        'driver'       => $env('MAIL_DRIVER', 'smtp'),
        'host'         => $env('MAIL_HOST', ''),
        'port'         => (int) $env('MAIL_PORT', 587),
        'username'     => $env('MAIL_USERNAME', ''),
        'password'     => $env('MAIL_PASSWORD', ''),
        'encryption'   => $env('MAIL_ENCRYPTION', 'tls'),   // tls (STARTTLS) | ssl | none
        'verify_peer'  => $env('MAIL_VERIFY_PEER', true),
        'timeout'      => (int) $env('MAIL_TIMEOUT', 15),
        'from_address' => $env('MAIL_FROM_ADDRESS', ''),
        'from_name'    => $env('MAIL_FROM_NAME', 'Easy Budget Planner'),
        'reply_to'     => $env('MAIL_REPLY_TO', ''),
        'log_path'     => $env('MAIL_LOG_PATH', dirname(__DIR__) . '/storage/mail'),
    ],

    'limits' => [
        'max_body_bytes'       => 512 * 1024,
        'per_page_default'     => 50,
        'per_page_max'         => 200,
        'hydration_months'     => 18,        // bootstrap transaction window
        'hydration_cap'        => 5000,      // hard row cap for that window
        'recurring_post_guard' => 2000,      // max auto-posts per run
        'max_accounts'         => 200,
        'max_categories'       => 500,
        'max_goals'            => 200,
        'max_bills'            => 500,
        'max_recurring'        => 300,
        'max_grocery_items'    => 300,
        'max_grocery_lists'    => 50,       // saved grocery templates per user
        'max_saved_budgets'    => 50,       // saved budget templates per user
        'max_amount_minor'     => 999999999999,
        'string_max'           => 255,
        'text_max'             => 2000,
    ],

    'money' => [
        'default_currency' => 'PHP',
        'default_minor'    => 2,
    ],
];

$localFile = __DIR__ . '/config.local.php';
if (is_file($localFile)) {
    /** @var array<string,mixed> $local */
    $local = require $localFile;
    if (is_array($local)) {
        foreach ($local as $section => $values) {
            $config[$section] = is_array($values) && isset($config[$section]) && is_array($config[$section])
                ? array_replace($config[$section], $values)
                : $values;
        }
    }
}

return $config;
