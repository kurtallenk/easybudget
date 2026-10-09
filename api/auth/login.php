<?php
declare(strict_types=1);

/** Sign in. Throttling, timing safety and session rotation live in Auth/Session. */

require_once __DIR__ . '/../../includes/api.php';

api_public(['POST']);

$body = Request::body();
$clean = (new Validator($body))->required('email', 'password')->email('email')->values();

$password = $body['password'] ?? '';
if (!is_string($password)) {
    throw new ApiException('Please enter your password.', 422, 'validation_failed');
}

$remember = ($body['remember'] ?? false) === true;

$user = Auth::login($clean['email'], $password, $remember);

Response::ok(['user' => $user, 'csrfToken' => (function_exists('api_csrf_token') ? api_csrf_token() : Csrf::token())]);
