-- ===========================================================================
-- 009: email verification + forgot password / password reset.
--
-- Reuses the existing `auth_tokens` table (selector + SHA-256 validator hash,
-- expires_at, used_at) and the existing `users.email_verified_at` column.
-- Adds:
--   1. users.auth_version        bumped on password reset / change; every
--                                session stores the value it was issued with,
--                                so bumping it signs out all other sessions.
--   2. users.password_changed_at audit/display only.
--   3. login_attempts.purpose    gains 'verify' (verification email requests),
--                                used with 'reset' to rate-limit outgoing mail.
--   4. auth_tokens expiry index  for housekeeping.
--   5. Existing users are marked verified, so nobody who could sign in before
--      this release is locked out by the new requirement.
--
-- Fresh installs do NOT need this file: database/schema.sql already contains
-- every change. Run it once on an existing database, as a DB admin user:
--   mysqldump -u root -p budget_planner > backup.sql
--   mysql -u root -p budget_planner < database/migrations/009_email_verification_password_reset.sql
-- ===========================================================================

ALTER TABLE `users`
  ADD COLUMN `auth_version`        INT UNSIGNED NOT NULL DEFAULT 1 AFTER `email_verified_at`,
  ADD COLUMN `password_changed_at` DATETIME     NULL               AFTER `auth_version`;

UPDATE `users` SET `email_verified_at` = COALESCE(`created_at`, UTC_TIMESTAMP())
 WHERE `email_verified_at` IS NULL;

ALTER TABLE `login_attempts`
  MODIFY COLUMN `purpose` ENUM('login','register','reset','verify') NOT NULL DEFAULT 'login';

ALTER TABLE `auth_tokens`
  ADD KEY `ix_tokens_expiry` (`expires_at`);

INSERT IGNORE INTO `schema_migrations` (`version`) VALUES ('009_email_verification_password_reset');
