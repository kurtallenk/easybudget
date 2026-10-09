<?php
declare(strict_types=1);

/**
 * Thin PDO wrapper.
 *
 *  - Emulated prepares are OFF, so placeholders are real server-side parameters.
 *  - Every helper takes a parameter array; callers never concatenate values.
 *  - Driver errors surface as PDOException and api.php turns them into a
 *    generic 500, so schema details never reach the browser.
 *  - transaction() nests via SAVEPOINTs because repositories call each other
 *    (e.g. BillRepo::pay -> TransactionRepo::create).
 */
final class Database
{
    private static ?PDO $pdo = null;
    private static int $depth = 0;

    public static function pdo(): PDO
    {
        if (self::$pdo === null) {
            $cfg = Config::get('db');

            $dsn = !empty($cfg['socket'])
                ? sprintf('mysql:unix_socket=%s;dbname=%s;charset=%s', $cfg['socket'], $cfg['name'], $cfg['charset'])
                : sprintf('mysql:host=%s;port=%d;dbname=%s;charset=%s', $cfg['host'], (int) $cfg['port'], $cfg['name'], $cfg['charset']);

            self::$pdo = new PDO($dsn, (string) $cfg['user'], (string) $cfg['password'], [
                PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES   => false,
                PDO::ATTR_STRINGIFY_FETCHES  => false,
            ]);

            self::$pdo->exec("SET SESSION sql_mode = 'STRICT_ALL_TABLES,NO_ENGINE_SUBSTITUTION'");
            self::$pdo->exec("SET SESSION time_zone = '+00:00'");
        }
        return self::$pdo;
    }

    /** @param array<string,mixed> $params */
    public static function query(string $sql, array $params = []): PDOStatement
    {
        $stmt = self::pdo()->prepare($sql);
        foreach ($params as $key => $value) {
            $type = match (true) {
                is_bool($value) => PDO::PARAM_BOOL,
                is_int($value)  => PDO::PARAM_INT,
                $value === null => PDO::PARAM_NULL,
                default         => PDO::PARAM_STR,
            };
            $stmt->bindValue(is_int($key) ? $key + 1 : $key, $value, $type);
        }
        $stmt->execute();
        return $stmt;
    }

    /** @param array<string,mixed> $params @return array<int,array<string,mixed>> */
    public static function all(string $sql, array $params = []): array
    {
        return self::query($sql, $params)->fetchAll();
    }

    /** @param array<string,mixed> $params @return array<string,mixed>|null */
    public static function one(string $sql, array $params = []): ?array
    {
        $row = self::query($sql, $params)->fetch();
        return $row === false ? null : $row;
    }

    /** @param array<string,mixed> $params */
    public static function scalar(string $sql, array $params = [])
    {
        $v = self::query($sql, $params)->fetchColumn();
        return $v === false ? null : $v;
    }

    /** @param array<string,mixed> $params @return int affected rows */
    public static function run(string $sql, array $params = []): int
    {
        return self::query($sql, $params)->rowCount();
    }

    public static function lastInsertId(): string
    {
        return self::pdo()->lastInsertId();
    }

    /**
     * @template T
     * @param callable():T $fn
     * @return T
     */
    public static function transaction(callable $fn)
    {
        $pdo       = self::pdo();
        $nested    = self::$depth > 0;
        $savepoint = 'sp' . self::$depth;

        $nested ? $pdo->exec("SAVEPOINT {$savepoint}") : $pdo->beginTransaction();
        self::$depth++;

        try {
            $result = $fn();
            self::$depth--;
            $nested ? $pdo->exec("RELEASE SAVEPOINT {$savepoint}") : $pdo->commit();
            return $result;
        } catch (Throwable $e) {
            self::$depth--;
            if ($nested) {
                $pdo->exec("ROLLBACK TO SAVEPOINT {$savepoint}");
            } elseif ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $e;
        }
    }

    /** Used by the install check. */
    public static function ping(): bool
    {
        try {
            return (int) self::scalar('SELECT 1') === 1;
        } catch (Throwable $e) {
            Logger::error('database.ping_failed', ['error' => $e->getMessage()]);
            return false;
        }
    }
}
