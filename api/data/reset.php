<?php
declare(strict_types=1);

/** Destructive: deletes everything the user owns and restores the starter categories. */

require_once __DIR__ . '/../../includes/api.php';

$uid = api_guard(['POST']);

$clean = (new Validator(Request::body()))->required('confirm')->enum('confirm', ['RESET'])->values();

Response::ok(DataRepo::reset($uid));
