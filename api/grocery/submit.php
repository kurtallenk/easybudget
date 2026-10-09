<?php
declare(strict_types=1);

/**
 * Submit the grocery list: every purchased item becomes an ordinary expense
 * transaction and leaves the list. All-or-nothing.
 *
 * Only purchased items may be submitted: each expense uses the price stored on
 * the item when the shopper bought it, so nobody is asked for a price twice.
 * Unpurchased items have no amount paid, are left out by the client, and stay
 * on the list.
 *
 * Body: { accountId, date, method?, items: [{ id, categoryId?, amount? }] }
 * `amount` is an optional override kept for older clients; `categoryId` only
 * overrides the item's own category (needed when it has none).
 */

require_once __DIR__ . '/../../includes/api.php';

$uid = api_guard(['POST']);

$clean = (new Validator(Request::body()))
    ->required('accountId', 'date', 'items')
    ->id('accountId')
    ->date('date')
    ->nullableEnum('method', Defaults::PAYMENT_METHODS)
    ->listOf('items', static function (Validator $row): array {
        return $row->required('id')->id('id')->nullableAmount('amount')->nullableId('categoryId')->values();
    }, 300)
    ->values();

Response::ok(GroceryRepo::submit($uid, $clean));
