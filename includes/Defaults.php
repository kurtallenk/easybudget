<?php
declare(strict_types=1);

/**
 * Reference data and id generation.
 *
 * These lists mirror assets/js/core.js and assets/js/store.legacy.js exactly.
 * They are the server-side allow-lists for select fields, so the frontend and
 * the API can never disagree about what a valid account type or method is.
 */
final class Defaults
{
    /** @var array<int,array{0:string,1:string,2:string,3:string}> name, kind, colour, emoji */
    public const CATEGORIES = [
        ['Salary', 'income', '#0f9d58', "\u{1F4BC}"],
        ['Freelance', 'income', '#12b886', "\u{1F9D1}\u{200D}\u{1F4BB}"],
        ['Business', 'income', '#2f9e44', "\u{1F3EA}"],
        ['Allowance', 'income', '#66a80f', "\u{1F381}"],
        ['Commission', 'income', '#37b24d', "\u{1F4C8}"],
        ['Bonus', 'income', '#099268', "\u{2728}"],
        ['Other Income', 'income', '#748ffc', "\u{2795}"],
        ['Food', 'expense', '#f76707', "\u{1F35C}"],
        ['Transportation', 'expense', '#4c6ef5', "\u{1F68C}"],
        ['Housing', 'expense', '#7048e8', "\u{1F3E0}"],
        ['Utilities', 'expense', '#0ca678', "\u{1F4A1}"],
        ['Internet', 'expense', '#1098ad', "\u{1F310}"],
        ['Phone', 'expense', '#22b8cf', "\u{1F4F1}"],
        ['Shopping', 'expense', '#e8590c', "\u{1F6CD}\u{FE0F}"],
        ['Health', 'expense', '#e03131', "\u{1FA7A}"],
        ['Entertainment', 'expense', '#d6336c', "\u{1F3AC}"],
        ['Education', 'expense', '#3b5bdb', "\u{1F4DA}"],
        ['Family', 'expense', '#f08c00', "\u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467}"],
        ['Personal', 'expense', '#9c36b5', "\u{1F9F4}"],
        ['Subscriptions', 'expense', '#ae3ec9', "\u{1F501}"],
        ['Debt', 'expense', '#c2255c', "\u{1F4B3}"],
        ['Other Expense', 'expense', '#868e96', "\u{1F4E6}"],
    ];

    public const ACCOUNT_TYPES  = ['cash', 'bank', 'ewallet', 'savings', 'credit', 'other'];
    public const PAYMENT_METHODS = ['Cash', 'Debit Card', 'Credit Card', 'Bank Transfer', 'E-Wallet', 'Cheque', 'Auto-Debit', 'Other'];
    public const FREQUENCIES     = ['daily', 'weekly', 'biweekly', 'monthly', 'quarterly', 'yearly'];
    public const BILL_REPEATS    = ['once', 'daily', 'weekly', 'biweekly', 'monthly', 'quarterly', 'yearly'];
    public const TX_TYPES        = ['income', 'expense', 'transfer'];
    public const CATEGORY_KINDS  = ['income', 'expense', 'both'];
    public const GOAL_STATUSES   = ['active', 'reached', 'paused'];
    public const THEMES          = ['light', 'dark', 'system'];
    /** Visual design templates (presentation only; see assets/css/app.css §3). */
    public const TEMPLATES       = ['modern', 'classic', 'minimal', 'futuristic'];
    public const DATE_FORMATS    = ['MMM D, YYYY', 'D MMM YYYY', 'MM/DD/YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD'];
    public const CURRENCIES      = ['PHP', 'USD', 'EUR', 'GBP', 'JPY', 'SGD', 'AUD', 'CAD', 'INR'];

    /** @return array<int,string> */
    public static function frequencyIds(): array { return self::FREQUENCIES; }

    /** @return array<string,mixed> the settings a brand-new account starts with */
    public static function settings(): array
    {
        return [
            'currency'         => 'PHP',
            'dateFormat'       => 'MMM D, YYYY',
            'firstDayOfWeek'   => 0,
            'theme'            => 'system',
            'brandHue'         => 221,
            'designTemplate'   => 'modern',
            'hideSampleBanner' => false,
            'onboarded'        => false,
        ];
    }

    /**
     * Same shape as the frontend's uid(): prefix_<base36 time><6 random base36>.
     * Randomness comes from random_int, not mt_rand.
     */
    public static function newId(string $prefix = 'id'): string
    {
        $time = base_convert((string) (int) (microtime(true) * 1000), 10, 36);
        $alphabet = '0123456789abcdefghijklmnopqrstuvwxyz';
        $rand = '';
        for ($i = 0; $i < 6; $i++) {
            $rand .= $alphabet[random_int(0, 35)];
        }
        return substr($prefix . '_' . $time . $rand, 0, 40);
    }

    /** Gives a new account the same 22 starter categories the SPA created. */
    public static function seedCategories(int $uid): void
    {
        foreach (self::CATEGORIES as $i => [$name, $kind, $color, $emoji]) {
            Database::run(
                'INSERT INTO `categories` (`user_id`,`id`,`name`,`kind`,`color`,`emoji`,`is_system`,`sort_order`)
                 VALUES (:uid,:id,:name,:kind,:color,:emoji,1,:sort)',
                [
                    ':uid'   => $uid,
                    ':id'    => self::newId('cat'),
                    ':name'  => $name,
                    ':kind'  => $kind,
                    ':color' => $color,
                    ':emoji' => $emoji,
                    ':sort'  => $i,
                ]
            );
        }
    }
}
