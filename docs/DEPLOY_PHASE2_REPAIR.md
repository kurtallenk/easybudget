# Deploying the Phase 2 API repair (InfinityFree)

Read the whole page once before starting. Nothing here deletes or resets data.

## What you upload
Use **`easybudgetplanner_phase2_api_repair_DEPLOY.zip`** (not the full project ZIP).
It is flat: its folders (`api/`, `includes/`, `database/`, `docs/`) go straight into `htdocs/`.
It does **not** contain `config/config.local.php`, so your live database settings are never overwritten.

Files in the deploy ZIP (all must be uploaded, overwriting the existing ones):

```
api/.htaccess
api/health.php                 (new)
api/bootstrap.php
api/auth/login.php
api/auth/password.php
api/auth/register.php
api/auth/session.php
api/auth/token.php             (new for Phase 2)
api/auth/refresh.php           (new for Phase 2)
api/auth/revoke.php            (new for Phase 2)
includes/api.php
includes/ApiTokens.php         (new for Phase 2)
includes/Auth.php
includes/AuthFlows.php
includes/Repositories.php
includes/Request.php           (identical to Phase 1, included to undo any earlier partial upload)
includes/Session.php           (identical to Phase 1, included to undo any earlier partial upload)
database/migrations/010_api_tokens.sql
```

Do **not** upload the Phase 2 ZIP you had before (`easybudgetplanner_phase2_api.zip`): it has an extra
`easybudgetplanner/` folder and its core files must not be mixed with Phase 1 files.

## Steps
1. **Back up first.** In the InfinityFree control panel open phpMyAdmin, select database
   `if0_42988195_budget_planner`, *Export* > *Quick* > *SQL* > *Go*. Keep the downloaded file.
   Also download your current `htdocs/` folder (File Manager > select all > download / or FTP).
2. **Database migration 010 (additive only).** phpMyAdmin > your database > *Import* > choose
   `database/migrations/010_api_tokens.sql` > *Go*. It only runs `CREATE TABLE IF NOT EXISTS api_tokens`
   and records `010_api_tokens` in `schema_migrations`. It does not touch users or any other table and
   is safe to run twice. (You can also paste the file's contents into the *SQL* tab.)
3. **Upload the files** from the deploy ZIP into `htdocs/`, keeping the folder structure, overwriting.
   Upload `includes/` first, then `api/` (the repaired code tolerates any upload order, but this is
   the cleanest).
4. **Check** `https://easybudgetplanner.freedev.app/api/health.php` in a browser. Expected:
   `"ok": true` and every value in `"checks"` is `true`. If `apiTokensTable` is `false`, step 2 was
   not applied. If a module/endpoint check is `false`, that file did not upload.
5. **Website check:** open the site in the browser you were already signed in with. You should
   still be signed in. Sign out, sign in again, and try "Forgot password".
6. **App check:** install the repaired APK, sign in, register, and request a password reset.

## Effects on users
- Existing website sessions are kept (session cookie, storage and lifetime unchanged).
- No account or budget data is changed. Step 2 only adds a new, empty table.

## Rollback
Re-upload the files you downloaded in step 1. The `api_tokens` table can stay (Phase 1 ignores it).
