-- Round 10: database-backed notification read state + Super Admin messages / News & Updates.
-- Smallest change set:
--   1. users.role               -> server-side authorization for the Super Admin area
--                                  (default 'user'; nobody is an admin until promoted by SQL)
--   2. admin_posts              -> messages and News & Updates created in the Super Admin area
-- The EXISTING per-user `notifications` table is reused, unchanged, for:
--   * read receipts (read_at) of the static assets/data/announcements.json feed and of
--     "All users" posts (a row is written the first time the user reads the item), and
--   * delivery of "Specific users" messages (one unread row per recipient at send time).
-- Back up first:  mysqldump -u root -p budget_planner > backup.sql
-- Promote an administrator (run as a DB admin, never from the app):
--   UPDATE `users` SET `role` = 'super_admin' WHERE `email` = 'you@example.com';

ALTER TABLE `users`
  ADD COLUMN `role` ENUM('user','super_admin') NOT NULL DEFAULT 'user' AFTER `display_name`;

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

INSERT IGNORE INTO `schema_migrations` (`version`) VALUES ('008_notifications_admin');
