<?php
declare(strict_types=1);

/**
 * Cross-cutting helpers: Config, Logger, ApiException, Money, Dates.
 */

// ============================================================================
// CONFIG
// ============================================================================

final class Config
{
    /** @var array<string,mixed>|null */
    private static ?array $data = null;

    public static function load(): void
    {
        if (self::$data === null) {
            self::$data = require dirname(__DIR__) . '/config/config.php';
        }
    }

    /** Dot-path lookup: Config::get('limits.per_page_max', 200). */
    public static function get(string $path, $default = null)
    {
        self::load();
        $node = self::$data;
        foreach (explode('.', $path) as $segment) {
            if (!is_array($node) || !array_key_exists($segment, $node)) {
                return $default;
            }
            $node = $node[$segment];
        }
        return $node;
    }

    public static function isDebug(): bool
    {
        return (bool) self::get('app.debug', false);
    }
}

// ============================================================================
// LOGGER
// ============================================================================

final class Logger
{
    /** @param array<string,mixed> $context */
    public static function error(string $event, array $context = []): void { self::write('ERROR', $event, $context); }

    /** @param array<string,mixed> $context */
    public static function warn(string $event, array $context = []): void { self::write('WARN', $event, $context); }

    /** @param array<string,mixed> $context */
    public static function info(string $event, array $context = []): void { self::write('INFO', $event, $context); }

    /** @param array<string,mixed> $context */
    private static function write(string $level, string $event, array $context): void
    {
        $dir = (string) Config::get('app.log_path', dirname(__DIR__) . '/storage/logs');
        if (!is_dir($dir) && !@mkdir($dir, 0770, true) && !is_dir($dir)) {
            return; // logging must never break a request
        }

        $line = json_encode([
            'ts'      => gmdate('c'),
            'level'   => $level,
            'event'   => $event,
            'context' => self::scrub($context),
        ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);

        @file_put_contents($dir . '/app-' . gmdate('Y-m-d') . '.log', $line . PHP_EOL, FILE_APPEND | LOCK_EX);
    }

    /**
     * Secrets must never reach the log file.
     * @param array<string,mixed> $context
     * @return array<string,mixed>
     */
    private static function scrub(array $context): array
    {
        $secret = ['password', 'password_confirm', 'current_password', 'new_password',
                   'token', 'csrf', 'csrf_token', 'validator', 'password_hash', 'authorization'];
        foreach ($context as $k => $v) {
            if (in_array(strtolower((string) $k), $secret, true)) {
                $context[$k] = '[redacted]';
            } elseif (is_array($v)) {
                $context[$k] = self::scrub($v);
            }
        }
        return $context;
    }
}

// ============================================================================
// API EXCEPTION
// ============================================================================

/** An error whose message is safe to show the user. Anything else becomes a 500. */
class ApiException extends RuntimeException
{
    private string $errorCode;
    /** @var array<string,mixed> */
    private array $details;

    /** @param array<string,mixed> $details */
    public function __construct(string $message, int $status = 400, string $errorCode = 'bad_request', array $details = [])
    {
        parent::__construct($message, $status);
        $this->errorCode = $errorCode;
        $this->details   = $details;
    }

    public function status(): int
    {
        $s = $this->getCode();
        return ($s >= 400 && $s <= 599) ? (int) $s : 400;
    }

    public function errorCode(): string { return $this->errorCode; }

    /** @return array<string,mixed> */
    public function details(): array { return $this->details; }
}

// ============================================================================
// MONEY (integer minor units; mirrors assets/js/core.js)
// ============================================================================

final class Money
{
    /** Integer input is already minor units; strings/floats are major units. */
    public static function toMinor($value, int $minorUnit = 2): int
    {
        if (is_int($value)) {
            return self::guard($value);
        }
        if (is_bool($value) || $value === null || $value === '') {
            throw new ApiException('Please enter an amount.', 422, 'validation_failed');
        }
        if (is_string($value)) {
            $value = str_replace([',', ' '], '', trim($value));
        }
        if (!is_numeric($value)) {
            throw new ApiException('That amount is not a valid number.', 422, 'validation_failed');
        }
        $float = (float) $value;
        if (!is_finite($float)) {
            throw new ApiException('That amount is not a valid number.', 422, 'validation_failed');
        }
        return self::guard((int) round($float * (10 ** $minorUnit)));
    }

    public static function toMajor(int $minor, int $minorUnit = 2): float
    {
        return $minor / (10 ** $minorUnit);
    }

    /** Split $total into $parts with no lost or invented centavos. @return int[] */
    public static function allocate(int $total, int $parts): array
    {
        if ($parts < 1) {
            return [];
        }
        $base = intdiv($total, $parts);
        $rem  = $total - ($base * $parts);
        $out  = array_fill(0, $parts, $base);
        for ($i = 0; $i < abs($rem); $i++) {
            $out[$i] += $rem > 0 ? 1 : -1;
        }
        return $out;
    }

    private static function guard(int $minor): int
    {
        $max = (int) Config::get('limits.max_amount_minor', 999999999999);
        if ($minor > $max || $minor < -$max) {
            throw new ApiException('That amount is too large.', 422, 'validation_failed');
        }
        return $minor;
    }
}

// ============================================================================
// DATES (YYYY-MM-DD strings; mirrors assets/js/core.js)
// ============================================================================

final class Dates
{
    public const DATE = 'Y-m-d';

    public static function today(): string
    {
        return (new DateTimeImmutable('now', self::tz()))->format(self::DATE);
    }

    public static function isDate(?string $value): bool
    {
        if ($value === null || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $value)) {
            return false;
        }
        [$y, $m, $d] = array_map('intval', explode('-', $value));
        return checkdate($m, $d, $y);
    }

    public static function isMonthKey(?string $value): bool
    {
        return $value !== null && preg_match('/^\d{4}-(0[1-9]|1[0-2])$/', $value) === 1;
    }

    public static function addDays(string $date, int $days): string
    {
        return self::parse($date)->modify(($days >= 0 ? '+' : '') . $days . ' days')->format(self::DATE);
    }

    /** Month-safe: 2026-01-31 +1 month -> 2026-02-28, never 2026-03-03. */
    public static function addMonths(string $date, int $months): string
    {
        $d     = self::parse($date);
        $day   = (int) $d->format('j');
        $first = $d->modify('first day of this month')->modify(($months >= 0 ? '+' : '') . $months . ' months');
        $last  = (int) $first->format('t');
        return $first->setDate((int) $first->format('Y'), (int) $first->format('n'), min($day, $last))->format(self::DATE);
    }

    /** '2026-03' + 2 -> '2026-05' */
    public static function addMonthKey(string $ym, int $months): string
    {
        $d = DateTimeImmutable::createFromFormat('!Y-m-d', $ym . '-01', self::tz());
        if ($d === false) {
            throw new ApiException('That month is not valid.', 422, 'validation_failed');
        }
        return $d->modify(($months >= 0 ? '+' : '') . $months . ' months')->format('Y-m');
    }

    public static function monthStart(string $ym): string { return $ym . '-01'; }

    public static function monthEnd(string $ym): string
    {
        $d = DateTimeImmutable::createFromFormat('!Y-m-d', $ym . '-01', self::tz());
        if ($d === false) {
            throw new ApiException('That month is not valid.', 422, 'validation_failed');
        }
        return $d->format('Y-m-t');
    }

    public static function monthKey(string $date): string { return substr($date, 0, 7); }

    public static function diffDays(string $from, string $to): int
    {
        $a = self::parse($from)->setTime(0, 0);
        $b = self::parse($to)->setTime(0, 0);
        return (int) $a->diff($b)->format('%r%a');
    }

    /**
     * Advance a date by a frequency id. Unknown ids fall back to monthly; the
     * legacy frontend returned the same date, which caused the bill-rollover
     * drift recorded in docs/AUDIT.md.
     */
    public static function advance(string $date, ?string $frequency): string
    {
        return match ($frequency) {
            'daily'       => self::addDays($date, 1),
            'weekly'      => self::addDays($date, 7),
            'biweekly'    => self::addDays($date, 14),
            'semimonthly' => self::addDays($date, 15),
            'quarterly'   => self::addMonths($date, 3),
            'semiannual'  => self::addMonths($date, 6),
            'yearly'      => self::addMonths($date, 12),
            'once', null  => $date,
            default       => self::addMonths($date, 1),
        };
    }

    private static function parse(string $date): DateTimeImmutable
    {
        $d = DateTimeImmutable::createFromFormat('!' . self::DATE, $date, self::tz());
        if ($d === false) {
            throw new ApiException('That date is not valid.', 422, 'validation_failed', ['date' => $date]);
        }
        return $d;
    }

    private static function tz(): DateTimeZone
    {
        return new DateTimeZone((string) Config::get('app.timezone', 'UTC'));
    }
}
