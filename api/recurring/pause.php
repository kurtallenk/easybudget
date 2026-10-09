<?php
declare(strict_types=1);

/** Pause or resume a rule. */

require_once __DIR__ . '/../../includes/api.php';

$uid = api_guard(['POST']);
$id  = api_id();

$clean = (new Validator(Request::body()))->required('paused')->bool('paused')->values();

Response::ok(RecurringRepo::setPaused($uid, $id, (bool) $clean['paused']));
