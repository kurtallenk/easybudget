-- ===========================================================================
-- Budget Planner - multi-user schema (MySQL 8.0+ / MariaDB 10.5+)
-- ===========================================================================
--
-- Design notes
--  * Money is ALWAYS an integer in minor units (BIGINT). Never DECIMAL, never
--    FLOAT. PHP1,250.75 is stored as 125075.
--  * User-owned rows keep the client-generated string id from the original SPA
--    and use a COMPOSITE PRIMARY KEY (user_id, id). Two users can therefore
--    hold the same id without colliding, and every lookup is naturally scoped
--    to the owner, which makes IDOR a structural impossibility rather than a
--    thing we must remember to check.
--  * Every child table cascades from `users`, so account deletion is complete.
--  * utf8mb4 everywhere (emoji are used as category icons).
--
-- Apply with:  mysql -u root -p budget_planner < database/schema.sql
-- ===========================================================================
-- XAMPP/phpMyAdmin compatibility fixes
-- ---------------------------------------------------------------------------
-- 1) Composite foreign keys that include NOT NULL `user_id` cannot use
--    ON DELETE SET NULL. MySQL/MariaDB would try to NULL the entire FK,
--    including user_id, which makes the FK invalid. Those constraints use
--    ON DELETE RESTRICT instead. The application should archive/delete or
--    clear the optional child reference before deleting the parent.
-- 2) CHECK constraints are omitted for compatibility with older XAMPP/
--    phpMyAdmin parsers. Application validation should enforce those rules.
-- ===========================================================================
-- ===========================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 1;

-- ---------------------------------------------------------------------------
-- Identity
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS `users` (
  `id`             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `email`          VARCHAR(190)    NOT NULL,
  `password_hash`  VARCHAR(255)    NOT NULL,
  `display_name`   VARCHAR(80)     NULL,
  `role`           ENUM('user','super_admin') NOT NULL DEFAULT 'user',
  `status`         ENUM('active','suspended','deleted') NOT NULL DEFAULT 'active',
  `email_verified_at` DATETIME     NULL,
  `auth_version`   INT UNSIGNED    NOT NULL DEFAULT 1,   -- bumped to sign out every session
  `password_changed_at` DATETIME   NULL,
  `last_login_at`  DATETIME        NULL,
  `created_at`     DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`     DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_users_email` (`email`),
  KEY `ix_users_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `user_settings` (
  `user_id`            BIGINT UNSIGNED NOT NULL,
  `currency`           CHAR(3)      NOT NULL DEFAULT 'PHP',
  `date_format`        VARCHAR(20)  NOT NULL DEFAULT 'MMM D, YYYY',
  `first_day_of_week`  TINYINT      NOT NULL DEFAULT 0,
  `theme`              ENUM('light','dark','system') NOT NULL DEFAULT 'system',
  `brand_hue`          SMALLINT     NOT NULL DEFAULT 221,
  `design_template`    ENUM('modern','classic','minimal','futuristic') NOT NULL DEFAULT 'modern',
  `hide_sample_banner` TINYINT(1)   NOT NULL DEFAULT 0,
  `onboarded`          TINYINT(1)   NOT NULL DEFAULT 0,
  `has_sample_data`    TINYINT(1)   NOT NULL DEFAULT 0,
  `created_at`         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`),
  CONSTRAINT `fk_settings_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Brute-force throttle + registration rate limit.
CREATE TABLE IF NOT EXISTS `login_attempts` (
  `id`           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `email`        VARCHAR(190) NOT NULL,
  `ip_address`   VARCHAR(45)  NOT NULL,
  `successful`   TINYINT(1)   NOT NULL DEFAULT 0,
  `purpose`      ENUM('login','register','reset','verify') NOT NULL DEFAULT 'login',
  `user_agent`   VARCHAR(255) NULL,
  `attempted_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `ix_attempts_email_time` (`email`, `attempted_at`),
  KEY `ix_attempts_ip_time`    (`ip_address`, `attempted_at`),
  KEY `ix_attempts_purpose`    (`purpose`, `attempted_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Single-use email verification and password reset tokens (purpose 'verify' /
-- 'reset'). The link carries selector + validator; only SHA-256(validator) is
-- stored, so a database leak does not yield usable links.
CREATE TABLE IF NOT EXISTS `auth_tokens` (
  `id`             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`        BIGINT UNSIGNED NOT NULL,
  `selector`       CHAR(32)     NOT NULL,
  `validator_hash` CHAR(64)     NOT NULL,
  `purpose`        ENUM('remember','reset','verify') NOT NULL,
  `expires_at`     DATETIME     NOT NULL,
  `used_at`        DATETIME     NULL,
  `created_at`     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_tokens_selector` (`selector`),
  KEY `ix_tokens_user` (`user_id`, `purpose`),
  KEY `ix_tokens_expiry` (`expires_at`),
  CONSTRAINT `fk_tokens_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Bearer tokens for the Android app (access 1h + rotating refresh 60d). Hashes only.
CREATE TABLE IF NOT EXISTS `api_tokens` (
  `id`           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`      BIGINT UNSIGNED NOT NULL,
  `family`       CHAR(32)     NOT NULL,
  `kind`         ENUM('access','refresh') NOT NULL,
  `selector`     CHAR(32)     NOT NULL,
  `token_hash`   CHAR(64)     NOT NULL,
  `auth_version` INT UNSIGNED NOT NULL DEFAULT 1,
  `device_name`  VARCHAR(80)  NULL,
  `expires_at`   DATETIME     NOT NULL,
  `used_at`      DATETIME     NULL,
  `revoked_at`   DATETIME     NULL,
  `created_at`   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_api_tokens_selector` (`selector`),
  KEY `ix_api_tokens_user` (`user_id`, `kind`),
  KEY `ix_api_tokens_family` (`family`),
  KEY `ix_api_tokens_expiry` (`expires_at`),
  CONSTRAINT `fk_api_tokens_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Reference data (shared, read-only; seeded by database/seeds)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS `currencies` (
  `code`       CHAR(3)     NOT NULL,
  `name`       VARCHAR(60) NOT NULL,
  `symbol`     VARCHAR(8)  NOT NULL,
  `locale`     VARCHAR(12) NOT NULL,
  `minor_unit` TINYINT     NOT NULL DEFAULT 2,
  `sort_order` SMALLINT    NOT NULL DEFAULT 0,
  PRIMARY KEY (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `account_types` (
  `id`         VARCHAR(20) NOT NULL,
  `label`      VARCHAR(40) NOT NULL,
  `icon`       VARCHAR(20) NOT NULL,
  `color`      CHAR(7)     NOT NULL,
  `sort_order` SMALLINT    NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `payment_methods` (
  `id`         VARCHAR(30) NOT NULL,
  `label`      VARCHAR(40) NOT NULL,
  `sort_order` SMALLINT    NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `frequencies` (
  `id`         VARCHAR(20) NOT NULL,
  `label`      VARCHAR(40) NOT NULL,
  `days_hint`  SMALLINT    NOT NULL DEFAULT 30,
  `sort_order` SMALLINT    NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- User-owned data
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS `categories` (
  `user_id`    BIGINT UNSIGNED NOT NULL,
  `id`         VARCHAR(40)  NOT NULL,
  `name`       VARCHAR(80)  NOT NULL,
  `kind`       ENUM('income','expense','both') NOT NULL DEFAULT 'expense',
  `color`      CHAR(7)      NOT NULL DEFAULT '#868e96',
  `emoji`      VARCHAR(16)  NULL,
  `is_system`  TINYINT(1)   NOT NULL DEFAULT 0,
  `archived`   TINYINT(1)   NOT NULL DEFAULT 0,
  `is_sample`  TINYINT(1)   NOT NULL DEFAULT 0,
  `sort_order` SMALLINT     NOT NULL DEFAULT 0,
  `created_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`, `id`),
  UNIQUE KEY `uq_categories_name` (`user_id`, `name`, `kind`),
  KEY `ix_categories_archived` (`user_id`, `archived`),
  CONSTRAINT `fk_categories_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `accounts` (
  `user_id`         BIGINT UNSIGNED NOT NULL,
  `id`              VARCHAR(40)  NOT NULL,
  `name`            VARCHAR(80)  NOT NULL,
  `type`            VARCHAR(20)  NOT NULL DEFAULT 'cash',
  `opening_balance` BIGINT       NOT NULL DEFAULT 0,   -- minor units
  `currency`        CHAR(3)      NOT NULL DEFAULT 'PHP',
  `color`           CHAR(7)      NULL,
  `note`            VARCHAR(255) NULL,
  `archived`        TINYINT(1)   NOT NULL DEFAULT 0,
  `is_sample`       TINYINT(1)   NOT NULL DEFAULT 0,
  `sort_order`      SMALLINT     NOT NULL DEFAULT 0,
  `created_at`      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`, `id`),
  UNIQUE KEY `uq_accounts_name` (`user_id`, `name`),
  KEY `ix_accounts_archived` (`user_id`, `archived`),
  CONSTRAINT `fk_accounts_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_accounts_type` FOREIGN KEY (`type`) REFERENCES `account_types` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `savings_goals` (
  `user_id`        BIGINT UNSIGNED NOT NULL,
  `id`             VARCHAR(40)  NOT NULL,
  `name`           VARCHAR(80)  NOT NULL,
  `target_amount`  BIGINT       NOT NULL DEFAULT 0,
  `current_amount` BIGINT       NOT NULL DEFAULT 0,   -- derived from goal_contributions
  `target_date`    DATE         NULL,
  `account_id`     VARCHAR(40)  NULL,
  `description`    VARCHAR(255) NULL,
  `emoji`          VARCHAR(16)  NULL,
  `color`          CHAR(7)      NULL,
  `status`         ENUM('active','reached','paused') NOT NULL DEFAULT 'active',
  `archived`       TINYINT(1)   NOT NULL DEFAULT 0,
  `is_sample`      TINYINT(1)   NOT NULL DEFAULT 0,
  `created_at`     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`, `id`),
  KEY `ix_goals_status` (`user_id`, `status`, `archived`),
  CONSTRAINT `fk_goals_user`    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_goals_account` FOREIGN KEY (`user_id`, `account_id`) REFERENCES `accounts` (`user_id`, `id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `bills` (
  `user_id`       BIGINT UNSIGNED NOT NULL,
  `id`            VARCHAR(40)  NOT NULL,
  `name`          VARCHAR(80)  NOT NULL,
  `amount`        BIGINT       NOT NULL DEFAULT 0,
  `due_date`      DATE         NOT NULL,
  `category_id`   VARCHAR(40)  NULL,
  `account_id`    VARCHAR(40)  NULL,
  `method`        VARCHAR(30)  NULL,
  `repeat_freq`   VARCHAR(20)  NOT NULL DEFAULT 'monthly',
  `notes`         VARCHAR(500) NULL,
  `paid_on`       DATE         NULL,
  `paid_tx_id`    VARCHAR(40)  NULL,
  `reminder_days` SMALLINT     NOT NULL DEFAULT 3,
  `is_sample`     TINYINT(1)   NOT NULL DEFAULT 0,
  `created_at`    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`, `id`),
  KEY `ix_bills_due`  (`user_id`, `due_date`),
  KEY `ix_bills_open` (`user_id`, `paid_on`, `due_date`),
  CONSTRAINT `fk_bills_user`     FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_bills_category` FOREIGN KEY (`user_id`, `category_id`) REFERENCES `categories` (`user_id`, `id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_bills_account`  FOREIGN KEY (`user_id`, `account_id`)  REFERENCES `accounts` (`user_id`, `id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `recurring_transactions` (
  `user_id`     BIGINT UNSIGNED NOT NULL,
  `id`          VARCHAR(40)  NOT NULL,
  `name`        VARCHAR(80)  NOT NULL,
  `type`        ENUM('income','expense','transfer') NOT NULL DEFAULT 'expense',
  `amount`      BIGINT       NOT NULL DEFAULT 0,
  `category_id` VARCHAR(40)  NULL,
  `account_id`  VARCHAR(40)  NULL,
  `method`      VARCHAR(30)  NULL,
  `frequency`   VARCHAR(20)  NOT NULL DEFAULT 'monthly',
  `next_date`   DATE         NOT NULL,
  `end_date`    DATE         NULL,
  `auto_post`   TINYINT(1)   NOT NULL DEFAULT 0,
  `paused`      TINYINT(1)   NOT NULL DEFAULT 0,
  `notes`       VARCHAR(500) NULL,
  `last_posted` DATE         NULL,
  `is_sample`   TINYINT(1)   NOT NULL DEFAULT 0,
  `created_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`, `id`),
  KEY `ix_recurring_due` (`user_id`, `paused`, `next_date`),
  CONSTRAINT `fk_recurring_user`      FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_recurring_category`  FOREIGN KEY (`user_id`, `category_id`) REFERENCES `categories` (`user_id`, `id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_recurring_account`   FOREIGN KEY (`user_id`, `account_id`)  REFERENCES `accounts` (`user_id`, `id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_recurring_frequency` FOREIGN KEY (`frequency`) REFERENCES `frequencies` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- The hot table. Indexes below match the filters the Transactions view offers.
CREATE TABLE IF NOT EXISTS `transactions` (
  `user_id`       BIGINT UNSIGNED NOT NULL,
  `id`            VARCHAR(40)  NOT NULL,
  `type`          ENUM('income','expense','transfer') NOT NULL,
  `amount`        BIGINT       NOT NULL,              -- minor units, always >= 0
  `tx_date`       DATE         NOT NULL,
  `description`   VARCHAR(160) NULL,
  `category_id`   VARCHAR(40)  NULL,
  `account_id`    VARCHAR(40)  NULL,
  `to_account_id` VARCHAR(40)  NULL,                  -- transfers only
  `method`        VARCHAR(30)  NULL,
  `notes`         VARCHAR(500) NULL,
  `recurring_id`  VARCHAR(40)  NULL,
  `bill_id`       VARCHAR(40)  NULL,
  `goal_id`       VARCHAR(40)  NULL,
  `is_sample`     TINYINT(1)   NOT NULL DEFAULT 0,
  `created_at`    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`, `id`),
  KEY `ix_tx_date`     (`user_id`, `tx_date`, `created_at`),
  KEY `ix_tx_account`  (`user_id`, `account_id`, `tx_date`),
  KEY `ix_tx_to_acct`  (`user_id`, `to_account_id`, `tx_date`),
  KEY `ix_tx_category` (`user_id`, `category_id`, `tx_date`),
  KEY `ix_tx_type`     (`user_id`, `type`, `tx_date`),
  KEY `ix_tx_bill`     (`user_id`, `bill_id`),
  KEY `ix_tx_goal`     (`user_id`, `goal_id`),
  -- Idempotency guard: a recurring rule can post at most one row per date,
  -- so a double-clicked or retried "post due" run cannot duplicate money.
  UNIQUE KEY `uq_tx_recurring_day` (`user_id`, `recurring_id`, `tx_date`),
  CONSTRAINT `fk_tx_user`      FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_tx_category`  FOREIGN KEY (`user_id`, `category_id`)   REFERENCES `categories` (`user_id`, `id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_tx_account`   FOREIGN KEY (`user_id`, `account_id`)    REFERENCES `accounts` (`user_id`, `id`)   ON DELETE RESTRICT,
  CONSTRAINT `fk_tx_to_acct`   FOREIGN KEY (`user_id`, `to_account_id`) REFERENCES `accounts` (`user_id`, `id`)   ON DELETE RESTRICT,
  CONSTRAINT `fk_tx_recurring` FOREIGN KEY (`user_id`, `recurring_id`)  REFERENCES `recurring_transactions` (`user_id`, `id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_tx_bill`      FOREIGN KEY (`user_id`, `bill_id`)       REFERENCES `bills` (`user_id`, `id`)      ON DELETE RESTRICT,
  CONSTRAINT `fk_tx_goal`      FOREIGN KEY (`user_id`, `goal_id`)       REFERENCES `savings_goals` (`user_id`, `id`) ON DELETE RESTRICT,
  CONSTRAINT `ck_tx_transfer`  CHECK (
      (`type` <> 'transfer')
      OR (`to_account_id` IS NOT NULL AND `account_id` IS NOT NULL AND `to_account_id` <> `account_id`)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Live Grocery List: the working shopping list (see migrations/002_grocery_items.sql).
-- (price column is part of the CREATE TABLE, so fresh installs get it too.)
-- ===========================================================================

CREATE TABLE IF NOT EXISTS `grocery_items` (
  `user_id`     BIGINT UNSIGNED NOT NULL,
  `id`          VARCHAR(40)  NOT NULL,
  `name`        VARCHAR(120) NOT NULL,
  `category_id` VARCHAR(40)  NULL,
  `price`       BIGINT       NULL DEFAULT NULL,
  `is_checked`  TINYINT(1)   NOT NULL DEFAULT 0,
  `checked_at`  DATETIME     NULL,
  `created_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`, `id`),
  KEY `ix_grocery_list` (`user_id`, `is_checked`, `created_at`),
  CONSTRAINT `fk_grocery_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- Saved grocery lists: reusable shopping templates (see
-- migrations/004_saved_grocery_lists.sql). Templates only, never ledger data.

CREATE TABLE IF NOT EXISTS `grocery_lists` (
  `user_id`    BIGINT UNSIGNED NOT NULL,
  `id`         VARCHAR(40) NOT NULL,
  `name`       VARCHAR(80) NOT NULL,
  `created_at` DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`, `id`),
  KEY `ix_grocery_lists_user` (`user_id`, `updated_at`),
  CONSTRAINT `fk_grocery_lists_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `grocery_list_items` (
  `user_id`     BIGINT UNSIGNED NOT NULL,
  `id`          VARCHAR(40)  NOT NULL,
  `list_id`     VARCHAR(40)  NOT NULL,
  `name`        VARCHAR(120) NOT NULL,
  `category_id` VARCHAR(40)  NULL,
  `position`    INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`user_id`, `id`),
  KEY `ix_grocery_list_items` (`user_id`, `list_id`, `position`),
  CONSTRAINT `fk_grocery_list_items_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_grocery_list_items_list` FOREIGN KEY (`user_id`, `list_id`) REFERENCES `grocery_lists` (`user_id`, `id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Optional split lines (one transaction across several categories).
CREATE TABLE IF NOT EXISTS `transaction_splits` (
  `user_id`        BIGINT UNSIGNED NOT NULL,
  `id`             VARCHAR(40)  NOT NULL,
  `transaction_id` VARCHAR(40)  NOT NULL,
  `category_id`    VARCHAR(40)  NULL,
  `amount`         BIGINT       NOT NULL,
  `note`           VARCHAR(160) NULL,
  PRIMARY KEY (`user_id`, `id`),
  KEY `ix_splits_tx` (`user_id`, `transaction_id`),
  CONSTRAINT `fk_splits_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_splits_tx`   FOREIGN KEY (`user_id`, `transaction_id`) REFERENCES `transactions` (`user_id`, `id`) ON DELETE CASCADE,
  CONSTRAINT `fk_splits_cat`  FOREIGN KEY (`user_id`, `category_id`)    REFERENCES `categories` (`user_id`, `id`)   ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Budgets
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS `budgets` (
  `user_id`    BIGINT UNSIGNED NOT NULL,
  `id`         VARCHAR(40)  NOT NULL,
  `month`      CHAR(7)      NOT NULL,                 -- 'YYYY-MM'
  `note`       VARCHAR(255) NULL,
  `is_sample`  TINYINT(1)   NOT NULL DEFAULT 0,
  `created_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`, `id`),
  UNIQUE KEY `uq_budget_month` (`user_id`, `month`),
  CONSTRAINT `fk_budgets_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `budget_lines` (
  `user_id`     BIGINT UNSIGNED NOT NULL,
  `id`          VARCHAR(40) NOT NULL,
  `budget_id`   VARCHAR(40) NOT NULL,
  `category_id` VARCHAR(40) NOT NULL,
  `amount`      BIGINT      NOT NULL DEFAULT 0,
  `rollover`    TINYINT(1)  NOT NULL DEFAULT 0,
  PRIMARY KEY (`user_id`, `id`),
  UNIQUE KEY `uq_budget_line` (`user_id`, `budget_id`, `category_id`),
  CONSTRAINT `fk_lines_user`   FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_lines_budget` FOREIGN KEY (`user_id`, `budget_id`)   REFERENCES `budgets` (`user_id`, `id`)    ON DELETE CASCADE,
  CONSTRAINT `fk_lines_cat`    FOREIGN KEY (`user_id`, `category_id`) REFERENCES `categories` (`user_id`, `id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Free-text income and savings plan rows shown beside the category lines.
CREATE TABLE IF NOT EXISTS `budget_plan_lines` (
  `user_id`    BIGINT UNSIGNED NOT NULL,
  `id`         VARCHAR(40) NOT NULL,
  `budget_id`  VARCHAR(40) NOT NULL,
  `plan_kind`  ENUM('income','savings') NOT NULL,
  `label`      VARCHAR(80) NOT NULL,
  `amount`     BIGINT      NOT NULL DEFAULT 0,
  `sort_order` SMALLINT    NOT NULL DEFAULT 0,
  PRIMARY KEY (`user_id`, `id`),
  KEY `ix_plan_budget` (`user_id`, `budget_id`, `plan_kind`, `sort_order`),
  CONSTRAINT `fk_plan_user`   FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_plan_budget` FOREIGN KEY (`user_id`, `budget_id`) REFERENCES `budgets` (`user_id`, `id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Ledgers for goals and bills
-- ---------------------------------------------------------------------------

-- savings_goals.current_amount is always SUM(goal_contributions.amount).
-- The original SPA both created a transaction AND incremented the goal, which
-- double counted; see docs/AUDIT.md.
CREATE TABLE IF NOT EXISTS `goal_contributions` (
  `user_id`        BIGINT UNSIGNED NOT NULL,
  `id`             VARCHAR(40)  NOT NULL,
  `goal_id`        VARCHAR(40)  NOT NULL,
  `amount`         BIGINT       NOT NULL,
  `contributed_on` DATE         NOT NULL,
  `account_id`     VARCHAR(40)  NULL,
  `transaction_id` VARCHAR(40)  NULL,
  `note`           VARCHAR(160) NULL,
  `created_at`     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`, `id`),
  KEY `ix_contrib_goal` (`user_id`, `goal_id`, `contributed_on`),
  CONSTRAINT `fk_contrib_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_contrib_goal` FOREIGN KEY (`user_id`, `goal_id`)        REFERENCES `savings_goals` (`user_id`, `id`) ON DELETE CASCADE,
  CONSTRAINT `fk_contrib_tx`   FOREIGN KEY (`user_id`, `transaction_id`) REFERENCES `transactions` (`user_id`, `id`)  ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One row per paid occurrence, so history survives the bill rolling forward.
CREATE TABLE IF NOT EXISTS `bill_payments` (
  `user_id`        BIGINT UNSIGNED NOT NULL,
  `id`             VARCHAR(40) NOT NULL,
  `bill_id`        VARCHAR(40) NOT NULL,
  `amount`         BIGINT      NOT NULL,
  `paid_on`        DATE        NOT NULL,
  `due_date`       DATE        NOT NULL,
  `account_id`     VARCHAR(40) NULL,
  `transaction_id` VARCHAR(40) NULL,
  `created_at`     DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`, `id`),
  UNIQUE KEY `uq_bill_occurrence` (`user_id`, `bill_id`, `due_date`),
  KEY `ix_payments_bill` (`user_id`, `bill_id`, `paid_on`),
  CONSTRAINT `fk_payments_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_payments_bill` FOREIGN KEY (`user_id`, `bill_id`)        REFERENCES `bills` (`user_id`, `id`)        ON DELETE CASCADE,
  CONSTRAINT `fk_payments_tx`   FOREIGN KEY (`user_id`, `transaction_id`) REFERENCES `transactions` (`user_id`, `id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Operational
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS `notifications` (
  `user_id`    BIGINT UNSIGNED NOT NULL,
  `id`         VARCHAR(40)  NOT NULL,
  `kind`       VARCHAR(40)  NOT NULL,
  `title`      VARCHAR(120) NOT NULL,
  `body`       VARCHAR(500) NULL,
  `entity`     VARCHAR(40)  NULL,
  `entity_id`  VARCHAR(40)  NULL,
  `read_at`    DATETIME     NULL,
  `created_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`, `id`),
  KEY `ix_notifications_unread` (`user_id`, `read_at`, `created_at`),
  CONSTRAINT `fk_notifications_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Super Admin messages and News & Updates (migration 008). Delivery/read state
-- lives in `notifications` (one row per user who received or read an item).
CREATE TABLE IF NOT EXISTS `admin_posts` (
  `id`              VARCHAR(40)  NOT NULL,
  `kind`            ENUM('message','news') NOT NULL,
  `type`            VARCHAR(20)  NOT NULL,
  `title`           VARCHAR(120) NOT NULL,
  `body`            VARCHAR(500) NOT NULL,
  `details`         TEXT         NULL,
  `link`            VARCHAR(500) NULL,
  `audience`        ENUM('all','selected') NOT NULL DEFAULT 'all',
  `recipient_count` INT UNSIGNED NOT NULL DEFAULT 0,
  `created_by`      BIGINT UNSIGNED NULL,
  `created_at`      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `ix_admin_posts_feed` (`audience`, `created_at`),
  KEY `ix_admin_posts_kind` (`kind`, `created_at`),
  CONSTRAINT `fk_admin_posts_author` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Append only. user_id is nullable so failed sign-ins can still be recorded.
CREATE TABLE IF NOT EXISTS `audit_logs` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`    BIGINT UNSIGNED NULL,
  `action`     VARCHAR(60)  NOT NULL,
  `entity`     VARCHAR(40)  NULL,
  `entity_id`  VARCHAR(40)  NULL,
  `ip_address` VARCHAR(45)  NULL,
  `user_agent` VARCHAR(255) NULL,
  `meta`       JSON         NULL,
  `created_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `ix_audit_user` (`user_id`, `created_at`),
  KEY `ix_audit_action` (`action`, `created_at`),
  CONSTRAINT `fk_audit_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Saved budgets: reusable budget templates (see migrations/005_saved_budgets.sql).
-- A snapshot of a plan (category allocations + income/savings rows), never
-- ledger data; loading one only rewrites budget_lines / budget_plan_lines.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `saved_budgets` (
  `user_id`      BIGINT UNSIGNED NOT NULL,
  `id`           VARCHAR(40) NOT NULL,
  `name`         VARCHAR(80) NOT NULL,
  `source_month` CHAR(7)     NULL,
  `created_at`   DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`   DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`, `id`),
  KEY `ix_saved_budgets_user` (`user_id`, `updated_at`),
  CONSTRAINT `fk_saved_budgets_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `saved_budget_lines` (
  `user_id`     BIGINT UNSIGNED NOT NULL,
  `id`          VARCHAR(40) NOT NULL,
  `budget_id`   VARCHAR(40) NOT NULL,
  `kind`        ENUM('category','income','savings') NOT NULL DEFAULT 'category',
  `category_id` VARCHAR(40) NULL,
  `label`       VARCHAR(80) NULL,
  `amount`      BIGINT      NOT NULL DEFAULT 0,
  `position`    INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`user_id`, `id`),
  KEY `ix_saved_budget_lines` (`user_id`, `budget_id`, `kind`, `position`),
  CONSTRAINT `fk_saved_budget_lines_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_saved_budget_lines_budget` FOREIGN KEY (`user_id`, `budget_id`) REFERENCES `saved_budgets` (`user_id`, `id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `schema_migrations` (
  `version`    VARCHAR(40) NOT NULL,
  `applied_at` DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`version`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
