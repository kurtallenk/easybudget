-- ===========================================================================
-- 010: bearer tokens for the Android app (and any other non-browser client).
--
-- The web app keeps using its hardened PHP session + CSRF. Mobile clients sign
-- in through api/auth/token.php and receive:
--   * a short-lived access token (1 hour) sent as "Authorization: Bearer ..."
--     (or X-EBP-Token on hosts that strip Authorization), and
--   * a long-lived refresh token (60 days) that is ROTATED on every use.
-- Only SHA-256 hashes are stored. Every token belongs to a "family" (one per
-- sign-in on one device); presenting an already-rotated refresh token is
-- treated as theft and revokes the whole family. Tokens carry the user's
-- auth_version, so a password reset/change signs every device out.
--
-- Fresh installs do NOT need this file: database/schema.sql already has it.
--   mysql -u root -p budget_planner < database/migrations/010_api_tokens.sql
-- ===========================================================================

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

INSERT IGNORE INTO `schema_migrations` (`version`) VALUES ('010_api_tokens');
