<?php
declare(strict_types=1);

/** Request parsing. Endpoints only ever see decoded, size-limited input. */
final class Request
{
    /** @var array<string,mixed>|null */
    private static ?array $body = null;

    public static function method(): string
    {
        return strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    }

    /** @param string[] $allowed */
    public static function assertMethod(array $allowed): void
    {
        if (!in_array(self::method(), $allowed, true)) {
            header('Allow: ' . implode(', ', $allowed));
            throw new ApiException('That action is not allowed here.', 405, 'method_not_allowed');
        }
    }

    public static function isWrite(): bool
    {
        return in_array(self::method(), ['POST', 'PUT', 'PATCH', 'DELETE'], true);
    }

    /** Decoded JSON body (objects only), cached. @return array<string,mixed> */
    public static function body(): array
    {
        if (self::$body !== null) {
            return self::$body;
        }

        $max      = (int) Config::get('limits.max_body_bytes', 524288);
        $declared = (int) ($_SERVER['CONTENT_LENGTH'] ?? 0);
        if ($declared > $max) {
            throw new ApiException('That request is too large.', 413, 'payload_too_large');
        }

        $raw = file_get_contents('php://input', false, null, 0, $max + 1);
        if ($raw === false || $raw === '') {
            return self::$body = [];
        }
        if (strlen($raw) > $max) {
            throw new ApiException('That request is too large.', 413, 'payload_too_large');
        }

        $decoded = json_decode($raw, true, 32);
        if (json_last_error() !== JSON_ERROR_NONE) {
            throw new ApiException('The request body was not valid JSON.', 400, 'invalid_json');
        }
        // json_decode('{}', true) gives [], and array_is_list([]) is true, so
        // the empty object has to be allowed explicitly: POST {} is a valid
        // "no options" request for endpoints like recurring/run.
        if (!is_array($decoded) || ($decoded !== [] && array_is_list($decoded))) {
            throw new ApiException('The request body must be a JSON object.', 400, 'invalid_json');
        }

        return self::$body = $decoded;
    }

    /** Query-string value (strings only; arrays are rejected). */
    public static function query(string $key, ?string $default = null): ?string
    {
        $v = $_GET[$key] ?? null;
        if ($v === null) {
            return $default;
        }
        if (!is_string($v)) {
            throw new ApiException('That query parameter is not valid.', 400, 'bad_request', ['param' => $key]);
        }
        return $v;
    }

    public static function queryInt(string $key, int $default, int $min, int $max): int
    {
        $v = self::query($key);
        if ($v === null || !preg_match('/^-?\d+$/', $v)) {
            return $default;
        }
        return max($min, min($max, (int) $v));
    }

    public static function queryBool(string $key, bool $default = false): bool
    {
        $v = self::query($key);
        return $v === null ? $default : in_array(strtolower($v), ['1', 'true', 'yes', 'on'], true);
    }

    public static function header(string $name): ?string
    {
        $v = $_SERVER['HTTP_' . strtoupper(str_replace('-', '_', $name))] ?? null;
        return is_string($v) ? $v : null;
    }

    public static function ip(): string
    {
        $remote  = (string) ($_SERVER['REMOTE_ADDR'] ?? '0.0.0.0');
        $trusted = (array) Config::get('security.trusted_proxies', []);

        // X-Forwarded-For is honoured only when the immediate peer is trusted,
        // otherwise any client could spoof past the login throttle.
        if ($trusted !== [] && in_array($remote, $trusted, true)) {
            $fwd = self::header('X-Forwarded-For');
            if ($fwd !== null) {
                $first = trim(explode(',', $fwd)[0]);
                if (filter_var($first, FILTER_VALIDATE_IP) !== false) {
                    return $first;
                }
            }
        }
        return filter_var($remote, FILTER_VALIDATE_IP) !== false ? $remote : '0.0.0.0';
    }

    public static function userAgent(): string
    {
        return substr((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 255);
    }

    /** Same-origin check for writes: defence in depth beside CSRF + SameSite. */
    public static function assertSameOrigin(): void
    {
        if (!Config::get('security.require_same_origin', true) || !self::isWrite()) {
            return;
        }

        $host   = (string) ($_SERVER['HTTP_HOST'] ?? '');
        $source = self::header('Origin') ?? self::header('Referer');
        if ($source === null || $host === '') {
            return; // the CSRF token still gates the request
        }

        $sourceHost = parse_url($source, PHP_URL_HOST);
        $sourcePort = parse_url($source, PHP_URL_PORT);
        if ($sourcePort !== null && !in_array((int) $sourcePort, [80, 443], true)) {
            $sourceHost .= ':' . $sourcePort;
        }

        if (!is_string($sourceHost) || strcasecmp($sourceHost, $host) !== 0) {
            Logger::warn('security.cross_origin_blocked', ['origin' => $source, 'host' => $host]);
            throw new ApiException('This request came from an untrusted origin.', 403, 'cross_origin');
        }
    }
}
