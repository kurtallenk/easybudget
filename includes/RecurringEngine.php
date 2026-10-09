<?php
declare(strict_types=1);

/**
 * RecurringEngine - posts due recurring transactions.
 *
 * Correctness rules
 * -----------------
 *  1. **Idempotent.** The real protection is the database:
 *     `uq_tx_recurring_day (user_id, recurring_id, tx_date)`. A duplicate key
 *     is caught and treated as "already posted", so a double-clicked button,
 *     a retried request or two concurrent runs can never post the same
 *     occurrence twice. The pre-check is only an optimisation.
 *  2. **Transactional.** Each occurrence is written and the rule's schedule is
 *     advanced inside one `Database::transaction()`; a failure rolls the pair
 *     back together, so the schedule can never move without its transaction.
 *  3. **Guarded.** `limits.recurring_post_guard` caps how many occurrences a
 *     single run may create, mirroring the legacy `guard++ < 2000`. A rule
 *     whose next_date is years in the past therefore cannot spin forever.
 *  4. **Scoped.** Everything runs against the authenticated `$uid`.
 *
 * Only rules with `auto_post = 1` post automatically. A manual run may target
 * a single rule, which is how the Recurring view's "Post now" button works.
 *
 * NOTE: never executed - no PHP binary and no MySQL server here.
 */
final class RecurringEngine
{
    /** MySQL integrity-constraint violation. */
    private const DUPLICATE_KEY = '23000';

    /**
     * Posts every due occurrence for the user.
     *
     * @param string|null $asOf     post occurrences up to this date (defaults today)
     * @param bool        $autoOnly only rules with autoPost enabled
     * @return array{posted:int,skipped:int,rules:int,guardHit:bool,transactions:array<int,array<string,mixed>>,asOf:string}
     */
    public static function run(int $uid, ?string $asOf = null, bool $autoOnly = true): array
    {
        $asOf  = $asOf !== null && Dates::isDate($asOf) ? $asOf : Dates::today();
        $guard = max(1, (int) Config::get('limits.recurring_post_guard', 2000));

        $rules = RecurringRepo::due($uid, $asOf, $autoOnly);

        $posted   = 0;
        $skipped  = 0;
        $created  = [];
        $guardHit = false;

        foreach ($rules as $rule) {
            $result = self::advanceRule($uid, $rule, $asOf, $guard - ($posted + $skipped));

            $posted  += $result['posted'];
            $skipped += $result['skipped'];
            $created  = array_merge($created, $result['transactions']);

            if ($result['guardHit']) {
                $guardHit = true;
                break;
            }
        }

        if ($posted > 0) {
            Audit::log($uid, 'recurring.run', 'recurring', null, [
                'posted'  => $posted,
                'skipped' => $skipped,
                'asOf'    => $asOf,
            ]);
        }

        return [
            'posted'       => $posted,
            'skipped'      => $skipped,
            'rules'        => count($rules),
            'guardHit'     => $guardHit,
            'transactions' => $created,
            'asOf'         => $asOf,
        ];
    }

    /**
     * Posts one rule's due occurrences, ignoring its autoPost flag. Used by
     * the "Post now" action.
     *
     * @return array{posted:int,skipped:int,guardHit:bool,transactions:array<int,array<string,mixed>>,rule:array<string,mixed>}
     */
    public static function runRule(int $uid, string $ruleId, ?string $asOf = null): array
    {
        $rule = RecurringRepo::findOrFail($uid, $ruleId);
        $asOf = $asOf !== null && Dates::isDate($asOf) ? $asOf : Dates::today();

        if ($rule['paused']) {
            throw new ApiException('That recurring rule is paused.', 409, 'rule_paused');
        }

        $guard  = max(1, (int) Config::get('limits.recurring_post_guard', 2000));
        $result = self::advanceRule($uid, $rule, $asOf, $guard);

        return [
            'posted'       => $result['posted'],
            'skipped'      => $result['skipped'],
            'guardHit'     => $result['guardHit'],
            'transactions' => $result['transactions'],
            'rule'         => RecurringRepo::findOrFail($uid, $ruleId),
        ];
    }

    /**
     * How many occurrences are waiting, without writing anything. Lets the UI
     * show "3 due" before the user commits.
     *
     * @return array{rules:int,occurrences:int,asOf:string}
     */
    public static function preview(int $uid, ?string $asOf = null, bool $autoOnly = false): array
    {
        $asOf  = $asOf !== null && Dates::isDate($asOf) ? $asOf : Dates::today();
        $guard = max(1, (int) Config::get('limits.recurring_post_guard', 2000));
        $rules = RecurringRepo::due($uid, $asOf, $autoOnly);

        $occurrences = 0;
        foreach ($rules as $rule) {
            foreach (self::occurrences($rule, $asOf, $guard) as $unused) {
                $occurrences++;
                if ($occurrences >= $guard) {
                    break 2;
                }
            }
        }

        return ['rules' => count($rules), 'occurrences' => $occurrences, 'asOf' => $asOf];
    }

    /**
     * Walks one rule forward, posting each occurrence transactionally.
     *
     * @param array<string,mixed> $rule
     * @return array{posted:int,skipped:int,guardHit:bool,transactions:array<int,array<string,mixed>>}
     */
    private static function advanceRule(int $uid, array $rule, string $asOf, int $budget): array
    {
        $ruleId  = (string) $rule['id'];
        $posted  = 0;
        $skipped = 0;
        $created = [];

        if ($budget <= 0) {
            return ['posted' => 0, 'skipped' => 0, 'guardHit' => true, 'transactions' => []];
        }

        $date      = (string) $rule['nextDate'];
        $endDate   = $rule['endDate'] === null ? null : (string) $rule['endDate'];
        $frequency = (string) $rule['frequency'];
        $steps     = 0;

        while ($date <= $asOf && ($endDate === null || $date <= $endDate)) {
            if ($steps >= $budget) {
                return ['posted' => $posted, 'skipped' => $skipped, 'guardHit' => true, 'transactions' => $created];
            }
            $steps++;

            $next = Dates::advance($date, $frequency);
            if ($next === $date) {
                // 'once' (or any non-advancing frequency) must not loop.
                $next = Dates::addMonths($date, 1);
            }

            $occurrenceDate = $date;

            try {
                $transaction = Database::transaction(
                    static function () use ($uid, $rule, $ruleId, $occurrenceDate, $next): ?array {
                        if (TransactionRepo::existsForRecurring($uid, $ruleId, $occurrenceDate)) {
                            RecurringRepo::markPosted($uid, $ruleId, $occurrenceDate, $next);
                            return null;
                        }

                        $created = TransactionRepo::create($uid, [
                            'type'        => $rule['type'],
                            'amount'      => Repo::money($rule['amount']),
                            'date'        => $occurrenceDate,
                            'description' => (string) $rule['name'],
                            'categoryId'  => $rule['categoryId'],
                            'accountId'   => $rule['accountId'],
                            'method'      => $rule['method'],
                            'notes'       => $rule['notes'],
                            'recurringId' => $ruleId,
                            'sample'      => (bool) $rule['sample'],
                        ]);

                        RecurringRepo::markPosted($uid, $ruleId, $occurrenceDate, $next);
                        return $created;
                    }
                );

                if ($transaction === null) {
                    $skipped++;
                } else {
                    $posted++;
                    $created[] = $transaction;
                }
            } catch (PDOException $e) {
                if (!self::isDuplicate($e)) {
                    throw $e;
                }
                // The unique key did its job: another run already posted this
                // occurrence. Move the schedule on and carry on.
                $skipped++;
                RecurringRepo::markPosted($uid, $ruleId, $occurrenceDate, $next);
                Logger::info('recurring.duplicate_skipped', [
                    'uid'  => $uid,
                    'rule' => $ruleId,
                    'date' => $occurrenceDate,
                ]);
            } catch (ApiException $e) {
                // A rule pointing at a deleted account or category cannot post.
                // Skipping keeps one broken rule from blocking every other one.
                $skipped++;
                Logger::warn('recurring.rule_invalid', [
                    'uid'    => $uid,
                    'rule'   => $ruleId,
                    'date'   => $occurrenceDate,
                    'reason' => $e->getMessage(),
                ]);
                break;
            }

            $date = $next;
        }

        return ['posted' => $posted, 'skipped' => $skipped, 'guardHit' => false, 'transactions' => $created];
    }

    /**
     * The dates a rule would post on, capped by the guard.
     *
     * @param array<string,mixed> $rule
     * @return array<int,string>
     */
    private static function occurrences(array $rule, string $asOf, int $guard): array
    {
        $dates   = [];
        $date    = (string) $rule['nextDate'];
        $endDate = $rule['endDate'] === null ? null : (string) $rule['endDate'];

        while ($date <= $asOf && ($endDate === null || $date <= $endDate) && count($dates) < $guard) {
            $dates[] = $date;
            $next    = Dates::advance($date, (string) $rule['frequency']);
            if ($next === $date) {
                $next = Dates::addMonths($date, 1);
            }
            $date = $next;
        }

        return $dates;
    }

    private static function isDuplicate(PDOException $e): bool
    {
        return $e->getCode() === self::DUPLICATE_KEY
            || (isset($e->errorInfo[1]) && (int) $e->errorInfo[1] === 1062);
    }
}
