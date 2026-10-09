<?php
declare(strict_types=1);

/**
 * Repositories - the only place that talks SQL for user-owned data.
 *
 * Contract with the frontend
 * --------------------------
 * Every read method returns the exact camelCase shapes documented in
 * docs/AUDIT.md, so assets/js views need no changes:
 *
 *   settings     { currency, dateFormat, firstDayOfWeek, theme, brandHue,
 *                  hideSampleBanner, onboarded }
 *   categories   { id, name, kind, color, emoji, system, archived }
 *   accounts     { id, name, type, openingBalance, color, note, archived,
 *                  sample, createdAt }
 *   transactions { id, type, amount, description, categoryId, date, accountId,
 *                  toAccountId, method, notes, recurringId, billId, goalId,
 *                  sample, createdAt, updatedAt }
 *   budgets      { id, month, lines[], incomePlan[], savingsPlan[], createdAt }
 *   goals        { id, name, target, current, targetDate, accountId,
 *                  description, emoji, color, archived, sample, createdAt }
 *   recurring    { id, name, type, amount, categoryId, accountId, method,
 *                  frequency, nextDate, endDate, autoPost, paused, notes,
 *                  lastPosted, sample, createdAt }
 *   bills        { id, name, amount, dueDate, categoryId, accountId, method,
 *                  repeat, notes, paidOn, paidTxId, sample, createdAt }
 *   grocery      { id, name, categoryId, price, checked, checkedAt, createdAt,
 *                  updatedAt }          price = minor units, null = not bought
 *   groceryLists { id, name, items[{ id, name, categoryId }], createdAt,
 *                  updatedAt }          reusable shopping templates
 *   savedBudgets { id, name, sourceMonth, lines[{ id, categoryId, amount }],
 *                  incomePlan[], savingsPlan[], total, createdAt, updatedAt }
 *                                       reusable budget templates
 *
 * Security rules that are not optional
 * ------------------------------------
 *  1. $uid always comes from Auth::requireUser(); a repository never reads a
 *     user id out of the request body.
 *  2. Every statement that touches a user-owned table carries
 *     `user_id = :uid`, including UPDATE and DELETE.
 *  3. Values are bound; identifiers are never interpolated from client input.
 *     Sortable columns come from hard-coded allow-lists.
 *  4. Money is read back with an explicit (int) cast: BIGINT must never become
 *     a float on the way to JSON.
 *  5. Foreign references supplied by the client (accountId, categoryId, ...)
 *     are checked with Auth::ownsOrFail before they are written, which turns a
 *     cross-tenant reference into a 404 rather than a silent FK error.
 *
 * NOTE: this file has never been executed. There is no PHP binary and no MySQL
 * server in the build environment; see PROJECT_PROGRESS.md.
 */

// ============================================================================
// SHARED HELPERS
// ============================================================================

final class Repo
{
    /** MySQL DATETIME (session tz is UTC) -> ISO-8601, matching the SPA. */
    public static function iso(?string $dt): ?string
    {
        if ($dt === null || $dt === '') {
            return null;
        }
        $d = DateTimeImmutable::createFromFormat('Y-m-d H:i:s', $dt, new DateTimeZone('UTC'));
        return $d === false ? $dt : $d->format('Y-m-d\TH:i:s\Z');
    }

    public static function now(): string
    {
        return gmdate('Y-m-d H:i:s');
    }

    /** BIGINT columns arrive as int|string depending on driver build. */
    public static function money($value): int
    {
        return (int) $value;
    }

    public static function flag($value): bool
    {
        return (int) $value === 1;
    }

    public static function str($value): ?string
    {
        return $value === null ? null : (string) $value;
    }

    /** Refuses to create row number N+1 once a per-user cap is reached. */
    public static function assertUnderLimit(int $uid, string $table, string $configKey, string $label): void
    {
        $max = (int) Config::get($configKey, 0);
        if ($max <= 0) {
            return;
        }
        $allowed = ['accounts', 'categories', 'savings_goals', 'bills', 'recurring_transactions', 'grocery_items', 'grocery_lists', 'saved_budgets'];
        if (!in_array($table, $allowed, true)) {
            throw new LogicException('Row cap requested for an unknown table: ' . $table);
        }
        $count = (int) Database::scalar(
            "SELECT COUNT(*) FROM `{$table}` WHERE `user_id` = :uid",
            [':uid' => $uid]
        );
        if ($count >= $max) {
            throw new ApiException("You have reached the maximum number of {$label} ({$max}).", 422, 'limit_reached');
        }
    }

    /**
     * Resolves a client-supplied sort key through an allow-list. The returned
     * string is a literal from this file, never client text.
     *
     * @param array<string,string> $allowed
     */
    public static function sortColumn(array $allowed, ?string $key, string $fallback): string
    {
        if ($key !== null && isset($allowed[$key])) {
            return $allowed[$key];
        }
        return $allowed[$fallback];
    }

    public static function sortDirection(?string $dir): string
    {
        return strtolower((string) $dir) === 'asc' ? 'ASC' : 'DESC';
    }
}

// ============================================================================
// SETTINGS
// ============================================================================

final class SettingsRepo
{
    /** Columns the client may change, mapped to their SQL column. */
    private const WRITABLE = [
        'currency'         => 'currency',
        'dateFormat'       => 'date_format',
        'firstDayOfWeek'   => 'first_day_of_week',
        'theme'            => 'theme',
        'brandHue'         => 'brand_hue',
        'designTemplate'   => 'design_template',
        'hideSampleBanner' => 'hide_sample_banner',
        'onboarded'        => 'onboarded',
    ];

    /** Creates the row on first use so callers never deal with a null row. */
    public static function ensure(int $uid): void
    {
        Database::run(
            'INSERT INTO `user_settings` (`user_id`) VALUES (:uid)
             ON DUPLICATE KEY UPDATE `user_id` = `user_id`',
            [':uid' => $uid]
        );
    }

    /** @return array<string,mixed> */
    public static function get(int $uid): array
    {
        $row = Database::one(
            'SELECT * FROM `user_settings` WHERE `user_id` = :uid',
            [':uid' => $uid]
        );

        if ($row === null) {
            self::ensure($uid);
            $row = Database::one(
                'SELECT * FROM `user_settings` WHERE `user_id` = :uid',
                [':uid' => $uid]
            );
        }

        return self::shape($row ?? []);
    }

    /**
     * @param array<string,mixed> $patch already validated camelCase values
     * @return array<string,mixed> the stored settings
     */
    public static function update(int $uid, array $patch): array
    {
        self::ensure($uid);

        $sets   = [];
        $params = [':uid' => $uid];
        foreach (self::WRITABLE as $key => $column) {
            if (!array_key_exists($key, $patch)) {
                continue;
            }
            // design_template arrives with migration 006; until it is applied
            // the preference is skipped instead of failing the whole update.
            // Migration 007 widens the ENUM for 'futuristic'; a value the column
            // cannot store is skipped too (the browser keeps it in its local mirror).
            if ($column === 'design_template'
                && !in_array($patch[$key], self::templateValues(), true)) {
                continue;
            }
            $value = $patch[$key];
            if (is_bool($value)) {
                $value = $value ? 1 : 0;
            }
            $sets[]              = "`{$column}` = :{$column}";
            $params[":{$column}"] = $value;
        }

        if ($sets !== []) {
            Database::run(
                'UPDATE `user_settings` SET ' . implode(', ', $sets) . ' WHERE `user_id` = :uid',
                $params
            );
        }

        return self::get($uid);
    }

    public static function hasSampleData(int $uid): bool
    {
        return Repo::flag(Database::scalar(
            'SELECT `has_sample_data` FROM `user_settings` WHERE `user_id` = :uid',
            [':uid' => $uid]
        ));
    }

    public static function setHasSampleData(int $uid, bool $value): void
    {
        self::ensure($uid);
        Database::run(
            'UPDATE `user_settings` SET `has_sample_data` = :v WHERE `user_id` = :uid',
            [':uid' => $uid, ':v' => $value ? 1 : 0]
        );
    }

    /** @var array<int,string>|null */
    private static ?array $templateValues = null;

    /**
     * Template ids the user_settings.design_template column can store:
     * [] before migration 006, the ENUM members after it (007 adds 'futuristic').
     * @return array<int,string>
     */
    private static function templateValues(): array
    {
        if (self::$templateValues === null) {
            $type = (string) (Database::scalar(
                "SELECT COLUMN_TYPE FROM information_schema.COLUMNS
                  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'user_settings'
                    AND COLUMN_NAME = 'design_template'"
            ) ?? '');
            preg_match_all("/'([^']*)'/", $type, $m);
            self::$templateValues = array_values(array_intersect($m[1], Defaults::TEMPLATES));
        }
        return self::$templateValues;
    }

    /** True when every template in Defaults::TEMPLATES can be stored (006 + 007 applied). */
    private static function templateColumnReady(): bool
    {
        return array_diff(Defaults::TEMPLATES, self::templateValues()) === [];
    }

    /** @param array<string,mixed> $row @return array<string,mixed> */
    private static function shape(array $row): array
    {
        $defaults = Defaults::settings();
        if ($row === []) {
            return $defaults;
        }
        $out = [
            'currency'         => (string) ($row['currency'] ?? $defaults['currency']),
            'dateFormat'       => (string) ($row['date_format'] ?? $defaults['dateFormat']),
            'firstDayOfWeek'   => (int) ($row['first_day_of_week'] ?? 0),
            'theme'            => (string) ($row['theme'] ?? 'system'),
            'brandHue'         => (int) ($row['brand_hue'] ?? 221),
            'designTemplate'   => in_array($row['design_template'] ?? null, Defaults::TEMPLATES, true)
                                    ? (string) $row['design_template'] : 'modern',
            'hideSampleBanner' => Repo::flag($row['hide_sample_banner'] ?? 0),
            'onboarded'        => Repo::flag($row['onboarded'] ?? 0),
            'hasSampleData'    => Repo::flag($row['has_sample_data'] ?? 0),
        ];
        // Until migrations 006/007 are applied the server cannot hold every
        // template, so it leaves the choice to the browser's local mirror.
        if (!self::templateColumnReady()) {
            unset($out['designTemplate']);
        }
        return $out;
    }
}

// ============================================================================
// CATEGORIES
// ============================================================================

final class CategoryRepo
{
    /** @return array<int,array<string,mixed>> */
    public static function all(int $uid, bool $includeArchived = true): array
    {
        $sql = 'SELECT * FROM `categories` WHERE `user_id` = :uid';
        if (!$includeArchived) {
            $sql .= ' AND `archived` = 0';
        }
        $sql .= ' ORDER BY `sort_order` ASC, `name` ASC';

        return array_map([self::class, 'shape'], Database::all($sql, [':uid' => $uid]));
    }

    /** @return array<string,mixed>|null */
    public static function find(int $uid, string $id): ?array
    {
        $row = Database::one(
            'SELECT * FROM `categories` WHERE `user_id` = :uid AND `id` = :id',
            [':uid' => $uid, ':id' => $id]
        );
        return $row === null ? null : self::shape($row);
    }

    /** @return array<string,mixed> */
    public static function findOrFail(int $uid, string $id): array
    {
        $row = self::find($uid, $id);
        if ($row === null) {
            throw new ApiException('That category could not be found.', 404, 'not_found');
        }
        return $row;
    }

    /** @param array<string,mixed> $data @return array<string,mixed> */
    public static function create(int $uid, array $data): array
    {
        Repo::assertUnderLimit($uid, 'categories', 'limits.max_categories', 'categories');

        $id   = Defaults::newId('cat');
        $kind = in_array($data['kind'] ?? 'expense', Defaults::CATEGORY_KINDS, true) ? $data['kind'] : 'expense';

        self::assertNameFree($uid, (string) $data['name'], (string) $kind, null);

        $sort = (int) Database::scalar(
            'SELECT COALESCE(MAX(`sort_order`), 0) + 1 FROM `categories` WHERE `user_id` = :uid',
            [':uid' => $uid]
        );

        Database::run(
            'INSERT INTO `categories`
                (`user_id`,`id`,`name`,`kind`,`color`,`emoji`,`is_system`,`archived`,`is_sample`,`sort_order`)
             VALUES (:uid,:id,:name,:kind,:color,:emoji,0,0,:sample,:sort)',
            [
                ':uid'    => $uid,
                ':id'     => $id,
                ':name'   => (string) $data['name'],
                ':kind'   => (string) $kind,
                ':color'  => (string) ($data['color'] ?? '#4c6ef5'),
                ':emoji'  => $data['emoji'] ?? "\u{1F3F7}\u{FE0F}",
                ':sample' => !empty($data['sample']) ? 1 : 0,
                ':sort'   => $sort,
            ]
        );

        return self::findOrFail($uid, $id);
    }

    /** @param array<string,mixed> $patch @return array<string,mixed> */
    public static function update(int $uid, string $id, array $patch): array
    {
        $existing = self::findOrFail($uid, $id);

        $map = [
            'name'     => 'name',
            'kind'     => 'kind',
            'color'    => 'color',
            'emoji'    => 'emoji',
            'archived' => 'archived',
        ];

        if (array_key_exists('name', $patch) || array_key_exists('kind', $patch)) {
            self::assertNameFree(
                $uid,
                (string) ($patch['name'] ?? $existing['name']),
                (string) ($patch['kind'] ?? $existing['kind']),
                $id
            );
        }

        $sets   = [];
        $params = [':uid' => $uid, ':id' => $id];
        foreach ($map as $key => $column) {
            if (!array_key_exists($key, $patch)) {
                continue;
            }
            $value = $patch[$key];
            if (is_bool($value)) {
                $value = $value ? 1 : 0;
            }
            $sets[]               = "`{$column}` = :{$column}";
            $params[":{$column}"] = $value;
        }

        if ($sets !== []) {
            Database::run(
                'UPDATE `categories` SET ' . implode(', ', $sets) . ' WHERE `user_id` = :uid AND `id` = :id',
                $params
            );
        }

        return self::findOrFail($uid, $id);
    }

    /**
     * Legacy behaviour: a category still referenced by a transaction is
     * archived rather than deleted, so historical rows keep their label.
     *
     * @return array{archived:bool}
     */
    public static function delete(int $uid, string $id): array
    {
        self::findOrFail($uid, $id);

        return Database::transaction(static function () use ($uid, $id): array {
            $inUse = (int) Database::scalar(
                'SELECT COUNT(*) FROM `transactions` WHERE `user_id` = :uid AND `category_id` = :id',
                [':uid' => $uid, ':id' => $id]
            ) > 0;

            // Budget lines are dropped either way: a plan for a dead category
            // would otherwise keep inflating the monthly plan total.
            Database::run(
                'DELETE FROM `budget_lines` WHERE `user_id` = :uid AND `category_id` = :id',
                [':uid' => $uid, ':id' => $id]
            );

            if ($inUse) {
                Database::run(
                    'UPDATE `categories` SET `archived` = 1 WHERE `user_id` = :uid AND `id` = :id',
                    [':uid' => $uid, ':id' => $id]
                );
            } else {
                // Composite foreign keys cannot use ON DELETE SET NULL (user_id
                // is NOT NULL), so the detach is explicit and happens here.
                foreach ([
                    'UPDATE `bills` SET `category_id` = NULL WHERE `user_id` = :uid AND `category_id` = :id',
                    'UPDATE `recurring_transactions` SET `category_id` = NULL WHERE `user_id` = :uid AND `category_id` = :id',
                    'UPDATE `transaction_splits` SET `category_id` = NULL WHERE `user_id` = :uid AND `category_id` = :id',
                    'UPDATE `grocery_items` SET `category_id` = NULL WHERE `user_id` = :uid AND `category_id` = :id',
                    'UPDATE `grocery_list_items` SET `category_id` = NULL WHERE `user_id` = :uid AND `category_id` = :id',
                    'UPDATE `saved_budget_lines` SET `category_id` = NULL WHERE `user_id` = :uid AND `category_id` = :id',
                ] as $sql) {
                    Database::run($sql, [':uid' => $uid, ':id' => $id]);
                }
                Database::run(
                    'DELETE FROM `categories` WHERE `user_id` = :uid AND `id` = :id',
                    [':uid' => $uid, ':id' => $id]
                );
            }

            return ['archived' => $inUse];
        });
    }

    /** Guards the (user_id, name, kind) unique key with a friendly message. */
    private static function assertNameFree(int $uid, string $name, string $kind, ?string $exceptId): void
    {
        $sql    = 'SELECT COUNT(*) FROM `categories`
                   WHERE `user_id` = :uid AND `name` = :name AND `kind` = :kind';
        $params = [':uid' => $uid, ':name' => $name, ':kind' => $kind];

        if ($exceptId !== null) {
            $sql            .= ' AND `id` <> :id';
            $params[':id']   = $exceptId;
        }

        if ((int) Database::scalar($sql, $params) > 0) {
            throw new ApiException('That category already exists.', 422, 'validation_failed', [
                'fields' => ['name' => 'That category already exists.'],
            ]);
        }
    }

    /** @param array<string,mixed> $row @return array<string,mixed> */
    public static function shape(array $row): array
    {
        return [
            'id'        => (string) $row['id'],
            'name'      => (string) $row['name'],
            'kind'      => (string) $row['kind'],
            'color'     => (string) $row['color'],
            'emoji'     => Repo::str($row['emoji']),
            'system'    => Repo::flag($row['is_system']),
            'archived'  => Repo::flag($row['archived']),
            'sample'    => Repo::flag($row['is_sample'] ?? 0),
            'createdAt' => Repo::iso($row['created_at'] ?? null),
        ];
    }
}

// ============================================================================
// ACCOUNTS
// ============================================================================

final class AccountRepo
{
    /** @return array<int,array<string,mixed>> */
    public static function all(int $uid, bool $includeArchived = true): array
    {
        $sql = 'SELECT * FROM `accounts` WHERE `user_id` = :uid';
        if (!$includeArchived) {
            $sql .= ' AND `archived` = 0';
        }
        $sql .= ' ORDER BY `sort_order` ASC, `created_at` ASC';

        return array_map([self::class, 'shape'], Database::all($sql, [':uid' => $uid]));
    }

    /** @return array<string,mixed>|null */
    public static function find(int $uid, string $id): ?array
    {
        $row = Database::one(
            'SELECT * FROM `accounts` WHERE `user_id` = :uid AND `id` = :id',
            [':uid' => $uid, ':id' => $id]
        );
        return $row === null ? null : self::shape($row);
    }

    /** @return array<string,mixed> */
    public static function findOrFail(int $uid, string $id): array
    {
        $row = self::find($uid, $id);
        if ($row === null) {
            throw new ApiException('That account could not be found.', 404, 'not_found');
        }
        return $row;
    }

    /** @param array<string,mixed> $data @return array<string,mixed> */
    public static function create(int $uid, array $data): array
    {
        Repo::assertUnderLimit($uid, 'accounts', 'limits.max_accounts', 'accounts');

        $id   = Defaults::newId('acc');
        $type = in_array($data['type'] ?? 'cash', Defaults::ACCOUNT_TYPES, true) ? (string) ($data['type'] ?? 'cash') : 'cash';

        self::assertNameFree($uid, (string) $data['name'], null);

        $sort = (int) Database::scalar(
            'SELECT COALESCE(MAX(`sort_order`), 0) + 1 FROM `accounts` WHERE `user_id` = :uid',
            [':uid' => $uid]
        );

        Database::run(
            'INSERT INTO `accounts`
                (`user_id`,`id`,`name`,`type`,`opening_balance`,`currency`,`color`,`note`,
                 `archived`,`is_sample`,`sort_order`)
             VALUES (:uid,:id,:name,:type,:opening,:currency,:color,:note,0,:sample,:sort)',
            [
                ':uid'      => $uid,
                ':id'       => $id,
                ':name'     => (string) $data['name'],
                ':type'     => (string) $type,
                ':opening'  => Repo::money($data['openingBalance'] ?? 0),
                ':currency' => (string) ($data['currency'] ?? Config::get('money.default_currency', 'PHP')),
                ':color'    => $data['color'] ?? null,
                ':note'     => $data['note'] ?? null,
                ':sample'   => !empty($data['sample']) ? 1 : 0,
                ':sort'     => $sort,
            ]
        );

        return self::findOrFail($uid, $id);
    }

    /** @param array<string,mixed> $patch @return array<string,mixed> */
    public static function update(int $uid, string $id, array $patch): array
    {
        self::findOrFail($uid, $id);

        if (array_key_exists('name', $patch)) {
            self::assertNameFree($uid, (string) $patch['name'], $id);
        }

        $map = [
            'name'           => 'name',
            'type'           => 'type',
            'openingBalance' => 'opening_balance',
            'color'          => 'color',
            'note'           => 'note',
            'archived'       => 'archived',
        ];

        $sets   = [];
        $params = [':uid' => $uid, ':id' => $id];
        foreach ($map as $key => $column) {
            if (!array_key_exists($key, $patch)) {
                continue;
            }
            $value = $patch[$key];
            if (is_bool($value)) {
                $value = $value ? 1 : 0;
            }
            if ($key === 'openingBalance') {
                $value = Repo::money($value);
            }
            $sets[]               = "`{$column}` = :{$column}";
            $params[":{$column}"] = $value;
        }

        if ($sets !== []) {
            Database::run(
                'UPDATE `accounts` SET ' . implode(', ', $sets) . ' WHERE `user_id` = :uid AND `id` = :id',
                $params
            );
        }

        return self::findOrFail($uid, $id);
    }

    /**
     * $mode 'delete' also removes the account's transactions (legacy default).
     * $mode 'keep' detaches them instead.
     *
     * Composite foreign keys cannot use ON DELETE SET NULL, because user_id is
     * NOT NULL in every child table, so each reference is cleared explicitly
     * inside the transaction before the account row goes away.
     */
    public static function delete(int $uid, string $id, string $mode = 'delete'): void
    {
        self::findOrFail($uid, $id);
        $mode = $mode === 'keep' ? 'keep' : 'delete';

        Database::transaction(static function () use ($uid, $id, $mode): void {
            $goalIds = [];

            if ($mode === 'delete') {
                // Children that point at the doomed transactions first.
                Database::run(
                    'UPDATE `bills` b
                        JOIN `transactions` t
                          ON t.`user_id` = b.`user_id` AND t.`id` = b.`paid_tx_id`
                        SET b.`paid_on` = NULL, b.`paid_tx_id` = NULL
                      WHERE b.`user_id` = :uid
                        AND (t.`account_id` = :id OR t.`to_account_id` = :id2)',
                    [':uid' => $uid, ':id' => $id, ':id2' => $id]
                );
                Database::run(
                    'UPDATE `bill_payments` p
                        JOIN `transactions` t
                          ON t.`user_id` = p.`user_id` AND t.`id` = p.`transaction_id`
                        SET p.`transaction_id` = NULL
                      WHERE p.`user_id` = :uid
                        AND (t.`account_id` = :id OR t.`to_account_id` = :id2)',
                    [':uid' => $uid, ':id' => $id, ':id2' => $id]
                );

                $goalRows = Database::all(
                    'SELECT DISTINCT c.`goal_id`
                       FROM `goal_contributions` c
                       JOIN `transactions` t
                         ON t.`user_id` = c.`user_id` AND t.`id` = c.`transaction_id`
                      WHERE c.`user_id` = :uid
                        AND (t.`account_id` = :id OR t.`to_account_id` = :id2)',
                    [':uid' => $uid, ':id' => $id, ':id2' => $id]
                );
                foreach ($goalRows as $goalRow) {
                    $goalIds[] = (string) $goalRow['goal_id'];
                }
                Database::run(
                    'DELETE c FROM `goal_contributions` c
                       JOIN `transactions` t
                         ON t.`user_id` = c.`user_id` AND t.`id` = c.`transaction_id`
                      WHERE c.`user_id` = :uid
                        AND (t.`account_id` = :id OR t.`to_account_id` = :id2)',
                    [':uid' => $uid, ':id' => $id, ':id2' => $id]
                );

                Database::run(
                    'DELETE FROM `transactions`
                     WHERE `user_id` = :uid AND (`account_id` = :id OR `to_account_id` = :id2)',
                    [':uid' => $uid, ':id' => $id, ':id2' => $id]
                );
            } else {
                // A transfer needs both legs (ck_tx_transfer), so a one-legged
                // survivor is not representable. Those rows go; income and
                // expense rows stay and simply lose the account.
                Database::run(
                    'DELETE FROM `transactions`
                      WHERE `user_id` = :uid AND `type` = \'transfer\'
                        AND (`account_id` = :id OR `to_account_id` = :id2)',
                    [':uid' => $uid, ':id' => $id, ':id2' => $id]
                );
                Database::run(
                    'UPDATE `transactions` SET `account_id` = NULL
                      WHERE `user_id` = :uid AND `account_id` = :id',
                    [':uid' => $uid, ':id' => $id]
                );
                Database::run(
                    'UPDATE `transactions` SET `to_account_id` = NULL
                      WHERE `user_id` = :uid AND `to_account_id` = :id',
                    [':uid' => $uid, ':id' => $id]
                );
            }

            foreach ([
                'UPDATE `bills` SET `account_id` = NULL WHERE `user_id` = :uid AND `account_id` = :id',
                'UPDATE `recurring_transactions` SET `account_id` = NULL WHERE `user_id` = :uid AND `account_id` = :id',
                'UPDATE `savings_goals` SET `account_id` = NULL WHERE `user_id` = :uid AND `account_id` = :id',
            ] as $sql) {
                Database::run($sql, [':uid' => $uid, ':id' => $id]);
            }

            Database::run(
                'DELETE FROM `accounts` WHERE `user_id` = :uid AND `id` = :id',
                [':uid' => $uid, ':id' => $id]
            );

            foreach ($goalIds as $goalId) {
                GoalRepo::recalculate($uid, (string) $goalId);
            }
        });
    }

    /**
     * Current balance per account: opening + income - expense + transfers in
     * - transfers out. Computed in SQL so a large ledger never has to be
     * shipped to PHP just to add it up.
     *
     * @return array<string,int> accountId => balance in minor units
     */
    public static function balances(int $uid): array
    {
        $rows = Database::all(
            'SELECT a.`id` AS account_id,
                    a.`opening_balance`
                    + COALESCE((SELECT SUM(CASE
                            WHEN t.`type` = \'income\'   THEN  t.`amount`
                            WHEN t.`type` = \'expense\'  THEN -t.`amount`
                            WHEN t.`type` = \'transfer\' THEN -t.`amount`
                            ELSE 0 END)
                        FROM `transactions` t
                        WHERE t.`user_id` = a.`user_id` AND t.`account_id` = a.`id`), 0)
                    + COALESCE((SELECT SUM(t2.`amount`)
                        FROM `transactions` t2
                        WHERE t2.`user_id` = a.`user_id`
                          AND t2.`to_account_id` = a.`id`
                          AND t2.`type` = \'transfer\'), 0) AS balance
             FROM `accounts` a
             WHERE a.`user_id` = :uid',
            [':uid' => $uid]
        );

        $out = [];
        foreach ($rows as $row) {
            $out[(string) $row['account_id']] = Repo::money($row['balance']);
        }
        return $out;
    }

    private static function assertNameFree(int $uid, string $name, ?string $exceptId): void
    {
        $sql    = 'SELECT COUNT(*) FROM `accounts` WHERE `user_id` = :uid AND `name` = :name';
        $params = [':uid' => $uid, ':name' => $name];

        if ($exceptId !== null) {
            $sql          .= ' AND `id` <> :id';
            $params[':id'] = $exceptId;
        }

        if ((int) Database::scalar($sql, $params) > 0) {
            throw new ApiException('An account with that name already exists.', 422, 'validation_failed', [
                'fields' => ['name' => 'An account with that name already exists.'],
            ]);
        }
    }

    /** @param array<string,mixed> $row @return array<string,mixed> */
    public static function shape(array $row): array
    {
        return [
            'id'             => (string) $row['id'],
            'name'           => (string) $row['name'],
            'type'           => (string) $row['type'],
            'openingBalance' => Repo::money($row['opening_balance']),
            'currency'       => Repo::str($row['currency'] ?? null),
            'color'          => Repo::str($row['color']),
            'note'           => Repo::str($row['note']),
            'archived'       => Repo::flag($row['archived']),
            'sample'         => Repo::flag($row['is_sample']),
            'createdAt'      => Repo::iso($row['created_at'] ?? null),
        ];
    }
}

// ============================================================================
// TRANSACTIONS
// ============================================================================

final class TransactionRepo
{
    /**
     * Sortable columns. The keys are the only strings a client may send; the
     * values are literals from this file, so no client text ever reaches SQL.
     *
     * @var array<string,string>
     */
    private const SORTS = [
        'date'        => '`tx_date`',
        'amount'      => '`amount`',
        'createdAt'   => '`created_at`',
        'description' => '`description`',
        'type'        => '`type`',
    ];

    /** @return array<string,mixed>|null */
    public static function find(int $uid, string $id): ?array
    {
        $row = Database::one(
            'SELECT * FROM `transactions` WHERE `user_id` = :uid AND `id` = :id',
            [':uid' => $uid, ':id' => $id]
        );
        return $row === null ? null : self::shape($row);
    }

    /** @return array<string,mixed> */
    public static function findOrFail(int $uid, string $id): array
    {
        $row = self::find($uid, $id);
        if ($row === null) {
            throw new ApiException('That transaction could not be found.', 404, 'not_found');
        }
        return $row;
    }

    /**
     * Server-side pagination. Filters are applied in SQL; the client never
     * receives the whole ledger.
     *
     * Supported $filters keys:
     *   search, type, categoryId, accountId, goalId, billId, recurringId,
     *   from, to, month, minAmount, maxAmount, sort, dir, includeSample
     *
     * @param array<string,mixed> $filters
     * @return array{rows:array<int,array<string,mixed>>,total:int,page:int,perPage:int,pages:int}
     */
    public static function paginate(int $uid, array $filters = [], int $page = 1, int $perPage = 50): array
    {
        $max     = (int) Config::get('limits.per_page_max', 200);
        $perPage = max(1, min($perPage, $max));
        $page    = max(1, $page);

        [$where, $params] = self::buildFilters($uid, $filters);

        $total = (int) Database::scalar(
            'SELECT COUNT(*) FROM `transactions` WHERE ' . $where,
            $params
        );

        $column    = Repo::sortColumn(self::SORTS, isset($filters['sort']) ? (string) $filters['sort'] : null, 'date');
        $direction = Repo::sortDirection($filters['dir'] ?? 'desc');
        $offset    = ($page - 1) * $perPage;

        $rows = Database::all(
            'SELECT * FROM `transactions`
             WHERE ' . $where . '
             ORDER BY ' . $column . ' ' . $direction . ', `created_at` ' . $direction . ', `id` ' . $direction . '
             LIMIT :limit OFFSET :offset',
            $params + [':limit' => $perPage, ':offset' => $offset]
        );

        return [
            'rows'    => array_map([self::class, 'shape'], $rows),
            'total'   => $total,
            'page'    => $page,
            'perPage' => $perPage,
            'pages'   => $total === 0 ? 1 : (int) ceil($total / $perPage),
        ];
    }

    /** Newest N rows, used by the dashboard's activity list. @return array<int,array<string,mixed>> */
    public static function recent(int $uid, int $limit = 10): array
    {
        $limit = max(1, min($limit, (int) Config::get('limits.per_page_max', 200)));

        $rows = Database::all(
            'SELECT * FROM `transactions`
             WHERE `user_id` = :uid
             ORDER BY `tx_date` DESC, `created_at` DESC, `id` DESC
             LIMIT :limit',
            [':uid' => $uid, ':limit' => $limit]
        );

        return array_map([self::class, 'shape'], $rows);
    }

    /**
     * The bounded history api/bootstrap.php hydrates the SPA with: the last
     * `limits.hydration_months` months, hard-capped at `limits.hydration_cap`
     * rows so a heavy account cannot blow up the first paint.
     *
     * @return array{rows:array<int,array<string,mixed>>,from:string,total:int,truncated:bool}
     */
    public static function hydrationWindow(int $uid): array
    {
        $months = max(1, (int) Config::get('limits.hydration_months', 18));
        $cap    = max(1, (int) Config::get('limits.hydration_cap', 5000));
        $from   = Dates::monthStart(Dates::addMonthKey(Dates::monthKey(Dates::today()), -($months - 1)));

        $total = (int) Database::scalar(
            'SELECT COUNT(*) FROM `transactions` WHERE `user_id` = :uid AND `tx_date` >= :from',
            [':uid' => $uid, ':from' => $from]
        );

        $rows = Database::all(
            'SELECT * FROM `transactions`
             WHERE `user_id` = :uid AND `tx_date` >= :from
             ORDER BY `tx_date` DESC, `created_at` DESC, `id` DESC
             LIMIT :limit',
            [':uid' => $uid, ':from' => $from, ':limit' => $cap]
        );

        return [
            'rows'      => array_map([self::class, 'shape'], $rows),
            'from'      => $from,
            'total'     => $total,
            'truncated' => $total > $cap,
        ];
    }

    /**
     * Legacy duplicate guard: same type, amount, date, account and
     * description already exists.
     *
     * @param array<string,mixed> $data
     */
    public static function isDuplicate(int $uid, array $data, ?string $exceptId = null): bool
    {
        $sql = 'SELECT COUNT(*) FROM `transactions`
                WHERE `user_id` = :uid
                  AND `type` = :type
                  AND `amount` = :amount
                  AND `tx_date` = :date
                  AND (`account_id` <=> :account)
                  AND LOWER(COALESCE(`description`, \'\')) = LOWER(:description)';
        $params = [
            ':uid'         => $uid,
            ':type'        => (string) $data['type'],
            ':amount'      => Repo::money($data['amount']),
            ':date'        => (string) $data['date'],
            ':account'     => $data['accountId'] ?? null,
            ':description' => (string) ($data['description'] ?? ''),
        ];

        if ($exceptId !== null) {
            $sql          .= ' AND `id` <> :id';
            $params[':id'] = $exceptId;
        }

        return (int) Database::scalar($sql, $params) > 0;
    }

    /**
     * @param array<string,mixed> $data validated camelCase payload
     * @return array<string,mixed> the stored transaction
     */
    public static function create(int $uid, array $data): array
    {
        $data = self::normalize($uid, $data);
        $id   = isset($data['id']) && is_string($data['id']) && $data['id'] !== ''
            ? $data['id']
            : Defaults::newId('tx');

        return Database::transaction(static function () use ($uid, $id, $data): array {
            Database::run(
                'INSERT INTO `transactions`
                    (`user_id`,`id`,`type`,`amount`,`tx_date`,`description`,`category_id`,`account_id`,
                     `to_account_id`,`method`,`notes`,`recurring_id`,`bill_id`,`goal_id`,`is_sample`)
                 VALUES
                    (:uid,:id,:type,:amount,:date,:description,:category,:account,
                     :to_account,:method,:notes,:recurring,:bill,:goal,:sample)',
                [
                    ':uid'         => $uid,
                    ':id'          => $id,
                    ':type'        => $data['type'],
                    ':amount'      => $data['amount'],
                    ':date'        => $data['date'],
                    ':description' => $data['description'],
                    ':category'    => $data['categoryId'],
                    ':account'     => $data['accountId'],
                    ':to_account'  => $data['toAccountId'],
                    ':method'      => $data['method'],
                    ':notes'       => $data['notes'],
                    ':recurring'   => $data['recurringId'],
                    ':bill'        => $data['billId'],
                    ':goal'        => $data['goalId'],
                    ':sample'      => $data['sample'] ? 1 : 0,
                ]
            );

            if ($data['goalId'] !== null) {
                GoalRepo::recalculate($uid, (string) $data['goalId']);
            }

            return self::findOrFail($uid, $id);
        });
    }

    /** @param array<string,mixed> $patch @return array<string,mixed> */
    public static function update(int $uid, string $id, array $patch): array
    {
        $existing = self::findOrFail($uid, $id);
        $merged   = self::normalize($uid, array_replace($existing, $patch));

        return Database::transaction(static function () use ($uid, $id, $existing, $merged): array {
            Database::run(
                'UPDATE `transactions` SET
                    `type` = :type,
                    `amount` = :amount,
                    `tx_date` = :date,
                    `description` = :description,
                    `category_id` = :category,
                    `account_id` = :account,
                    `to_account_id` = :to_account,
                    `method` = :method,
                    `notes` = :notes,
                    `goal_id` = :goal
                 WHERE `user_id` = :uid AND `id` = :id',
                [
                    ':uid'         => $uid,
                    ':id'          => $id,
                    ':type'        => $merged['type'],
                    ':amount'      => $merged['amount'],
                    ':date'        => $merged['date'],
                    ':description' => $merged['description'],
                    ':category'    => $merged['categoryId'],
                    ':account'     => $merged['accountId'],
                    ':to_account'  => $merged['toAccountId'],
                    ':method'      => $merged['method'],
                    ':notes'       => $merged['notes'],
                    ':goal'        => $merged['goalId'],
                ]
            );

            // recurringId and billId are deliberately not patchable: they are
            // provenance, and rewriting them would break the idempotency keys.
            foreach ([$existing['goalId'], $merged['goalId']] as $goalId) {
                if ($goalId !== null) {
                    GoalRepo::recalculate($uid, (string) $goalId);
                }
            }

            return self::findOrFail($uid, $id);
        });
    }

    /**
     * Deleting a transaction also unwinds what it represented: a bill payment
     * goes back to unpaid, and a goal contribution disappears from the goal's
     * running total.
     */
    public static function delete(int $uid, string $id): void
    {
        $existing = self::findOrFail($uid, $id);

        Database::transaction(static function () use ($uid, $id, $existing): void {
            if ($existing['billId'] !== null) {
                BillRepo::detachTransaction($uid, (string) $existing['billId'], $id);
            }

            Database::run(
                'DELETE FROM `goal_contributions` WHERE `user_id` = :uid AND `transaction_id` = :tx',
                [':uid' => $uid, ':tx' => $id]
            );

            // Any occurrence still pointing here keeps its history but loses
            // the link; the composite FK cannot do this for us.
            Database::run(
                'UPDATE `bill_payments` SET `transaction_id` = NULL
                  WHERE `user_id` = :uid AND `transaction_id` = :tx',
                [':uid' => $uid, ':tx' => $id]
            );
            Database::run(
                'UPDATE `bills` SET `paid_on` = NULL, `paid_tx_id` = NULL
                  WHERE `user_id` = :uid AND `paid_tx_id` = :tx',
                [':uid' => $uid, ':tx' => $id]
            );

            Database::run(
                'DELETE FROM `transactions` WHERE `user_id` = :uid AND `id` = :id',
                [':uid' => $uid, ':id' => $id]
            );

            if ($existing['goalId'] !== null) {
                GoalRepo::recalculate($uid, (string) $existing['goalId']);
            }
        });
    }

    /** True when a rule already posted on that date (idempotency pre-check). */
    public static function existsForRecurring(int $uid, string $recurringId, string $date): bool
    {
        return (int) Database::scalar(
            'SELECT COUNT(*) FROM `transactions`
             WHERE `user_id` = :uid AND `recurring_id` = :rec AND `tx_date` = :date',
            [':uid' => $uid, ':rec' => $recurringId, ':date' => $date]
        ) > 0;
    }

    /**
     * Applies the frontend's rules server-side and verifies that every
     * referenced row belongs to this user.
     *
     * @param array<string,mixed> $data
     * @return array<string,mixed>
     */
    private static function normalize(int $uid, array $data): array
    {
        $type = in_array($data['type'] ?? 'expense', Defaults::TX_TYPES, true) ? (string) $data['type'] : 'expense';

        $accountId   = self::idOrNull($data['accountId'] ?? null);
        $toAccountId = $type === 'transfer' ? self::idOrNull($data['toAccountId'] ?? null) : null;
        $categoryId  = $type === 'transfer' ? null : self::idOrNull($data['categoryId'] ?? null);

        $errors = [];
        if ($accountId === null) {
            $errors['accountId'] = 'Choose an account.';
        }
        if ($type === 'transfer') {
            if ($toAccountId === null) {
                $errors['toAccountId'] = 'Choose a destination account.';
            } elseif ($toAccountId === $accountId) {
                $errors['toAccountId'] = 'Source and destination must differ.';
            }
        } elseif ($categoryId === null) {
            $errors['categoryId'] = 'Choose a category.';
        }
        if ($errors !== []) {
            throw new ApiException('Please check the highlighted fields.', 422, 'validation_failed', ['fields' => $errors]);
        }

        Auth::ownsOrFail($uid, 'accounts', $accountId, 'account');
        Auth::ownsOrFail($uid, 'accounts', $toAccountId, 'account');
        Auth::ownsOrFail($uid, 'categories', $categoryId, 'category');
        Auth::ownsOrFail($uid, 'savings_goals', self::idOrNull($data['goalId'] ?? null), 'goal');
        Auth::ownsOrFail($uid, 'bills', self::idOrNull($data['billId'] ?? null), 'bill');
        Auth::ownsOrFail($uid, 'recurring_transactions', self::idOrNull($data['recurringId'] ?? null), 'recurring rule');

        if ($categoryId !== null) {
            $category = CategoryRepo::findOrFail($uid, $categoryId);
            if ($category['kind'] !== 'both' && $category['kind'] !== $type) {
                throw new ApiException('Please check the highlighted fields.', 422, 'validation_failed', [
                    'fields' => ['categoryId' => 'That category is for ' . $category['kind'] . '.'],
                ]);
            }
        }

        $date = isset($data['date']) && Dates::isDate((string) $data['date'])
            ? (string) $data['date']
            : Dates::today();

        $method = $data['method'] ?? null;
        if ($method === null || $method === '') {
            $method = $type === 'transfer' ? 'Bank Transfer' : 'Cash';
        }
        if (!in_array($method, Defaults::PAYMENT_METHODS, true)) {
            $method = 'Other';
        }

        return [
            'id'          => $data['id'] ?? null,
            'type'        => $type,
            'amount'      => Repo::money($data['amount'] ?? 0),
            'date'        => $date,
            'description' => mb_substr(trim((string) ($data['description'] ?? '')), 0, 160),
            'categoryId'  => $categoryId,
            'accountId'   => $accountId,
            'toAccountId' => $toAccountId,
            'method'      => $method,
            'notes'       => mb_substr(trim((string) ($data['notes'] ?? '')), 0, 500),
            'recurringId' => self::idOrNull($data['recurringId'] ?? null),
            'billId'      => self::idOrNull($data['billId'] ?? null),
            'goalId'      => self::idOrNull($data['goalId'] ?? null),
            'sample'      => !empty($data['sample']),
        ];
    }

    /**
     * @param array<string,mixed> $filters
     * @return array{0:string,1:array<string,mixed>}
     */
    private static function buildFilters(int $uid, array $filters): array
    {
        $where  = ['`user_id` = :uid'];
        $params = [':uid' => $uid];

        if (!empty($filters['type']) && in_array($filters['type'], Defaults::TX_TYPES, true)) {
            $where[]         = '`type` = :type';
            $params[':type'] = (string) $filters['type'];
        }

        foreach ([
            'categoryId'  => ['`category_id`', ':category'],
            'accountId'   => ['`account_id`',  ':account'],
            'goalId'      => ['`goal_id`',     ':goal'],
            'billId'      => ['`bill_id`',     ':bill'],
            'recurringId' => ['`recurring_id`', ':recurring'],
        ] as $key => [$column, $placeholder]) {
            if (!empty($filters[$key]) && is_string($filters[$key])) {
                if ($key === 'accountId') {
                    // An account filter must include money moved *into* it.
                    $where[]                = '(`account_id` = :account OR `to_account_id` = :account2)';
                    $params[':account']     = $filters[$key];
                    $params[':account2']    = $filters[$key];
                    continue;
                }
                $where[]              = $column . ' = ' . $placeholder;
                $params[$placeholder] = $filters[$key];
            }
        }

        if (!empty($filters['month']) && Dates::isMonthKey((string) $filters['month'])) {
            $month             = (string) $filters['month'];
            $where[]           = '`tx_date` BETWEEN :m_from AND :m_to';
            $params[':m_from'] = Dates::monthStart($month);
            $params[':m_to']   = Dates::monthEnd($month);
        } else {
            if (!empty($filters['from']) && Dates::isDate((string) $filters['from'])) {
                $where[]         = '`tx_date` >= :from';
                $params[':from'] = (string) $filters['from'];
            }
            if (!empty($filters['to']) && Dates::isDate((string) $filters['to'])) {
                $where[]       = '`tx_date` <= :to';
                $params[':to'] = (string) $filters['to'];
            }
        }

        if (isset($filters['minAmount']) && is_int($filters['minAmount'])) {
            $where[]           = '`amount` >= :min_amount';
            $params[':min_amount'] = $filters['minAmount'];
        }
        if (isset($filters['maxAmount']) && is_int($filters['maxAmount'])) {
            $where[]               = '`amount` <= :max_amount';
            $params[':max_amount'] = $filters['maxAmount'];
        }

        if (!empty($filters['search']) && is_string($filters['search'])) {
            $needle            = '%' . str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], trim($filters['search'])) . '%';
            $where[]           = '(`description` LIKE :search OR `notes` LIKE :search2)';
            $params[':search']  = $needle;
            $params[':search2'] = $needle;
        }

        if (isset($filters['includeSample']) && $filters['includeSample'] === false) {
            $where[] = '`is_sample` = 0';
        }

        return [implode(' AND ', $where), $params];
    }

    private static function idOrNull($value): ?string
    {
        if (!is_string($value) || $value === '') {
            return null;
        }
        return $value;
    }

    /** @param array<string,mixed> $row @return array<string,mixed> */
    public static function shape(array $row): array
    {
        return [
            'id'          => (string) $row['id'],
            'type'        => (string) $row['type'],
            'amount'      => Repo::money($row['amount']),
            'description' => (string) ($row['description'] ?? ''),
            'categoryId'  => Repo::str($row['category_id']),
            'date'        => (string) $row['tx_date'],
            'accountId'   => Repo::str($row['account_id']),
            'toAccountId' => Repo::str($row['to_account_id']),
            'method'      => Repo::str($row['method']),
            'notes'       => (string) ($row['notes'] ?? ''),
            'recurringId' => Repo::str($row['recurring_id']),
            'billId'      => Repo::str($row['bill_id']),
            'goalId'      => Repo::str($row['goal_id']),
            'sample'      => Repo::flag($row['is_sample']),
            'createdAt'   => Repo::iso($row['created_at'] ?? null),
            'updatedAt'   => Repo::iso($row['updated_at'] ?? null),
        ];
    }
}

// ============================================================================
// BUDGETS
// ============================================================================

final class BudgetRepo
{
    /** @return array<int,array<string,mixed>> */
    public static function all(int $uid): array
    {
        $budgets = Database::all(
            'SELECT * FROM `budgets` WHERE `user_id` = :uid ORDER BY `month` DESC',
            [':uid' => $uid]
        );
        if ($budgets === []) {
            return [];
        }

        $lines = self::linesByBudget($uid);
        $plans = self::plansByBudget($uid);

        $out = [];
        foreach ($budgets as $budget) {
            $out[] = self::shape($budget, $lines, $plans);
        }
        return $out;
    }

    /** @return array<string,mixed>|null */
    public static function forMonth(int $uid, string $month): ?array
    {
        if (!Dates::isMonthKey($month)) {
            throw new ApiException('Please use a valid month (YYYY-MM).', 422, 'validation_failed');
        }

        $budget = Database::one(
            'SELECT * FROM `budgets` WHERE `user_id` = :uid AND `month` = :month',
            [':uid' => $uid, ':month' => $month]
        );
        if ($budget === null) {
            return null;
        }

        return self::shape(
            $budget,
            self::linesByBudget($uid, (string) $budget['id']),
            self::plansByBudget($uid, (string) $budget['id'])
        );
    }

    /** Creates the month's budget if it does not exist yet. @return array<string,mixed> */
    public static function ensure(int $uid, string $month): array
    {
        $existing = self::forMonth($uid, $month);
        if ($existing !== null) {
            return $existing;
        }

        Database::run(
            'INSERT INTO `budgets` (`user_id`,`id`,`month`) VALUES (:uid,:id,:month)
             ON DUPLICATE KEY UPDATE `month` = `month`',
            [':uid' => $uid, ':id' => Defaults::newId('bgt'), ':month' => $month]
        );

        $budget = self::forMonth($uid, $month);
        if ($budget === null) {
            throw new ApiException('That budget could not be created.', 500, 'server_error');
        }
        return $budget;
    }

    /**
     * Amount <= 0 removes the line, matching Store.setBudgetLine.
     *
     * @return array<string,mixed> the whole month after the change
     */
    public static function setLine(int $uid, string $month, string $categoryId, int $amount): array
    {
        Auth::ownsOrFail($uid, 'categories', $categoryId, 'category');

        return Database::transaction(static function () use ($uid, $month, $categoryId, $amount): array {
            $budget   = self::ensure($uid, $month);
            $budgetId = (string) $budget['id'];

            if ($amount <= 0) {
                Database::run(
                    'DELETE FROM `budget_lines`
                     WHERE `user_id` = :uid AND `budget_id` = :budget AND `category_id` = :category',
                    [':uid' => $uid, ':budget' => $budgetId, ':category' => $categoryId]
                );
            } else {
                Database::run(
                    'INSERT INTO `budget_lines` (`user_id`,`id`,`budget_id`,`category_id`,`amount`)
                     VALUES (:uid,:id,:budget,:category,:amount)
                     ON DUPLICATE KEY UPDATE `amount` = VALUES(`amount`)',
                    [
                        ':uid'      => $uid,
                        ':id'       => Defaults::newId('bl'),
                        ':budget'   => $budgetId,
                        ':category' => $categoryId,
                        ':amount'   => $amount,
                    ]
                );
            }

            $updated = self::forMonth($uid, $month);
            if ($updated === null) {
                throw new ApiException('That budget could not be found.', 404, 'not_found');
            }
            return $updated;
        });
    }

    /**
     * Replaces the income or savings plan rows for a month.
     *
     * @param array<int,array{label:string,amount:int}> $rows
     * @return array<string,mixed>
     */
    public static function setPlan(int $uid, string $month, string $kind, array $rows): array
    {
        if (!in_array($kind, ['income', 'savings'], true)) {
            throw new ApiException('That plan type is not valid.', 422, 'validation_failed');
        }

        return Database::transaction(static function () use ($uid, $month, $kind, $rows): array {
            $budget   = self::ensure($uid, $month);
            $budgetId = (string) $budget['id'];

            Database::run(
                'DELETE FROM `budget_plan_lines`
                 WHERE `user_id` = :uid AND `budget_id` = :budget AND `plan_kind` = :kind',
                [':uid' => $uid, ':budget' => $budgetId, ':kind' => $kind]
            );

            $sort = 0;
            foreach ($rows as $row) {
                Database::run(
                    'INSERT INTO `budget_plan_lines`
                        (`user_id`,`id`,`budget_id`,`plan_kind`,`label`,`amount`,`sort_order`)
                     VALUES (:uid,:id,:budget,:kind,:label,:amount,:sort)',
                    [
                        ':uid'    => $uid,
                        ':id'     => Defaults::newId($kind === 'income' ? 'ip' : 'sp'),
                        ':budget' => $budgetId,
                        ':kind'   => $kind,
                        ':label'  => mb_substr(trim((string) ($row['label'] ?? '')), 0, 80),
                        ':amount' => Repo::money($row['amount'] ?? 0),
                        ':sort'   => $sort++,
                    ]
                );
            }

            $updated = self::forMonth($uid, $month);
            if ($updated === null) {
                throw new ApiException('That budget could not be found.', 404, 'not_found');
            }
            return $updated;
        });
    }

    /** Copies lines and plans from one month onto another. @return array<string,mixed> */
    public static function copy(int $uid, string $fromMonth, string $toMonth): array
    {
        $source = self::forMonth($uid, $fromMonth);
        if ($source === null) {
            throw new ApiException('There is no budget to copy from that month.', 404, 'not_found');
        }

        return Database::transaction(static function () use ($uid, $source, $toMonth): array {
            $target   = self::ensure($uid, $toMonth);
            $targetId = (string) $target['id'];

            Database::run(
                'DELETE FROM `budget_lines` WHERE `user_id` = :uid AND `budget_id` = :budget',
                [':uid' => $uid, ':budget' => $targetId]
            );
            Database::run(
                'DELETE FROM `budget_plan_lines` WHERE `user_id` = :uid AND `budget_id` = :budget',
                [':uid' => $uid, ':budget' => $targetId]
            );

            foreach ($source['lines'] as $line) {
                Database::run(
                    'INSERT INTO `budget_lines` (`user_id`,`id`,`budget_id`,`category_id`,`amount`)
                     VALUES (:uid,:id,:budget,:category,:amount)',
                    [
                        ':uid'      => $uid,
                        ':id'       => Defaults::newId('bl'),
                        ':budget'   => $targetId,
                        ':category' => $line['categoryId'],
                        ':amount'   => Repo::money($line['amount']),
                    ]
                );
            }

            foreach ([['income', 'incomePlan', 'ip'], ['savings', 'savingsPlan', 'sp']] as [$kind, $key, $prefix]) {
                $sort = 0;
                foreach ($source[$key] as $row) {
                    Database::run(
                        'INSERT INTO `budget_plan_lines`
                            (`user_id`,`id`,`budget_id`,`plan_kind`,`label`,`amount`,`sort_order`)
                         VALUES (:uid,:id,:budget,:kind,:label,:amount,:sort)',
                        [
                            ':uid'    => $uid,
                            ':id'     => Defaults::newId($prefix),
                            ':budget' => $targetId,
                            ':kind'   => $kind,
                            ':label'  => (string) $row['label'],
                            ':amount' => Repo::money($row['amount']),
                            ':sort'   => $sort++,
                        ]
                    );
                }
            }

            $updated = self::forMonth($uid, $toMonth);
            if ($updated === null) {
                throw new ApiException('That budget could not be found.', 404, 'not_found');
            }
            return $updated;
        });
    }

    public static function delete(int $uid, string $month): void
    {
        // Child rows disappear through ON DELETE CASCADE.
        Database::run(
            'DELETE FROM `budgets` WHERE `user_id` = :uid AND `month` = :month',
            [':uid' => $uid, ':month' => $month]
        );
    }

    /** @return array<string,array<int,array<string,mixed>>> budgetId => lines */
    private static function linesByBudget(int $uid, ?string $budgetId = null): array
    {
        $sql    = 'SELECT * FROM `budget_lines` WHERE `user_id` = :uid';
        $params = [':uid' => $uid];
        if ($budgetId !== null) {
            $sql              .= ' AND `budget_id` = :budget';
            $params[':budget'] = $budgetId;
        }

        $out = [];
        foreach (Database::all($sql, $params) as $row) {
            $out[(string) $row['budget_id']][] = [
                'id'         => (string) $row['id'],
                'categoryId' => (string) $row['category_id'],
                'amount'     => Repo::money($row['amount']),
                'rollover'   => Repo::flag($row['rollover']),
            ];
        }
        return $out;
    }

    /** @return array<string,array<string,array<int,array<string,mixed>>>> budgetId => kind => rows */
    private static function plansByBudget(int $uid, ?string $budgetId = null): array
    {
        $sql    = 'SELECT * FROM `budget_plan_lines` WHERE `user_id` = :uid';
        $params = [':uid' => $uid];
        if ($budgetId !== null) {
            $sql              .= ' AND `budget_id` = :budget';
            $params[':budget'] = $budgetId;
        }
        $sql .= ' ORDER BY `sort_order` ASC';

        $out = [];
        foreach (Database::all($sql, $params) as $row) {
            $out[(string) $row['budget_id']][(string) $row['plan_kind']][] = [
                'id'     => (string) $row['id'],
                'label'  => (string) $row['label'],
                'amount' => Repo::money($row['amount']),
            ];
        }
        return $out;
    }

    /**
     * @param array<string,mixed> $budget
     * @param array<string,array<int,array<string,mixed>>> $lines
     * @param array<string,array<string,array<int,array<string,mixed>>>> $plans
     * @return array<string,mixed>
     */
    private static function shape(array $budget, array $lines, array $plans): array
    {
        $id = (string) $budget['id'];
        return [
            'id'          => $id,
            'month'       => (string) $budget['month'],
            'lines'       => $lines[$id] ?? [],
            'incomePlan'  => $plans[$id]['income'] ?? [],
            'savingsPlan' => $plans[$id]['savings'] ?? [],
            'sample'      => Repo::flag($budget['is_sample'] ?? 0),
            'createdAt'   => Repo::iso($budget['created_at'] ?? null),
        ];
    }
}

// ============================================================================
// GOALS
// ============================================================================

final class GoalRepo
{
    /** @return array<int,array<string,mixed>> */
    public static function all(int $uid, bool $includeArchived = true): array
    {
        $sql = 'SELECT * FROM `savings_goals` WHERE `user_id` = :uid';
        if (!$includeArchived) {
            $sql .= ' AND `archived` = 0';
        }
        $sql .= ' ORDER BY `created_at` ASC';

        return array_map([self::class, 'shape'], Database::all($sql, [':uid' => $uid]));
    }

    /** @return array<string,mixed>|null */
    public static function find(int $uid, string $id): ?array
    {
        $row = Database::one(
            'SELECT * FROM `savings_goals` WHERE `user_id` = :uid AND `id` = :id',
            [':uid' => $uid, ':id' => $id]
        );
        return $row === null ? null : self::shape($row);
    }

    /** @return array<string,mixed> */
    public static function findOrFail(int $uid, string $id): array
    {
        $row = self::find($uid, $id);
        if ($row === null) {
            throw new ApiException('That goal could not be found.', 404, 'not_found');
        }
        return $row;
    }

    /** @param array<string,mixed> $data @return array<string,mixed> */
    public static function create(int $uid, array $data): array
    {
        Repo::assertUnderLimit($uid, 'savings_goals', 'limits.max_goals', 'goals');

        $accountId = self::idOrNull($data['accountId'] ?? null);
        Auth::ownsOrFail($uid, 'accounts', $accountId, 'account');

        $id = Defaults::newId('goal');

        Database::run(
            'INSERT INTO `savings_goals`
                (`user_id`,`id`,`name`,`target_amount`,`current_amount`,`target_date`,`account_id`,
                 `description`,`emoji`,`color`,`status`,`archived`,`is_sample`)
             VALUES (:uid,:id,:name,:target,0,:target_date,:account,:description,:emoji,:color,\'active\',0,:sample)',
            [
                ':uid'         => $uid,
                ':id'          => $id,
                ':name'        => (string) $data['name'],
                ':target'      => Repo::money($data['target'] ?? 0),
                ':target_date' => $data['targetDate'] ?? null,
                ':account'     => $accountId,
                ':description' => $data['description'] ?? null,
                ':emoji'       => $data['emoji'] ?? "\u{1F3AF}",
                ':color'       => $data['color'] ?? '#0ca678',
                ':sample'      => !empty($data['sample']) ? 1 : 0,
            ]
        );

        // A goal may be created with money already set aside; that opening
        // balance becomes a contribution so the ledger stays the only source.
        $opening = Repo::money($data['current'] ?? 0);
        if ($opening > 0) {
            self::recordContribution($uid, $id, $opening, null, Dates::today(), 'Starting balance', null);
        }

        self::recalculate($uid, $id);
        return self::findOrFail($uid, $id);
    }

    /** @param array<string,mixed> $patch @return array<string,mixed> */
    public static function update(int $uid, string $id, array $patch): array
    {
        self::findOrFail($uid, $id);

        if (array_key_exists('accountId', $patch)) {
            Auth::ownsOrFail($uid, 'accounts', self::idOrNull($patch['accountId']), 'account');
        }

        // current_amount is intentionally absent: it is derived from
        // goal_contributions (see docs/AUDIT.md, fix 1).
        $map = [
            'name'        => 'name',
            'target'      => 'target_amount',
            'targetDate'  => 'target_date',
            'accountId'   => 'account_id',
            'description' => 'description',
            'emoji'       => 'emoji',
            'color'       => 'color',
            'status'      => 'status',
            'archived'    => 'archived',
        ];

        $sets   = [];
        $params = [':uid' => $uid, ':id' => $id];
        foreach ($map as $key => $column) {
            if (!array_key_exists($key, $patch)) {
                continue;
            }
            $value = $patch[$key];
            if (is_bool($value)) {
                $value = $value ? 1 : 0;
            }
            if ($key === 'target') {
                $value = Repo::money($value);
            }
            if ($key === 'status' && !in_array($value, Defaults::GOAL_STATUSES, true)) {
                continue;
            }
            $sets[]               = "`{$column}` = :{$column}";
            $params[":{$column}"] = $value;
        }

        if ($sets !== []) {
            Database::run(
                'UPDATE `savings_goals` SET ' . implode(', ', $sets) . ' WHERE `user_id` = :uid AND `id` = :id',
                $params
            );
        }

        return self::findOrFail($uid, $id);
    }

    public static function delete(int $uid, string $id): void
    {
        self::findOrFail($uid, $id);

        Database::transaction(static function () use ($uid, $id): void {
            // Transactions survive the goal; only the link is cleared, which
            // matches Store.removeGoal.
            Database::run(
                'UPDATE `transactions` SET `goal_id` = NULL WHERE `user_id` = :uid AND `goal_id` = :id',
                [':uid' => $uid, ':id' => $id]
            );
            Database::run(
                'DELETE FROM `savings_goals` WHERE `user_id` = :uid AND `id` = :id',
                [':uid' => $uid, ':id' => $id]
            );
        });
    }

    /**
     * Moves money into a goal: one transaction, one contribution row, one
     * recalculation. The legacy client did the first and then *also*
     * incremented the goal, which double counted.
     *
     * @return array{goal:array<string,mixed>,transaction:array<string,mixed>|null,contributionId:string}
     */
    public static function contribute(
        int $uid,
        string $goalId,
        int $amount,
        ?string $accountId = null,
        ?string $date = null,
        ?string $note = null,
        ?string $categoryId = null
    ): array {
        if ($amount <= 0) {
            throw new ApiException('Please enter an amount greater than zero.', 422, 'validation_failed', [
                'fields' => ['amount' => 'Please enter an amount greater than zero.'],
            ]);
        }

        $goal = self::findOrFail($uid, $goalId);
        $date = $date !== null && Dates::isDate($date) ? $date : Dates::today();
        Auth::ownsOrFail($uid, 'accounts', $accountId, 'account');
        Auth::ownsOrFail($uid, 'categories', $categoryId, 'category');

        return Database::transaction(static function () use ($uid, $goal, $goalId, $amount, $accountId, $date, $note, $categoryId): array {
            $transaction = null;

            if ($accountId !== null) {
                $destination = $goal['accountId'];
                $isTransfer  = $destination !== null && $destination !== $accountId;

                $transaction = TransactionRepo::create($uid, [
                    'type'        => $isTransfer ? 'transfer' : 'expense',
                    'amount'      => $amount,
                    'date'        => $date,
                    'description' => 'Contribution · ' . $goal['name'],
                    'accountId'   => $accountId,
                    'toAccountId' => $isTransfer ? $destination : null,
                    // Without a separate goal account the money simply leaves
                    // the source account, so the caller must supply a category
                    // for that expense; transfers never carry one.
                    'categoryId'  => $isTransfer ? null : $categoryId,
                    'method'      => 'Bank Transfer',
                    'notes'       => $note,
                    'goalId'      => $goalId,
                ]);
            }

            $contributionId = self::recordContribution(
                $uid,
                $goalId,
                $amount,
                $accountId,
                $date,
                $note,
                $transaction === null ? null : (string) $transaction['id']
            );

            self::recalculate($uid, $goalId);

            return [
                'goal'           => self::findOrFail($uid, $goalId),
                'transaction'    => $transaction,
                'contributionId' => $contributionId,
            ];
        });
    }

    /** @return array<int,array<string,mixed>> */
    public static function contributions(int $uid, string $goalId): array
    {
        self::findOrFail($uid, $goalId);

        $rows = Database::all(
            'SELECT * FROM `goal_contributions`
             WHERE `user_id` = :uid AND `goal_id` = :goal
             ORDER BY `contributed_on` DESC, `created_at` DESC',
            [':uid' => $uid, ':goal' => $goalId]
        );

        return array_map(static fn (array $row): array => [
            'id'            => (string) $row['id'],
            'goalId'        => (string) $row['goal_id'],
            'amount'        => Repo::money($row['amount']),
            'date'          => (string) $row['contributed_on'],
            'accountId'     => Repo::str($row['account_id']),
            'transactionId' => Repo::str($row['transaction_id']),
            'note'          => Repo::str($row['note']),
            'createdAt'     => Repo::iso($row['created_at'] ?? null),
        ], $rows);
    }

    /** Removes a contribution (and its transaction, when it created one). */
    public static function removeContribution(int $uid, string $contributionId): array
    {
        $row = Database::one(
            'SELECT * FROM `goal_contributions` WHERE `user_id` = :uid AND `id` = :id',
            [':uid' => $uid, ':id' => $contributionId]
        );
        if ($row === null) {
            throw new ApiException('That contribution could not be found.', 404, 'not_found');
        }

        $goalId = (string) $row['goal_id'];
        $txId   = Repo::str($row['transaction_id']);

        return Database::transaction(static function () use ($uid, $contributionId, $goalId, $txId): array {
            Database::run(
                'DELETE FROM `goal_contributions` WHERE `user_id` = :uid AND `id` = :id',
                [':uid' => $uid, ':id' => $contributionId]
            );
            if ($txId !== null) {
                Database::run(
                    'DELETE FROM `transactions` WHERE `user_id` = :uid AND `id` = :id',
                    [':uid' => $uid, ':id' => $txId]
                );
            }
            self::recalculate($uid, $goalId);
            return self::findOrFail($uid, $goalId);
        });
    }

    /**
     * The single source of truth for current_amount. Also flips the goal to
     * 'reached' once the target is met, and back when it is not.
     */
    public static function recalculate(int $uid, string $goalId): void
    {
        Database::run(
            'UPDATE `savings_goals` g
             SET g.`current_amount` = GREATEST(0, COALESCE((
                     SELECT SUM(c.`amount`)
                     FROM `goal_contributions` c
                     WHERE c.`user_id` = g.`user_id` AND c.`goal_id` = g.`id`
                 ), 0)),
                 g.`status` = CASE
                     WHEN g.`status` = \'paused\' THEN \'paused\'
                     WHEN COALESCE((
                         SELECT SUM(c2.`amount`)
                         FROM `goal_contributions` c2
                         WHERE c2.`user_id` = g.`user_id` AND c2.`goal_id` = g.`id`
                     ), 0) >= g.`target_amount` AND g.`target_amount` > 0 THEN \'reached\'
                     ELSE \'active\'
                 END
             WHERE g.`user_id` = :uid AND g.`id` = :id',
            [':uid' => $uid, ':id' => $goalId]
        );
    }

    /** @return string the new contribution id */
    private static function recordContribution(
        int $uid,
        string $goalId,
        int $amount,
        ?string $accountId,
        string $date,
        ?string $note,
        ?string $transactionId
    ): string {
        $id = Defaults::newId('gc');

        Database::run(
            'INSERT INTO `goal_contributions`
                (`user_id`,`id`,`goal_id`,`amount`,`contributed_on`,`account_id`,`transaction_id`,`note`)
             VALUES (:uid,:id,:goal,:amount,:date,:account,:tx,:note)',
            [
                ':uid'     => $uid,
                ':id'      => $id,
                ':goal'    => $goalId,
                ':amount'  => $amount,
                ':date'    => $date,
                ':account' => $accountId,
                ':tx'      => $transactionId,
                ':note'    => $note === null ? null : mb_substr($note, 0, 160),
            ]
        );

        return $id;
    }

    private static function idOrNull($value): ?string
    {
        return is_string($value) && $value !== '' ? $value : null;
    }

    /** @param array<string,mixed> $row @return array<string,mixed> */
    public static function shape(array $row): array
    {
        return [
            'id'          => (string) $row['id'],
            'name'        => (string) $row['name'],
            'target'      => Repo::money($row['target_amount']),
            'current'     => Repo::money($row['current_amount']),
            'targetDate'  => Repo::str($row['target_date']),
            'accountId'   => Repo::str($row['account_id']),
            'description' => Repo::str($row['description']),
            'emoji'       => Repo::str($row['emoji']),
            'color'       => Repo::str($row['color']),
            'status'      => (string) $row['status'],
            'archived'    => Repo::flag($row['archived']),
            'sample'      => Repo::flag($row['is_sample']),
            'createdAt'   => Repo::iso($row['created_at'] ?? null),
        ];
    }
}

// ============================================================================
// BILLS
// ============================================================================

final class BillRepo
{
    /** @return array<int,array<string,mixed>> */
    public static function all(int $uid): array
    {
        return array_map([self::class, 'shape'], Database::all(
            'SELECT * FROM `bills` WHERE `user_id` = :uid ORDER BY `due_date` ASC, `created_at` ASC',
            [':uid' => $uid]
        ));
    }

    /** @return array<string,mixed>|null */
    public static function find(int $uid, string $id): ?array
    {
        $row = Database::one(
            'SELECT * FROM `bills` WHERE `user_id` = :uid AND `id` = :id',
            [':uid' => $uid, ':id' => $id]
        );
        return $row === null ? null : self::shape($row);
    }

    /** @return array<string,mixed> */
    public static function findOrFail(int $uid, string $id): array
    {
        $row = self::find($uid, $id);
        if ($row === null) {
            throw new ApiException('That bill could not be found.', 404, 'not_found');
        }
        return $row;
    }

    /** @param array<string,mixed> $data @return array<string,mixed> */
    public static function create(int $uid, array $data): array
    {
        Repo::assertUnderLimit($uid, 'bills', 'limits.max_bills', 'bills');

        $categoryId = self::idOrNull($data['categoryId'] ?? null);
        $accountId  = self::idOrNull($data['accountId'] ?? null);
        Auth::ownsOrFail($uid, 'categories', $categoryId, 'category');
        Auth::ownsOrFail($uid, 'accounts', $accountId, 'account');

        $id = Defaults::newId('bill');

        Database::run(
            'INSERT INTO `bills`
                (`user_id`,`id`,`name`,`amount`,`due_date`,`category_id`,`account_id`,`method`,
                 `repeat_freq`,`notes`,`reminder_days`,`is_sample`)
             VALUES (:uid,:id,:name,:amount,:due,:category,:account,:method,:repeat,:notes,:reminder,:sample)',
            [
                ':uid'      => $uid,
                ':id'       => $id,
                ':name'     => (string) $data['name'],
                ':amount'   => Repo::money($data['amount'] ?? 0),
                ':due'      => self::dateOrToday($data['dueDate'] ?? null),
                ':category' => $categoryId,
                ':account'  => $accountId,
                ':method'   => self::method($data['method'] ?? null),
                ':repeat'   => self::repeat($data['repeat'] ?? null),
                ':notes'    => $data['notes'] ?? null,
                ':reminder' => (int) ($data['reminderDays'] ?? 3),
                ':sample'   => !empty($data['sample']) ? 1 : 0,
            ]
        );

        return self::findOrFail($uid, $id);
    }

    /** @param array<string,mixed> $patch @return array<string,mixed> */
    public static function update(int $uid, string $id, array $patch): array
    {
        self::findOrFail($uid, $id);

        if (array_key_exists('categoryId', $patch)) {
            Auth::ownsOrFail($uid, 'categories', self::idOrNull($patch['categoryId']), 'category');
        }
        if (array_key_exists('accountId', $patch)) {
            Auth::ownsOrFail($uid, 'accounts', self::idOrNull($patch['accountId']), 'account');
        }

        $map = [
            'name'         => 'name',
            'amount'       => 'amount',
            'dueDate'      => 'due_date',
            'categoryId'   => 'category_id',
            'accountId'    => 'account_id',
            'method'       => 'method',
            'repeat'       => 'repeat_freq',
            'notes'        => 'notes',
            'reminderDays' => 'reminder_days',
        ];

        $sets   = [];
        $params = [':uid' => $uid, ':id' => $id];
        foreach ($map as $key => $column) {
            if (!array_key_exists($key, $patch)) {
                continue;
            }
            $value = $patch[$key];
            if ($key === 'amount') {
                $value = Repo::money($value);
            }
            if ($key === 'repeat') {
                $value = self::repeat($value);
            }
            if ($key === 'method') {
                $value = self::method($value);
            }
            $sets[]               = "`{$column}` = :{$column}";
            $params[":{$column}"] = $value;
        }

        if ($sets !== []) {
            Database::run(
                'UPDATE `bills` SET ' . implode(', ', $sets) . ' WHERE `user_id` = :uid AND `id` = :id',
                $params
            );
        }

        return self::findOrFail($uid, $id);
    }

    public static function delete(int $uid, string $id): void
    {
        self::findOrFail($uid, $id);

        Database::transaction(static function () use ($uid, $id): void {
            // bill_payments cascade. Transactions keep their history, but the
            // link has to be cleared by hand: a composite FK cannot SET NULL.
            Database::run(
                'UPDATE `transactions` SET `bill_id` = NULL WHERE `user_id` = :uid AND `bill_id` = :id',
                [':uid' => $uid, ':id' => $id]
            );
            Database::run(
                'DELETE FROM `bills` WHERE `user_id` = :uid AND `id` = :id',
                [':uid' => $uid, ':id' => $id]
            );
        });
    }

    /**
     * Pays the bill's current occurrence.
     *
     *  1. writes the expense transaction,
     *  2. records the occurrence in bill_payments - the
     *     (user_id, bill_id, due_date) unique key makes a double-click or a
     *     retried request idempotent instead of duplicating money,
     *  3. rolls a repeating bill forward to its next due date, which is where
     *     the legacy "unknown repeat leaves the bill due today" drift is fixed
     *     (Dates::advance falls back to monthly).
     *
     * @param array<string,mixed> $opts accountId, date
     * @return array{bill:array<string,mixed>,transaction:array<string,mixed>}
     */
    public static function pay(int $uid, string $id, array $opts = []): array
    {
        $bill = self::findOrFail($uid, $id);

        $accountId = self::idOrNull($opts['accountId'] ?? null) ?? $bill['accountId'];
        if ($accountId === null) {
            $first     = Database::scalar(
                'SELECT `id` FROM `accounts`
                 WHERE `user_id` = :uid AND `archived` = 0
                 ORDER BY `sort_order` ASC, `created_at` ASC LIMIT 1',
                [':uid' => $uid]
            );
            $accountId = $first === null ? null : (string) $first;
        }
        if ($accountId === null) {
            throw new ApiException('Create an account first.', 422, 'validation_failed', [
                'fields' => ['accountId' => 'Create an account first.'],
            ]);
        }
        Auth::ownsOrFail($uid, 'accounts', $accountId, 'account');

        $paidOn  = self::dateOrToday($opts['date'] ?? null);
        $dueDate = (string) $bill['dueDate'];

        if (self::isOccurrencePaid($uid, $id, $dueDate)) {
            throw new ApiException('That bill has already been paid for this due date.', 409, 'already_paid');
        }

        return Database::transaction(static function () use ($uid, $id, $bill, $accountId, $paidOn, $dueDate): array {
            $transaction = TransactionRepo::create($uid, [
                'type'        => 'expense',
                'amount'      => Repo::money($bill['amount']),
                'date'        => $paidOn,
                'description' => (string) $bill['name'],
                'categoryId'  => $bill['categoryId'],
                'accountId'   => $accountId,
                'method'      => $bill['method'],
                'notes'       => $bill['notes'],
                'billId'      => $id,
            ]);

            Database::run(
                'INSERT INTO `bill_payments`
                    (`user_id`,`id`,`bill_id`,`amount`,`paid_on`,`due_date`,`account_id`,`transaction_id`)
                 VALUES (:uid,:id,:bill,:amount,:paid_on,:due,:account,:tx)',
                [
                    ':uid'     => $uid,
                    ':id'      => Defaults::newId('pay'),
                    ':bill'    => $id,
                    ':amount'  => Repo::money($bill['amount']),
                    ':paid_on' => $paidOn,
                    ':due'     => $dueDate,
                    ':account' => $accountId,
                    ':tx'      => (string) $transaction['id'],
                ]
            );

            $repeat = (string) $bill['repeat'];
            if ($repeat !== 'once') {
                // Next occurrence starts unpaid; the payment we just wrote
                // keeps the history.
                Database::run(
                    'UPDATE `bills`
                     SET `due_date` = :due, `paid_on` = NULL, `paid_tx_id` = NULL
                     WHERE `user_id` = :uid AND `id` = :id',
                    [':uid' => $uid, ':id' => $id, ':due' => Dates::advance($dueDate, $repeat)]
                );
            } else {
                Database::run(
                    'UPDATE `bills`
                     SET `paid_on` = :paid_on, `paid_tx_id` = :tx
                     WHERE `user_id` = :uid AND `id` = :id',
                    [':uid' => $uid, ':id' => $id, ':paid_on' => $paidOn, ':tx' => (string) $transaction['id']]
                );
            }

            return [
                'bill'        => self::findOrFail($uid, $id),
                'transaction' => $transaction,
            ];
        });
    }

    /**
     * Reverses the most recent payment: deletes its transaction, drops the
     * occurrence row, and restores the due date it was paid against.
     *
     * @return array<string,mixed> the bill
     */
    public static function unpay(int $uid, string $id): array
    {
        self::findOrFail($uid, $id);

        $payment = Database::one(
            'SELECT * FROM `bill_payments`
             WHERE `user_id` = :uid AND `bill_id` = :bill
             ORDER BY `paid_on` DESC, `created_at` DESC LIMIT 1',
            [':uid' => $uid, ':bill' => $id]
        );
        if ($payment === null) {
            throw new ApiException('That bill has no payment to undo.', 404, 'not_found');
        }

        return Database::transaction(static function () use ($uid, $id, $payment): array {
            $txId = Repo::str($payment['transaction_id']);

            Database::run(
                'DELETE FROM `bill_payments` WHERE `user_id` = :uid AND `id` = :id',
                [':uid' => $uid, ':id' => (string) $payment['id']]
            );

            if ($txId !== null) {
                Database::run(
                    'DELETE FROM `transactions` WHERE `user_id` = :uid AND `id` = :id',
                    [':uid' => $uid, ':id' => $txId]
                );
            }

            Database::run(
                'UPDATE `bills`
                 SET `due_date` = :due, `paid_on` = NULL, `paid_tx_id` = NULL
                 WHERE `user_id` = :uid AND `id` = :id',
                [':uid' => $uid, ':id' => $id, ':due' => (string) $payment['due_date']]
            );

            return self::findOrFail($uid, $id);
        });
    }

    /**
     * Called when a bill's transaction is deleted directly from the
     * transactions view, so the bill does not stay marked as paid.
     */
    public static function detachTransaction(int $uid, string $billId, string $transactionId): void
    {
        $payment = Database::one(
            'SELECT * FROM `bill_payments`
             WHERE `user_id` = :uid AND `bill_id` = :bill AND `transaction_id` = :tx',
            [':uid' => $uid, ':bill' => $billId, ':tx' => $transactionId]
        );

        if ($payment !== null) {
            Database::run(
                'DELETE FROM `bill_payments` WHERE `user_id` = :uid AND `id` = :id',
                [':uid' => $uid, ':id' => (string) $payment['id']]
            );
            Database::run(
                'UPDATE `bills` SET `due_date` = :due WHERE `user_id` = :uid AND `id` = :id',
                [':uid' => $uid, ':id' => $billId, ':due' => (string) $payment['due_date']]
            );
        }

        Database::run(
            'UPDATE `bills`
             SET `paid_on` = NULL, `paid_tx_id` = NULL
             WHERE `user_id` = :uid AND `id` = :id AND `paid_tx_id` = :tx',
            [':uid' => $uid, ':id' => $billId, ':tx' => $transactionId]
        );
    }

    /** @return array<int,array<string,mixed>> */
    public static function payments(int $uid, string $billId): array
    {
        self::findOrFail($uid, $billId);

        return array_map(static fn (array $row): array => [
            'id'            => (string) $row['id'],
            'billId'        => (string) $row['bill_id'],
            'amount'        => Repo::money($row['amount']),
            'paidOn'        => (string) $row['paid_on'],
            'dueDate'       => (string) $row['due_date'],
            'accountId'     => Repo::str($row['account_id']),
            'transactionId' => Repo::str($row['transaction_id']),
            'createdAt'     => Repo::iso($row['created_at'] ?? null),
        ], Database::all(
            'SELECT * FROM `bill_payments`
             WHERE `user_id` = :uid AND `bill_id` = :bill
             ORDER BY `paid_on` DESC, `created_at` DESC',
            [':uid' => $uid, ':bill' => $billId]
        ));
    }

    public static function isOccurrencePaid(int $uid, string $billId, string $dueDate): bool
    {
        return (int) Database::scalar(
            'SELECT COUNT(*) FROM `bill_payments`
             WHERE `user_id` = :uid AND `bill_id` = :bill AND `due_date` = :due',
            [':uid' => $uid, ':bill' => $billId, ':due' => $dueDate]
        ) > 0;
    }

    private static function repeat($value): string
    {
        return is_string($value) && in_array($value, Defaults::BILL_REPEATS, true) ? $value : 'monthly';
    }

    private static function method($value): ?string
    {
        if (!is_string($value) || $value === '') {
            return 'Auto-Debit';
        }
        return in_array($value, Defaults::PAYMENT_METHODS, true) ? $value : 'Other';
    }

    private static function dateOrToday($value): string
    {
        return is_string($value) && Dates::isDate($value) ? $value : Dates::today();
    }

    private static function idOrNull($value): ?string
    {
        return is_string($value) && $value !== '' ? $value : null;
    }

    /** @param array<string,mixed> $row @return array<string,mixed> */
    public static function shape(array $row): array
    {
        return [
            'id'           => (string) $row['id'],
            'name'         => (string) $row['name'],
            'amount'       => Repo::money($row['amount']),
            'dueDate'      => (string) $row['due_date'],
            'categoryId'   => Repo::str($row['category_id']),
            'accountId'    => Repo::str($row['account_id']),
            'method'       => Repo::str($row['method']),
            'repeat'       => (string) $row['repeat_freq'],
            'notes'        => Repo::str($row['notes']),
            'paidOn'       => Repo::str($row['paid_on']),
            'paidTxId'     => Repo::str($row['paid_tx_id']),
            'reminderDays' => (int) ($row['reminder_days'] ?? 3),
            'sample'       => Repo::flag($row['is_sample']),
            'createdAt'    => Repo::iso($row['created_at'] ?? null),
        ];
    }
}

// ============================================================================
// RECURRING RULES
// ============================================================================

final class RecurringRepo
{
    /** @return array<int,array<string,mixed>> */
    public static function all(int $uid): array
    {
        return array_map([self::class, 'shape'], Database::all(
            'SELECT * FROM `recurring_transactions`
             WHERE `user_id` = :uid
             ORDER BY `next_date` ASC, `created_at` ASC',
            [':uid' => $uid]
        ));
    }

    /** @return array<string,mixed>|null */
    public static function find(int $uid, string $id): ?array
    {
        $row = Database::one(
            'SELECT * FROM `recurring_transactions` WHERE `user_id` = :uid AND `id` = :id',
            [':uid' => $uid, ':id' => $id]
        );
        return $row === null ? null : self::shape($row);
    }

    /** @return array<string,mixed> */
    public static function findOrFail(int $uid, string $id): array
    {
        $row = self::find($uid, $id);
        if ($row === null) {
            throw new ApiException('That recurring rule could not be found.', 404, 'not_found');
        }
        return $row;
    }

    /**
     * Rules whose next_date has arrived. RecurringEngine (Phase 3B) consumes
     * this; the posting guard and idempotency live there.
     *
     * @return array<int,array<string,mixed>>
     */
    public static function due(int $uid, ?string $onOrBefore = null, bool $autoPostOnly = true): array
    {
        $sql = 'SELECT * FROM `recurring_transactions`
                WHERE `user_id` = :uid
                  AND `paused` = 0
                  AND `next_date` <= :date
                  AND (`end_date` IS NULL OR `next_date` <= `end_date`)';
        if ($autoPostOnly) {
            $sql .= ' AND `auto_post` = 1';
        }
        $sql .= ' ORDER BY `next_date` ASC, `created_at` ASC';

        return array_map([self::class, 'shape'], Database::all($sql, [
            ':uid'  => $uid,
            ':date' => $onOrBefore !== null && Dates::isDate($onOrBefore) ? $onOrBefore : Dates::today(),
        ]));
    }

    /** @param array<string,mixed> $data @return array<string,mixed> */
    public static function create(int $uid, array $data): array
    {
        Repo::assertUnderLimit($uid, 'recurring_transactions', 'limits.max_recurring', 'recurring rules');

        $categoryId = self::idOrNull($data['categoryId'] ?? null);
        $accountId  = self::idOrNull($data['accountId'] ?? null);
        Auth::ownsOrFail($uid, 'categories', $categoryId, 'category');
        Auth::ownsOrFail($uid, 'accounts', $accountId, 'account');

        $id = Defaults::newId('rec');

        Database::run(
            'INSERT INTO `recurring_transactions`
                (`user_id`,`id`,`name`,`type`,`amount`,`category_id`,`account_id`,`method`,`frequency`,
                 `next_date`,`end_date`,`auto_post`,`paused`,`notes`,`is_sample`)
             VALUES (:uid,:id,:name,:type,:amount,:category,:account,:method,:frequency,
                     :next_date,:end_date,:auto_post,:paused,:notes,:sample)',
            [
                ':uid'       => $uid,
                ':id'        => $id,
                ':name'      => (string) $data['name'],
                ':type'      => self::type($data['type'] ?? null),
                ':amount'    => Repo::money($data['amount'] ?? 0),
                ':category'  => $categoryId,
                ':account'   => $accountId,
                ':method'    => self::method($data['method'] ?? null),
                ':frequency' => self::frequency($data['frequency'] ?? null),
                ':next_date' => self::dateOrToday($data['nextDate'] ?? null),
                ':end_date'  => self::dateOrNull($data['endDate'] ?? null),
                ':auto_post' => array_key_exists('autoPost', $data) && !$data['autoPost'] ? 0 : 1,
                ':paused'    => !empty($data['paused']) ? 1 : 0,
                ':notes'     => $data['notes'] ?? null,
                ':sample'    => !empty($data['sample']) ? 1 : 0,
            ]
        );

        return self::findOrFail($uid, $id);
    }

    /** @param array<string,mixed> $patch @return array<string,mixed> */
    public static function update(int $uid, string $id, array $patch): array
    {
        self::findOrFail($uid, $id);

        if (array_key_exists('categoryId', $patch)) {
            Auth::ownsOrFail($uid, 'categories', self::idOrNull($patch['categoryId']), 'category');
        }
        if (array_key_exists('accountId', $patch)) {
            Auth::ownsOrFail($uid, 'accounts', self::idOrNull($patch['accountId']), 'account');
        }

        $map = [
            'name'       => 'name',
            'type'       => 'type',
            'amount'     => 'amount',
            'categoryId' => 'category_id',
            'accountId'  => 'account_id',
            'method'     => 'method',
            'frequency'  => 'frequency',
            'nextDate'   => 'next_date',
            'endDate'    => 'end_date',
            'autoPost'   => 'auto_post',
            'paused'     => 'paused',
            'notes'      => 'notes',
        ];

        $sets   = [];
        $params = [':uid' => $uid, ':id' => $id];
        foreach ($map as $key => $column) {
            if (!array_key_exists($key, $patch)) {
                continue;
            }
            $value = $patch[$key];
            switch ($key) {
                case 'amount':
                    $value = Repo::money($value);
                    break;
                case 'type':
                    $value = self::type($value);
                    break;
                case 'frequency':
                    $value = self::frequency($value);
                    break;
                case 'method':
                    $value = self::method($value);
                    break;
                case 'nextDate':
                    $value = self::dateOrToday($value);
                    break;
                case 'endDate':
                    $value = self::dateOrNull($value);
                    break;
                default:
                    if (is_bool($value)) {
                        $value = $value ? 1 : 0;
                    }
            }
            $sets[]               = "`{$column}` = :{$column}";
            $params[":{$column}"] = $value;
        }

        if ($sets !== []) {
            Database::run(
                'UPDATE `recurring_transactions` SET ' . implode(', ', $sets)
                . ' WHERE `user_id` = :uid AND `id` = :id',
                $params
            );
        }

        return self::findOrFail($uid, $id);
    }

    public static function setPaused(int $uid, string $id, bool $paused): array
    {
        self::findOrFail($uid, $id);
        Database::run(
            'UPDATE `recurring_transactions` SET `paused` = :paused WHERE `user_id` = :uid AND `id` = :id',
            [':uid' => $uid, ':id' => $id, ':paused' => $paused ? 1 : 0]
        );
        return self::findOrFail($uid, $id);
    }

    public static function delete(int $uid, string $id): void
    {
        self::findOrFail($uid, $id);

        Database::transaction(static function () use ($uid, $id): void {
            // Posted transactions stay; their recurring_id is cleared here
            // because a composite FK cannot SET NULL.
            Database::run(
                'UPDATE `transactions` SET `recurring_id` = NULL WHERE `user_id` = :uid AND `recurring_id` = :id',
                [':uid' => $uid, ':id' => $id]
            );
            Database::run(
                'DELETE FROM `recurring_transactions` WHERE `user_id` = :uid AND `id` = :id',
                [':uid' => $uid, ':id' => $id]
            );
        });
    }

    /** Advances the schedule after a successful (or skipped) occurrence. */
    public static function markPosted(int $uid, string $id, string $postedDate, string $nextDate): void
    {
        Database::run(
            'UPDATE `recurring_transactions`
             SET `last_posted` = :posted, `next_date` = :next
             WHERE `user_id` = :uid AND `id` = :id',
            [':uid' => $uid, ':id' => $id, ':posted' => $postedDate, ':next' => $nextDate]
        );
    }

    private static function type($value): string
    {
        return is_string($value) && in_array($value, ['income', 'expense'], true) ? $value : 'expense';
    }

    private static function frequency($value): string
    {
        return is_string($value) && in_array($value, Defaults::FREQUENCIES, true) ? $value : 'monthly';
    }

    private static function method($value): ?string
    {
        if (!is_string($value) || $value === '') {
            return 'Auto-Debit';
        }
        return in_array($value, Defaults::PAYMENT_METHODS, true) ? $value : 'Other';
    }

    private static function dateOrToday($value): string
    {
        return is_string($value) && Dates::isDate($value) ? $value : Dates::today();
    }

    private static function dateOrNull($value): ?string
    {
        return is_string($value) && Dates::isDate($value) ? $value : null;
    }

    private static function idOrNull($value): ?string
    {
        return is_string($value) && $value !== '' ? $value : null;
    }

    /** @param array<string,mixed> $row @return array<string,mixed> */
    public static function shape(array $row): array
    {
        return [
            'id'         => (string) $row['id'],
            'name'       => (string) $row['name'],
            'type'       => (string) $row['type'],
            'amount'     => Repo::money($row['amount']),
            'categoryId' => Repo::str($row['category_id']),
            'accountId'  => Repo::str($row['account_id']),
            'method'     => Repo::str($row['method']),
            'frequency'  => (string) $row['frequency'],
            'nextDate'   => (string) $row['next_date'],
            'endDate'    => Repo::str($row['end_date']),
            'autoPost'   => Repo::flag($row['auto_post']),
            'paused'     => Repo::flag($row['paused']),
            'notes'      => Repo::str($row['notes']),
            'lastPosted' => Repo::str($row['last_posted']),
            'sample'     => Repo::flag($row['is_sample']),
            'createdAt'  => Repo::iso($row['created_at'] ?? null),
        ];
    }
}

// ============================================================================
// GROCERY LIST (Live Grocery List)
// ============================================================================

/**
 * The working shopping list. Items are not money: submit() is the only place
 * they become expenses, and it does so through TransactionRepo::create so every
 * existing rule (account/category ownership, category kind, method fallback,
 * minor-unit amounts) applies unchanged.
 */
final class GroceryRepo
{
    /** @return list<array<string,mixed>> oldest first, so the list keeps the order it was written in */
    public static function all(int $uid): array
    {
        $rows = Database::all(
            'SELECT * FROM `grocery_items` WHERE `user_id` = :uid ORDER BY `created_at`, `id`',
            [':uid' => $uid]
        );
        return array_map([self::class, 'shape'], $rows);
    }

    public static function find(int $uid, string $id): ?array
    {
        $row = Database::one(
            'SELECT * FROM `grocery_items` WHERE `user_id` = :uid AND `id` = :id',
            [':uid' => $uid, ':id' => $id]
        );
        return $row === null ? null : self::shape($row);
    }

    public static function findOrFail(int $uid, string $id): array
    {
        $item = self::find($uid, $id);
        if ($item === null) {
            throw new ApiException('That grocery item could not be found.', 404, 'not_found');
        }
        return $item;
    }

    /** @param array<string,mixed> $data validated payload @return array<string,mixed> */
    public static function create(int $uid, array $data): array
    {
        $name = mb_substr(trim((string) ($data['name'] ?? '')), 0, 120);
        if ($name === '') {
            throw new ApiException('Please check the highlighted fields.', 422, 'validation_failed', [
                'fields' => ['name' => 'Enter an item name.'],
            ]);
        }

        $categoryId = self::expenseCategoryOrFail($uid, $data['categoryId'] ?? null);
        Repo::assertUnderLimit($uid, 'grocery_items', 'limits.max_grocery_items', 'grocery items');

        $id = isset($data['id']) && is_string($data['id']) && $data['id'] !== ''
            ? $data['id']
            : Defaults::newId('gro');

        Database::run(
            'INSERT INTO `grocery_items` (`user_id`,`id`,`name`,`category_id`,`is_checked`,`checked_at`)
             VALUES (:uid,:id,:name,:category,:checked,:checked_at)',
            [
                ':uid'        => $uid,
                ':id'         => $id,
                ':name'       => $name,
                ':category'   => $categoryId,
                ':checked'    => !empty($data['checked']) ? 1 : 0,
                ':checked_at' => !empty($data['checked']) ? Repo::now() : null,
            ]
        );

        return self::findOrFail($uid, $id);
    }

    /** @param array<string,mixed> $patch @return array<string,mixed> */
    public static function update(int $uid, string $id, array $patch): array
    {
        $current = self::findOrFail($uid, $id);

        $name = array_key_exists('name', $patch)
            ? mb_substr(trim((string) $patch['name']), 0, 120)
            : $current['name'];
        if ($name === '') {
            throw new ApiException('Please check the highlighted fields.', 422, 'validation_failed', [
                'fields' => ['name' => 'Enter an item name.'],
            ]);
        }

        $categoryId = array_key_exists('categoryId', $patch)
            ? self::expenseCategoryOrFail($uid, $patch['categoryId'])
            : $current['categoryId'];

        $checked = array_key_exists('checked', $patch) ? (bool) $patch['checked'] : (bool) $current['checked'];
        $checkedAt = $checked
            ? ($current['checked'] ? Repo::str(self::rawCheckedAt($uid, $id)) : Repo::now())
            : null;

        // Price is the amount actually paid, collected by the purchase dialogue.
        // Rules (mirrored in assets/js/store.js):
        //   · an item can only be marked purchased together with a price > 0
        //   · moving an item back to the active list clears the price, so a
        //     stored price always belongs to a purchase that really happened
        $price = array_key_exists('price', $patch) ? $patch['price'] : $current['price'];
        if (!$checked) {
            $price = null;
        } elseif ($price === null || (int) $price <= 0) {
            throw new ApiException('Please check the highlighted fields.', 422, 'validation_failed', [
                'fields' => ['price' => 'Enter the price you paid for this item.'],
            ]);
        }

        Database::run(
            'UPDATE `grocery_items`
                SET `name` = :name, `category_id` = :category, `price` = :price,
                    `is_checked` = :checked, `checked_at` = :checked_at
              WHERE `user_id` = :uid AND `id` = :id',
            [
                ':name'       => $name,
                ':category'   => $categoryId,
                ':price'      => $price === null ? null : (int) $price,
                ':checked'    => $checked ? 1 : 0,
                ':checked_at' => $checkedAt,
                ':uid'        => $uid,
                ':id'         => $id,
            ]
        );

        return self::findOrFail($uid, $id);
    }

    public static function delete(int $uid, string $id): void
    {
        // Idempotent on purpose: deleting an item that is already gone (a second
        // tab, a retry after a dropped connection) is not an error.
        Database::run(
            'DELETE FROM `grocery_items` WHERE `user_id` = :uid AND `id` = :id',
            [':uid' => $uid, ':id' => $id]
        );
    }

    /**
     * Empties the working shopping list (active and purchased items alike).
     *
     * Scope is intentionally limited to `grocery_items` for this user: saved
     * grocery lists are separate tables and expenses are ordinary
     * `transactions`, so neither is affected. Idempotent.
     *
     * @return int how many items were removed
     */
    public static function clear(int $uid): int
    {
        $count = (int) Database::scalar(
            'SELECT COUNT(*) FROM `grocery_items` WHERE `user_id` = :uid',
            [':uid' => $uid]
        );
        if ($count > 0) {
            Database::run('DELETE FROM `grocery_items` WHERE `user_id` = :uid', [':uid' => $uid]);
            Audit::log($uid, 'grocery.clear', 'grocery_items', null, ['count' => $count]);
        }
        return $count;
    }

    /**
     * Turns grocery items into expenses. All-or-nothing: if any line fails, no
     * expense is created and no item is removed, so the list is never lost.
     * Removing each item inside the same transaction is also what makes a
     * double-submit safe - the second request finds the items already gone and
     * gets a 409 instead of duplicating the expenses.
     *
     * Only PURCHASED items can be submitted: the amount of every expense is the
     * price the shopper entered in the purchase dialogue (`grocery_items`.`price`).
     * Items that were never bought have no amount paid, so they are not expenses;
     * the client leaves them out and they stay on the list for the next trip.
     * `amount` on a line is optional and only kept for older clients.
     *
     * @param array{accountId:string,date:string,method?:?string,items:list<array<string,mixed>>} $data
     * @return array{transactions:list<array<string,mixed>>,submitted:int}
     */
    public static function submit(int $uid, array $data): array
    {
        $items = $data['items'] ?? [];
        if (!is_array($items) || $items === []) {
            throw new ApiException('Your grocery list is empty.', 422, 'validation_failed', [
                'fields' => ['items' => 'Add at least one item before submitting.'],
            ]);
        }

        $accountId = (string) ($data['accountId'] ?? '');
        Auth::ownsOrFail($uid, 'accounts', $accountId, 'account');

        $result = Database::transaction(static function () use ($uid, $data, $items, $accountId): array {
            $created = [];

            foreach (array_values($items) as $i => $line) {
                $id  = (string) ($line['id'] ?? '');
                $row = Database::one(
                    'SELECT * FROM `grocery_items` WHERE `user_id` = :uid AND `id` = :id FOR UPDATE',
                    [':uid' => $uid, ':id' => $id]
                );
                if ($row === null) {
                    throw new ApiException(
                        'Your grocery list changed (it may already have been submitted). Reload it and try again.',
                        409,
                        'grocery_changed'
                    );
                }

                $categoryId = $line['categoryId'] ?? $row['category_id'];

                if (!Repo::flag($row['is_checked'])) {
                    throw new ApiException('Please check the highlighted fields.', 422, 'validation_failed', [
                        'fields' => ["items.{$i}.amount" => 'Buy this item first so it has a price.'],
                    ]);
                }

                // The stored purchase price is the source of truth for the expense.
                $amount = $line['amount'] ?? null;
                if ($amount === null) {
                    $amount = $row['price'] === null ? null : (int) $row['price'];
                }
                if ($amount === null || (int) $amount <= 0) {
                    throw new ApiException('Please check the highlighted fields.', 422, 'validation_failed', [
                        'fields' => ["items.{$i}.amount" => 'This item has no purchase price. Buy it first, or remove it.'],
                    ]);
                }

                try {
                    $created[] = TransactionRepo::create($uid, [
                        'type'        => 'expense',
                        'amount'      => $amount,
                        'date'        => $data['date'],
                        'description' => (string) $row['name'],
                        'categoryId'  => $categoryId,
                        'accountId'   => $accountId,
                        'method'      => $data['method'] ?? null,
                        'notes'       => 'Live Grocery List',
                    ]);
                } catch (ApiException $e) {
                    // Point the message at the row the person can actually fix.
                    if ($e->errorCode() === 'validation_failed') {
                        $fields = [];
                        foreach ((array) ($e->details()['fields'] ?? []) as $k => $msg) {
                            $fields["items.{$i}.{$k}"] = $msg;
                        }
                        throw new ApiException($e->getMessage(), 422, 'validation_failed', ['fields' => $fields]);
                    }
                    throw $e;
                }

                Database::run(
                    'DELETE FROM `grocery_items` WHERE `user_id` = :uid AND `id` = :id',
                    [':uid' => $uid, ':id' => $id]
                );
            }

            return ['transactions' => $created, 'submitted' => count($created)];
        });

        Audit::log($uid, 'grocery.submit', 'grocery_items', null, ['count' => $result['submitted']]);
        return $result;
    }

    /** A grocery item may only point at a category the user owns that can hold expenses. */
    private static function expenseCategoryOrFail(int $uid, $categoryId): ?string
    {
        if ($categoryId === null || $categoryId === '') {
            return null;
        }
        $categoryId = (string) $categoryId;
        Auth::ownsOrFail($uid, 'categories', $categoryId, 'category');
        $category = CategoryRepo::findOrFail($uid, $categoryId);
        if ($category['kind'] !== 'both' && $category['kind'] !== 'expense') {
            throw new ApiException('Please check the highlighted fields.', 422, 'validation_failed', [
                'fields' => ['categoryId' => 'Choose an expense category.'],
            ]);
        }
        return $categoryId;
    }

    private static function rawCheckedAt(int $uid, string $id): ?string
    {
        $v = Database::scalar(
            'SELECT `checked_at` FROM `grocery_items` WHERE `user_id` = :uid AND `id` = :id',
            [':uid' => $uid, ':id' => $id]
        );
        return $v === null ? null : (string) $v;
    }

    /** @param array<string,mixed> $row */
    public static function shape(array $row): array
    {
        return [
            'id'         => (string) $row['id'],
            'name'       => (string) $row['name'],
            'categoryId' => Repo::str($row['category_id']),
            'price'      => ($row['price'] ?? null) === null ? null : Repo::money($row['price']),
            'checked'    => Repo::flag($row['is_checked']),
            'checkedAt'  => Repo::iso($row['checked_at'] ?? null),
            'createdAt'  => Repo::iso($row['created_at'] ?? null),
            'updatedAt'  => Repo::iso($row['updated_at'] ?? null),
        ];
    }
}

// ============================================================================
// SAVED GROCERY LISTS (reusable shopping templates)
// ============================================================================

/**
 * A saved grocery list is a TEMPLATE: the items a user wants to buy again
 * (name + category), never an expense record and never a purchase state.
 *
 *   grocery_lists       one row per template
 *   grocery_list_items  its items, ordered by `position`
 *
 * Loading a template rebuilds the working list in `grocery_items` with every
 * item unpurchased and no price; money is still created only by
 * GroceryRepo::submit. Deleting a template never touches `transactions`.
 */
final class GroceryListRepo
{
    /** @return list<array<string,mixed>> newest change first */
    public static function all(int $uid): array
    {
        $lists = Database::all(
            'SELECT * FROM `grocery_lists` WHERE `user_id` = :uid ORDER BY `updated_at` DESC, `id`',
            [':uid' => $uid]
        );
        if ($lists === []) {
            return [];
        }
        $rows = Database::all(
            'SELECT * FROM `grocery_list_items` WHERE `user_id` = :uid ORDER BY `list_id`, `position`, `id`',
            [':uid' => $uid]
        );
        $byList = [];
        foreach ($rows as $row) {
            $byList[(string) $row['list_id']][] = self::shapeItem($row);
        }
        return array_map(
            static fn (array $l): array => self::shape($l, $byList[(string) $l['id']] ?? []),
            $lists
        );
    }

    public static function find(int $uid, string $id): ?array
    {
        $list = Database::one(
            'SELECT * FROM `grocery_lists` WHERE `user_id` = :uid AND `id` = :id',
            [':uid' => $uid, ':id' => $id]
        );
        if ($list === null) {
            return null;
        }
        $rows = Database::all(
            'SELECT * FROM `grocery_list_items` WHERE `user_id` = :uid AND `list_id` = :id ORDER BY `position`, `id`',
            [':uid' => $uid, ':id' => $id]
        );
        return self::shape($list, array_map([self::class, 'shapeItem'], $rows));
    }

    public static function findOrFail(int $uid, string $id): array
    {
        $list = self::find($uid, $id);
        if ($list === null) {
            throw new ApiException('That saved grocery list could not be found.', 404, 'not_found');
        }
        return $list;
    }

    /** @param array<string,mixed> $data validated payload @return array<string,mixed> */
    public static function create(int $uid, array $data): array
    {
        $items = self::cleanItems($uid, $data['items'] ?? []);
        $name  = self::cleanName($data['name'] ?? null);
        Repo::assertUnderLimit($uid, 'grocery_lists', 'limits.max_grocery_lists', 'saved grocery lists');

        $id = isset($data['id']) && is_string($data['id']) && $data['id'] !== ''
            ? $data['id']
            : Defaults::newId('grl');

        Database::transaction(static function () use ($uid, $id, $name, $items): void {
            Database::run(
                'INSERT INTO `grocery_lists` (`user_id`,`id`,`name`) VALUES (:uid,:id,:name)',
                [':uid' => $uid, ':id' => $id, ':name' => $name]
            );
            self::writeItems($uid, $id, $items);
        });

        Audit::log($uid, 'grocery_list.create', 'grocery_lists', $id, ['items' => count($items)]);
        return self::findOrFail($uid, $id);
    }

    /**
     * Rename a saved list and/or replace its items ("Save" over a loaded list).
     *
     * @param array<string,mixed> $patch
     * @return array<string,mixed>
     */
    public static function update(int $uid, string $id, array $patch): array
    {
        self::findOrFail($uid, $id);
        $name  = array_key_exists('name', $patch) && $patch['name'] !== null ? self::cleanName($patch['name']) : null;
        $items = array_key_exists('items', $patch) && $patch['items'] !== null ? self::cleanItems($uid, $patch['items']) : null;

        Database::transaction(static function () use ($uid, $id, $name, $items): void {
            if ($name !== null) {
                Database::run(
                    'UPDATE `grocery_lists` SET `name` = :name WHERE `user_id` = :uid AND `id` = :id',
                    [':name' => $name, ':uid' => $uid, ':id' => $id]
                );
            }
            if ($items !== null) {
                Database::run(
                    'DELETE FROM `grocery_list_items` WHERE `user_id` = :uid AND `list_id` = :id',
                    [':uid' => $uid, ':id' => $id]
                );
                self::writeItems($uid, $id, $items);
            }
            // Touch the row even when only the items changed.
            Database::run(
                'UPDATE `grocery_lists` SET `updated_at` = :now WHERE `user_id` = :uid AND `id` = :id',
                [':now' => Repo::now(), ':uid' => $uid, ':id' => $id]
            );
        });

        Audit::log($uid, 'grocery_list.update', 'grocery_lists', $id);
        return self::findOrFail($uid, $id);
    }

    /** Idempotent. Expenses created from this list earlier are NOT affected. */
    public static function delete(int $uid, string $id): void
    {
        Database::transaction(static function () use ($uid, $id): void {
            Database::run(
                'DELETE FROM `grocery_list_items` WHERE `user_id` = :uid AND `list_id` = :id',
                [':uid' => $uid, ':id' => $id]
            );
            Database::run(
                'DELETE FROM `grocery_lists` WHERE `user_id` = :uid AND `id` = :id',
                [':uid' => $uid, ':id' => $id]
            );
        });
        Audit::log($uid, 'grocery_list.delete', 'grocery_lists', $id);
    }

    /**
     * Copies a saved list into the working grocery list. Every item is created
     * unpurchased and without a price - loading a template never creates an
     * expense and never marks anything as bought.
     *
     * @param bool $replace true (default) clears the current working list first
     * @return array{grocery:list<array<string,mixed>>,listId:string,name:string}
     */
    public static function load(int $uid, string $id, bool $replace = true): array
    {
        $list = self::findOrFail($uid, $id);

        Database::transaction(static function () use ($uid, $list, $replace): void {
            if ($replace) {
                Database::run('DELETE FROM `grocery_items` WHERE `user_id` = :uid', [':uid' => $uid]);
            }
            foreach ($list['items'] as $item) {
                Database::run(
                    'INSERT INTO `grocery_items` (`user_id`,`id`,`name`,`category_id`,`price`,`is_checked`,`checked_at`)
                     VALUES (:uid,:id,:name,:category,NULL,0,NULL)',
                    [
                        ':uid'      => $uid,
                        ':id'       => Defaults::newId('gro'),
                        ':name'     => $item['name'],
                        ':category' => $item['categoryId'],
                    ]
                );
            }
        });

        Audit::log($uid, 'grocery_list.load', 'grocery_lists', $id, ['items' => count($list['items'])]);
        return ['grocery' => GroceryRepo::all($uid), 'listId' => $list['id'], 'name' => $list['name']];
    }

    /** @param list<array<string,mixed>> $items */
    private static function writeItems(int $uid, string $listId, array $items): void
    {
        foreach (array_values($items) as $i => $item) {
            Database::run(
                'INSERT INTO `grocery_list_items` (`user_id`,`id`,`list_id`,`name`,`category_id`,`position`)
                 VALUES (:uid,:id,:list,:name,:category,:position)',
                [
                    ':uid'      => $uid,
                    ':id'       => Defaults::newId('gri'),
                    ':list'     => $listId,
                    ':name'     => $item['name'],
                    ':category' => $item['categoryId'],
                    ':position' => $i,
                ]
            );
        }
    }

    /**
     * Only a name and a category are saved: a template says what to buy, not
     * what it cost. An empty list cannot be saved.
     *
     * @param mixed $items
     * @return list<array{name:string,categoryId:?string}>
     */
    private static function cleanItems(int $uid, $items): array
    {
        $out = [];
        foreach (is_array($items) ? $items : [] as $item) {
            if (!is_array($item)) {
                continue;
            }
            $name = mb_substr(trim((string) ($item['name'] ?? '')), 0, 120);
            if ($name === '') {
                continue;
            }
            $categoryId = $item['categoryId'] ?? null;
            if ($categoryId !== null && $categoryId !== '') {
                Auth::ownsOrFail($uid, 'categories', (string) $categoryId, 'category');
                $categoryId = (string) $categoryId;
            } else {
                $categoryId = null;
            }
            $out[] = ['name' => $name, 'categoryId' => $categoryId];
        }
        if ($out === []) {
            throw new ApiException('Please check the highlighted fields.', 422, 'validation_failed', [
                'fields' => ['items' => 'Add at least one item before saving this list.'],
            ]);
        }
        if (count($out) > (int) Config::get('limits.max_grocery_items', 300)) {
            $out = array_slice($out, 0, (int) Config::get('limits.max_grocery_items', 300));
        }
        return $out;
    }

    /** @param mixed $name */
    private static function cleanName($name): string
    {
        $clean = mb_substr(trim((string) ($name ?? '')), 0, 80);
        if ($clean === '') {
            // Same default the SPA offers, so an empty name is never an error.
            $clean = 'grocery-list-' . gmdate('Y-m-d-H-i');
        }
        return $clean;
    }

    /**
     * @param array<string,mixed> $row
     * @param list<array<string,mixed>> $items
     * @return array<string,mixed>
     */
    private static function shape(array $row, array $items): array
    {
        return [
            'id'        => (string) $row['id'],
            'name'      => (string) $row['name'],
            'items'     => $items,
            'createdAt' => Repo::iso($row['created_at'] ?? null),
            'updatedAt' => Repo::iso($row['updated_at'] ?? null),
        ];
    }

    /** @param array<string,mixed> $row */
    private static function shapeItem(array $row): array
    {
        return [
            'id'         => (string) $row['id'],
            'name'       => (string) $row['name'],
            'categoryId' => Repo::str($row['category_id']),
        ];
    }
}

/**
 * Saved budgets: reusable budget templates (Save / Load / Preview).
 *
 * A saved budget is a snapshot of a plan - the category allocations plus the
 * income and savings plan rows of a month. It is NEVER ledger data: loading
 * one only rewrites `budget_lines` / `budget_plan_lines` for the chosen month
 * through BudgetRepo, and deleting one never touches transactions, bills or
 * recurring rules.
 */
final class SavedBudgetRepo
{
    /** @return list<array<string,mixed>> newest change first */
    public static function all(int $uid): array
    {
        $rows = Database::all(
            'SELECT * FROM `saved_budgets` WHERE `user_id` = :uid ORDER BY `updated_at` DESC, `id`',
            [':uid' => $uid]
        );
        if ($rows === []) {
            return [];
        }
        $lines = Database::all(
            'SELECT * FROM `saved_budget_lines` WHERE `user_id` = :uid ORDER BY `budget_id`, `kind`, `position`, `id`',
            [':uid' => $uid]
        );
        $byBudget = [];
        foreach ($lines as $line) {
            $byBudget[(string) $line['budget_id']][] = $line;
        }
        return array_map(
            static fn (array $r): array => self::shape($r, $byBudget[(string) $r['id']] ?? []),
            $rows
        );
    }

    public static function find(int $uid, string $id): ?array
    {
        $row = Database::one(
            'SELECT * FROM `saved_budgets` WHERE `user_id` = :uid AND `id` = :id',
            [':uid' => $uid, ':id' => $id]
        );
        if ($row === null) {
            return null;
        }
        $lines = Database::all(
            'SELECT * FROM `saved_budget_lines` WHERE `user_id` = :uid AND `budget_id` = :id ORDER BY `kind`, `position`, `id`',
            [':uid' => $uid, ':id' => $id]
        );
        return self::shape($row, $lines);
    }

    public static function findOrFail(int $uid, string $id): array
    {
        $row = self::find($uid, $id);
        if ($row === null) {
            throw new ApiException('That saved budget could not be found.', 404, 'not_found');
        }
        return $row;
    }

    /** @param array<string,mixed> $data validated payload @return array<string,mixed> */
    public static function create(int $uid, array $data): array
    {
        $lines = self::cleanLines($uid, $data);
        $name  = self::cleanName($data['name'] ?? null);
        $month = self::cleanMonth($data['sourceMonth'] ?? null);
        Repo::assertUnderLimit($uid, 'saved_budgets', 'limits.max_saved_budgets', 'saved budgets');

        $id = isset($data['id']) && is_string($data['id']) && $data['id'] !== ''
            ? $data['id']
            : Defaults::newId('sbg');

        Database::transaction(static function () use ($uid, $id, $name, $month, $lines): void {
            Database::run(
                'INSERT INTO `saved_budgets` (`user_id`,`id`,`name`,`source_month`) VALUES (:uid,:id,:name,:month)',
                [':uid' => $uid, ':id' => $id, ':name' => $name, ':month' => $month]
            );
            self::writeLines($uid, $id, $lines);
        });

        Audit::log($uid, 'saved_budget.create', 'saved_budgets', $id, ['lines' => count($lines)]);
        return self::findOrFail($uid, $id);
    }

    /**
     * Rename a saved budget and/or replace its contents ("Save" over a loaded one).
     *
     * @param array<string,mixed> $patch
     * @return array<string,mixed>
     */
    public static function update(int $uid, string $id, array $patch): array
    {
        self::findOrFail($uid, $id);
        $name  = array_key_exists('name', $patch) && $patch['name'] !== null ? self::cleanName($patch['name']) : null;
        $month = array_key_exists('sourceMonth', $patch) ? self::cleanMonth($patch['sourceMonth']) : null;
        $hasLines = array_key_exists('lines', $patch) || array_key_exists('incomePlan', $patch) || array_key_exists('savingsPlan', $patch);
        $lines = $hasLines ? self::cleanLines($uid, $patch) : null;

        Database::transaction(static function () use ($uid, $id, $name, $month, $lines): void {
            if ($name !== null) {
                Database::run(
                    'UPDATE `saved_budgets` SET `name` = :name WHERE `user_id` = :uid AND `id` = :id',
                    [':name' => $name, ':uid' => $uid, ':id' => $id]
                );
            }
            if ($month !== null) {
                Database::run(
                    'UPDATE `saved_budgets` SET `source_month` = :month WHERE `user_id` = :uid AND `id` = :id',
                    [':month' => $month, ':uid' => $uid, ':id' => $id]
                );
            }
            if ($lines !== null) {
                Database::run(
                    'DELETE FROM `saved_budget_lines` WHERE `user_id` = :uid AND `budget_id` = :id',
                    [':uid' => $uid, ':id' => $id]
                );
                self::writeLines($uid, $id, $lines);
            }
            // Touch the row even when only the lines changed.
            Database::run(
                'UPDATE `saved_budgets` SET `updated_at` = :now WHERE `user_id` = :uid AND `id` = :id',
                [':now' => Repo::now(), ':uid' => $uid, ':id' => $id]
            );
        });

        Audit::log($uid, 'saved_budget.update', 'saved_budgets', $id);
        return self::findOrFail($uid, $id);
    }

    /** Idempotent. Budgets, transactions, bills and recurring rules are untouched. */
    public static function delete(int $uid, string $id): void
    {
        Database::transaction(static function () use ($uid, $id): void {
            Database::run(
                'DELETE FROM `saved_budget_lines` WHERE `user_id` = :uid AND `budget_id` = :id',
                [':uid' => $uid, ':id' => $id]
            );
            Database::run(
                'DELETE FROM `saved_budgets` WHERE `user_id` = :uid AND `id` = :id',
                [':uid' => $uid, ':id' => $id]
            );
        });
        Audit::log($uid, 'saved_budget.delete', 'saved_budgets', $id);
    }

    /**
     * Copies a saved budget onto a month, replacing that month's plan. Only
     * `budget_lines` and `budget_plan_lines` are written - no transaction is
     * ever created and the template itself is left alone.
     *
     * @return array{budget:array<string,mixed>,savedBudgetId:string,name:string}
     */
    public static function load(int $uid, string $id, string $month): array
    {
        if (!Dates::isMonthKey($month)) {
            throw new ApiException('Please use a valid month (YYYY-MM).', 422, 'validation_failed');
        }
        $saved = self::findOrFail($uid, $id);

        $budget = Database::transaction(static function () use ($uid, $saved, $month): array {
            $target   = BudgetRepo::ensure($uid, $month);
            $targetId = (string) $target['id'];

            Database::run(
                'DELETE FROM `budget_lines` WHERE `user_id` = :uid AND `budget_id` = :budget',
                [':uid' => $uid, ':budget' => $targetId]
            );
            Database::run(
                'DELETE FROM `budget_plan_lines` WHERE `user_id` = :uid AND `budget_id` = :budget',
                [':uid' => $uid, ':budget' => $targetId]
            );

            foreach ($saved['lines'] as $line) {
                if ($line['categoryId'] === null) {
                    continue;              // the category was deleted after saving
                }
                Database::run(
                    'INSERT INTO `budget_lines` (`user_id`,`id`,`budget_id`,`category_id`,`amount`)
                     VALUES (:uid,:id,:budget,:category,:amount)',
                    [
                        ':uid'      => $uid,
                        ':id'       => Defaults::newId('bl'),
                        ':budget'   => $targetId,
                        ':category' => $line['categoryId'],
                        ':amount'   => Repo::money($line['amount']),
                    ]
                );
            }

            foreach ([['income', 'incomePlan', 'ip'], ['savings', 'savingsPlan', 'sp']] as [$kind, $key, $prefix]) {
                $sort = 0;
                foreach ($saved[$key] as $row) {
                    Database::run(
                        'INSERT INTO `budget_plan_lines`
                            (`user_id`,`id`,`budget_id`,`plan_kind`,`label`,`amount`,`sort_order`)
                         VALUES (:uid,:id,:budget,:kind,:label,:amount,:sort)',
                        [
                            ':uid'    => $uid,
                            ':id'     => Defaults::newId($prefix),
                            ':budget' => $targetId,
                            ':kind'   => $kind,
                            ':label'  => (string) $row['label'],
                            ':amount' => Repo::money($row['amount']),
                            ':sort'   => $sort++,
                        ]
                    );
                }
            }

            $updated = BudgetRepo::forMonth($uid, $month);
            if ($updated === null) {
                throw new ApiException('That budget could not be found.', 404, 'not_found');
            }
            return $updated;
        });

        Audit::log($uid, 'saved_budget.load', 'saved_budgets', $id, ['month' => $month]);
        return ['budget' => $budget, 'savedBudgetId' => $saved['id'], 'name' => $saved['name']];
    }

    /** @param list<array{kind:string,categoryId:?string,label:?string,amount:int}> $lines */
    private static function writeLines(int $uid, string $budgetId, array $lines): void
    {
        $position = ['category' => 0, 'income' => 0, 'savings' => 0];
        foreach ($lines as $line) {
            Database::run(
                'INSERT INTO `saved_budget_lines`
                    (`user_id`,`id`,`budget_id`,`kind`,`category_id`,`label`,`amount`,`position`)
                 VALUES (:uid,:id,:budget,:kind,:category,:label,:amount,:position)',
                [
                    ':uid'      => $uid,
                    ':id'       => Defaults::newId('sbl'),
                    ':budget'   => $budgetId,
                    ':kind'     => $line['kind'],
                    ':category' => $line['categoryId'],
                    ':label'    => $line['label'],
                    ':amount'   => $line['amount'],
                    ':position' => $position[$line['kind']]++,
                ]
            );
        }
    }

    /**
     * Category allocations plus the income/savings plan rows. A budget with no
     * allocation at all cannot be saved - there would be nothing to load back.
     *
     * @param array<string,mixed> $data
     * @return list<array{kind:string,categoryId:?string,label:?string,amount:int}>
     */
    private static function cleanLines(int $uid, array $data): array
    {
        $out = [];
        foreach (is_array($data['lines'] ?? null) ? $data['lines'] : [] as $line) {
            if (!is_array($line)) {
                continue;
            }
            $categoryId = $line['categoryId'] ?? null;
            if ($categoryId === null || $categoryId === '') {
                continue;
            }
            Auth::ownsOrFail($uid, 'categories', (string) $categoryId, 'category');
            $amount = Repo::money($line['amount'] ?? 0);
            if ($amount <= 0) {
                continue;              // the working budget drops a line at <= 0 too
            }
            $out[] = ['kind' => 'category', 'categoryId' => (string) $categoryId, 'label' => null, 'amount' => $amount];
        }

        foreach ([['incomePlan', 'income'], ['savingsPlan', 'savings']] as [$key, $kind]) {
            foreach (is_array($data[$key] ?? null) ? $data[$key] : [] as $row) {
                if (!is_array($row)) {
                    continue;
                }
                $label = mb_substr(trim((string) ($row['label'] ?? '')), 0, 80);
                if ($label === '') {
                    continue;
                }
                $out[] = ['kind' => $kind, 'categoryId' => null, 'label' => $label, 'amount' => Repo::money($row['amount'] ?? 0)];
            }
        }

        if ($out === []) {
            throw new ApiException('Please check the highlighted fields.', 422, 'validation_failed', [
                'fields' => ['lines' => 'Add at least one budget category before saving.'],
            ]);
        }
        return $out;
    }

    /** @param mixed $name */
    private static function cleanName($name): string
    {
        $clean = mb_substr(trim((string) ($name ?? '')), 0, 80);
        if ($clean === '') {
            // Same default the SPA offers, so an empty name is never an error.
            $clean = 'budget-' . gmdate('Y-m-d-H-i');
        }
        return $clean;
    }

    /** @param mixed $month */
    private static function cleanMonth($month): ?string
    {
        $clean = trim((string) ($month ?? ''));
        return $clean !== '' && Dates::isMonthKey($clean) ? $clean : null;
    }

    /**
     * @param array<string,mixed> $row
     * @param list<array<string,mixed>> $lines
     * @return array<string,mixed>
     */
    private static function shape(array $row, array $lines): array
    {
        $categories = $income = $savings = [];
        foreach ($lines as $line) {
            $shaped = [
                'id'         => (string) $line['id'],
                'categoryId' => Repo::str($line['category_id']),
                'label'      => Repo::str($line['label']),
                'amount'     => Repo::money($line['amount']),
            ];
            if ($line['kind'] === 'income') {
                $income[] = ['id' => $shaped['id'], 'label' => (string) $shaped['label'], 'amount' => $shaped['amount']];
            } elseif ($line['kind'] === 'savings') {
                $savings[] = ['id' => $shaped['id'], 'label' => (string) $shaped['label'], 'amount' => $shaped['amount']];
            } else {
                $categories[] = ['id' => $shaped['id'], 'categoryId' => $shaped['categoryId'], 'amount' => $shaped['amount']];
            }
        }
        $total = 0;
        foreach ($categories as $line) {
            $total += (int) $line['amount'];
        }

        return [
            'id'          => (string) $row['id'],
            'name'        => (string) $row['name'],
            'sourceMonth' => Repo::str($row['source_month']),
            'lines'       => $categories,
            'incomePlan'  => $income,
            'savingsPlan' => $savings,
            'total'       => $total,
            'createdAt'   => Repo::iso($row['created_at']),
            'updatedAt'   => Repo::iso($row['updated_at']),
        ];
    }
}

// ============================================================================
// WORKSPACE MAINTENANCE
// ============================================================================

/**
 * Bulk operations that span every table: "reset everything" and "remove the
 * sample data". Both are destructive, both run in one transaction, and both
 * are scoped to the authenticated user.
 */
final class DataRepo
{
    /** Child-first order, so a delete never trips a foreign key. */
    private const PURGE_ORDER = [
        'saved_budget_lines',
        'saved_budgets',
        'grocery_list_items',
        'grocery_lists',
        'grocery_items',
        'bill_payments',
        'goal_contributions',
        'transaction_splits',
        'transactions',
        'budget_lines',
        'budget_plan_lines',
        'budgets',
        'bills',
        'recurring_transactions',
        'savings_goals',
        'accounts',
        'categories',
        // `notifications` is deliberately NOT purged: it holds inbox deliveries
        // (Super Admin messages) and read receipts, not financial data.
    ];

    /** @return array<string,int> */
    public static function counts(int $uid): array
    {
        return [
            'transactions' => self::count($uid, 'transactions'),
            'accounts'     => self::count($uid, 'accounts'),
            'categories'   => self::count($uid, 'categories'),
            'budgets'      => self::count($uid, 'budgets'),
            'goals'        => self::count($uid, 'savings_goals'),
            'recurring'    => self::count($uid, 'recurring_transactions'),
            'bills'        => self::count($uid, 'bills'),
        ];
    }

    /**
     * Deletes everything the user owns and restores the 22 starter
     * categories, matching Store.resetAll.
     *
     * @return array<string,int> the counts after the reset
     */
    public static function reset(int $uid): array
    {
        Database::transaction(static function () use ($uid): void {
            foreach (self::PURGE_ORDER as $table) {
                Database::run("DELETE FROM `{$table}` WHERE `user_id` = :uid", [':uid' => $uid]);
            }
            Defaults::seedCategories($uid);
            SettingsRepo::setHasSampleData($uid, false);
        });

        Audit::log($uid, 'data.reset', 'user', (string) $uid);
        return self::counts($uid);
    }

    /**
     * Removes only the rows flagged as sample data, including transactions
     * that belong to a sample account, matching Store.clearSample.
     *
     * @return array<string,int>
     */
    public static function clearSample(int $uid): array
    {
        Database::transaction(static function () use ($uid): void {
            Database::run(
                'DELETE FROM `transactions`
                 WHERE `user_id` = :uid
                   AND (`is_sample` = 1
                        OR `account_id` IN (SELECT `id` FROM (
                               SELECT `id` FROM `accounts` WHERE `user_id` = :uid2 AND `is_sample` = 1
                           ) AS sample_accounts))',
                [':uid' => $uid, ':uid2' => $uid]
            );

            foreach (['bills', 'recurring_transactions', 'savings_goals', 'budgets', 'accounts', 'categories'] as $table) {
                Database::run(
                    "DELETE FROM `{$table}` WHERE `user_id` = :uid AND `is_sample` = 1",
                    [':uid' => $uid]
                );
            }

            SettingsRepo::setHasSampleData($uid, false);
        });

        Audit::log($uid, 'data.clear_sample', 'user', (string) $uid);
        return self::counts($uid);
    }

    /**
     * The complete dataset, for the Settings view's JSON backup. Uses the
     * repositories so the export matches the frontend document shape exactly.
     *
     * @return array<string,mixed>
     */
    public static function export(int $uid): array
    {
        return [
            'version'      => 1,
            'exportedAt'   => gmdate('c'),
            'settings'     => SettingsRepo::get($uid),
            'categories'   => CategoryRepo::all($uid),
            'accounts'     => AccountRepo::all($uid),
            'transactions' => TransactionRepo::paginate($uid, [], 1, (int) Config::get('limits.per_page_max', 200))['rows'],
            'budgets'      => BudgetRepo::all($uid),
            'goals'        => GoalRepo::all($uid),
            'recurring'    => RecurringRepo::all($uid),
            'bills'        => BillRepo::all($uid),
            'grocery'      => GroceryRepo::all($uid),
            'groceryLists' => GroceryListRepo::all($uid),
            'savedBudgets' => SavedBudgetRepo::all($uid),
        ];
    }

    private static function count(int $uid, string $table): int
    {
        if (!in_array($table, self::PURGE_ORDER, true)) {
            throw new LogicException('Count requested for an unknown table: ' . $table);
        }
        return (int) Database::scalar(
            "SELECT COUNT(*) FROM `{$table}` WHERE `user_id` = :uid",
            [':uid' => $uid]
        );
    }
}
