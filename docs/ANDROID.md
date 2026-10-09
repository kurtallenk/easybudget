<!-- Copy of EasyBudgetPlanner/README.md, kept with the backend docs. -->
# Easy Budget Planner for Android

Native Android client (Kotlin, Jetpack Compose, Material 3) for the Easy Budget Planner PHP
site. It uses the same PHP API and the same MySQL database as the website, through HTTPS only.
**The app contains no database credentials or server secrets**: it only knows the site URL.

- Package: `app.freedev.easybudgetplanner` (debug builds: `app.freedev.easybudgetplanner.debug`)
- Version: `1.0.0` (versionCode `1`), minSdk 24 (Android 7.0), target/compile SDK 35
- API: `https://easybudgetplanner.freedev.app/` by default (`gradle.properties`, `ebp.apiBaseUrl`)

## Features

Sign in, create account, email confirmation (resend), forgot password; dashboard (month
summary, budget progress, upcoming bills, top spending, recent activity); expenses and income
(add, edit, delete, search, filter, paging, duplicate warning); monthly budget (category limits,
planned income, save as template, saved budgets table with preview, load, update and delete,
clear); bills (add, edit, delete, mark paid, undo payment); recurring items (add, edit, pause,
resume, post due now, delete); Live Grocery List (add, tick with price, untick, delete, submit
purchased items to expenses with a confirmation and summary, save list, saved lists table with
preview, load and delete, clear); accounts; change password; sign out.

## Architecture

```
app/src/main/java/app/freedev/easybudgetplanner/
  EbpApplication.kt, MainActivity.kt   app start, splash screen, edge to edge
  data/ApiClient.kt      OkHttp client: JSON envelope, errors, bearer token, refresh, host challenge
  data/HostChallenge.kt  solves the InfinityFree "aes.js" cookie check natively
  data/BudgetApi.kt      one function per PHP endpoint
  data/Models.kt         kotlinx.serialization models (money in minor units)
  data/TokenStore.kt     EncryptedSharedPreferences (Android Keystore AES-256-GCM)
  data/SessionManager.kt signed in / out state, shared reference data
  data/AppContainer.kt   manual DI, server URL, network monitor
  ui/                    Compose screens + view models, shared components, theme
```

- Every request sends `X-EBP-Client: android`, User-Agent `EasyBudgetPlanner-Android/<version>` and
  `Authorization: Bearer <token>` (also `X-EBP-Token` and an `ebp_at` cookie, for hosts that strip
  `Authorization` or every non-standard header; repair 2026-10-05). The server recognises the app by the
  header **or** the User-Agent, and accepts the `ebp_at` cookie from the app only. No cookie session and
  no CSRF token is ever used for the app.
- A redirect (3xx) is never followed; the app shows "The server is not ready for the app yet" (on
  InfinityFree a missing endpoint redirects to an HTML 404 page).
- Deployment self-check: `GET /api/health.php` (see `docs/DEPLOY_PHASE2_REPAIR.md`).
- Expired access tokens (`401 token_expired`) are refreshed once with the rotating refresh
  token (concurrent calls share a single refresh) and the call is retried. Any other `401`
  signs the user out locally and returns to the sign-in screen with a notice.
- Redirects are never followed with a token attached. Release builds allow HTTPS only
  (`network_security_config.xml`); debug builds also allow `10.0.2.2`, `127.0.0.1` and
  `localhost` so you can test against a local PHP server.
- Offline: a banner shows when there is no network, screens keep what they loaded and offer
  Retry, and an offline start keeps the session. Writes need a connection.
- Double submits are blocked (buttons disable while a write runs) and editors ask before
  discarding unsaved changes on Back. Back from any tab returns to Home, then leaves the app.
- Validation mirrors the server (amounts, dates, required fields, password policy); the server
  stays authoritative and its field errors are shown next to the fields.
- Phones use a bottom navigation bar; screens 600dp and wider (tablets, landscape) use a
  navigation rail, and content width is capped so it stays readable.

Dependencies: AndroidX Core, Activity Compose, Lifecycle, Navigation Compose, Compose BOM
2024.12.01 (Material 3), core-splashscreen, security-crypto 1.1.0-alpha06, OkHttp 4.12.0,
kotlinx.serialization 1.7.3, kotlinx.coroutines 1.9.0, desugar_jdk_libs. Tests: JUnit 4,
Robolectric 4.14.1, Compose UI test, OkHttp MockWebServer.

## Build

Requirements: JDK 17, Android SDK with `platforms;android-35` and `build-tools;35.0.0`
(Android Studio Ladybug or newer works). Gradle 8.11.1 is provided by the wrapper.

```bash
echo "sdk.dir=/path/to/Android/sdk" > local.properties   # or set ANDROID_HOME
./gradlew assembleDebug
# APK: app/build/outputs/apk/debug/app-debug.apk
```

Point a build at another server (for example a staging copy):

```bash
./gradlew assembleDebug -Pebp.apiBaseUrl=https://staging.example.com/
```

Debug builds also show a "Server" field on the sign-in screen (for example
`http://10.0.2.2:8080/` from the emulator to a PHP dev server on your computer). Release builds
ignore that setting and always use `ebp.apiBaseUrl`.

### Release build and signing

No signing credentials are included. Create your own upload key once and keep it safe (losing
it means you cannot update the app on Google Play):

```bash
keytool -genkeypair -v -keystore ebp-release.jks -alias ebp -keyalg RSA -keysize 4096 -validity 10000
```

Create `keystore.properties` next to `settings.gradle.kts` (it is git-ignored, never commit it):

```
storeFile=ebp-release.jks
storePassword=...
keyAlias=ebp
keyPassword=...
```

Then build a signed, minified release:

```bash
./gradlew assembleRelease   # app/build/outputs/apk/release/app-release.apk
./gradlew bundleRelease     # app/build/outputs/bundle/release/app-release.aab (Google Play)
```

Without `keystore.properties` the release APK is built unsigned. Before publishing, raise
`versionCode` and `versionName` in `app/build.gradle.kts`.

## Server requirements

The PHP site must include the mobile endpoints (`api/auth/token.php`, `refresh.php`,
`revoke.php`) and migration `database/migrations/010_api_tokens.sql` must be applied. See
`docs/ANDROID.md` and `docs/API.md` in the website project.

## Tests

```bash
./gradlew testDebugUnitTest                         # unit + MockWebServer tests only
../../proj/tools/android_tests.sh http://127.0.0.1:8080/  # plus live API, UI flows, screenshots
```

The live tests need the PHP dev server with `MAIL_DRIVER=log` (they confirm the test accounts
by reading the emails it writes). Screenshots for six device sizes are written to
`app/build/screenshots/` (or `$SHOTS`).
