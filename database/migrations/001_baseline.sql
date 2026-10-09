-- ===========================================================================
-- 001_baseline - records database/schema.sql as the starting point.
--
-- schema.sql is idempotent (CREATE TABLE IF NOT EXISTS), so a fresh install
-- runs it directly and then stamps this version. Later changes get their own
-- numbered file and their own INSERT here.
--
-- Apply:  mysql -u root -p budget_planner < database/migrations/001_baseline.sql
-- ===========================================================================

INSERT INTO `schema_migrations` (`version`) VALUES ('001_baseline')
ON DUPLICATE KEY UPDATE `version` = `version`;
