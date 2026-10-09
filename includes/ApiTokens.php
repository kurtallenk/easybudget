<?php
declare(strict_types=1);

/**
 * Bearer tokens for non-browser clients (the Android app).
 *
 * Format: "ebp_" + selector (32 hex) + validator (64 hex). The database keeps
 * the selector and SHA-256(validator) only. See migration 010 for the model.
 */
/**
 * Detection of the Android app and extraction of its bearer token.
 *
 * Kept in this file (not in Request.php / Session.php) on purpose: the website's
 * core files stay byte-identical to the Phase 1 baseline, so a partial upload can
 * never leave the website calling a method that does not exist. Core files only
 * call into this class after checking class_exists('MobileApi', false).
 *
 * Why skipping CSRF for these requests is safe: a mobile request never reads or
 * creates a cookie session, so there is no ambient authority for another site to
 * abuse. Browsers also cannot send the custom header (or a custom User-Agent)
 * cross-origin without a CORS preflight, which this API never grants.
 */
final class MobileApi
{
    public const UA_PREFIX = 'EasyBudgetPlanner-Android';
    public const TOKEN_COOKIE = 'ebp_at';

    private static function server(string $name): ?string
    {
        $v = $_SERVER['HTTP_' . strtoupper(str_replace('-', '_', $name))] ?? null;
        return is_string($v) ? $v : null;
    }

    /**
     * True for the Android app. Primary signal: "X-EBP-Client: android".
     * Fallback for hosts that drop custom headers: the app's User-Agent.
     */
    public static function isClient(): bool
    {
        $v = self::server('X-EBP-Client');
        if (is_string($v) && preg_match('/^[a-z0-9._\/-]{1,40}$/i', $v) === 1) {
            return true;
        }
        $ua = self::server('User-Agent');
        return is_string($ua) && strncmp($ua, self::UA_PREFIX, strlen(self::UA_PREFIX)) === 0;
    }

    /** Where the bearer token came from (diagnostics only): authorization | x-ebp-token | cookie | none. */
    public static ?string $channel = null;

    /**
     * Bearer token from Authorization (or REDIRECT_HTTP_AUTHORIZATION on CGI),
     * X-EBP-Token (hosts that drop Authorization), or, for the app only, an
     * "ebp_at" cookie (hosts that drop every non-standard header). The server
     * never sets that cookie, so a browser can never carry it by accident.
     */
    public static function bearerToken(): ?string
    {
        foreach ([$_SERVER['HTTP_AUTHORIZATION'] ?? null, $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? null] as $h) {
            if (is_string($h) && preg_match('/^Bearer\s+(\S{1,200})$/i', trim($h), $m)) {
                self::$channel = 'authorization';
                return $m[1];
            }
        }
        $x = self::server('X-EBP-Token');
        if (is_string($x) && trim($x) !== '' && strlen($x) <= 200) {
            self::$channel = 'x-ebp-token';
            return trim($x);
        }
        $c = $_COOKIE[self::TOKEN_COOKIE] ?? null;
        if (self::isClient() && is_string($c) && trim($c) !== '' && strlen($c) <= 200) {
            self::$channel = 'cookie';
            return trim($c);
        }
        self::$channel = 'none';
        return null;
    }

    /** This request is handled as a mobile (bearer, no cookie session, no CSRF) request. */
    public static function active(): bool
    {
        return self::isClient() || ApiToken::viaApi();
    }
}

/**
 * True when the api_tokens table is missing (migration 010 not applied yet).
 * MySQL/MariaDB: SQLSTATE 42S02, driver error 1146.
 */
function api_tokens_table_missing(Throwable $e): bool
{
    return $e instanceof PDOException
        && ((string) $e->getCode() === '42S02' || strpos($e->getMessage(), '1146') !== false);
}

final class ApiToken
{
    public const ACCESS_TTL  = 3600;            // 1 hour
    public const REFRESH_TTL = 60 * 60 * 24 * 60; // 60 days, rotated on every use

    /** Set by api_guard() when the request authenticated with a bearer token. */
    private static ?array $current = null;

    public static function viaApi(): bool { return self::$current !== null; }

    /** @return array{user_id:int,family:string}|null */
    public static function current(): ?array { return self::$current; }

    /**
     * @return array{accessToken:string,accessExpiresIn:int,refreshToken:string,refreshExpiresIn:int,tokenType:string}
     */
    public static function issuePair(int $uid, int $authVersion, ?string $device, ?string $family = null): array
    {
        $family ??= bin2hex(random_bytes(16));
        $device = $device === null ? null : mb_substr(preg_replace('/[^\P{C}]/u', '', $device) ?? '', 0, 80);
        try {
            $access  = self::insert($uid, $family, 'access', $authVersion, $device, self::ACCESS_TTL);
            $refresh = self::insert($uid, $family, 'refresh', $authVersion, $device, self::REFRESH_TTL);
        } catch (PDOException $e) {
            throw self::notReady($e);
        }
        return [
            'tokenType'        => 'Bearer',
            'accessToken'      => $access,
            'accessExpiresIn'  => self::ACCESS_TTL,
            'refreshToken'     => $refresh,
            'refreshExpiresIn' => self::REFRESH_TTL,
        ];
    }

    private static function insert(int $uid, string $family, string $kind, int $authVersion, ?string $device, int $ttl): string
    {
        $selector  = bin2hex(random_bytes(16));
        $validator = bin2hex(random_bytes(32));
        Database::run(
            'INSERT INTO `api_tokens` (`user_id`,`family`,`kind`,`selector`,`token_hash`,`auth_version`,`device_name`,`expires_at`)
             VALUES (:u,:f,:k,:s,:h,:v,:d, UTC_TIMESTAMP() + INTERVAL :ttl SECOND)',
            [':u' => $uid, ':f' => $family, ':k' => $kind, ':s' => $selector, ':h' => hash('sha256', $validator),
             ':v' => $authVersion, ':d' => $device, ':ttl' => $ttl]
        );
        return 'ebp_' . $selector . $validator;
    }

    /** @return array{0:string,1:string}|null [selector, validator] */
    private static function parse(?string $token): ?array
    {
        if (!is_string($token) || !preg_match('/^ebp_([a-f0-9]{32})([a-f0-9]{64})$/', $token, $m)) {
            return null;
        }
        return [$m[1], $m[2]];
    }

    /** @return array<string,mixed>|null the joined token + user row when the token is genuine */
    private static function lookup(string $token, string $kind): ?array
    {
        $p = self::parse($token);
        if ($p === null) {
            return null;
        }
        try {
            $row = Database::one(
            'SELECT t.`id`, t.`user_id`, t.`family`, t.`token_hash`, t.`auth_version` AS `token_version`,
                    t.`used_at`, t.`revoked_at`, t.`device_name`, (t.`expires_at` > UTC_TIMESTAMP()) AS `live`,
                    u.`status`, u.`email_verified_at`, u.`auth_version` AS `user_version`
               FROM `api_tokens` t JOIN `users` u ON u.`id` = t.`user_id`
              WHERE t.`selector` = :s AND t.`kind` = :k',
            [':s' => $p[0], ':k' => $kind]
            );
        } catch (PDOException $e) {
            throw self::notReady($e);
        }
        if ($row === null || !hash_equals((string) $row['token_hash'], hash('sha256', $p[1]))) {
            return null;
        }
        return $row;
    }

    private static function accountUsable(array $row): bool
    {
        return $row['status'] === 'active'
            && (!EmailVerification::required() || $row['email_verified_at'] !== null)
            && (int) $row['token_version'] === (int) $row['user_version'];
    }

    /** Validates an access token for this request. Throws 401 when it is not usable. */
    public static function authenticate(string $token): int
    {
        $row = self::lookup($token, 'access');
        if ($row === null || $row['revoked_at'] !== null || !self::accountUsable($row)) {
            throw new ApiException('Please sign in again.', 401, 'unauthenticated');
        }
        if ((int) $row['live'] !== 1) {
            // Distinct code so the app knows to refresh rather than sign out.
            throw new ApiException('Your session needs to be refreshed.', 401, 'token_expired');
        }
        self::$current = ['user_id' => (int) $row['user_id'], 'family' => (string) $row['family']];
        return (int) $row['user_id'];
    }

    /** Rotates a refresh token. Reuse of an old one revokes the family (stolen token defence). */
    public static function refresh(string $token): array
    {
        $row = self::lookup($token, 'refresh');
        if ($row === null) {
            throw new ApiException('Please sign in again.', 401, 'unauthenticated');
        }
        if ($row['used_at'] !== null) {
            Logger::warn('security.refresh_reuse', ['uid' => (int) $row['user_id']]);
            Audit::log((int) $row['user_id'], 'api.refresh_reuse_detected', 'user', (string) $row['user_id']);
            self::revokeFamily((string) $row['family']);
            throw new ApiException('Please sign in again.', 401, 'unauthenticated');
        }
        if ($row['revoked_at'] !== null || (int) $row['live'] !== 1 || !self::accountUsable($row)) {
            throw new ApiException('Please sign in again.', 401, 'unauthenticated');
        }

        return Database::transaction(static function () use ($row): array {
            $claimed = Database::run(
                'UPDATE `api_tokens` SET `used_at` = UTC_TIMESTAMP() WHERE `id` = :id AND `used_at` IS NULL',
                [':id' => (int) $row['id']]
            );
            if ($claimed !== 1) {
                throw new ApiException('Please sign in again.', 401, 'unauthenticated');
            }
            // Old access tokens of this device die with the rotation.
            Database::run(
                "UPDATE `api_tokens` SET `revoked_at` = UTC_TIMESTAMP()
                  WHERE `family` = :f AND `kind` = 'access' AND `revoked_at` IS NULL",
                [':f' => (string) $row['family']]
            );
            return self::issuePair((int) $row['user_id'], (int) $row['user_version'], $row['device_name'], (string) $row['family']);
        });
    }

    public static function revokeFamily(string $family): void
    {
        Database::run(
            'UPDATE `api_tokens` SET `revoked_at` = UTC_TIMESTAMP() WHERE `family` = :f AND `revoked_at` IS NULL',
            [':f' => $family]
        );
    }

    /** Signs out a device given either of its tokens. Silently ignores unknown tokens. */
    public static function revokeByToken(string $token): void
    {
        foreach (['access', 'refresh'] as $kind) {
            $row = self::lookup($token, $kind);
            if ($row !== null) {
                self::revokeFamily((string) $row['family']);
                return;
            }
        }
    }

    /**
     * Signs every device of a user out. Never blocks the caller (password reset
     * and change must keep working for the website even before migration 010):
     * the auth_version bump done by those flows already invalidates every token.
     */
    public static function revokeAllForUser(int $uid): void
    {
        try {
            Database::run(
                'UPDATE `api_tokens` SET `revoked_at` = UTC_TIMESTAMP() WHERE `user_id` = :u AND `revoked_at` IS NULL',
                [':u' => $uid]
            );
        } catch (PDOException $e) {
            if (!api_tokens_table_missing($e)) {
                throw $e;
            }
            Logger::warn('api_tokens.table_missing', ['where' => 'revokeAllForUser']);
        }
    }

    /** True when migration 010 has been applied. */
    public static function tableExists(): bool
    {
        return (int) Database::scalar(
            "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'api_tokens'"
        ) === 1;
    }

    /** A missing api_tokens table becomes a clear JSON 503 instead of a generic 500. */
    private static function notReady(PDOException $e): Throwable
    {
        if (!api_tokens_table_missing($e)) {
            return $e;
        }
        Logger::error('api_tokens.table_missing', ['hint' => 'apply database/migrations/010_api_tokens.sql']);
        return new ApiException('App sign-in is not available on the server yet. Please try again later.', 503, 'service_unavailable');
    }

    /** Housekeeping: expired or long-revoked rows. */
    public static function prune(): void
    {
        try {
            Database::run('DELETE FROM `api_tokens` WHERE `expires_at` < UTC_TIMESTAMP() - INTERVAL 1 DAY
                            OR `revoked_at` < UTC_TIMESTAMP() - INTERVAL 7 DAY');
        } catch (PDOException $e) {
            Logger::warn('api_tokens.prune_failed', ['code' => (string) $e->getCode()]);
        }
    }
}
