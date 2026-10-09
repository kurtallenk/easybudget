-- Round 4: add the optional 'futuristic' (Game HUD) design template.
-- Requires migration 006. Presentation-only preference; no data is touched.
-- Back up first:  mysqldump -u root -p budget_planner > backup.sql
ALTER TABLE `user_settings`
  MODIFY COLUMN `design_template` ENUM('modern','classic','minimal','futuristic') NOT NULL DEFAULT 'modern';

INSERT IGNORE INTO `schema_migrations` (`version`) VALUES ('007_design_template_futuristic');
