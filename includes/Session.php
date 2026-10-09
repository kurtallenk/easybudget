<?php
declare(strict_types=1);

/**
 * Hardened sessions + CSRF.
 *
 *  - HttpOnly / Secure / SameSite=Lax cookie; no session id in URLs.
 *  - Fixation: the id is regenerated on login, on logout, and every
 *    session.regenerate_after seconds.
 *  - Idle timeout and absolute lifetime.
 *  - Per-session CSRF secret compared with hash_equals.
 */
final class Session
{
    private static bool $started = false;

    public static function start(): void
    {
        if (self::$started || session_status() === PHP_SESSION_ACTIVE) {
            self::$started = true;
            return;
        }

        $cfg    = Config::get('session');
        $secure = (bool) $cfg['cookie_secure'];

        // Plain HTTP is tolerated only for loopback development.
        if ($secure && (($_SERVER['HTTPS'] ?? '') === '') && in_array($_SERVER['REMOTE_ADDR'] ?? '', ['127.0.0.1', '::1'], true)) {
            $secure = false;
        }

        session_name((string) $cfg['name']);
        session_set_cookie_params([
            'lifetime' => 0,
            'path'     => (string) $cfg['cookie_path'],
            'domain'   => (string) $cfg['cookie_domain'],
            'secure'   => $secure,
            'httponly' => true,
            'samesite' => (string) $cfg['cookie_samesite'],
        ]);

        ini_set('session.use_strict_mode', '1');
        ini_set('session.use_only_cookies', '1');
        ini_set('session.use_trans_sid', '0');
        // Deprecated in PHP 8.4+, where the engine already uses a 32-byte
        // random id. Set them only when the runtime still honours them, so a
        // modern PHP does not raise a deprecation on every request.
        if (PHP_VERSION_ID < 80400) {
            ini_set('session.sid_length', '48');
            ini_set('session.sid_bits_per_character', '5');
        }
        ini_set('session.gc_maxlifetime', (string) (int) $cfg['lifetime']);

        session_start();
        self::$started = true;

        self::enforceTimeouts();
        self::rotateIfStale();
    }

    public static function get(string $key, $default = null) { return $_SESSION[$key] ?? $default; }

    public static function set(string $key, $value): void { $_SESSION[$key] = $value; }

    public static function forget(string $key): void { unset($_SESSION[$key]); }

    public static function userId(): ?int
    {
        $id = $_SESSION['uid'] ?? null;
        return is_int($id) && $id > 0 ? $id : null;
    }

    /**
     * Called after a verified password check. Rotates the id to defeat fixation.
     *
     * $remember only changes how long the session cookie and the server-side
     * timeouts last (see enforceTimeouts()) - it never stores a credential of
     * any kind, so there is nothing sensitive sitting in the browser.
     */
    public static function login(int $userId, string $email, bool $remember = false, int $authVersion = 1): void
    {
        self::start();
        session_regenerate_id(true);

        $_SESSION = [
            'uid'        => $userId,
            'email'      => $email,
            'created_at' => time(),
            'last_seen'  => time(),
            'rotated_at' => time(),
            'remember'   => $remember,
            'av'         => $authVersion,   // must match users.auth_version
            'ua_hash'    => self::fingerprint(),
            'csrf'       => bin2hex(random_bytes((int) Config::get('security.csrf_token_bytes', 32))),
        ];

        self::applyCookieLifetime($remember);
    }

    /**
     * The session cookie itself is just carrying the (regenerated) session
     * id, so extending "remember me" is a matter of re-issuing that same
     * cookie with a longer expiry - no separate token to manage.
     */
    private static function applyCookieLifetime(bool $remember): void
    {
        if (!$remember || !ini_get('session.use_cookies')) {
            return;
        }
        $cfg = Config::get('session');
        $p   = session_get_cookie_params();
        setcookie(session_name(), session_id(), [
            'expires'  => time() + (int) Config::get('session.remember_lifetime', 2592000),
            'path'     => $p['path'],
            'domain'   => $p['domain'],
            'secure'   => $p['secure'],
            'httponly' => true,
            'samesite' => $p['samesite'] ?? 'Lax',
        ]);
    }

    public static function logout(): void
    {
        self::start();
        $_SESSION = [];

        if (ini_get('session.use_cookies')) {
            $p = session_get_cookie_params();
            setcookie(session_name(), '', [
                'expires'  => time() - 42000,
                'path'     => $p['path'],
                'domain'   => $p['domain'],
                'secure'   => $p['secure'],
                'httponly' => $p['httponly'],
                'samesite' => $p['samesite'] ?? 'Lax',
            ]);
        }
        session_destroy();
        self::$started = false;
    }

    /** auth_version this session was issued with (pre-migration sessions count as 1). */
    public static function authVersion(): int
    {
        $v = $_SESSION['av'] ?? 1;
        return is_int($v) ? $v : 1;
    }

    public static function touch(): void { $_SESSION['last_seen'] = time(); }

    /** Coarse client binding (user agent only; IP addresses roam legitimately). */
    private static function fingerprint(): string
    {
        return hash('sha256', Request::userAgent());
    }

    public static function fingerprintMatches(): bool
    {
        $stored = $_SESSION['ua_hash'] ?? null;
        return !is_string($stored) || hash_equals($stored, self::fingerprint());
    }

    private static function enforceTimeouts(): void
    {
        if (!isset($_SESSION['uid'])) {
            return;
        }
        $now       = time();
        $created   = (int) ($_SESSION['created_at'] ?? $now);
        $lastSeen  = (int) ($_SESSION['last_seen'] ?? $now);
        $remember  = (bool) ($_SESSION['remember'] ?? false);
        $lifetime  = $remember
            ? (int) Config::get('session.remember_lifetime', 2592000)
            : (int) Config::get('session.lifetime', 43200);
        $idleLimit = $remember
            ? (int) Config::get('session.remember_idle_timeout', 2592000)
            : (int) Config::get('session.idle_timeout', 7200);

        if (($now - $created) > $lifetime || ($now - $lastSeen) > $idleLimit) {
            $_SESSION = [];
            session_regenerate_id(true);
        }
    }

    private static function rotateIfStale(): void
    {
        if (!isset($_SESSION['uid'])) {
            return;
        }
        if ((time() - (int) ($_SESSION['rotated_at'] ?? 0)) > (int) Config::get('session.regenerate_after', 900)) {
            session_regenerate_id(true);
            $_SESSION['rotated_at'] = time();
            // session_regenerate_id() re-sends the cookie with the default
            // (session-only) lifetime from start(); re-apply "remember me"'s
            // longer expiry so periodic rotation doesn't quietly cut it short.
            self::applyCookieLifetime((bool) ($_SESSION['remember'] ?? false));
        }
    }
}

/** CSRF: per-session secret submitted in the X-CSRF-Token header. */
final class Csrf
{
    public static function token(): string
    {
        Session::start();
        if (!isset($_SESSION['csrf']) || !is_string($_SESSION['csrf']) || $_SESSION['csrf'] === '') {
            $_SESSION['csrf'] = bin2hex(random_bytes((int) Config::get('security.csrf_token_bytes', 32)));
        }
        return $_SESSION['csrf'];
    }

    /** Verifies writes only; reads need no token. */
    public static function verify(): void
    {
        if (!Request::isWrite()) {
            return;
        }

        $expected = $_SESSION['csrf'] ?? null;
        $provided = Request::header((string) Config::get('security.csrf_header', 'X-CSRF-Token'));

        if ($provided === null) {
            $body = Request::body();
            $provided = isset($body['csrf_token']) && is_string($body['csrf_token']) ? $body['csrf_token'] : null;
        }

        if (!is_string($expected) || $expected === '' || !is_string($provided) || !hash_equals($expected, $provided)) {
            Logger::warn('security.csrf_failed', ['path' => $_SERVER['REQUEST_URI'] ?? '']);
            throw new ApiException('Your session expired. Please refresh the page and try again.', 419, 'csrf_failed');
        }
    }
}
