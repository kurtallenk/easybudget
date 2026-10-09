-- ===========================================================================
-- 004_saved_grocery_lists - reusable grocery templates (Save / Load).
--
-- A saved list is a SHOPPING TEMPLATE, never ledger data: it stores what the
-- user wants to buy (name + category), not what was paid. Loading one only
-- rebuilds the working list in `grocery_items`; expenses are still created
-- exclusively by api/grocery/submit.php.
--
-- Deleting a saved list therefore never touches `transactions`: the two are
-- separate concepts and there is no foreign key between them.
--
-- category_id deliberately has NO foreign key, for the same reason as
-- grocery_items: a category can be deleted or cleared with the sample data and
-- a dangling reference on a template is harmless (it loads as Uncategorized).
-- CategoryRepo::delete also clears it explicitly.
--
-- Apply:  mysql -u root -p budget_planner < database/migrations/004_saved_grocery_lists.sql
-- (schema.sql contains the same CREATE TABLEs, so fresh installs get them too.)
-- ===========================================================================

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

INSERT INTO `schema_migrations` (`version`) VALUES ('004_saved_grocery_lists')
ON DUPLICATE KEY UPDATE `version` = `version`;
