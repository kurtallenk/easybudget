#!/usr/bin/env bash
# ===========================================================================
# Round 10 runtime tests - notification read sync + Super Admin security.
#
# Usage:  DB_CLI="mysql -u root -p… budget_planner" tools/admin_runtime_tests.sh [base-url]
#
# Needs a running dev server (tools/dev_server.sh) with migration 008 applied.
# DB_CLI is used ONLY to promote the test admin (the app has no promote API
# by design) and to read rows back for verification.
# ===========================================================================
set -uo pipefail
BASE="${1:-http://127.0.0.1:8080}"; API="$BASE/api"
DB_CLI="${DB_CLI:?set DB_CLI to a mysql command for the test database}"
TMP="$(mktemp -d)"; PASS=0; FAIL=0; STAMP="$(date +%s)$$"
trap 'rm -rf "$TMP"' EXIT
say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok()   { PASS=$((PASS+1)); printf '  \033[32mPASS\033[0m %s\n' "$*"; }
bad()  { FAIL=$((FAIL+1)); printf '  \033[31mFAIL\033[0m %s\n' "$*"; }
check() { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (expected $2, got $3)"; fi; }
jar()   { echo "$TMP/$1.jar"; }
token() { cat "$TMP/$1.csrf"; }
bootstrap() { curl -s -c "$(jar "$1")" -b "$(jar "$1")" "$API/auth/session.php" \
  | python3 -c 'import json,sys;print(json.load(sys.stdin)["data"]["csrfToken"])' > "$TMP/$1.csrf"; }
req() { local u="$1" m="$2" path="$3" body="${4:-}" out="$TMP/body"
  local args=(-s -o "$out" -w '%{http_code}' -c "$(jar "$u")" -b "$(jar "$u")" -X "$m" -H "Origin: $BASE" -H "X-CSRF-Token: $(token "$u")")
  [ -n "$body" ] && args+=(-H 'Content-Type: application/json' -d "$body")
  curl "${args[@]}" "$API$path" > "$TMP/status"; cat "$out"; }
status() { cat "$TMP/status"; }
json() { python3 -c "import json,sys
try: d=json.load(sys.stdin)
except Exception: print('<not-json>'); raise SystemExit
try: print($1)
except Exception as e: print('<missing>')"; }
sql() { $DB_CLI -N -B -e "$1"; }
# Registration no longer signs in: confirm the address (by SQL here; the link
# flow itself is covered by tools/auth_runtime_tests.py), then sign in.
register() { bootstrap "$1"; req "$1" POST /auth/register.php "{\"email\":\"$2\",\"password\":\"CorrectHorse9!\",\"displayName\":\"$3\"}" >/dev/null
  sql "UPDATE users SET email_verified_at = UTC_TIMESTAMP() WHERE email = '$2'"
  bootstrap "$1"; req "$1" POST /auth/login.php "{\"email\":\"$2\",\"password\":\"CorrectHorse9!\"}" >/dev/null; bootstrap "$1"; }
login() { bootstrap "$1"; req "$1" POST /auth/login.php "{\"email\":\"$2\",\"password\":\"CorrectHorse9!\"}" >/dev/null; bootstrap "$1"; }

ADMIN="admin$STAMP@example.com"; U1="user1$STAMP@example.com"; U2="user2$STAMP@example.com"
register admin "$ADMIN" "Ada Admin"; register u1 "$U1" "Uma User"; register u2 "$U2" "Otto Other"
UID1="$(sql "SELECT id FROM users WHERE email='$U1'")"; UID2="$(sql "SELECT id FROM users WHERE email='$U2'")"

# ===========================================================================
say "1. Read/unread state lives in the database (cross-device)"
B="$(req u1 GET /notifications/list.php)"; check "list is 200" 200 "$(status)"
N="$(echo "$B" | json 'len(d["data"])')"; [ "$N" -ge 1 ] 2>/dev/null && ok "inbox has $N items (feed)" || bad "empty inbox"
FIRST="$(echo "$B" | json 'd["data"][0]["id"]')"
check "all start unread" 0 "$(echo "$B" | json 'sum(1 for x in d["data"] if x["read"])')"
B="$(req u1 POST /notifications/read.php "{\"ids\":[\"$FIRST\"]}")"; check "mark one read is 200" 200 "$(status)"
check "response shows it read" True "$(echo "$B" | json "[x['read'] for x in d['data'] if x['id']=='$FIRST'][0]")"
check "row stored in notifications table" 1 "$(sql "SELECT COUNT(*) FROM notifications WHERE user_id=$UID1 AND id='$FIRST' AND read_at IS NOT NULL")"
login u1dev2 "$U1"   # second browser/device: separate cookie jar, fresh login
B="$(req u1dev2 GET /notifications/list.php)"
check "second device sees the same read state" True "$(echo "$B" | json "[x['read'] for x in d['data'] if x['id']=='$FIRST'][0]")"
check "second device unread count = N-1" "$((N-1))" "$(echo "$B" | json 'sum(1 for x in d["data"] if not x["read"])')"
B="$(req u2 GET /notifications/list.php)"
check "other user is unaffected (per-user state)" 0 "$(echo "$B" | json 'sum(1 for x in d["data"] if x["read"])')"
B="$(req u1 POST /notifications/read.php "{\"ids\":[\"$FIRST\"]}")"
check "marking again is idempotent (one row)" 1 "$(sql "SELECT COUNT(*) FROM notifications WHERE user_id=$UID1 AND id='$FIRST'")"
B="$(req u1 POST /notifications/read.php '{"ids":["does-not-exist"]}')"
check "unknown ids are ignored (no row created)" 0 "$(sql "SELECT COUNT(*) FROM notifications WHERE user_id=$UID1 AND id='does-not-exist'")"
B="$(req u1 POST /notifications/read.php '{"ids":["bad id!"]}')"; check "invalid id is a 422" 422 "$(status)"
B="$(req u1 POST /notifications/read.php '{"ids":[]}')"; check "empty list is a 422" 422 "$(status)"
R="$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "Origin: $BASE" -H 'Content-Type: application/json' -d '{"all":true}' "$API/notifications/read.php")"
check "signed-out mark-read is rejected" 419 "$R"
R="$(curl -s -o /dev/null -w '%{http_code}' "$API/notifications/list.php")"; check "signed-out list is a 401" 401 "$R"
B="$(req u1dev2 POST /notifications/read.php '{"all":true}')"; check "Mark all as read is 200" 200 "$(status)"
B="$(req u1 GET /notifications/list.php)"
check "Mark all as read persisted (seen from device 1)" 0 "$(echo "$B" | json 'sum(1 for x in d["data"] if not x["read"])')"
req u1 POST /auth/logout.php '{}' >/dev/null; login u1 "$U1"
B="$(req u1 GET /notifications/list.php)"
check "state survives logout/login" 0 "$(echo "$B" | json 'sum(1 for x in d["data"] if not x["read"])')"

# ===========================================================================
say "2. Normal users cannot reach Super Admin APIs (server-side)"
B="$(req u1 GET /auth/session.php)"; check "session flags normal user as not admin" False "$(echo "$B" | json 'd["data"]["user"]["isSuperAdmin"]')"
for p in "GET /admin/overview.php" "GET /admin/users.php"; do set -- $p; req u1 "$1" "$2" >/dev/null; check "normal user $1 $2 is 403" 403 "$(status)"; done
req u1 POST /admin/posts/create.php '{"kind":"message","type":"message","title":"Hack","body":"x","audience":"all"}' >/dev/null
check "normal user cannot send a message" 403 "$(status)"
req u1 POST /admin/posts/create.php '{"kind":"news","type":"feature","title":"Hack","body":"x"}' >/dev/null
check "normal user cannot publish news" 403 "$(status)"
check "nothing was written" 0 "$(sql "SELECT COUNT(*) FROM admin_posts WHERE title='Hack'")"
req u1 POST /admin/posts/create.php '{"kind":"message","type":"message","title":"Hack","body":"x","audience":"all","role":"super_admin","isSuperAdmin":true}' >/dev/null
check "client-supplied role flags are ignored (403)" 403 "$(status)"
R="$(curl -s -o /dev/null -w '%{http_code}' "$API/admin/overview.php")"; check "signed-out admin API is a 401" 401 "$R"
check "denials are audited" 1 "$(sql "SELECT COUNT(*)>0 FROM audit_logs WHERE user_id=$UID1 AND action='admin.denied'")"

# ===========================================================================
say "3. Super Admin (promoted by SQL only)"
req admin GET /admin/overview.php >/dev/null; check "before promotion the admin-to-be is also 403" 403 "$(status)"
sql "UPDATE users SET role='super_admin' WHERE email='$ADMIN'"
B="$(req admin GET /auth/session.php)"; check "session flags the Super Admin" True "$(echo "$B" | json 'd["data"]["user"]["isSuperAdmin"]')"
B="$(req admin GET /admin/overview.php)"; check "overview is 200" 200 "$(status)"
B="$(req admin GET "/admin/users.php?q=user1$STAMP")"; check "user search is 200" 200 "$(status)"
check "search finds exactly the user" "$U1" "$(echo "$B" | json 'd["data"][0]["email"] if len(d["data"])==1 else len(d["data"])')"
check "no password hash leaves the API" "False" "$(echo "$B" | json '"password" in json.dumps(d).lower()')"
req admin POST /admin/posts/create.php '{"kind":"message","type":"message","title":"","body":"x","audience":"all"}' >/dev/null
check "empty title is a 422" 422 "$(status)"
req admin POST /admin/posts/create.php '{"kind":"message","type":"feature","title":"T","body":"x","audience":"all"}' >/dev/null
check "news-only type on a message is a 422" 422 "$(status)"
req admin POST /admin/posts/create.php '{"kind":"message","type":"message","title":"T","body":"x","audience":"selected","userIds":[]}' >/dev/null
check "selected with no users is a 422" 422 "$(status)"
req admin POST /admin/posts/create.php '{"kind":"news","type":"feature","title":"T","body":"x","link":"javascript:alert(1)"}' >/dev/null
check "javascript: link is rejected" 422 "$(status)"

B="$(req admin POST /admin/posts/create.php '{"kind":"message","type":"important","title":"Budget system maintenance","body":"Tonight 10pm.","audience":"all"}')"
check "message to all users is 201" 201 "$(status)"; MALL="$(echo "$B" | json 'd["data"]["id"]')"
B="$(req admin POST /admin/posts/create.php "{\"kind\":\"message\",\"type\":\"message\",\"title\":\"Hello Uma\",\"body\":\"Just for you.\",\"audience\":\"selected\",\"userIds\":[$UID1]}")"
check "message to a specific user is 201" 201 "$(status)"; MSEL="$(echo "$B" | json 'd["data"]["id"]')"
check "recipient count 1" 1 "$(echo "$B" | json 'd["data"]["recipientCount"]')"
B="$(req admin POST /admin/posts/create.php '{"kind":"news","type":"feature","title":"NEW FEATURE ADDED","body":"Savings Goals have been improved.","details":"More charts.","link":"goals"}')"
check "news publish is 201" 201 "$(status)"; NEWS="$(echo "$B" | json 'd["data"]["id"]')"
check "news is always for all users" all "$(echo "$B" | json 'd["data"]["audience"]')"
check "posts persisted in admin_posts" 3 "$(sql "SELECT COUNT(*) FROM admin_posts WHERE id IN ('$MALL','$MSEL','$NEWS')")"

say "4. Delivery to inboxes"
B="$(req u1 GET /notifications/list.php)"
check "user1 gets the all-users message (unread)" False "$(echo "$B" | json "[x['read'] for x in d['data'] if x['id']=='$MALL'][0]")"
check "user1 gets the selected message" 1 "$(echo "$B" | json "sum(1 for x in d['data'] if x['id']=='$MSEL')")"
check "user1 gets the news with route" goals "$(echo "$B" | json "[x['route'] for x in d['data'] if x['id']=='$NEWS'][0]")"
check "user1 unread count = 3 new items" 3 "$(echo "$B" | json 'sum(1 for x in d["data"] if not x["read"])')"
check "newest first" "$NEWS" "$(echo "$B" | json 'd["data"][0]["id"]')"
B="$(req u2 GET /notifications/list.php)"
check "user2 does NOT get user1's message" 0 "$(echo "$B" | json "sum(1 for x in d['data'] if x['id']=='$MSEL')")"
check "user2 gets the all-users message" 1 "$(echo "$B" | json "sum(1 for x in d['data'] if x['id']=='$MALL')")"
req u2 POST /notifications/read.php "{\"ids\":[\"$MSEL\"]}" >/dev/null
check "user2 cannot create a delivery for user1's message" 0 "$(sql "SELECT COUNT(*) FROM notifications WHERE user_id=$UID2 AND id='$MSEL'")"
req u1 POST /notifications/read.php "{\"ids\":[\"$MSEL\",\"$MALL\"]}" >/dev/null
B="$(req u1dev2 GET /notifications/list.php)"
check "admin items read state syncs across devices" 1 "$(echo "$B" | json 'sum(1 for x in d["data"] if not x["read"])')"
B="$(req admin GET /admin/overview.php)"
check "admin sees read count" 1 "$(echo "$B" | json "[x['readCount'] for x in d['data']['posts'] if x['id']=='$MSEL'][0]")"

say "5. Manage (edit / delete) + authorization"
req u1 POST /admin/posts/update.php "{\"id\":\"$NEWS\",\"title\":\"pwned\"}" >/dev/null; check "normal user cannot edit" 403 "$(status)"
req u1 POST /admin/posts/delete.php "{\"id\":\"$NEWS\"}" >/dev/null; check "normal user cannot delete" 403 "$(status)"
B="$(req admin POST /admin/posts/update.php "{\"id\":\"$NEWS\",\"title\":\"Savings Goals improved\",\"type\":\"update\"}")"
check "admin edit is 200" 200 "$(status)"
B="$(req u1 GET /notifications/list.php)"
check "users see the edited title" "Savings Goals improved" "$(echo "$B" | json "[x['title'] for x in d['data'] if x['id']=='$NEWS'][0]")"
req admin POST /admin/posts/update.php "{\"id\":\"$NEWS\",\"type\":\"important\"}" >/dev/null; check "invalid type on edit is 422" 422 "$(status)"
req admin POST /admin/posts/delete.php "{\"id\":\"$MSEL\"}" >/dev/null; check "admin delete is 200" 200 "$(status)"
check "delete removes deliveries" 0 "$(sql "SELECT COUNT(*) FROM notifications WHERE id='$MSEL'")"
B="$(req u1 GET /notifications/list.php)"; check "deleted message gone from inbox" 0 "$(echo "$B" | json "sum(1 for x in d['data'] if x['id']=='$MSEL')")"
req admin POST /admin/posts/delete.php "{\"id\":\"$MSEL\"}" >/dev/null; check "delete twice is 404" 404 "$(status)"
R="$(curl -s -o /dev/null -w '%{http_code}' -c "$(jar admin)" -b "$(jar admin)" -X POST -H 'Origin: https://evil.example' -H "X-CSRF-Token: $(token admin)" -H 'Content-Type: application/json' -d '{"kind":"news","type":"feature","title":"x","body":"x"}' "$API/admin/posts/create.php")"
check "cross-origin admin write is rejected" 403 "$R"
R="$(curl -s -o /dev/null -w '%{http_code}' -c "$(jar admin)" -b "$(jar admin)" -X POST -H "Origin: $BASE" -H 'Content-Type: application/json' -d '{"kind":"news","type":"feature","title":"x","body":"x"}' "$API/admin/posts/create.php")"
check "admin write without CSRF token is rejected" 419 "$R"
sql "UPDATE users SET role='user' WHERE email='$ADMIN'"
req admin GET /admin/overview.php >/dev/null; check "demotion takes effect on the next request" 403 "$(status)"
req u1 POST /data/reset.php '{"confirm":"RESET"}' >/dev/null
check "data reset keeps inbox read state" 1 "$(sql "SELECT COUNT(*)>0 FROM notifications WHERE user_id=$UID1")"

say "Result"; echo "  $PASS passed, $FAIL failed"; [ "$FAIL" = 0 ]
