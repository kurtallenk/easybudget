<?php
declare(strict_types=1);

/**
 * Host-specific overrides for the InfinityFree deployment.
 * Git-ignored / blocked from the web by config/.htaccess - never commit
 * this file or share it outside your own hosting control panel.
 */
return [
    'app' => [
        'env'      => 'production',
        'debug'    => false,   // never true in production - leaks stack traces otherwise
        // Update this if your live URL is different from the one already
        // referenced in index.html's og:url meta tag.
        'url'      => 'https://easybudgetplanner.freedev.app',
        'timezone' => 'Asia/Manila',
    ],

    'db' => [
        'host'     => 'sql310.infinityfree.com',
        'port'     => 3306,
        'name'     => 'if0_42988195_budget_planner',
        'user'     => 'if0_42988195',
        'password' => 't4n66qH9QO',
    ],

    // Outgoing email for verification and password reset links (docs/AUTH.md).
    // InfinityFree has no PHP mail(); use an external SMTP provider. Fill in and
    // uncomment. Never share this file.
    // 'mail' => [
    //     'driver'       => 'smtp',
    //     'host'         => 'smtp.gmail.com',
    //     'port'         => 587,
    //     'encryption'   => 'tls',          // 'ssl' with port 465
    //     'username'     => 'you@gmail.com',
    //     'password'     => 'your-16-char-app-password',
    //     'from_address' => 'you@gmail.com',
    //     'from_name'    => 'Easy Budget Planner',
    // ],

    'session' => [
        // InfinityFree subdomains (*.infinityfree.io) are served over HTTPS
        // by default, so the session cookie can require it.
        'cookie_secure' => true,
        // Leave cookie_domain unset (default '') unless you're sharing the
        // session across multiple subdomains of the same site.
    ],
];
