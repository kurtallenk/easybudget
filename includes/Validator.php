<?php
declare(strict_types=1);

/**
 * Whitelist validator.
 *
 * Endpoints declare the fields they accept; everything else in the payload is
 * dropped, which closes mass assignment (a client cannot smuggle `user_id`,
 * `is_sample`, or a foreign `id` into an update).
 *
 *   $clean = (new Validator($body))
 *       ->required('name')->string('name', 80)
 *       ->amount('amount')->date('date')
 *       ->enum('type', ['income','expense','transfer'])
 *       ->values();
 */
final class Validator
{
    /** @var array<string,mixed> */ private array $input;
    /** @var array<string,mixed> */ private array $clean = [];
    /** @var array<string,string> */ private array $errors = [];

    /** @param array<string,mixed> $input */
    public function __construct(array $input) { $this->input = $input; }

    // ---------- presence ----------

    public function required(string ...$fields): self
    {
        foreach ($fields as $f) {
            $v = $this->input[$f] ?? null;
            if ($v === null || (is_string($v) && trim($v) === '') || (is_array($v) && $v === [])) {
                $this->errors[$f] = 'This field is required.';
            }
        }
        return $this;
    }

    public function has(string $field): bool { return array_key_exists($field, $this->input); }

    // ---------- scalars ----------

    public function string(string $field, ?int $max = null, ?int $min = null): self
    {
        if (!$this->present($field)) {
            return $this;
        }
        $v = $this->input[$field];
        if (!is_string($v)) {
            return $this->fail($field, 'This must be text.');
        }
        $v = trim(preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u', '', $v) ?? '');
        $max ??= (int) Config::get('limits.string_max', 255);
        if (mb_strlen($v) > $max) {
            return $this->fail($field, "Please keep this under {$max} characters.");
        }
        if ($min !== null && mb_strlen($v) < $min) {
            return $this->fail($field, "Please use at least {$min} characters.");
        }
        $this->clean[$field] = $v;
        return $this;
    }

    public function text(string $field): self
    {
        return $this->string($field, (int) Config::get('limits.text_max', 2000));
    }

    public function nullableString(string $field, ?int $max = null): self
    {
        if (!$this->has($field) || $this->input[$field] === null || $this->input[$field] === '') {
            if ($this->has($field)) { $this->clean[$field] = null; }
            return $this;
        }
        return $this->string($field, $max);
    }

    public function nullableText(string $field): self
    {
        return $this->nullableString($field, (int) Config::get('limits.text_max', 2000));
    }

    public function email(string $field): self
    {
        if (!$this->present($field)) {
            return $this;
        }
        $v = is_string($this->input[$field]) ? strtolower(trim($this->input[$field])) : '';
        if ($v === '' || mb_strlen($v) > 190 || filter_var($v, FILTER_VALIDATE_EMAIL) === false) {
            return $this->fail($field, 'Please enter a valid email address.');
        }
        $this->clean[$field] = $v;
        return $this;
    }

    public function int(string $field, int $min = PHP_INT_MIN, int $max = PHP_INT_MAX): self
    {
        if (!$this->present($field)) {
            return $this;
        }
        $v = $this->input[$field];
        if (is_string($v) && preg_match('/^-?\d+$/', trim($v))) {
            $v = (int) trim($v);
        }
        if (!is_int($v)) {
            return $this->fail($field, 'This must be a whole number.');
        }
        if ($v < $min || $v > $max) {
            return $this->fail($field, "This must be between {$min} and {$max}.");
        }
        $this->clean[$field] = $v;
        return $this;
    }

    public function bool(string $field): self
    {
        if (!$this->has($field)) {
            return $this;
        }
        $v = $this->input[$field];
        if (is_bool($v)) {
            $this->clean[$field] = $v;
        } elseif (in_array($v, [0, 1, '0', '1', 'true', 'false'], true)) {
            $this->clean[$field] = in_array($v, [1, '1', 'true'], true);
        } else {
            $this->fail($field, 'This must be true or false.');
        }
        return $this;
    }

    /** Money, stored as integer minor units. */
    public function amount(string $field, bool $allowZero = false): self
    {
        if (!$this->present($field)) {
            return $this;
        }
        try {
            $minor = Money::toMinor($this->input[$field]);
        } catch (ApiException $e) {
            return $this->fail($field, $e->getMessage());
        }
        if ($minor < 0 || (!$allowZero && $minor === 0)) {
            return $this->fail($field, 'Please enter an amount greater than zero.');
        }
        $this->clean[$field] = $minor;
        return $this;
    }

    /** Money that may legitimately be absent, e.g. the price of an unbought item. */
    public function nullableAmount(string $field, bool $allowZero = false): self
    {
        if (!$this->has($field) || $this->input[$field] === null || $this->input[$field] === '') {
            if ($this->has($field)) { $this->clean[$field] = null; }
            return $this;
        }
        return $this->amount($field, $allowZero);
    }

    public function date(string $field): self
    {
        if (!$this->present($field)) {
            return $this;
        }
        $v = is_string($this->input[$field]) ? trim($this->input[$field]) : '';
        if (!Dates::isDate($v)) {
            return $this->fail($field, 'Please use a valid date (YYYY-MM-DD).');
        }
        $this->clean[$field] = $v;
        return $this;
    }

    public function nullableDate(string $field): self
    {
        if (!$this->has($field) || $this->input[$field] === null || $this->input[$field] === '') {
            if ($this->has($field)) { $this->clean[$field] = null; }
            return $this;
        }
        return $this->date($field);
    }

    public function monthKey(string $field): self
    {
        if (!$this->present($field)) {
            return $this;
        }
        $v = is_string($this->input[$field]) ? trim($this->input[$field]) : '';
        if (!Dates::isMonthKey($v)) {
            return $this->fail($field, 'Please use a valid month (YYYY-MM).');
        }
        $this->clean[$field] = $v;
        return $this;
    }

    /** @param array<int,string> $allowed */
    public function enum(string $field, array $allowed): self
    {
        if (!$this->present($field)) {
            return $this;
        }
        $v = is_string($this->input[$field]) ? trim($this->input[$field]) : $this->input[$field];
        if (!in_array($v, $allowed, true)) {
            return $this->fail($field, 'Please choose one of the available options.');
        }
        $this->clean[$field] = $v;
        return $this;
    }

    /** @param array<int,string> $allowed */
    public function nullableEnum(string $field, array $allowed): self
    {
        if (!$this->has($field) || $this->input[$field] === null || $this->input[$field] === '') {
            if ($this->has($field)) { $this->clean[$field] = null; }
            return $this;
        }
        return $this->enum($field, $allowed);
    }

    /** Client-generated entity id, e.g. tx_l8f2p1. */
    public function id(string $field): self
    {
        if (!$this->present($field)) {
            return $this;
        }
        $v = is_string($this->input[$field]) ? trim($this->input[$field]) : '';
        if (!preg_match('/^[A-Za-z0-9_-]{1,40}$/', $v)) {
            return $this->fail($field, 'That identifier is not valid.');
        }
        $this->clean[$field] = $v;
        return $this;
    }

    public function nullableId(string $field): self
    {
        if (!$this->has($field) || $this->input[$field] === null || $this->input[$field] === '') {
            if ($this->has($field)) { $this->clean[$field] = null; }
            return $this;
        }
        return $this->id($field);
    }

    public function hexColor(string $field): self
    {
        if (!$this->present($field)) {
            return $this;
        }
        $v = is_string($this->input[$field]) ? trim($this->input[$field]) : '';
        if (!preg_match('/^#[0-9a-fA-F]{6}$/', $v)) {
            return $this->fail($field, 'Please choose a valid colour.');
        }
        $this->clean[$field] = $v;
        return $this;
    }

    public function emoji(string $field): self
    {
        if (!$this->has($field) || $this->input[$field] === null || $this->input[$field] === '') {
            if ($this->has($field)) { $this->clean[$field] = null; }
            return $this;
        }
        $v = is_string($this->input[$field]) ? trim($this->input[$field]) : '';
        if (mb_strlen($v) > 8) {
            return $this->fail($field, 'Please use a single emoji.');
        }
        $this->clean[$field] = $v;
        return $this;
    }

    /**
     * A list of objects, each validated by $each(Validator): array.
     * @param callable(Validator):array<string,mixed> $each
     */
    public function listOf(string $field, callable $each, int $maxRows = 200): self
    {
        if (!$this->has($field)) {
            return $this;
        }
        $rows = $this->input[$field];
        if (!is_array($rows) || !array_is_list($rows)) {
            return $this->fail($field, 'This must be a list.');
        }
        if (count($rows) > $maxRows) {
            return $this->fail($field, "Please send at most {$maxRows} rows.");
        }

        $out = [];
        foreach ($rows as $i => $row) {
            if (!is_array($row)) {
                return $this->fail($field, 'Each row must be an object.');
            }
            $child = new self($row);
            $value = $each($child);
            if ($child->errors !== []) {
                foreach ($child->errors as $k => $msg) {
                    $this->errors["{$field}.{$i}.{$k}"] = $msg;
                }
                continue;
            }
            $out[] = $value;
        }
        $this->clean[$field] = $out;
        return $this;
    }

    // ---------- output ----------

    public function fails(): bool { return $this->errors !== []; }

    /** @return array<string,string> */
    public function errors(): array { return $this->errors; }

    /** Validated values only; throws 422 with field messages. @return array<string,mixed> */
    public function values(): array
    {
        if ($this->errors !== []) {
            throw new ApiException('Please check the highlighted fields.', 422, 'validation_failed', ['fields' => $this->errors]);
        }
        return $this->clean;
    }

    /**
     * Values plus defaults for keys the caller omitted, so repositories always
     * receive a complete row.
     *
     * @param array<string,mixed> $defaults
     * @return array<string,mixed>
     */
    public function withDefaults(array $defaults): array
    {
        return array_replace($defaults, $this->values());
    }

    private function present(string $field): bool
    {
        return $this->has($field)
            && $this->input[$field] !== null
            && $this->input[$field] !== ''
            && !isset($this->errors[$field]);
    }

    private function fail(string $field, string $message): self
    {
        $this->errors[$field] = $message;
        unset($this->clean[$field]);
        return $this;
    }
}
