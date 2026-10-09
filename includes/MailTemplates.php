<?php
declare(strict_types=1);

/**
 * Transactional email content. Each method returns [subject, html, text].
 *
 * Rules: no passwords, no session data, nothing beyond the one link the
 * recipient needs. Every dynamic value is HTML-escaped. Layout is a single
 * 560px table with inline styles, which renders in Gmail, Outlook and Apple
 * Mail, and collapses to full width on phones.
 */
final class MailTemplates
{
    private const BRAND = 'Easy Budget Planner';

    /** @return array{0:string,1:string,2:string} */
    public static function verifyEmail(?string $name, string $url, int $ttlSeconds): array
    {
        $life = self::duration($ttlSeconds);
        $subject = 'Confirm your email for ' . self::BRAND;
        $intro = 'Thanks for signing up. Please confirm that this is your email address so we can finish setting up your account.';
        $html = self::layout(
            'Confirm your email address',
            self::greeting($name)
            . self::p($intro)
            . self::button('Confirm email address', $url)
            . self::p("This link expires in {$life} and can be used once.", true)
            . self::fallback($url)
            . self::p('If you did not create an account, you can safely ignore this email. No account will be activated without this confirmation.', true)
        );
        $text = self::plain($name, [
            $intro,
            "Confirm your email address:\n{$url}",
            "This link expires in {$life} and can be used once.",
            'If you did not create an account, you can safely ignore this email.',
        ]);
        return [$subject, $html, $text];
    }

    /** @return array{0:string,1:string,2:string} */
    public static function passwordReset(?string $name, string $url, int $ttlSeconds): array
    {
        $life = self::duration($ttlSeconds);
        $subject = 'Reset your ' . self::BRAND . ' password';
        $intro = 'We received a request to reset the password for your ' . self::BRAND . ' account.';
        $todo = 'To choose a new password, select the button below. You will be asked to enter it twice.';
        $html = self::layout(
            'Reset your password',
            self::greeting($name)
            . self::p($intro)
            . self::p($todo)
            . self::button('Reset password', $url)
            . self::p("For your security, this link expires in {$life} and works only once. Resetting your password signs you out on every device.", true)
            . self::fallback($url)
            . self::notice('Did not request this? You can ignore this email. Your password will stay the same, and nobody can change it without this link.')
        );
        $text = self::plain($name, [
            $intro,
            $todo,
            "Reset your password:\n{$url}",
            "This link expires in {$life} and works only once. Resetting your password signs you out on every device.",
            'Did not request this? You can ignore this email. Your password will stay the same.',
        ]);
        return [$subject, $html, $text];
    }

    /** Sent when someone tries to register an address that already has an account. */
    /** @return array{0:string,1:string,2:string} */
    public static function accountExists(?string $name, string $loginUrl, string $forgotUrl): array
    {
        $subject = 'You already have an ' . self::BRAND . ' account';
        $intro = 'Someone, hopefully you, tried to create a new account with this email address. You already have an account, so no new one was created.';
        $html = self::layout(
            'You already have an account',
            self::greeting($name)
            . self::p($intro)
            . self::button('Sign in', $loginUrl)
            . self::p('Forgot your password? <a href="' . self::e($forgotUrl) . '" style="color:#2563eb;">Reset it here</a>.', false, true)
            . self::notice('If this was not you, no action is needed. Your account has not been changed.')
        );
        $text = self::plain($name, [
            $intro,
            "Sign in:\n{$loginUrl}",
            "Forgot your password? Reset it here:\n{$forgotUrl}",
            'If this was not you, no action is needed. Your account has not been changed.',
        ]);
        return [$subject, $html, $text];
    }

    /** @return array{0:string,1:string,2:string} */
    public static function passwordChanged(?string $name, string $forgotUrl): array
    {
        $subject = 'Your ' . self::BRAND . ' password was changed';
        $when = gmdate('F j, Y \a\t H:i') . ' UTC';
        $intro = "The password for your account was changed on {$when}. For your security, every device that was signed in has been signed out.";
        $html = self::layout(
            'Your password was changed',
            self::greeting($name)
            . self::p(self::e($intro), false, true)
            . self::p('If you made this change, no action is needed.')
            . self::notice('Did not change your password? <a href="' . self::e($forgotUrl) . '" style="color:#b42318;font-weight:600;">Reset it now</a> to secure your account.', true)
        );
        $text = self::plain($name, [
            $intro,
            'If you made this change, no action is needed.',
            "Did not change your password? Reset it now:\n{$forgotUrl}",
        ]);
        return [$subject, $html, $text];
    }

    // ------------------------------------------------------------------

    private static function e(string $v): string
    {
        return htmlspecialchars($v, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    }

    private static function duration(int $seconds): string
    {
        if ($seconds % 86400 === 0) {
            $d = intdiv($seconds, 86400);
            return $d === 1 ? '24 hours' : "{$d} days";
        }
        if ($seconds % 3600 === 0) {
            $h = intdiv($seconds, 3600);
            return $h === 1 ? '1 hour' : "{$h} hours";
        }
        $m = max(1, intdiv($seconds, 60));
        return $m === 1 ? '1 minute' : "{$m} minutes";
    }

    private static function greeting(?string $name): string
    {
        $name = trim((string) $name);
        return self::p($name === '' ? 'Hello,' : 'Hi ' . self::e($name) . ',', false, true);
    }

    private static function p(string $text, bool $muted = false, bool $raw = false): string
    {
        $color = $muted ? '#667085' : '#344054';
        $size  = $muted ? '13px' : '15px';
        return '<p style="margin:0 0 16px;font-size:' . $size . ';line-height:1.6;color:' . $color . ';">'
            . ($raw ? $text : self::e($text)) . '</p>';
    }

    private static function button(string $label, string $url): string
    {
        $u = self::e($url);
        return '<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:8px 0 24px;"><tr>'
            . '<td style="border-radius:10px;background:#2563eb;">'
            . '<a href="' . $u . '" target="_blank" rel="noopener" style="display:inline-block;padding:13px 26px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px;">'
            . self::e($label) . '</a></td></tr></table>';
    }

    private static function fallback(string $url): string
    {
        $u = self::e($url);
        return '<p style="margin:0 0 16px;font-size:12px;line-height:1.5;color:#667085;">If the button does not work, copy and paste this link into your browser:<br>'
            . '<a href="' . $u . '" style="color:#2563eb;word-break:break-all;">' . $u . '</a></p>';
    }

    private static function notice(string $html, bool $danger = false): string
    {
        $bg = $danger ? '#fef3f2' : '#f9fafb';
        $bd = $danger ? '#fecdca' : '#eaecf0';
        return '<div style="margin:8px 0 0;padding:12px 14px;border:1px solid ' . $bd . ';background:' . $bg . ';border-radius:10px;font-size:13px;line-height:1.5;color:#475467;">'
            . $html . '</div>';
    }

    private static function layout(string $heading, string $inner): string
    {
        $brand = self::e(self::BRAND);
        $year = gmdate('Y');
        return '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
            . '<meta name="color-scheme" content="light"><title>' . self::e($heading) . '</title></head>'
            . '<body style="margin:0;padding:0;background:#f3f5f8;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;">'
            . '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f3f5f8;"><tr><td align="center" style="padding:32px 12px;">'
            . '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;">'
            . '<tr><td style="padding:0 4px 16px;font-size:16px;font-weight:700;color:#111418;">'
            . '<span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:#2563eb;margin-right:8px;"></span>' . $brand . '</td></tr>'
            . '<tr><td style="background:#ffffff;border:1px solid #e3e6eb;border-radius:14px;padding:32px 28px;">'
            . '<h1 style="margin:0 0 20px;font-size:21px;line-height:1.3;color:#111418;">' . self::e($heading) . '</h1>'
            . $inner
            . '</td></tr>'
            . '<tr><td style="padding:18px 4px 0;font-size:12px;line-height:1.5;color:#98a2b3;text-align:center;">'
            . 'This is an automated message from ' . $brand . '. Please do not reply.<br>&copy; ' . $year . ' ' . $brand
            . '</td></tr></table></td></tr></table></body></html>';
    }

    /** @param string[] $paragraphs */
    private static function plain(?string $name, array $paragraphs): string
    {
        $name = trim((string) $name);
        $out = ($name === '' ? 'Hello,' : "Hi {$name},") . "\n\n" . implode("\n\n", $paragraphs);
        return $out . "\n\n-- \n" . self::BRAND . "\nThis is an automated message. Please do not reply.\n";
    }
}
