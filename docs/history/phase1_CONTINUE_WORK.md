# Continue work

## Where things stand

Phase 1 (email verification, forgot/reset password, auth hardening, auth UI, em dash
removal) is complete and tested. Read `PROJECT_PROGRESS.md` and `docs/AUTH.md` first.

## Deploying Phase 1 to InfinityFree

1. Back up the database, then run
   `database/migrations/009_email_verification_password_reset.sql` in phpMyAdmin.
2. In `config/config.local.php`: confirm `app.url`, uncomment and fill the `mail` block
   with a real SMTP account (for Gmail use an App Password).
3. Upload the files. Register a test account and confirm the email arrives.

## Local development

```bash
mysql -e "CREATE DATABASE budget_planner CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
mysql budget_planner < database/schema.sql && mysql budget_planner < database/seeds/001_reference_data.sql
mv config/config.local.php /somewhere/safe   # it points at production and overrides env vars
DB_NAME=budget_planner RELAX_THROTTLE=1 tools/dev_server.sh 8080   # emails -> storage/mail/
```

## Next steps

- Phase 2: Android app using this same PHP API (see TASK_STATE.json `next`).
- Optional: tie-break admin post ordering to remove the intermittent admin test.
