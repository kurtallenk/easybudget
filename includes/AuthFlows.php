<?php
declare(strict_types=1);

/**
 * Email verification and password reset.
 *
 *  - Tokens: 16-byte random selector + 32-byte random validator (random_bytes).
 *    The link carries both; the database stores the selector and
 *    SHA-256(validator) only, compared with hash_equals.
 *  - Single use: consume() is an atomic UPDATE ... WHERE used_at IS NULL, so
 *    two concurrent clicks cannot both succeed.
 *  - Expiry is checked in SQL against UTC_TIMESTAMP().
 *  - Issuing a new token deletes the user's earlier unused tokens of the same
 *    purpose, so only the newest link works.
 *  - Outgoing mail is rate-limited per address and per IP, and the request
 *    endpoints answer identically whether or not the address exists.
 */
final class AuthToken
{
    public const VERIFY = 'verify';
    public const RESET  = 'reset';

    /** @return string the opaque token for the link (96 hex chars) */
    public static function issue(int $uid, string $purpose, int $ttlSeconds): string
    {
        $selector  = bin2hex(random_bytes(16));
        $validator = bin2hex(random_bytes(32));

        Database::run(
            'DELETE FROM `auth_tokens` WHERE `user_id` = :uid AND `purpose` = :p AND `used_at` IS NULL',
            [':uid' => $uid, ':p' => $purpose]
        );
        Database::run(
            'INSERT INTO `auth_tokens` (`user_id`,`selector`,`validator_hash`,`purpose`,`expires_at`)
             VALUES (:uid,:s,:h,:p, UTC_TIMESTAMP() + INTERVAL :ttl SECOND)',
            [':uid' => $uid, ':s' => $selector, ':h' => hash('sha256', $validator), ':p' => $purpose, ':ttl' => max(60, $ttlSeconds)]
        );
        return $selector . $validator;
    }

    /**
     * Looks a token up without consuming it.
     *
     * @return array{status:string,id?:int,user_id?:int} status: valid | expired | used | invalid
     */
    public static function inspect(?string $token, string $purpose): array
    {
        if (!is_string($token) || !preg_match('/^[a-f0-9]{96}$/', $token)) {
            return ['status' => 'invalid'];
        }
        $selector  = substr($token, 0, 32);
        $validator = substr($token, 32);

        $row = Database::one(
            'SELECT `id`,`user_id`,`validator_hash`,`used_at`, (`expires_at` > UTC_TIMESTAMP()) AS `live`
               FROM `auth_tokens` WHERE `selector` = :s AND `purpose` = :p',
            [':s' => $selector, ':p' => $purpose]
        );
        if ($row === null || !hash_equals((string) $row['validator_hash'], hash('sha256', $validator))) {
            return ['status' => 'invalid'];
        }
        $base = ['id' => (int) $row['id'], 'user_id' => (int) $row['user_id']];
        if ($row['used_at'] !== null) {
            return ['status' => 'used'] + $base;
        }
        if ((int) $row['live'] !== 1) {
            return ['status' => 'expired'] + $base;
        }
        return ['status' => 'valid'] + $base;
    }

    /** Atomically marks the token used. False when another request got there first or it just expired. */
    public static function consume(int $id): bool
    {
        return Database::run(
            'UPDATE `auth_tokens` SET `used_at` = UTC_TIMESTAMP()
              WHERE `id` = :id AND `used_at` IS NULL AND `expires_at` > UTC_TIMESTAMP()',
            [':id' => $id]
        ) === 1;
    }

    public static function revokeAll(int $uid, string $purpose): void
    {
        Database::run(
            'DELETE FROM `auth_tokens` WHERE `user_id` = :uid AND `purpose` = :p AND `used_at` IS NULL',
            [':uid' => $uid, ':p' => $purpose]
        );
    }

    /** Housekeeping: drop tokens that expired or were used more than a week ago. */
    public static function prune(): void
    {
        Database::run(
            'DELETE FROM `auth_tokens`
              WHERE `purpose` IN (\'verify\',\'reset\')
                AND (`expires_at` < UTC_TIMESTAMP() - INTERVAL 7 DAY OR `used_at` < UTC_TIMESTAMP() - INTERVAL 7 DAY)'
        );
    }
}

/** Rate limit for outgoing auth emails, keyed by address string (existing or not) and IP. */
final class AuthEmailLimit
{
    /**
     * Records the request and throws 429 when it is over the limit. Counting
     * by the submitted address, not the account, keeps the answer identical for
     * registered and unknown addresses.
     */
    public static function hit(string $purpose, string $email, string $ip): void
    {
        $cooldown = (int) Config::get('auth.email_cooldown_seconds', 60);
        $perAddr  = (int) Config::get('auth.email_max_per_address', 3);
        $perIp    = (int) Config::get('auth.email_max_per_ip', 10);

        $row = Database::one(
            "SELECT
                SUM(`email` = :e1 AND `attempted_at` > (UTC_TIMESTAMP() - INTERVAL 1 HOUR))       AS `addr_hour`,
                SUM(`email` = :e2 AND `attempted_at` > (UTC_TIMESTAMP() - INTERVAL :cd SECOND))   AS `addr_recent`,
                SUM(`ip_address` = :ip1 AND `attempted_at` > (UTC_TIMESTAMP() - INTERVAL 1 HOUR)) AS `ip_hour`
               FROM `login_attempts`
              WHERE `purpose` = :p AND (`email` = :e3 OR `ip_address` = :ip2)
                AND `attempted_at` > (UTC_TIMESTAMP() - INTERVAL 1 HOUR)",
            [':e1' => $email, ':e2' => $email, ':e3' => $email, ':ip1' => $ip, ':ip2' => $ip, ':cd' => $cooldown, ':p' => $purpose]
        ) ?? [];

        if ((int) ($row['addr_recent'] ?? 0) > 0) {
            throw new ApiException('We just sent an email to that address. Please wait a minute before asking for another one.', 429, 'rate_limited', ['retryAfter' => $cooldown]);
        }
        if ((int) ($row['addr_hour'] ?? 0) >= $perAddr || (int) ($row['ip_hour'] ?? 0) >= $perIp) {
            Logger::warn('security.auth_email_throttled', ['purpose' => $purpose, 'ip' => $ip]);
            throw new ApiException('Too many email requests. Please check your inbox (and spam folder) or try again in an hour.', 429, 'rate_limited', ['retryAfter' => 3600]);
        }

        LoginThrottle::record($email, $ip, true, $purpose);
    }
}

final class EmailVerification
{
    public static function required(): bool
    {
        return (bool) Config::get('auth.require_verification', true);
    }

    /** Issues a fresh token (invalidating older ones) and queues the email. */
    public static function send(int $uid): void
    {
        $user = Database::one('SELECT `email`,`display_name` FROM `users` WHERE `id` = :id', [':id' => $uid]);
        if ($user === null) {
            return;
        }
        $ttl   = (int) Config::get('auth.verify_ttl_seconds', 86400);
        $token = AuthToken::issue($uid, AuthToken::VERIFY, $ttl);
        $to = (string) $user['email']; $name = $user['display_name'];
        // Built inside the deferred job: a missing APP_URL is then logged
        // instead of changing the response (which would reveal the account).
        Deferred::add(static function () use ($to, $name, $token, $ttl): void {
            $url = Mailer::appUrl() . '/pages/verify-email.html?token=' . $token;
            [$subject, $html, $text] = MailTemplates::verifyEmail($name, $url, $ttl);
            Mailer::send($to, $subject, $html, $text, $name);
        });
        Audit::log($uid, 'user.verification_sent', 'user', (string) $uid);
    }

    /** Duplicate signup: tell the real owner, without telling the requester. */
    public static function sendAccountExists(int $uid): void
    {
        $user = Database::one('SELECT `email`,`display_name` FROM `users` WHERE `id` = :id', [':id' => $uid]);
        if ($user === null) {
            return;
        }
        $to = (string) $user['email']; $name = $user['display_name'];
        Deferred::add(static function () use ($to, $name): void {
            $base = Mailer::appUrl();
            [$subject, $html, $text] = MailTemplates::accountExists($name, $base . '/pages/login.html', $base . '/pages/forgot-password.html');
            Mailer::send($to, $subject, $html, $text, $name);
        });
        Audit::log($uid, 'user.duplicate_signup_notice', 'user', (string) $uid);
    }

    /**
     * Resend on request (login page / check-your-inbox page). Always returns
     * normally for well-formed input so the caller can answer generically.
     */
    public static function resend(string $email): void
    {
        AuthEmailLimit::hit('verify', $email, Request::ip());
        $row = Database::one('SELECT `id`,`status`,`email_verified_at` FROM `users` WHERE `email` = :e', [':e' => $email]);
        if ($row !== null && $row['status'] === 'active' && $row['email_verified_at'] === null) {
            self::send((int) $row['id']);
        }
    }

    /** @return array{status:string,email?:string} status: verified | already_verified | expired | invalid */
    public static function confirm(?string $token): array
    {
        $t = AuthToken::inspect($token, AuthToken::VERIFY);

        if ($t['status'] === 'used' || $t['status'] === 'expired') {
            // A stale link for an address that is already confirmed is not an
            // error from the user's point of view.
            $verified = Database::scalar('SELECT `email_verified_at` FROM `users` WHERE `id` = :id', [':id' => $t['user_id']]);
            if ($verified !== null) {
                return ['status' => 'already_verified'];
            }
            return ['status' => $t['status'] === 'used' ? 'invalid' : 'expired'];
        }
        if ($t['status'] !== 'valid') {
            return ['status' => 'invalid'];
        }

        $uid = (int) $t['user_id'];
        $ok = Database::transaction(static function () use ($t, $uid): bool {
            if (!AuthToken::consume((int) $t['id'])) {
                return false;
            }
            Database::run(
                'UPDATE `users` SET `email_verified_at` = COALESCE(`email_verified_at`, UTC_TIMESTAMP()) WHERE `id` = :id',
                [':id' => $uid]
            );
            AuthToken::revokeAll($uid, AuthToken::VERIFY);
            return true;
        });
        if (!$ok) {
            return ['status' => 'invalid'];
        }

        Audit::log($uid, 'user.email_verified', 'user', (string) $uid);
        AuthToken::prune();
        return ['status' => 'verified'];
    }
}

final class PasswordReset
{
    /** Always returns normally for well-formed input: the caller answers generically. */
    public static function request(string $email): void
    {
        AuthEmailLimit::hit('reset', $email, Request::ip());

        $row = Database::one('SELECT `id`,`email`,`display_name`,`status` FROM `users` WHERE `email` = :e', [':e' => $email]);
        if ($row === null || $row['status'] !== 'active') {
            Logger::info('auth.reset_unknown_or_inactive');
            return;
        }
        $uid   = (int) $row['id'];
        $ttl   = (int) Config::get('auth.reset_ttl_seconds', 3600);
        $token = AuthToken::issue($uid, AuthToken::RESET, $ttl);
        $to = (string) $row['email']; $name = $row['display_name'];
        Deferred::add(static function () use ($to, $name, $token, $ttl): void {
            $url = Mailer::appUrl() . '/pages/reset-password.html?token=' . $token;
            [$subject, $html, $text] = MailTemplates::passwordReset($name, $url, $ttl);
            Mailer::send($to, $subject, $html, $text, $name);
        });
        Audit::log($uid, 'user.password_reset_requested', 'user', (string) $uid);
    }

    /** @return string valid | expired | used | invalid */
    public static function check(?string $token): string
    {
        $t = AuthToken::inspect($token, AuthToken::RESET);
        if ($t['status'] === 'valid') {
            $active = Database::scalar("SELECT `id` FROM `users` WHERE `id` = :id AND `status` = 'active'", [':id' => $t['user_id']]);
            return $active === null ? 'invalid' : 'valid';
        }
        return $t['status'];
    }

    public static function complete(?string $token, string $password): void
    {
        $t = AuthToken::inspect($token, AuthToken::RESET);
        self::assertUsable($t['status']);

        $uid = (int) $t['user_id'];
        $user = Database::one('SELECT `email`,`display_name`,`status`,`password_hash` FROM `users` WHERE `id` = :id', [':id' => $uid]);
        if ($user === null || $user['status'] !== 'active') {
            self::assertUsable('invalid');
        }

        Auth::assertPasswordStrength($password);
        if (password_verify($password, (string) $user['password_hash'])) {
            $msg = 'Please choose a password you have not used here before.';
            throw new ApiException($msg, 422, 'validation_failed', ['fields' => ['password' => $msg]]);
        }
        $hash = Auth::hashPassword($password);

        $ok = Database::transaction(static function () use ($t, $uid, $hash): bool {
            if (!AuthToken::consume((int) $t['id'])) {
                return false;
            }
            Database::run(
                'UPDATE `users`
                    SET `password_hash` = :h,
                        `auth_version` = `auth_version` + 1,
                        `password_changed_at` = UTC_TIMESTAMP(),
                        `email_verified_at` = COALESCE(`email_verified_at`, UTC_TIMESTAMP())
                  WHERE `id` = :id',
                [':h' => $hash, ':id' => $uid]
            );
            // Every other outstanding link dies with the old password, and every
            // mobile device is signed out (auth_version would refuse them anyway).
            Database::run("DELETE FROM `auth_tokens` WHERE `user_id` = :uid AND `used_at` IS NULL", [':uid' => $uid]);
            if (class_exists('ApiToken', false)) {
                ApiToken::revokeAllForUser($uid); // tolerant of a missing table (migration 010)
            }
            return true;
        });
        if (!$ok) {
            self::assertUsable('used');
        }

        LoginThrottle::clear((string) $user['email'], Request::ip());
        Database::run(
            "DELETE FROM `login_attempts` WHERE `purpose` = 'login' AND `successful` = 0 AND `email` = :e",
            [':e' => (string) $user['email']]
        );
        // Whoever is signed in on this browser starts over too.
        Session::logout();
        Audit::log($uid, 'user.password_reset', 'user', (string) $uid);

        $to = (string) $user['email']; $name = $user['display_name'];
        Deferred::add(static function () use ($to, $name): void {
            [$subject, $html, $text] = MailTemplates::passwordChanged($name, Mailer::appUrl() . '/pages/forgot-password.html');
            Mailer::send($to, $subject, $html, $text, $name);
        });
        AuthToken::prune();
    }

    private static function assertUsable(string $status): void
    {
        switch ($status) {
            case 'valid':
                return;
            case 'expired':
                throw new ApiException('This password reset link has expired. Please request a new one.', 410, 'token_expired');
            case 'used':
                throw new ApiException('This password reset link has already been used. Please request a new one if you still need to reset your password.', 410, 'token_used');
            default:
                throw new ApiException('This password reset link is not valid. Please request a new one.', 400, 'token_invalid');
        }
    }
}
