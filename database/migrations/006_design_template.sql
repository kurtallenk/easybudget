-- ===========================================================================
-- 006_design_template - per-user visual Design Template preference.
--
-- Presentation only: the value selects a CSS token set
-- (html[data-template="..."] in assets/css/app.css). It never affects
-- transactions, balances, budgets, goals, bills, recurring rules, grocery
-- data, saved templates or categories.
--
-- Safe to run once on an existing database. SettingsRepo detects the column,
-- so the app keeps working (other settings still save) before this runs.
-- ===========================================================================

ALTER TABLE `user_settings`
  ADD COLUMN `design_template` ENUM('modern','classic','minimal') NOT NULL DEFAULT 'modern'
  AFTER `brand_hue`;
