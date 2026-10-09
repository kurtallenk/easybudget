<?php
declare(strict_types=1);

/**
 * Mark notifications as read for the signed-in user.
 *   { "ids": ["2026-09-30-notifications", "adm_…"] }   -> those items
 *   { "all": true }                                     -> Mark all as read
 * Ids that are not in the user's own inbox are ignored. Returns the inbox.
 */

require_once __DIR__ . '/../../includes/api.php';

$uid  = api_guard(['POST']);
$body = Request::body();

if (($body['all'] ?? false) === true) {
    Response::ok(NotificationRepo::markRead($uid, null));
    return;
}

$ids = $body['ids'] ?? null;
if (!is_array($ids) || !array_is_list($ids) || $ids === [] || count($ids) > NotificationRepo::MAX_ITEMS) {
    throw new ApiException('Please check the highlighted fields.', 422, 'validation_failed', ['fields' => ['ids' => 'Send a list of notification ids.']]);
}
foreach ($ids as $id) {
    if (!is_string($id) || !preg_match('/^[A-Za-z0-9_-]{1,40}$/', $id)) {
        throw new ApiException('That identifier is not valid.', 422, 'validation_failed', ['param' => 'ids']);
    }
}
Response::ok(NotificationRepo::markRead($uid, array_values(array_unique($ids))));
