<?php
declare(strict_types=1);

/**
 * Reports - read-only aggregates.
 *
 * These mirror assets/js/compute.js so a view can be fed either from the
 * client-side Compute module (inside the hydration window) or from the server
 * (any month, any range) and see the same keys and the same numbers.
 *
 * Every figure is an integer in minor units except ratios, which are floats
 * expressed in percent exactly like Core.pct(a, b) = a / b * 100.
 *
 * Transfers are never income or expense; they only move money between
 * accounts. That rule is applied in SQL, not after the fact.
 *
 * Every query is scoped with `user_id = :uid`.
 *
 * NOTE: never executed - no PHP binary and no MySQL server in this
 * environment. See PROJECT_PROGRESS.md.
 */
final class Reports
{
    /** Core.pct: percentage, 0 when the denominator is falsy. */
    public static function pct(int $a, int $b): float
    {
        return $b === 0 ? 0.0 : ($a / $b) * 100;
    }

    public static function daysInMonth(string $ym): int
    {
        return (int) (new DateTimeImmutable(Dates::monthEnd($ym)))->format('j');
    }

    public static function monthLabel(string $ym, bool $short = false): string
    {
        $d = DateTimeImmutable::createFromFormat('!Y-m-d', Dates::monthStart($ym));
        if ($d === false) {
            return $ym;
        }
        return $d->format($short ? 'M Y' : 'F Y');
    }

    /** @return array<int,string> n month keys ending at $endYm inclusive */
    public static function monthRange(string $endYm, int $count): array
    {
        $count = max(1, min($count, 120));
        $out   = [];
        for ($i = $count - 1; $i >= 0; $i--) {
            $out[] = Dates::addMonthKey($endYm, -$i);
        }
        return $out;
    }

    // ------------------------------------------------------------------
    // MONTH TOTALS
    // ------------------------------------------------------------------

    /**
     * Compute.monthSummary for one month.
     *
     * @return array<string,mixed>
     */
    public static function monthTotals(int $uid, string $ym): array
    {
        self::assertMonth($ym);

        $from = Dates::monthStart($ym);
        $to   = Dates::monthEnd($ym);

        $row = Database::one(
            'SELECT
                COALESCE(SUM(CASE WHEN `type` = \'income\'  THEN `amount` ELSE 0 END), 0) AS income,
                COALESCE(SUM(CASE WHEN `type` = \'expense\' THEN `amount` ELSE 0 END), 0) AS expenses,
                COUNT(*) AS tx_count
             FROM `transactions`
             WHERE `user_id` = :uid AND `tx_date` BETWEEN :from AND :to',
            [':uid' => $uid, ':from' => $from, ':to' => $to]
        ) ?? ['income' => 0, 'expenses' => 0, 'tx_count' => 0];

        $income   = Repo::money($row['income']);
        $expenses = Repo::money($row['expenses']);
        $net      = $income - $expenses;

        $startBalance = self::netWorthAt($uid, Dates::addDays($from, -1));

        return [
            'ym'              => $ym,
            'label'           => self::monthLabel($ym),
            'income'          => $income,
            'expenses'        => $expenses,
            'net'             => $net,
            'savings'         => max($net, 0),
            'transferSavings' => self::transferSavings($uid, $from, $to),
            'startBalance'    => $startBalance,
            'endBalance'      => $startBalance + $net,
            'savingsRate'     => self::pct($net, $income),
            'expenseRatio'    => self::pct($expenses, $income),
            'byCat'           => self::categoryTotals($uid, $from, $to, 'expense'),
            'byIncomeCat'     => self::categoryTotals($uid, $from, $to, 'income'),
            'largestExpense'  => self::largest($uid, $from, $to, 'expense'),
            'largestIncome'   => self::largest($uid, $from, $to, 'income'),
            'count'           => (int) $row['tx_count'],
            'avgDailySpend'   => (int) round($expenses / max(1, self::daysInMonth($ym))),
        ];
    }

    // ------------------------------------------------------------------
    // TIME SERIES
    // ------------------------------------------------------------------

    /**
     * Income/expense/net per month, one row per month in the range, including
     * months with no activity.
     *
     * @return array<int,array<string,mixed>>
     */
    public static function series(int $uid, string $endYm, int $months = 6): array
    {
        self::assertMonth($endYm);

        $keys = self::monthRange($endYm, $months);
        $from = Dates::monthStart($keys[0]);
        $to   = Dates::monthEnd($endYm);

        $rows = Database::all(
            'SELECT DATE_FORMAT(`tx_date`, \'%Y-%m\') AS ym,
                    COALESCE(SUM(CASE WHEN `type` = \'income\'  THEN `amount` ELSE 0 END), 0) AS income,
                    COALESCE(SUM(CASE WHEN `type` = \'expense\' THEN `amount` ELSE 0 END), 0) AS expenses
             FROM `transactions`
             WHERE `user_id` = :uid AND `tx_date` BETWEEN :from AND :to
             GROUP BY ym',
            [':uid' => $uid, ':from' => $from, ':to' => $to]
        );

        $byMonth = [];
        foreach ($rows as $row) {
            $byMonth[(string) $row['ym']] = [
                'income'   => Repo::money($row['income']),
                'expenses' => Repo::money($row['expenses']),
            ];
        }

        $out = [];
        foreach ($keys as $ym) {
            $income   = $byMonth[$ym]['income'] ?? 0;
            $expenses = $byMonth[$ym]['expenses'] ?? 0;
            $out[]    = [
                'ym'          => $ym,
                'label'       => self::monthLabel($ym, true),
                'income'      => $income,
                'expenses'    => $expenses,
                'net'         => $income - $expenses,
                'savingsRate' => self::pct($income - $expenses, $income),
            ];
        }
        return $out;
    }

    /**
     * Running total of net cash flow, seeded with everything before the range.
     *
     * @return array<int,array<string,mixed>>
     */
    public static function cumulativeSavings(int $uid, string $endYm, int $months = 6): array
    {
        $keys  = self::monthRange($endYm, $months);
        $first = Dates::monthStart($keys[0]);

        $running = Repo::money(Database::scalar(
            'SELECT COALESCE(SUM(CASE
                        WHEN `type` = \'income\'  THEN  `amount`
                        WHEN `type` = \'expense\' THEN -`amount`
                        ELSE 0 END), 0)
             FROM `transactions`
             WHERE `user_id` = :uid AND `tx_date` < :first',
            [':uid' => $uid, ':first' => $first]
        ));

        $out = [];
        foreach (self::series($uid, $endYm, $months) as $point) {
            $running += (int) $point['net'];
            $out[]    = ['ym' => $point['ym'], 'label' => $point['label'], 'value' => $running];
        }
        return $out;
    }

    /** Spend per day of month, always one entry per calendar day. @return array<int,array<string,int>> */
    public static function dailySpend(int $uid, string $ym): array
    {
        self::assertMonth($ym);

        $rows = Database::all(
            'SELECT DAY(`tx_date`) AS d, COALESCE(SUM(`amount`), 0) AS total
             FROM `transactions`
             WHERE `user_id` = :uid
               AND `type` = \'expense\'
               AND `tx_date` BETWEEN :from AND :to
             GROUP BY d',
            [':uid' => $uid, ':from' => Dates::monthStart($ym), ':to' => Dates::monthEnd($ym)]
        );

        $byDay = [];
        foreach ($rows as $row) {
            $byDay[(int) $row['d']] = Repo::money($row['total']);
        }

        $out = [];
        for ($day = 1, $n = self::daysInMonth($ym); $day <= $n; $day++) {
            $out[] = ['day' => $day, 'value' => $byDay[$day] ?? 0];
        }
        return $out;
    }

    // ------------------------------------------------------------------
    // BY CATEGORY
    // ------------------------------------------------------------------

    /**
     * Compute.topCategories: ranked category totals decorated with the
     * category's display fields.
     *
     * @return array<int,array<string,mixed>>
     */
    public static function byCategory(int $uid, string $ym, string $type = 'expense', int $limit = 0): array
    {
        self::assertMonth($ym);
        $type = in_array($type, ['income', 'expense'], true) ? $type : 'expense';

        $rows = Database::all(
            'SELECT t.`category_id` AS id,
                    COALESCE(SUM(t.`amount`), 0) AS value,
                    c.`name`  AS name,
                    c.`color` AS color,
                    c.`emoji` AS emoji
             FROM `transactions` t
             LEFT JOIN `categories` c
                    ON c.`user_id` = t.`user_id` AND c.`id` = t.`category_id`
             WHERE t.`user_id` = :uid
               AND t.`type` = :type
               AND t.`tx_date` BETWEEN :from AND :to
             GROUP BY t.`category_id`, c.`name`, c.`color`, c.`emoji`
             ORDER BY value DESC',
            [
                ':uid'  => $uid,
                ':type' => $type,
                ':from' => Dates::monthStart($ym),
                ':to'   => Dates::monthEnd($ym),
            ]
        );

        $out = [];
        foreach ($rows as $row) {
            $out[] = [
                'id'    => Repo::str($row['id']),
                'value' => Repo::money($row['value']),
                'name'  => (string) ($row['name'] ?? 'Uncategorized'),
                'color' => (string) ($row['color'] ?? '#868e96'),
                'emoji' => (string) ($row['emoji'] ?? "\u{1F4C1}"),
            ];
        }

        return $limit > 0 ? array_slice($out, 0, $limit) : $out;
    }

    /**
     * Expense totals for the given categories across a month range, for the
     * analytics trend chart.
     *
     * @param array<int,string> $categoryIds
     * @return array<int,array<string,mixed>>
     */
    public static function categoryTrend(int $uid, string $endYm, int $months, array $categoryIds): array
    {
        $keys = self::monthRange($endYm, $months);
        $out  = [];

        foreach (array_slice($categoryIds, 0, 12) as $categoryId) {
            if (!is_string($categoryId) || $categoryId === '') {
                continue;
            }
            $category = CategoryRepo::find($uid, $categoryId);
            if ($category === null) {
                continue;   // not this user's category: skipped, never queried
            }

            $rows = Database::all(
                'SELECT DATE_FORMAT(`tx_date`, \'%Y-%m\') AS ym, COALESCE(SUM(`amount`), 0) AS value
                 FROM `transactions`
                 WHERE `user_id` = :uid
                   AND `type` = \'expense\'
                   AND `category_id` = :category
                   AND `tx_date` BETWEEN :from AND :to
                 GROUP BY ym',
                [
                    ':uid'      => $uid,
                    ':category' => $categoryId,
                    ':from'     => Dates::monthStart($keys[0]),
                    ':to'       => Dates::monthEnd($endYm),
                ]
            );

            $byMonth = [];
            foreach ($rows as $row) {
                $byMonth[(string) $row['ym']] = Repo::money($row['value']);
            }

            $points = [];
            foreach ($keys as $ym) {
                $points[] = ['ym' => $ym, 'label' => self::monthLabel($ym, true), 'value' => $byMonth[$ym] ?? 0];
            }

            $out[] = [
                'id'     => $category['id'],
                'name'   => $category['name'],
                'color'  => $category['color'],
                'points' => $points,
            ];
        }

        return $out;
    }

    // ------------------------------------------------------------------
    // BUDGET PERFORMANCE
    // ------------------------------------------------------------------

    /**
     * Compute.budgetSummary: planned vs actual per category line, plus the
     * spending that fell outside the plan.
     *
     * @return array<string,mixed>
     */
    public static function budgetPerformance(int $uid, string $ym): array
    {
        self::assertMonth($ym);

        $budget    = BudgetRepo::forMonth($uid, $ym);
        $spentByCat = self::categoryTotals($uid, Dates::monthStart($ym), Dates::monthEnd($ym), 'expense');

        $lines = [];
        foreach ($budget['lines'] ?? [] as $line) {
            $amount = Repo::money($line['amount']);
            $spent  = $spentByCat[$line['categoryId']] ?? 0;
            $used   = self::pct($spent, $amount);

            $lines[] = [
                'id'         => $line['id'],
                'categoryId' => $line['categoryId'],
                'amount'     => $amount,
                'spent'      => $spent,
                'remaining'  => $amount - $spent,
                'used'       => $used,
                'state'      => $used > 100 ? 'over' : ($used >= 85 ? 'warn' : 'ok'),
            ];
        }

        usort($lines, static fn (array $a, array $b): int => $b['used'] <=> $a['used']);

        $planned  = 0;
        $spent    = 0;
        $over     = 0;
        $warn     = 0;
        $budgeted = [];
        foreach ($lines as $line) {
            $planned            += (int) $line['amount'];
            $spent              += (int) $line['spent'];
            $budgeted[(string) $line['categoryId']] = true;
            if ($line['state'] === 'over') {
                $over++;
            } elseif ($line['state'] === 'warn') {
                $warn++;
            }
        }

        $unbudgeted = 0;
        foreach ($spentByCat as $categoryId => $value) {
            if (!isset($budgeted[$categoryId])) {
                $unbudgeted += $value;
            }
        }

        return [
            'exists'      => $budget !== null,
            'month'       => $ym,
            'lines'       => $lines,
            'planned'     => $planned,
            'spent'       => $spent,
            'remaining'   => $planned - $spent,
            'utilization' => self::pct($spent, $planned),
            'unbudgeted'  => $unbudgeted,
            'incomePlan'  => $budget['incomePlan'] ?? [],
            'savingsPlan' => $budget['savingsPlan'] ?? [],
            'overCount'   => $over,
            'warnCount'   => $warn,
        ];
    }

    // ------------------------------------------------------------------
    // BILLS
    // ------------------------------------------------------------------

    /**
     * Compute.billStatus / upcomingBills, computed against today.
     *
     * @return array<string,mixed>
     */
    public static function billStatus(int $uid, int $withinDays = 45): array
    {
        $today = Dates::today();
        $bills = [];
        $due   = 0;
        $overdue = 0;
        $dueTotal = 0;

        foreach (BillRepo::all($uid) as $bill) {
            $inDays = Dates::diffDays($today, (string) $bill['dueDate']);

            if ($bill['paidOn'] !== null) {
                $status = 'paid';
            } elseif ($inDays < 0) {
                $status = 'overdue';
            } elseif ($inDays <= 7) {
                $status = 'due-soon';
            } else {
                $status = 'upcoming';
            }

            $bill['status'] = $status;
            $bill['inDays'] = $inDays;
            $bills[]        = $bill;

            if ($status === 'overdue') {
                $overdue++;
            }
            if ($status !== 'paid' && $inDays <= 7) {
                $due++;
                $dueTotal += Repo::money($bill['amount']);
            }
        }

        $upcoming = array_values(array_filter(
            $bills,
            static fn (array $b): bool => $b['status'] !== 'paid' && $b['inDays'] <= $withinDays
        ));
        usort($upcoming, static fn (array $a, array $b): int => strcmp((string) $a['dueDate'], (string) $b['dueDate']));

        return [
            'bills'        => $bills,
            'upcoming'     => $upcoming,
            'dueCount'     => $due,
            'overdueCount' => $overdue,
            'dueTotal'     => $dueTotal,
            'withinDays'   => $withinDays,
        ];
    }

    // ------------------------------------------------------------------
    // RECURRING
    // ------------------------------------------------------------------

    /** @return array<string,mixed> */
    public static function recurringOutlook(int $uid, int $withinDays = 45): array
    {
        $today  = Dates::today();
        $factor = [
            'daily'     => 30.0,
            'weekly'    => 4.345,
            'biweekly'  => 2.17,
            'monthly'   => 1.0,
            'quarterly' => 1 / 3,
            'yearly'    => 1 / 12,
        ];

        $upcoming      = [];
        $monthlyIncome = 0.0;
        $monthlyExpense = 0.0;

        foreach (RecurringRepo::all($uid) as $rule) {
            if ($rule['paused']) {
                continue;
            }
            $weight = $factor[$rule['frequency']] ?? 1.0;
            if ($rule['type'] === 'income') {
                $monthlyIncome += Repo::money($rule['amount']) * $weight;
            } else {
                $monthlyExpense += Repo::money($rule['amount']) * $weight;
            }

            $inDays = Dates::diffDays($today, (string) $rule['nextDate']);
            if ($inDays <= $withinDays) {
                $rule['inDays'] = $inDays;
                $upcoming[]     = $rule;
            }
        }

        usort($upcoming, static fn (array $a, array $b): int => strcmp((string) $a['nextDate'], (string) $b['nextDate']));

        return [
            'upcoming' => $upcoming,
            'load'     => [
                'income'  => (int) round($monthlyIncome),
                'expense' => (int) round($monthlyExpense),
            ],
        ];
    }

    // ------------------------------------------------------------------
    // NET WORTH
    // ------------------------------------------------------------------

    /**
     * Balances per account plus the totals. Credit accounts are excluded from
     * "liquid", matching Compute.liquidBalance.
     *
     * @return array<string,mixed>
     */
    public static function netWorth(int $uid, bool $includeArchived = false): array
    {
        $balances = AccountRepo::balances($uid);
        $accounts = AccountRepo::all($uid, $includeArchived);

        $total       = 0;
        $liquid      = 0;
        $assets      = 0;
        $liabilities = 0;
        $rows        = [];

        foreach ($accounts as $account) {
            $balance = $balances[$account['id']] ?? Repo::money($account['openingBalance']);
            $total  += $balance;

            if ($account['type'] !== 'credit') {
                $liquid += $balance;
            }
            if ($balance >= 0) {
                $assets += $balance;
            } else {
                $liabilities += -$balance;
            }

            $account['balance'] = $balance;
            $rows[]             = $account;
        }

        return [
            'total'       => $total,
            'liquid'      => $liquid,
            'assets'      => $assets,
            'liabilities' => $liabilities,
            'accounts'    => $rows,
        ];
    }

    /** Net worth as of a date, used for a month's opening balance. */
    public static function netWorthAt(int $uid, string $date): int
    {
        return Repo::money(Database::scalar(
            'SELECT COALESCE(SUM(a.`opening_balance`), 0)
                    + COALESCE((SELECT SUM(CASE
                            WHEN t.`type` = \'income\'   THEN  t.`amount`
                            WHEN t.`type` = \'expense\'  THEN -t.`amount`
                            ELSE 0 END)
                        FROM `transactions` t
                        WHERE t.`user_id` = :uid2 AND t.`tx_date` <= :date2), 0)
             FROM `accounts` a
             WHERE a.`user_id` = :uid AND a.`archived` = 0',
            [':uid' => $uid, ':uid2' => $uid, ':date2' => $date]
        ));
    }

    // ------------------------------------------------------------------
    // DASHBOARD BUNDLE
    // ------------------------------------------------------------------

    /**
     * Everything the dashboard needs in one round trip.
     *
     * @return array<string,mixed>
     */
    public static function dashboard(int $uid, ?string $ym = null, int $seriesMonths = 6): array
    {
        $ym = $ym !== null && Dates::isMonthKey($ym) ? $ym : Dates::monthKey(Dates::today());

        $summary = self::monthTotals($uid, $ym);
        $budget  = self::budgetPerformance($uid, $ym);
        $bills   = self::billStatus($uid);

        return [
            'month'         => $ym,
            'generatedAt'   => gmdate('c'),
            'summary'       => $summary,
            'budget'        => $budget,
            'series'        => self::series($uid, $ym, $seriesMonths),
            'topCategories' => self::byCategory($uid, $ym, 'expense', 6),
            'dailySpend'    => self::dailySpend($uid, $ym),
            'netWorth'      => self::netWorth($uid),
            'bills'         => [
                'upcoming'     => $bills['upcoming'],
                'dueCount'     => $bills['dueCount'],
                'overdueCount' => $bills['overdueCount'],
                'dueTotal'     => $bills['dueTotal'],
            ],
            'recurring'     => self::recurringOutlook($uid),
            'goals'         => self::goalProgress($uid),
            'recent'        => TransactionRepo::recent($uid, 10),
        ];
    }

    /**
     * Compute.goalProgress for every active goal.
     *
     * @return array<int,array<string,mixed>>
     */
    public static function goalProgress(int $uid): array
    {
        $today = Dates::today();
        $out   = [];

        foreach (GoalRepo::all($uid, false) as $goal) {
            $target    = Repo::money($goal['target']);
            $current   = Repo::money($goal['current']);
            $remaining = max(0, $target - $current);

            $monthsLeft = null;
            $perMonth   = null;
            $onTrack    = null;

            if ($goal['targetDate'] !== null) {
                $days       = Dates::diffDays($today, (string) $goal['targetDate']);
                $monthsLeft = max(0, self::monthsBetween(Dates::monthKey($today), Dates::monthKey((string) $goal['targetDate'])));
                $perMonth   = (int) ceil($remaining / max(1, $monthsLeft));
                $onTrack    = !($days < 0 && $remaining > 0);
            }

            $goal['progress'] = [
                'pct'        => max(0.0, min(100.0, self::pct($current, $target))),
                'remaining'  => $remaining,
                'monthsLeft' => $monthsLeft,
                'perMonth'   => $perMonth,
                'complete'   => $current >= $target && $target > 0,
                'onTrack'    => $onTrack,
            ];

            $out[] = $goal;
        }

        return $out;
    }

    // ------------------------------------------------------------------
    // INTERNALS
    // ------------------------------------------------------------------

    public static function monthsBetween(string $a, string $b): int
    {
        [$y1, $m1] = array_map('intval', explode('-', $a));
        [$y2, $m2] = array_map('intval', explode('-', $b));
        return ($y2 - $y1) * 12 + ($m2 - $m1);
    }

    /** @return array<string,int> categoryId => total */
    private static function categoryTotals(int $uid, string $from, string $to, string $type): array
    {
        $rows = Database::all(
            'SELECT `category_id` AS id, COALESCE(SUM(`amount`), 0) AS total
             FROM `transactions`
             WHERE `user_id` = :uid AND `type` = :type AND `tx_date` BETWEEN :from AND :to
             GROUP BY `category_id`',
            [':uid' => $uid, ':type' => $type, ':from' => $from, ':to' => $to]
        );

        $out = [];
        foreach ($rows as $row) {
            $out[(string) ($row['id'] ?? '')] = Repo::money($row['total']);
        }
        return $out;
    }

    /** Transfers into savings accounts minus transfers back out. */
    private static function transferSavings(int $uid, string $from, string $to): int
    {
        return Repo::money(Database::scalar(
            'SELECT COALESCE(SUM(CASE
                        WHEN dest.`type` = \'savings\' THEN  t.`amount`
                        WHEN src.`type`  = \'savings\' THEN -t.`amount`
                        ELSE 0 END), 0)
             FROM `transactions` t
             LEFT JOIN `accounts` dest
                    ON dest.`user_id` = t.`user_id` AND dest.`id` = t.`to_account_id`
             LEFT JOIN `accounts` src
                    ON src.`user_id` = t.`user_id` AND src.`id` = t.`account_id`
             WHERE t.`user_id` = :uid
               AND t.`type` = \'transfer\'
               AND t.`tx_date` BETWEEN :from AND :to',
            [':uid' => $uid, ':from' => $from, ':to' => $to]
        ));
    }

    /** @return array<string,mixed>|null the biggest single row of a type */
    private static function largest(int $uid, string $from, string $to, string $type): ?array
    {
        $row = Database::one(
            'SELECT * FROM `transactions`
             WHERE `user_id` = :uid AND `type` = :type AND `tx_date` BETWEEN :from AND :to
             ORDER BY `amount` DESC LIMIT 1',
            [':uid' => $uid, ':type' => $type, ':from' => $from, ':to' => $to]
        );
        return $row === null ? null : TransactionRepo::shape($row);
    }

    private static function assertMonth(string $ym): void
    {
        if (!Dates::isMonthKey($ym)) {
            throw new ApiException('Please use a valid month (YYYY-MM).', 422, 'validation_failed');
        }
    }
}
