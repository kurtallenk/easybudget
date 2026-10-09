-- ===========================================================================
-- Reference data. Idempotent: safe to run on every deploy.
-- Values mirror assets/js/core.js and assets/js/store.legacy.js exactly.
-- ===========================================================================

SET NAMES utf8mb4;

INSERT INTO `currencies` (`code`,`name`,`symbol`,`locale`,`minor_unit`,`sort_order`) VALUES
  ('PHP','Philippine Peso','₱','en-PH',2,1),
  ('USD','US Dollar','$','en-US',2,2),
  ('EUR','Euro','€','de-DE',2,3),
  ('GBP','British Pound','£','en-GB',2,4),
  -- NOTE: JPY has no minor unit in reality, but the existing frontend divides
  -- every currency by 100. minor_unit is kept at 2 so behaviour is unchanged;
  -- see docs/AUDIT.md "Known limitations" before changing this.
  ('JPY','Japanese Yen','¥','ja-JP',2,5),
  ('SGD','Singapore Dollar','S$','en-SG',2,6),
  ('AUD','Australian Dollar','A$','en-AU',2,7),
  ('CAD','Canadian Dollar','C$','en-CA',2,8),
  ('INR','Indian Rupee','₹','en-IN',2,9)
ON DUPLICATE KEY UPDATE
  `name` = VALUES(`name`), `symbol` = VALUES(`symbol`),
  `locale` = VALUES(`locale`), `sort_order` = VALUES(`sort_order`);

INSERT INTO `account_types` (`id`,`label`,`icon`,`color`,`sort_order`) VALUES
  ('cash','Cash','cash','#0f9d58',1),
  ('bank','Bank Account','bank','#2563eb',2),
  ('ewallet','E-Wallet','phone','#7048e8',3),
  ('savings','Savings Account','piggy','#0ca678',4),
  ('credit','Credit Card','card','#d6336c',5),
  ('other','Other','wallet','#868e96',6)
ON DUPLICATE KEY UPDATE
  `label` = VALUES(`label`), `icon` = VALUES(`icon`),
  `color` = VALUES(`color`), `sort_order` = VALUES(`sort_order`);

INSERT INTO `payment_methods` (`id`,`label`,`sort_order`) VALUES
  ('Cash','Cash',1),
  ('Debit Card','Debit Card',2),
  ('Credit Card','Credit Card',3),
  ('Bank Transfer','Bank Transfer',4),
  ('E-Wallet','E-Wallet',5),
  ('Cheque','Cheque',6),
  ('Auto-Debit','Auto-Debit',7),
  ('Other','Other',8)
ON DUPLICATE KEY UPDATE `label` = VALUES(`label`), `sort_order` = VALUES(`sort_order`);

INSERT INTO `frequencies` (`id`,`label`,`days_hint`,`sort_order`) VALUES
  ('daily','Daily',1,1),
  ('weekly','Weekly',7,2),
  ('biweekly','Every 2 weeks',14,3),
  ('monthly','Monthly',30,4),
  ('quarterly','Quarterly',91,5),
  ('yearly','Yearly',365,6)
ON DUPLICATE KEY UPDATE
  `label` = VALUES(`label`), `days_hint` = VALUES(`days_hint`), `sort_order` = VALUES(`sort_order`);

INSERT INTO `schema_migrations` (`version`) VALUES ('001_baseline')
ON DUPLICATE KEY UPDATE `version` = `version`;
