<?php
declare(strict_types=1);

/** Sign out and destroy the session. */

require_once __DIR__ . '/../../includes/api.php';

api_public(['POST']);
Auth::logout();
Response::ok(['authenticated' => false]);
