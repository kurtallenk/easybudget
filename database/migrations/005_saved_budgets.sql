-- ===========================================================================
-- 005_saved_budgets - reusable budget templates (Save / Load / Preview).
--
-- A saved budget is a SNAPSHOT OF A PLAN, never ledger data: it stores the
-- category allocations plus the income and savings plan rows of a month.
-- Loading one rewrites `budget_lines` / `budget_plan_lines` for the selected
-- month through BudgetRepo; it never touches transactions, bills, recurring
-- rules or the saved budget itself.
--
-- Both plan kinds and the category lines share one child table, separated by
-- `kind`, because they are the same thing (a label and an amount) and a single
-- table keeps ordering and deletion trivial.
--
-- category_id deliberately has NO foreign key, for the same reason as
-- grocery_list_items: a deleted category must not break a stored template.
-- CategoryRepo::delete clears it explicitly.
--
-- Apply:  mysql -u root -p budget_planner < database/migrations/005_saved_budgets.sql
-- (schema.sql contains the same CREATE TABLEs, so fresh installs get them too.)
-- ===========================================================================

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

INSERT INTO `schema_migrations` (`version`) VALUES ('005_saved_budgets')
ON DUPLICATE KEY UPDATE `version` = `version`;
