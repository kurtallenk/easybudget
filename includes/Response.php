<?php
declare(strict_types=1);

/** JSON responses + security headers. Every endpoint exits through here. */
final class Response
{
    private static bool $sent = false;

    public static function securityHeaders(): void
    {
        if (headers_sent()) {
            return;
        }
        header('X-Content-Type-Options: nosniff');
        header('X-Frame-Options: DENY');
        header('Referrer-Policy: same-origin');
        header('Cross-Origin-Opener-Policy: same-origin');
        header('Cross-Origin-Resource-Policy: same-origin');
        header('Permissions-Policy: geolocation=(), microphone=(), camera=(), payment=()');
        header('Cache-Control: no-store, no-cache, must-revalidate, private');
        header('Pragma: no-cache');
        header_remove('X-Powered-By');
    }

    /** @param array<string,mixed> $payload */
    public static function json(array $payload, int $status = 200): void
    {
        if (self::$sent) {
            return;
        }
        self::$sent = true;

        self::securityHeaders();
        if (!headers_sent()) {
            http_response_code($status);
            header('Content-Type: application/json; charset=utf-8');
        }

        echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION);
    }

    /** @param array<string,mixed> $meta */
    public static function ok($data = null, array $meta = []): void
    {
        $body = ['ok' => true, 'data' => $data];
        if ($meta !== []) {
            $body['meta'] = $meta;
        }
        self::json($body, 200);
    }

    public static function created($data = null): void { self::json(['ok' => true, 'data' => $data], 201); }

    public static function noContent(): void { self::json(['ok' => true, 'data' => null], 200); }

    /**
     * Client-safe error. `details` carries field-level validation messages only,
     * never driver text or stack information.
     *
     * @param array<string,mixed> $details
     */
    public static function error(string $message, int $status = 400, string $code = 'bad_request', array $details = []): void
    {
        $body = ['ok' => false, 'error' => ['code' => $code, 'message' => $message]];
        if ($details !== []) {
            $body['error']['details'] = $details;
        }
        self::json($body, $status);
    }

    public static function exception(ApiException $e): void
    {
        self::error($e->getMessage(), $e->status(), $e->errorCode(), $e->details());
    }

    /** Unexpected failure: real reason to the log, generic message to the client. */
    public static function serverError(Throwable $e, string $event = 'unhandled_exception'): void
    {
        Logger::error($event, [
            'type'    => get_class($e),
            'message' => $e->getMessage(),
            'file'    => $e->getFile(),
            'line'    => $e->getLine(),
        ]);

        $payload = ['ok' => false, 'error' => [
            'code'    => 'server_error',
            'message' => 'Something went wrong on our side. Please try again.',
        ]];

        if (Config::isDebug()) {
            $payload['error']['debug'] = [
                'type'    => get_class($e),
                'message' => $e->getMessage(),
                'file'    => basename($e->getFile()) . ':' . $e->getLine(),
            ];
        }

        self::json($payload, 500);
    }
}
