<?php
declare(strict_types=1);

/**
 * Registration, login, password changes, ownership checks, throttling, audit.
 *
 * Identity always comes from the session. No endpoint accepts a client
 * supplied user_id, and every ownership test is scoped by user_id.
 */
final class Auth
{
    /** Tokens re-issued to a mobile client by changePassword(). */
    public static ?array $reissued = null;

    public static function id(): ?int
    {
        Session::start();
        return Session::userId();
    }

    /** Current user id, or a 401. */
    public static function requireUser(): int
    {
        $uid = self::id();
        if ($uid === null) {
            throw new ApiException('Please sign in to continue.', 401, 'unauthenticated');
        }
        if (!Session::fingerprintMatches()) {
            Logger::warn('security.session_fingerprint_mismatch', ['uid' => $uid]);
            Session::logout();
            throw new ApiException('Please sign in again.', 401, 'unauthenticated');
        }
        if (!self::sessionStillValid($uid)) {
            Session::logout();
            throw new ApiException('Please sign in again.', 401, 'unauthenticated');
        }
        Session::touch();
        return $uid;
    }

    /**
     * Re-checks the account behind a session on every authenticated request:
     * it must still exist, be active, be verified (when verification is
     * required) and carry the same auth_version the session was issued with.
     * A password reset or change bumps auth_version, which signs out every
     * other session at once.
     */
    public static function sessionStillValid(int $uid): bool
    {
        $row = Database::one(
            'SELECT `status`,`email_verified_at`,`auth_version` FROM `users` WHERE `id` = :id',
            [':id' => $uid]
        );
        if ($row === null || $row['status'] !== 'active') {
            return false;
        }
        if (EmailVerification::required() && $row['email_verified_at'] === null) {
            return false;
        }
        return (int) $row['auth_version'] === Session::authVersion();
    }

    /** Session probe helper: the signed-in user id only if the session is fully valid. */
    public static function currentValidUser(): ?int
    {
        $uid = self::id();
        if ($uid === null) {
            return null;
        }
        if (!Session::fingerprintMatches() || !self::sessionStillValid($uid)) {
            Session::logout();
            return null;
        }
        return $uid;
    }

    public static function hashPassword(string $password): string
    {
        $hash = password_hash($password, Config::get('security.password_algo', PASSWORD_DEFAULT), [
            'cost' => (int) Config::get('security.password_cost', 12),
        ]);
        if (!is_string($hash)) {
            throw new ApiException('We could not save your password. Please try again.', 500, 'server_error');
        }
        return $hash;
    }

    /** @return array<string,mixed>|null */
    public static function user(int $uid): ?array
    {
        $r = Database::one(
            'SELECT `id`,`email`,`display_name`,`status`,`created_at`,`last_login_at`
               FROM `users` WHERE `id` = :id',
            [':id' => $uid]
        );
        if ($r === null) {
            return null;
        }
        return [
            'id'          => (int) $r['id'],
            'email'       => $r['email'],
            'displayName' => $r['display_name'],
            'status'      => $r['status'],
            'createdAt'   => $r['created_at'],
            'lastLoginAt' => $r['last_login_at'],
            // Presentation hint only (shows the Super Admin menu). Every admin
            // endpoint re-checks the role in the database via requireSuperAdmin().
            'isSuperAdmin' => self::isSuperAdmin((int) $r['id']),
        ];
    }

    // ------------------------------------------------------------------
    // Roles (migration 008: users.role ENUM('user','super_admin'))
    // ------------------------------------------------------------------

    /**
     * Reads the role from the database on every call, so a demotion takes
     * effect on the very next request. Fails closed: a missing column
     * (migration not applied yet), an inactive account or any error = not admin.
     */
    public static function isSuperAdmin(int $uid): bool
    {
        try {
            $r = Database::one('SELECT `role`,`status` FROM `users` WHERE `id` = :id', [':id' => $uid]);
        } catch (Throwable $e) {
            return false;
        }
        return is_array($r) && ($r['role'] ?? '') === 'super_admin' && ($r['status'] ?? '') === 'active';
    }

    /** Authenticated Super Admin id, or a 403 (logged + audited). */
    public static function requireSuperAdmin(int $uid): int
    {
        if (!self::isSuperAdmin($uid)) {
            Logger::warn('security.admin_denied', ['uid' => $uid, 'path' => (string) ($_SERVER['SCRIPT_NAME'] ?? '')]);
            Audit::log($uid, 'admin.denied', 'endpoint', substr((string) basename((string) ($_SERVER['SCRIPT_NAME'] ?? '')), 0, 40));
            throw new ApiException('You do not have permission to do that.', 403, 'forbidden');
        }
        return $uid;
    }

    // ------------------------------------------------------------------
    // Registration
    // ------------------------------------------------------------------

    /**
     * Creates the account in an unverified state and emails a confirmation
     * link. The user is NOT signed in until the address is confirmed.
     *
     * Duplicate addresses get exactly the same response as new ones (no
     * account enumeration); the real owner receives an "you already have an
     * account" email instead, or a fresh link if they never verified.
     *
     * When auth.require_verification is off, the old behaviour applies:
     * the account is active at once and the user is signed in.
     *
     * @return array{verificationRequired:bool,email:string,user?:array<string,mixed>}
     */
    public static function register(string $email, string $password, ?string $displayName): array
    {
        self::assertPasswordStrength($password);

        $ip = Request::ip();
        $recent = (int) Database::scalar(
            "SELECT COUNT(*) FROM `login_attempts`
              WHERE `ip_address` = :ip AND `purpose` = 'register'
                AND `attempted_at` > (UTC_TIMESTAMP() - INTERVAL 1 HOUR)",
            [':ip' => $ip]
        );
        if ($recent >= (int) Config::get('security.register_max_per_ip', 5)) {
            throw new ApiException('Too many accounts have been created from this device. Please try again later.', 429, 'rate_limited');
        }
        LoginThrottle::record($email, $ip, false, 'register');

        $hash = self::hashPassword($password);
        $verify = EmailVerification::required();

        $existing = Database::one('SELECT `id`,`email_verified_at`,`status` FROM `users` WHERE `email` = :e', [':e' => $email]);
        if ($existing !== null) {
            if (!$verify) {
                throw new ApiException('An account with that email already exists.', 409, 'email_taken');
            }
            // Quietly help the real owner; the requester sees the normal response.
            try {
                AuthEmailLimit::hit('verify', $email, $ip);
                if ($existing['status'] === 'active') {
                    $existing['email_verified_at'] === null
                        ? EmailVerification::send((int) $existing['id'])
                        : EmailVerification::sendAccountExists((int) $existing['id']);
                }
            } catch (ApiException $e) {
                // Rate limited: send nothing, still answer generically.
            }
            return ['verificationRequired' => true, 'email' => $email];
        }

        try {
            $user = Database::transaction(static function () use ($email, $hash, $displayName, $verify): array {
                Database::run(
                    "INSERT INTO `users` (`email`,`password_hash`,`display_name`,`status`,`email_verified_at`)
                     VALUES (:e,:h,:n,'active', " . ($verify ? 'NULL' : 'UTC_TIMESTAMP()') . ')',
                    [':e' => $email, ':h' => $hash, ':n' => $displayName]
                );
                $uid = (int) Database::lastInsertId();

                Database::run('INSERT INTO `user_settings` (`user_id`) VALUES (:uid)', [':uid' => $uid]);
                Defaults::seedCategories($uid);

                Audit::log($uid, 'user.registered', 'user', (string) $uid);
                return self::user($uid) ?? [];
            });
        } catch (PDOException $e) {
            // Two simultaneous signups for one address: the unique key wins.
            if ((string) $e->getCode() === '23000') {
                return ['verificationRequired' => $verify, 'email' => $email];
            }
            throw $e;
        }

        if (!$verify) {
            Session::login((int) $user['id'], (string) $user['email'], false, 1);
            return ['verificationRequired' => false, 'email' => $email, 'user' => $user];
        }

        LoginThrottle::record($email, $ip, true, 'verify');
        EmailVerification::send((int) $user['id']);
        return ['verificationRequired' => true, 'email' => $email];
    }

    // ------------------------------------------------------------------
    // Login / logout
    // ------------------------------------------------------------------

    /** @return array<string,mixed> the signed-in user */
    public static function login(string $email, string $password, bool $remember = false): array
    {
        $row = self::checkCredentials($email, $password);
        $uid = (int) $row['id'];
        Session::login($uid, (string) $row['email'], $remember, (int) $row['auth_version']);
        Database::run('UPDATE `users` SET `last_login_at` = UTC_TIMESTAMP() WHERE `id` = :id', [':id' => $uid]);
        Audit::log($uid, 'user.login', 'user', (string) $uid);

        return self::user($uid) ?? [];
    }

    /**
     * Mobile sign-in: the same checks as login() (throttle, timing-safe verify,
     * active, verified), but returns bearer tokens instead of a cookie session.
     *
     * @return array{user:array<string,mixed>,tokens:array<string,mixed>}
     */
    public static function loginForToken(string $email, string $password, ?string $device): array
    {
        $row = self::checkCredentials($email, $password);
        $uid = (int) $row['id'];
        $tokens = ApiToken::issuePair($uid, (int) $row['auth_version'], $device);
        Database::run('UPDATE `users` SET `last_login_at` = UTC_TIMESTAMP() WHERE `id` = :id', [':id' => $uid]);
        Audit::log($uid, 'user.login_api', 'user', (string) $uid);
        ApiToken::prune();
        return ['user' => self::user($uid) ?? [], 'tokens' => $tokens];
    }

    /** @return array<string,mixed> the verified user row */
    private static function checkCredentials(string $email, string $password): array
    {
        $ip = Request::ip();
        LoginThrottle::assertNotLocked($email, $ip);

        $row = Database::one(
            'SELECT `id`,`email`,`password_hash`,`status`,`email_verified_at`,`auth_version` FROM `users` WHERE `email` = :e',
            [':e' => $email]
        );

        // Constant-ish work whether or not the account exists, so response time
        // does not reveal which emails are registered.
        $hash = is_array($row) ? (string) $row['password_hash'] : '$2y$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinva';
        $valid = password_verify($password, $hash);

        if (!is_array($row) || !$valid) {
            LoginThrottle::record($email, $ip, false, 'login');
            throw new ApiException('That email or password is incorrect.', 401, 'invalid_credentials');
        }
        if ($row['status'] !== 'active') {
            LoginThrottle::record($email, $ip, false, 'login');
            throw new ApiException('That account is not active. Please contact support.', 403, 'account_inactive');
        }
        // Only reachable with the correct password, so it reveals nothing to a
        // guesser. The user is told how to finish, and can ask for a new link.
        if (EmailVerification::required() && $row['email_verified_at'] === null) {
            throw new ApiException(
                'Please confirm your email address before signing in. Check your inbox for the link we sent, or send a new one.',
                403,
                'email_unverified',
                ['email' => (string) $row['email']]
            );
        }

        $uid = (int) $row['id'];

        if (password_needs_rehash($hash, Config::get('security.password_algo', PASSWORD_DEFAULT), ['cost' => (int) Config::get('security.password_cost', 12)])) {
            $new = password_hash($password, Config::get('security.password_algo', PASSWORD_DEFAULT), ['cost' => (int) Config::get('security.password_cost', 12)]);
            if (is_string($new)) {
                Database::run('UPDATE `users` SET `password_hash` = :h WHERE `id` = :id', [':h' => $new, ':id' => $uid]);
            }
        }

        LoginThrottle::record($email, $ip, true, 'login');
        LoginThrottle::clear($email, $ip);

        return $row;
    }

    public static function logout(): void
    {
        $uid = self::id();
        if ($uid !== null) {
            Audit::log($uid, 'user.logout', 'user', (string) $uid);
        }
        Session::logout();
    }

    // ------------------------------------------------------------------
    // Password management
    // ------------------------------------------------------------------

    public static function changePassword(int $uid, string $current, string $next): void
    {
        $hash = Database::scalar('SELECT `password_hash` FROM `users` WHERE `id` = :id', [':id' => $uid]);
        if (!is_string($hash) || !password_verify($current, $hash)) {
            Audit::log($uid, 'user.password_change_failed', 'user', (string) $uid);
            throw new ApiException('Your current password is incorrect.', 403, 'invalid_credentials');
        }
        self::assertPasswordStrength($next);
        if (password_verify($next, $hash)) {
            throw new ApiException('Please choose a password you have not used here before.', 422, 'validation_failed');
        }

        $new = self::hashPassword($next);

        // Bumping auth_version signs out every other session; this one is
        // re-issued below with the new version and a fresh id.
        Database::run(
            'UPDATE `users` SET `password_hash` = :h, `auth_version` = `auth_version` + 1, `password_changed_at` = UTC_TIMESTAMP() WHERE `id` = :id',
            [':h' => $new, ':id' => $uid]
        );
        AuthToken::revokeAll($uid, AuthToken::RESET);
        $version = (int) Database::scalar('SELECT `auth_version` FROM `users` WHERE `id` = :id', [':id' => $uid]);

        if (class_exists('ApiToken', false) && ApiToken::viaApi()) {
            // Mobile: every other device is out (auth_version); this one gets a
            // fresh pair in the same family. password.php returns it.
            $cur = ApiToken::current();
            ApiToken::revokeAllForUser($uid);
            self::$reissued = ApiToken::issuePair($uid, $version, null, $cur['family'] ?? null);
        } else {
            $email = (string) Session::get('email', '');
            Session::login($uid, $email, (bool) Session::get('remember', false), $version);
        }
        Audit::log($uid, 'user.password_changed', 'user', (string) $uid);
    }

    public static function assertPasswordStrength(string $password): void
    {
        $min = (int) Config::get('security.password_min', 10);
        $len = mb_strlen($password);

        if ($len < $min) {
            throw new ApiException("Please use at least {$min} characters.", 422, 'validation_failed', [
                'fields' => ['password' => "Please use at least {$min} characters."],
            ]);
        }
        if ($len > 200) {
            throw new ApiException('Please use fewer than 200 characters.', 422, 'validation_failed');
        }

        $classes = (int) (bool) preg_match('/[a-z]/', $password)
                 + (int) (bool) preg_match('/[A-Z]/', $password)
                 + (int) (bool) preg_match('/\d/', $password)
                 + (int) (bool) preg_match('/[^A-Za-z0-9]/', $password);

        if ($classes < 3) {
            $msg = 'Please mix upper case, lower case, numbers, or symbols.';
            throw new ApiException($msg, 422, 'validation_failed', ['fields' => ['password' => $msg]]);
        }

        $common = ['password', 'password1', '12345678', '123456789', 'qwertyuiop', 'letmein123', 'budget123', 'iloveyou1'];
        if (in_array(strtolower($password), $common, true)) {
            $msg = 'That password is too easy to guess.';
            throw new ApiException($msg, 422, 'validation_failed', ['fields' => ['password' => $msg]]);
        }
    }

    // ------------------------------------------------------------------
    // Ownership (IDOR defence)
    // ------------------------------------------------------------------

    /** Tables an ownership check may target. Never interpolate caller input. */
    private const OWNED_TABLES = [
        'accounts', 'categories', 'transactions', 'budgets', 'savings_goals',
        'bills', 'recurring_transactions',
    ];

    /**
     * Throws 404 (not 403) when the row is missing or belongs to someone else,
     * so the API never confirms that another user's id exists.
     */
    public static function ownsOrFail(int $uid, string $table, ?string $id, string $label = 'Record'): void
    {
        if ($id === null || $id === '') {
            return;
        }
        if (!in_array($table, self::OWNED_TABLES, true)) {
            throw new LogicException('Ownership check on an unknown table: ' . $table);
        }

        $found = Database::scalar(
            "SELECT `id` FROM `{$table}` WHERE `user_id` = :uid AND `id` = :id",
            [':uid' => $uid, ':id' => $id]
        );

        if ($found === null) {
            Logger::warn('security.ownership_denied', ['uid' => $uid, 'table' => $table, 'id' => $id]);
            throw new ApiException("That {$label} could not be found.", 404, 'not_found');
        }
    }

    public static function owns(int $uid, string $table, ?string $id): bool
    {
        try {
            self::ownsOrFail($uid, $table, $id);
            return true;
        } catch (ApiException $e) {
            return false;
        }
    }
}

/**
 * Brute-force throttle: counts failures per email+IP inside a rolling window.
 */
final class LoginThrottle
{
    public static function assertNotLocked(string $email, string $ip): void
    {
        $max    = (int) Config::get('security.login_max_attempts', 8);
        $window = (int) Config::get('security.login_window_seconds', 900);

        $failures = (int) Database::scalar(
            "SELECT COUNT(*) FROM `login_attempts`
              WHERE `purpose` = 'login' AND `successful` = 0
                AND (`email` = :e OR `ip_address` = :ip)
                AND `attempted_at` > (UTC_TIMESTAMP() - INTERVAL :w SECOND)",
            [':e' => $email, ':ip' => $ip, ':w' => $window]
        );

        if ($failures >= $max) {
            $minutes = max(1, (int) ceil((int) Config::get('security.login_lockout_seconds', 900) / 60));
            Logger::warn('security.login_throttled', ['email' => $email, 'ip' => $ip, 'failures' => $failures]);
            throw new ApiException("Too many sign-in attempts. Please try again in about {$minutes} minutes.", 429, 'rate_limited');
        }
    }

    public static function record(string $email, string $ip, bool $successful, string $purpose = 'login'): void
    {
        Database::run(
            'INSERT INTO `login_attempts` (`email`,`ip_address`,`successful`,`purpose`,`user_agent`)
             VALUES (:e,:ip,:s,:p,:ua)',
            [
                ':e' => $email, ':ip' => $ip, ':s' => $successful ? 1 : 0,
                ':p' => $purpose, ':ua' => Request::userAgent(),
            ]
        );
    }

    /** Clears the failure history after a successful sign-in. */
    public static function clear(string $email, string $ip): void
    {
        Database::run(
            "DELETE FROM `login_attempts`
              WHERE `purpose` = 'login' AND `successful` = 0 AND `email` = :e AND `ip_address` = :ip",
            [':e' => $email, ':ip' => $ip]
        );
    }

    /** Housekeeping, called opportunistically from the auth endpoints. */
    public static function prune(): void
    {
        Database::run('DELETE FROM `login_attempts` WHERE `attempted_at` < (UTC_TIMESTAMP() - INTERVAL 30 DAY)');
    }
}

/** Append-only audit trail for security-relevant events. */
final class Audit
{
    /** @param array<string,mixed> $meta */
    public static function log(?int $uid, string $action, ?string $entity = null, ?string $entityId = null, array $meta = []): void
    {
        try {
            Database::run(
                'INSERT INTO `audit_logs` (`user_id`,`action`,`entity`,`entity_id`,`ip_address`,`user_agent`,`meta`)
                 VALUES (:uid,:a,:e,:eid,:ip,:ua,:meta)',
                [
                    ':uid'  => $uid,
                    ':a'    => $action,
                    ':e'    => $entity,
                    ':eid'  => $entityId,
                    ':ip'   => Request::ip(),
                    ':ua'   => Request::userAgent(),
                    ':meta' => $meta === [] ? null : json_encode($meta, JSON_UNESCAPED_SLASHES),
                ]
            );
        } catch (Throwable $e) {
            // Auditing must never break the request it is recording.
            Logger::error('audit.write_failed', ['action' => $action, 'error' => $e->getMessage()]);
        }
    }
}
