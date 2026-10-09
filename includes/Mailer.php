<?php
declare(strict_types=1);

/**
 * Outgoing email: one small, dependency-free mailer.
 *
 * Drivers (config mail.driver):
 *   smtp  Native SMTP client (STARTTLS or implicit TLS, AUTH LOGIN/PLAIN).
 *         Works on shared hosts without Composer.
 *   mail  PHP mail(), for hosts that provide a local MTA.
 *   log   Development only: writes each message to storage/mail/*.eml.
 *
 * Every header value is stripped of CR/LF, so user input (a display name, an
 * email address) can never inject extra headers or recipients.
 */
final class Mailer
{
    /** @var array<int,array<string,string>> messages sent during this request (tests/diagnostics) */
    private static array $sent = [];

    /**
     * @param string $to   recipient address (already validated)
     * @return bool true when the transport accepted the message
     */
    public static function send(string $to, string $subject, string $html, string $text, ?string $toName = null): bool
    {
        $to = self::clean($to);
        if (filter_var($to, FILTER_VALIDATE_EMAIL) === false) {
            Logger::warn('mail.invalid_recipient');
            return false;
        }

        $driver = strtolower((string) Config::get('mail.driver', 'smtp'));
        $from   = self::clean((string) Config::get('mail.from_address', ''));
        if ($driver === 'smtp' && ((string) Config::get('mail.host', '') === '' || $from === '')) {
            // Not configured: never silently drop the message.
            Logger::error('mail.not_configured', ['driver' => $driver, 'hint' => 'Set MAIL_HOST and MAIL_FROM_ADDRESS (see docs/AUTH.md)']);
            $driver = 'log';
        }
        if ($from === '') {
            $host = parse_url(self::appUrlOrEmpty(), PHP_URL_HOST);
            $from = 'no-reply@' . (is_string($host) && $host !== '' ? $host : 'localhost');
        }

        $message = self::build($from, $to, $toName, $subject, $html, $text);

        try {
            switch ($driver) {
                case 'log':
                    $ok = self::writeToLog($to, $message);
                    break;
                case 'mail':
                    $ok = self::viaMail($from, $to, $subject, $message);
                    break;
                default:
                    (new SmtpTransport(
                        (string) Config::get('mail.host'),
                        (int) Config::get('mail.port', 587),
                        strtolower((string) Config::get('mail.encryption', 'tls')),
                        (string) Config::get('mail.username', ''),
                        (string) Config::get('mail.password', ''),
                        (int) Config::get('mail.timeout', 15),
                        (bool) Config::get('mail.verify_peer', true)
                    ))->send($from, $to, $message['raw']);
                    $ok = true;
            }
        } catch (Throwable $e) {
            Logger::error('mail.send_failed', ['driver' => $driver, 'error' => $e->getMessage()]);
            $ok = false;
        }

        if ($ok) {
            self::$sent[] = ['to' => $to, 'subject' => $subject];
            Logger::info('mail.sent', ['driver' => $driver, 'subject' => $subject]);
        }
        return $ok;
    }

    /**
     * Public base URL for links in emails. In production it must come from
     * config (app.url / APP_URL), never from the request: a forged Host header
     * would otherwise turn a reset email into a link to an attacker's site.
     */
    public static function appUrl(): string
    {
        $url = self::appUrlOrEmpty();
        if ($url !== '') {
            return $url;
        }
        if ((string) Config::get('app.env', 'production') === 'development') {
            $host = (string) ($_SERVER['HTTP_HOST'] ?? '127.0.0.1');
            if (!preg_match('/^[A-Za-z0-9.\-]+(:\d{1,5})?$/', $host)) {
                $host = '127.0.0.1';
            }
            $https = ($_SERVER['HTTPS'] ?? '') !== '' && ($_SERVER['HTTPS'] ?? '') !== 'off';
            return ($https ? 'https://' : 'http://') . $host;
        }
        throw new RuntimeException('app.url (APP_URL) must be set before emails with links can be sent.');
    }

    private static function appUrlOrEmpty(): string
    {
        $url = rtrim(trim((string) Config::get('app.url', '')), '/');
        return preg_match('#^https?://[^\s/]+(/[^\s]*)?$#i', $url) ? $url : '';
    }

    /** @return array<int,array<string,string>> */
    public static function sentThisRequest(): array { return self::$sent; }

    private static function clean(string $v): string
    {
        return trim(str_replace(["\r", "\n", "\0"], '', $v));
    }

    private static function encodeHeader(string $v): string
    {
        $v = self::clean($v);
        return preg_match('/[^\x20-\x7E]/', $v) ? '=?UTF-8?B?' . base64_encode($v) . '?=' : $v;
    }

    private static function address(string $email, ?string $name): string
    {
        $name = $name === null ? '' : self::clean($name);
        if ($name === '') {
            return '<' . $email . '>';
        }
        $quoted = preg_match('/[^\x20-\x7E]/', $name)
            ? self::encodeHeader($name)
            : '"' . addcslashes($name, '"\\') . '"';
        return $quoted . ' <' . $email . '>';
    }

    /** @return array{headers:string,body:string,raw:string,subject:string} */
    private static function build(string $from, string $to, ?string $toName, string $subject, string $html, string $text): array
    {
        $boundary = 'bp_' . bin2hex(random_bytes(12));
        $domain   = substr((string) strrchr($from, '@'), 1) ?: 'localhost';
        $replyTo  = self::clean((string) Config::get('mail.reply_to', ''));

        $headers = [
            'Date: ' . date(DATE_RFC2822),
            'From: ' . self::address($from, (string) Config::get('mail.from_name', 'Easy Budget Planner')),
            'To: ' . self::address($to, $toName),
            'Subject: ' . self::encodeHeader($subject),
            'Message-ID: <' . bin2hex(random_bytes(16)) . '@' . $domain . '>',
            'MIME-Version: 1.0',
            'Content-Type: multipart/alternative; boundary="' . $boundary . '"',
            'Auto-Submitted: auto-generated',
            'X-Auto-Response-Suppress: All',
        ];
        if ($replyTo !== '' && filter_var($replyTo, FILTER_VALIDATE_EMAIL) !== false) {
            $headers[] = 'Reply-To: <' . $replyTo . '>';
        }

        $body = "This is a multi-part message in MIME format.\r\n\r\n"
            . "--{$boundary}\r\n"
            . "Content-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n"
            . chunk_split(base64_encode($text), 76, "\r\n")
            . "--{$boundary}\r\n"
            . "Content-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n"
            . chunk_split(base64_encode($html), 76, "\r\n")
            . "--{$boundary}--\r\n";

        $head = implode("\r\n", $headers);
        return ['headers' => $head, 'body' => $body, 'raw' => $head . "\r\n\r\n" . $body, 'subject' => $subject];
    }

    /** @param array{headers:string,body:string,raw:string,subject:string} $m */
    private static function viaMail(string $from, string $to, string $subject, array $m): bool
    {
        // mail() adds To/Subject itself, so strip them from the header block.
        $headers = preg_replace('/^(To|Subject): .*\r\n/m', '', $m['headers'] . "\r\n");
        return mail($to, self::encodeHeader($subject), $m['body'], rtrim((string) $headers), '-f' . $from);
    }

    /** @param array{headers:string,body:string,raw:string,subject:string} $m */
    private static function writeToLog(string $to, array $m): bool
    {
        $dir = (string) Config::get('mail.log_path', dirname(__DIR__) . '/storage/mail');
        if (!is_dir($dir) && !@mkdir($dir, 0770, true) && !is_dir($dir)) {
            return false;
        }
        $name = sprintf('%s/%s_%s_%s.eml', $dir, gmdate('Ymd\THis'), substr(hash('sha256', $to), 0, 10), bin2hex(random_bytes(4)));
        return @file_put_contents($name, $m['raw'], LOCK_EX) !== false;
    }
}

/** Minimal RFC 5321 client. Throws RuntimeException on any protocol error. */
final class SmtpTransport
{
    /** @var resource|null */
    private $sock = null;

    public function __construct(
        private string $host,
        private int $port,
        private string $encryption,
        private string $username,
        private string $password,
        private int $timeout,
        private bool $verifyPeer
    ) {
    }

    public function send(string $from, string $to, string $raw): void
    {
        $ctx = stream_context_create(['ssl' => [
            'verify_peer'       => $this->verifyPeer,
            'verify_peer_name'  => $this->verifyPeer,
            'allow_self_signed' => !$this->verifyPeer,
            'SNI_enabled'       => true,
            'peer_name'         => $this->host,
        ]]);
        $scheme = $this->encryption === 'ssl' ? 'ssl://' : 'tcp://';
        $errno = 0; $errstr = '';
        $sock = @stream_socket_client($scheme . $this->host . ':' . $this->port, $errno, $errstr, $this->timeout, STREAM_CLIENT_CONNECT, $ctx);
        if (!is_resource($sock)) {
            throw new RuntimeException("SMTP connect failed ({$errno}): {$errstr}");
        }
        $this->sock = $sock;
        stream_set_timeout($sock, $this->timeout);

        try {
            $this->expect([220]);
            $ehloHost = $this->ehloName();
            $caps = $this->ehlo($ehloHost);

            if ($this->encryption === 'tls') {
                if (stripos($caps, 'STARTTLS') === false) {
                    throw new RuntimeException('SMTP server does not offer STARTTLS.');
                }
                $this->command('STARTTLS', [220]);
                $method = STREAM_CRYPTO_METHOD_TLSv1_2_CLIENT;
                if (defined('STREAM_CRYPTO_METHOD_TLSv1_3_CLIENT')) {
                    $method |= STREAM_CRYPTO_METHOD_TLSv1_3_CLIENT;
                }
                if (@stream_socket_enable_crypto($sock, true, $method) !== true) {
                    throw new RuntimeException('SMTP STARTTLS negotiation failed.');
                }
                $caps = $this->ehlo($ehloHost);
            }

            if ($this->username !== '') {
                if (preg_match('/AUTH[ =][^\r\n]*PLAIN/i', $caps) && !preg_match('/AUTH[ =][^\r\n]*LOGIN/i', $caps)) {
                    $this->command('AUTH PLAIN ' . base64_encode("\0" . $this->username . "\0" . $this->password), [235], true);
                } else {
                    $this->command('AUTH LOGIN', [334]);
                    $this->command(base64_encode($this->username), [334], true);
                    $this->command(base64_encode($this->password), [235], true);
                }
            }

            $this->command('MAIL FROM:<' . $from . '>', [250]);
            $this->command('RCPT TO:<' . $to . '>', [250, 251]);
            $this->command('DATA', [354]);
            // Normalise line endings and dot-stuff (RFC 5321 4.5.2).
            $data = preg_replace("/\r?\n/", "\r\n", $raw);
            $data = preg_replace('/^\./m', '..', (string) $data);
            $this->write(rtrim((string) $data, "\r\n") . "\r\n.\r\n");
            $this->expect([250]);
            $this->command('QUIT', [221, 250], false, true);
        } finally {
            if (is_resource($this->sock)) {
                fclose($this->sock);
            }
            $this->sock = null;
        }
    }

    private function ehloName(): string
    {
        $h = (string) ($_SERVER['SERVER_NAME'] ?? gethostname() ?: 'localhost');
        return preg_match('/^[A-Za-z0-9.\-]+$/', $h) ? $h : 'localhost';
    }

    private function ehlo(string $name): string
    {
        try {
            return $this->command('EHLO ' . $name, [250]);
        } catch (RuntimeException $e) {
            return $this->command('HELO ' . $name, [250]);
        }
    }

    /** @param int[] $codes */
    private function command(string $line, array $codes, bool $secret = false, bool $lenient = false): string
    {
        $this->write($line . "\r\n");
        try {
            return $this->expect($codes, $secret ? '[credentials]' : $line);
        } catch (RuntimeException $e) {
            if ($lenient) {
                return '';
            }
            throw $e;
        }
    }

    private function write(string $data): void
    {
        $len = strlen($data);
        for ($off = 0; $off < $len;) {
            $n = @fwrite($this->sock, substr($data, $off, 8192));
            if ($n === false || $n === 0) {
                throw new RuntimeException('SMTP write failed.');
            }
            $off += $n;
        }
    }

    /** @param int[] $codes */
    private function expect(array $codes, string $context = 'greeting'): string
    {
        $all = '';
        while (true) {
            $line = fgets($this->sock, 1024);
            if ($line === false) {
                throw new RuntimeException("SMTP connection closed (after {$context}).");
            }
            $all .= $line;
            if (strlen($line) < 4 || $line[3] !== '-') {
                break;
            }
        }
        $code = (int) substr($all, 0, 3);
        if (!in_array($code, $codes, true)) {
            throw new RuntimeException("SMTP unexpected reply {$code} (after {$context}): " . trim(substr($all, 0, 200)));
        }
        return $all;
    }
}

/**
 * Work that should run after the response is on its way (sending email).
 * Keeps response time identical whether or not an email was sent, which
 * matters for account-enumeration resistance on forgot-password/resend.
 */
final class Deferred
{
    /** @var callable[] */
    private static array $jobs = [];
    private static bool $registered = false;
    private static bool $immediate = false;

    public static function add(callable $job): void
    {
        if (self::$immediate) {
            self::safely($job);
            return;
        }
        self::$jobs[] = $job;
        if (!self::$registered) {
            self::$registered = true;
            register_shutdown_function([self::class, 'flush']);
        }
    }

    /** CLI scripts and tests can opt out of deferral. */
    public static function runImmediately(bool $on = true): void { self::$immediate = $on; }

    public static function flush(): void
    {
        if (self::$jobs === []) {
            return;
        }
        ignore_user_abort(true);
        if (session_status() === PHP_SESSION_ACTIVE) {
            session_write_close();
        }
        if (function_exists('fastcgi_finish_request')) {
            fastcgi_finish_request();
        } elseif (function_exists('litespeed_finish_request')) {
            litespeed_finish_request();
        } else {
            @ob_end_flush();
            @flush();
        }
        $jobs = self::$jobs;
        self::$jobs = [];
        foreach ($jobs as $job) {
            self::safely($job);
        }
    }

    private static function safely(callable $job): void
    {
        try {
            $job();
        } catch (Throwable $e) {
            Logger::error('deferred.failed', ['error' => $e->getMessage()]);
        }
    }
}
