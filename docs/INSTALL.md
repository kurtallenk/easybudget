# Installation

Requirements: PHP 8.1+ with PDO MySQL, MySQL 8.0+ or MariaDB 10.5+, and a web server
(Apache with `.htaccess` support, or nginx with the equivalent rules below).

> Verified on PHP 8.5.9 with MariaDB 10.5. After installing, run
> `tools/runtime_tests.sh` against the new host to confirm the whole API answers
> correctly there too.

## 1. Database

```bash
mysql -u root -p -e "CREATE DATABASE budget_planner CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
mysql -u root -p -e "CREATE USER 'budget_app'@'localhost' IDENTIFIED BY 'a-long-random-password';"
mysql -u root -p -e "GRANT SELECT, INSERT, UPDATE, DELETE ON budget_planner.* TO 'budget_app'@'localhost';"

mysql -u root -p budget_planner < database/schema.sql
mysql -u root -p budget_planner < database/seeds/001_reference_data.sql
```

The application user deliberately has no DDL rights. Migrations run as an admin user.

`schema.sql` must load without errors and create 26 tables. If it stops part-way, the
remaining statements are skipped - check the output rather than assuming success.

### Local development

`tools/dev_server.sh` starts PHP's built-in server with loopback-friendly defaults
(`SESSION_SECURE=false`, `APP_ENV=development`). Set `RELAX_THROTTLE=1` to raise the
sign-up and sign-in limits while testing. Never use either in production.

The database connection, and the throttle ceilings, can also come from the environment:
`DB_HOST`, `DB_PORT`, `DB_SOCKET`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`,
`REGISTER_MAX_PER_IP`, `LOGIN_MAX_ATTEMPTS`, `LOGIN_WINDOW_SECONDS`,
`LOGIN_LOCKOUT_SECONDS`.

## 2. Configuration

Create `config/config.local.php` (git-ignored, blocked from the web by
`config/.htaccess`). It is merged over `config/config.php` section by section:

```php
<?php
return [
    'app' => [
        'env'      => 'production',
        'debug'    => false,          // never true in production
        'url'      => 'https://budget.example.com',
        'timezone' => 'Asia/Manila',
    ],
    'db' => [
        'host'     => '127.0.0.1',
        'name'     => 'budget_planner',
        'user'     => 'budget_app',
        'password' => 'a-long-random-password',
    ],
    'session' => [
        'cookie_secure' => true,      // requires HTTPS
        'cookie_domain' => 'budget.example.com',
    ],
];
```

Environment variables (`DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `APP_ENV`,
`APP_DEBUG`, `SESSION_SECURE`, ...) work too; resolution order is
`config.local.php` > environment variable > default.

## 3. Web server

Point the document root at the project directory. `index.html` is the entry point and
`api/` must be reachable; everything else must not be.

**Apache** - the bundled `.htaccess` files already deny `config/`, `includes/`,
`database/` and `storage/`. Confirm `AllowOverride All` is set for the directory.

**nginx** - there is no `.htaccess` support, so add the equivalent:

```nginx
root /var/www/budget-planner;
index index.html;

location ~ ^/(config|includes|database|storage|tools|docs)/ { deny all; return 404; }
location ~ \.(md|sql|json|log)$                             { deny all; return 404; }

location ~ ^/api/.*\.php$ {
    include fastcgi_params;
    fastcgi_pass unix:/run/php/php8.2-fpm.sock;
    fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
}
location ~ \.php$ { deny all; return 404; }   # only api/ runs PHP
```

## 4. Permissions

```bash
mkdir -p storage/logs storage/mail
chown -R www-data:www-data storage
chmod 750 storage storage/logs storage/mail
```

`storage/` must be writable by PHP and unreachable from the web.

## 5. First run

1. Open `https://your-host/` - you will be redirected to `pages/login.html`.
2. Configure `APP_URL` and SMTP (see `docs/AUTH.md`), then create an account on
   `pages/register.html` and open the confirmation link from the email. The 22 starter
   categories are seeded automatically.
3. Add an account, then a transaction, and confirm the dashboard updates.
4. Work through `docs/TESTING.md`.

## Upgrading

`database/schema.sql` is idempotent (`CREATE TABLE IF NOT EXISTS`) and
`schema_migrations` is there for versioned changes. Back up before any upgrade:

```bash
mysqldump -u root -p budget_planner > backup-$(date +%F).sql
```


### Upgrading an existing database to the Live Grocery List

Fresh installs get the `grocery_items` table (including its `price` column) from `schema.sql`.
An existing database needs the migrations, in order (back up first):

```
mysql -u root -p budget_planner < database/migrations/002_grocery_items.sql
mysql -u root -p budget_planner < database/migrations/003_grocery_item_price.sql
mysql -u root -p budget_planner < database/migrations/004_saved_grocery_lists.sql
mysql -u root -p budget_planner < database/migrations/005_saved_budgets.sql
mysql -u root -p budget_planner < database/migrations/006_design_template.sql
mysql -u root -p budget_planner < database/migrations/007_design_template_futuristic.sql
mysql -u root -p budget_planner < database/migrations/008_notifications_admin.sql
mysql -u root -p budget_planner < database/migrations/009_email_verification_password_reset.sql
mysql -u root -p budget_planner < database/migrations/010_api_tokens.sql
```

`010` adds the `api_tokens` table used by the Android app (bearer access + refresh tokens,
stored as SHA-256 hashes). The website does not need it, but the app cannot sign in until it
exists. Details: `docs/API.md` ("Mobile clients") and `docs/ANDROID.md`.

`009` adds email verification and password reset support (`users.auth_version`,
`users.password_changed_at`, `login_attempts.purpose = 'verify'`) and marks every existing
user as verified. Details and SMTP setup: `docs/AUTH.md`.

`008` adds `users.role` (`user` | `super_admin`, default `user`) and the `admin_posts` table
(Super Admin messages and News & Updates). Read/unread state and "specific users" deliveries
reuse the existing `notifications` table. Nobody is a Super Admin until promoted **by SQL**
(there is deliberately no promote endpoint):

```
mysql -u root -p budget_planner -e "UPDATE users SET role='super_admin' WHERE email='you@example.com';"
```

Demote with `role='user'`; it takes effect on the next request. Until `008` is applied the app
keeps working: the inbox shows the static feed and every admin endpoint answers 403.

`003` adds `grocery_items.price`, the amount a shopper paid for an item, which the Live
Grocery List collects in the purchase dialogue and reuses when the list becomes expenses.
`004` adds `grocery_lists` and `grocery_list_items`, the reusable shopping templates behind
Save / Load Grocery List. Templates hold item names and categories only - no prices, no
purchase state - and deleting one never touches `transactions`.
`005` adds `saved_budgets` and `saved_budget_lines`, the reusable budget templates behind
Save / Load Budget and the Saved Budget Quick Preview. A saved budget stores category
allocations and planned income/savings rows only; loading one rewrites just that month's
`budget_lines` / `budget_plan_lines`, and deleting one changes nothing else.
