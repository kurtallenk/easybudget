<?php
declare(strict_types=1);

/** Update settings. Only the documented keys are accepted. */

require_once __DIR__ . '/../../includes/api.php';

$uid = api_guard(['POST']);

$clean = (new Validator(Request::body()))
    ->enum('currency', Defaults::CURRENCIES)
    ->enum('dateFormat', Defaults::DATE_FORMATS)
    ->int('firstDayOfWeek', 0, 6)
    ->enum('theme', Defaults::THEMES)
    ->int('brandHue', 0, 360)
    ->enum('designTemplate', Defaults::TEMPLATES)
    ->bool('hideSampleBanner')
    ->bool('onboarded')
    ->values();

Response::ok(SettingsRepo::update($uid, $clean));
