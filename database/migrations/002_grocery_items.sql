-- ===========================================================================
-- 002_grocery_items - Live Grocery List.
--
-- One row per item on a user's shopping list. Items are a working list, not
-- ledger data: money is only created when the list is submitted, at which point
-- api/grocery/submit.php writes ordinary `transactions` rows and removes the
-- submitted items in the same database transaction.
--
-- category_id deliberately has NO foreign key. Categories can be deleted or
-- cleared with sample data, and a dangling reference on a shopping list is
-- harmless (the SPA shows it as Uncategorized and asks for a category when
-- the list is submitted). CategoryRepo::delete also clears it explicitly.
--
-- Apply:  mysql -u root -p budget_planner < database/migrations/002_grocery_items.sql
-- (schema.sql contains the same CREATE TABLE, so fresh installs get it too.)
-- ===========================================================================

CREATE TABLE IF NOT EXISTS `grocery_items` (
  `user_id`     BIGINT UNSIGNED NOT NULL,
  `id`          VARCHAR(40)  NOT NULL,
  `name`        VARCHAR(120) NOT NULL,
  `category_id` VARCHAR(40)  NULL,
  `is_checked`  TINYINT(1)   NOT NULL DEFAULT 0,
  `checked_at`  DATETIME     NULL,
  `created_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`, `id`),
  KEY `ix_grocery_list` (`user_id`, `is_checked`, `created_at`),
  CONSTRAINT `fk_grocery_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `schema_migrations` (`version`) VALUES ('002_grocery_items')
ON DUPLICATE KEY UPDATE `version` = `version`;
