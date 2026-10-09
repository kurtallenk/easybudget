-- ===========================================================================
-- 003_grocery_item_price - the price a shopper actually paid for an item.
--
-- The Live Grocery List now collects the price at the moment the item is
-- bought ("Get Item" -> price dialogue) instead of asking for every price
-- again when the list is submitted. `price` holds integer minor units
-- (centavos), exactly like `transactions`.`amount`.
--
-- NULL means "not purchased yet". Moving an item back to the active list
-- clears it again (GroceryRepo::update), so a price always belongs to a
-- purchase that really happened.
--
-- Apply:  mysql -u root -p budget_planner < database/migrations/003_grocery_item_price.sql
-- (schema.sql contains the same column, so fresh installs get it too.)
-- ===========================================================================

ALTER TABLE `grocery_items`
  ADD COLUMN `price` BIGINT NULL DEFAULT NULL AFTER `category_id`;

INSERT INTO `schema_migrations` (`version`) VALUES ('003_grocery_item_price')
ON DUPLICATE KEY UPDATE `version` = `version`;
