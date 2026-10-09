#!/usr/bin/env bash
# ===========================================================================
# Runtime test suite - exercises the live API over HTTP.
#
# Usage:  tools/runtime_tests.sh [base-url]
# Default base-url: http://127.0.0.1:8080
#
# Assumes the PHP dev server is already serving the project root and that the
# database is loaded (database/schema.sql + database/seeds).
# New accounts must confirm their email: the dev server writes emails to
# storage/mail/ (MAIL_DRIVER=log), and verify_and_login reads the link there.
# Override the folder with MAIL_DIR. Auth-specific cases: tools/auth_runtime_tests.py
# Mirrors the scenarios in docs/TESTING.md.
# ===========================================================================
set -uo pipefail

BASE="${1:-http://127.0.0.1:8080}"
API="$BASE/api"
TMP="$(mktemp -d)"
PASS=0; FAIL=0
STAMP="$(date +%s)$$"
TODAY="$(date +%Y-%m-%d)"
YESTERDAY="$(date -d '-1 day' +%Y-%m-%d)"
MONTH="$(date +%Y-%m)"

cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok()   { PASS=$((PASS+1)); printf '  \033[32mPASS\033[0m %s\n' "$*"; }
bad()  { FAIL=$((FAIL+1)); printf '  \033[31mFAIL\033[0m %s\n' "$*"; }

# check <label> <expected> <actual>
check() { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (expected $2, got $3)"; fi; }
# contains <label> <needle> <haystack>
contains() { case "$3" in *"$2"*) ok "$1";; *) bad "$1 (missing '$2' in ${3:0:200})";; esac; }

# --- session helpers -------------------------------------------------------
# Each user gets a cookie jar and a CSRF token file.
jar()   { echo "$TMP/$1.jar"; }
token() { cat "$TMP/$1.csrf"; }

bootstrap() {                       # bootstrap <user-slug>
  local u="$1"
  curl -s -c "$(jar "$u")" -b "$(jar "$u")" "$API/auth/session.php" \
    | python3 -c 'import json,sys;print(json.load(sys.stdin)["data"]["csrfToken"])' > "$TMP/$u.csrf"
}

# req <user> <METHOD> <path> [json-body]  -> body on stdout.
# The status code goes to $TMP/status, because req is normally called inside a
# command substitution and a subshell cannot export a variable to its parent.
# Read it with  status  immediately afterwards.
req() {
  local u="$1" m="$2" path="$3" body="${4:-}"
  local out="$TMP/body"
  local args=(-s -o "$out" -w '%{http_code}'
              -c "$(jar "$u")" -b "$(jar "$u")"
              -X "$m" -H "Origin: $BASE" -H "X-CSRF-Token: $(token "$u")")
  if [ -n "$body" ]; then args+=(-H 'Content-Type: application/json' -d "$body"); fi
  curl "${args[@]}" "$API$path" > "$TMP/status"
  cat "$out"
}

status() { cat "$TMP/status"; }

MAIL_DIR="${MAIL_DIR:-$(cd "$(dirname "$0")/.." && pwd)/storage/mail}"
# verify_and_login <user-slug> <email>: follows the newest verification link
# emailed to <email>, then signs in (the session is refreshed afterwards).
verify_and_login() {
  local u="$1" addr="$2" tok=""
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    tok="$(python3 - "$MAIL_DIR" "$addr" <<'PY'
import email, glob, os, re, sys
from email import policy
d, addr = sys.argv[1], sys.argv[2].lower()
tok = ""
for f in sorted(glob.glob(os.path.join(d, "*.eml")), key=os.path.getmtime):
    m = email.message_from_binary_file(open(f, "rb"), policy=policy.default)
    if addr in str(m["To"]).lower():
        t = re.search(r"verify-email\.html\?token=([a-f0-9]{96})", m.get_body(preferencelist=("plain",)).get_content())
        if t: tok = t.group(1)
print(tok)
PY
)"
    [ -n "$tok" ] && break; sleep 0.3
  done
  req "$u" POST /auth/verify-email.php "{\"token\":\"$tok\"}" > /dev/null
  bootstrap "$u"
  req "$u" POST /auth/login.php "{\"email\":\"$addr\",\"password\":\"CorrectHorse9!\"}" > /dev/null
  bootstrap "$u"
}

# json <expr> reads stdin
json() { python3 -c "import json,sys
try: d=json.load(sys.stdin)
except Exception: print('<not-json>'); raise SystemExit
try: print($1)
except Exception as e: print('<missing>')"; }

# ===========================================================================
say "1. Bootstrap and CSRF"
bootstrap alice
[ -s "$TMP/alice.csrf" ] && ok "session.php issues a CSRF token" || bad "no CSRF token"

R="$(curl -s -o /dev/null -w '%{http_code}' -c "$(jar nocsrf)" -b "$(jar nocsrf)" \
      -X POST -H "Origin: $BASE" -H 'Content-Type: application/json' \
      -d '{"email":"x@example.com","password":"CorrectHorse9!"}' "$API/auth/register.php")"
check "register without a CSRF token is rejected" "419" "$R"

R="$(curl -s -o /dev/null -w '%{http_code}' -c "$(jar alice)" -b "$(jar alice)" \
      -X POST -H 'Origin: https://evil.example' -H "X-CSRF-Token: $(token alice)" \
      -H 'Content-Type: application/json' -d '{}' "$API/auth/register.php")"
check "cross-origin write is rejected" "403" "$R"

say "2. Registration and validation"
B="$(req alice POST /auth/register.php '{"email":"not-an-email","password":"CorrectHorse9!"}')"
check "invalid email is a 422" "422" "$(status)"
B="$(req alice POST /auth/register.php "{\"email\":\"alice$STAMP@example.com\",\"password\":\"short\"}")"
check "weak password is a 422" "422" "$(status)"

ALICE="alice$STAMP@example.com"
B="$(req alice POST /auth/register.php "{\"email\":\"$ALICE\",\"password\":\"CorrectHorse9!\",\"displayName\":\"Alice\"}")"
check "registration succeeds" "201" "$(status)"
contains "registration asks for email verification" '"verificationRequired":true' "$B"
R="$(req alice GET /bootstrap.php > /dev/null; status)"
check "registration does not sign in before verification" "401" "$R"

B="$(req alice POST /auth/register.php "{\"email\":\"$ALICE\",\"password\":\"CorrectHorse9!\"}")"
check "duplicate email gets the generic answer (no enumeration)" "201" "$(status)"
verify_and_login alice "$ALICE"
R="$(req alice GET /bootstrap.php > /dev/null; status)"
check "verified user signs in" "200" "$R"

say "3. Defaults provisioned for a new user"
B="$(req alice GET /categories/list.php)"
check "categories list is 200" "200" "$(status)"
N="$(echo "$B" | json 'len(d["data"]["categories"]) if isinstance(d["data"],dict) and "categories" in d["data"] else len(d["data"])')"
[ "$N" -gt 0 ] 2>/dev/null && ok "default categories seeded ($N)" || bad "no default categories"

B="$(req alice GET /settings/get.php)"
check "settings load" "200" "$(status)"
contains "settings carry a currency" 'currency' "$B"

say "4. Accounts"
B="$(req alice POST /accounts/create.php '{"name":"Everyday","type":"cash","openingBalance":100000}')"
check "create account" "201" "$(status)"
ACC="$(echo "$B" | json 'd["data"]["account"]["id"] if "account" in d["data"] else d["data"]["id"]')"
[ -n "$ACC" ] && ok "account id returned ($ACC)" || bad "no account id"

B="$(req alice POST /accounts/create.php '{"name":"Everyday","type":"cash"}')"
check "duplicate account name is rejected" "422" "$(status)"

B="$(req alice POST /accounts/create.php '{"name":"Savings","type":"savings","openingBalance":500000}')"
ACC2="$(echo "$B" | json 'd["data"]["account"]["id"] if "account" in d["data"] else d["data"]["id"]')"

say "5. Transactions"
INCAT="$(req alice GET /categories/list.php | json '[c["id"] for c in (d["data"]["categories"] if "categories" in d["data"] else d["data"]) if c.get("kind")=="income"][0]')"
CAT="$(req alice GET /categories/list.php | json '[c["id"] for c in (d["data"]["categories"] if "categories" in d["data"] else d["data"]) if c.get("kind")=="expense"][0]')"
B="$(req alice POST /transactions/create.php "{\"type\":\"expense\",\"amount\":2550,\"accountId\":\"$ACC\",\"categoryId\":\"$CAT\",\"date\":\"$(date +%Y-%m-%d)\",\"note\":\"Coffee\"}")"
check "create expense" "201" "$(status)"
TX="$(echo "$B" | json 'd["data"]["transaction"]["id"] if "transaction" in d["data"] else d["data"]["id"]')"

B="$(req alice POST /transactions/create.php "{\"type\":\"expense\",\"amount\":-5,\"accountId\":\"$ACC\",\"categoryId\":\"$CAT\",\"date\":\"$TODAY\"}")"
check "negative amount is rejected" "422" "$(status)"

B="$(req alice POST /transactions/create.php "{\"type\":\"transfer\",\"amount\":10000,\"accountId\":\"$ACC\",\"toAccountId\":\"$ACC\",\"date\":\"$TODAY\"}")"
check "transfer to the same account is rejected" "422" "$(status)"

B="$(req alice POST /transactions/create.php "{\"type\":\"transfer\",\"amount\":10000,\"accountId\":\"$ACC\",\"toAccountId\":\"$ACC2\",\"date\":\"$TODAY\"}")"
check "transfer between accounts" "201" "$(status)"

B="$(req alice GET '/transactions/list.php?page=1&perPage=1')"
check "paginated list" "200" "$(status)"
contains "pagination metadata present" 'total' "$B"

say "6. Reports"
for r in dashboard month categories series networth bills budget; do
  B="$(req alice GET "/reports/$r.php?month=$(date +%Y-%m)")"
  check "reports/$r" "200" "$(status)"
done
BAL="$(req alice GET /accounts/list.php | json '[a for a in (d["data"]["accounts"] if "accounts" in d["data"] else d["data"]) if a["id"]=="'"$ACC"'"][0]["balance"]')"
check "balance = 100000 - 2550 - 10000" "87450" "$BAL"

say "7. Budgets"
B="$(req alice POST /budgets/line.php "{\"month\":\"$MONTH\",\"categoryId\":\"$CAT\",\"amount\":50000}")"
[ "$(status)" = "200" ] || [ "$(status)" = "201" ] && ok "set a budget line ($(status))" || bad "budget line failed ($(status))"
B="$(req alice GET "/budgets/get.php?month=$MONTH")"
contains "budget reflects the line" '50000' "$B"

say "8. Goals - the double-count regression"
B="$(req alice POST /goals/create.php '{"name":"Laptop","target":200000}')"
check "create goal" "201" "$(status)"
GOAL="$(echo "$B" | json 'd["data"]["goal"]["id"] if "goal" in d["data"] else d["data"]["id"]')"
B="$(req alice POST /goals/contribute.php "{\"goalId\":\"$GOAL\",\"amount\":25000,\"accountId\":\"$ACC\",\"categoryId\":\"$CAT\"}")"
check "contribute to goal" "201" "$(status)"
CUR="$(req alice GET /goals/list.php | json '[g for g in (d["data"]["goals"] if "goals" in d["data"] else d["data"]) if g["id"]=="'"$GOAL"'"][0]["current"]')"
check "goal counted the contribution exactly once" "25000" "$CUR"

say "9. Bills - idempotent payment"
DUE="$(date +%Y-%m-%d)"
B="$(req alice POST /bills/create.php "{\"name\":\"Internet\",\"amount\":39900,\"dueDate\":\"$DUE\",\"repeat\":\"monthly\",\"accountId\":\"$ACC\",\"categoryId\":\"$CAT\"}")"
check "create bill" "201" "$(status)"
BILL="$(echo "$B" | json 'd["data"]["bill"]["id"] if "bill" in d["data"] else d["data"]["id"]')"
B="$(req alice POST /bills/pay.php "{\"id\":\"$BILL\"}")"
check "pay bill" "201" "$(status)"
NEXTDUE="$(req alice GET /bills/list.php | json '[b for b in (d["data"]["bills"] if "bills" in d["data"] else d["data"]) if b["id"]=="'"$BILL"'"][0]["dueDate"]')"
[ "$NEXTDUE" != "$DUE" ] && ok "due date rolled forward ($DUE -> $NEXTDUE)" || bad "due date did not advance"
B="$(req alice POST /bills/unpay.php "{\"id\":\"$BILL\"}")"
check "unpay restores the occurrence" "200" "$(status)"
B="$(req alice POST /bills/pay.php "{\"id\":\"$BILL\"}")"
check "re-pay after unpay" "201" "$(status)"
B="$(req alice POST /bills/pay.php "{\"id\":\"$BILL\",\"date\":\"$DUE\"}")"
# the bill has advanced, so this is a new occurrence, not a duplicate
[ "$(status)" = "201" ] || [ "$(status)" = "409" ] && ok "second pay handled deterministically ($(status))" || bad "unexpected $(status)"

say "10. Recurring - idempotency"
B="$(req alice POST /recurring/create.php "{\"name\":\"Salary\",\"type\":\"income\",\"amount\":300000,\"frequency\":\"monthly\",\"nextDate\":\"$YESTERDAY\",\"accountId\":\"$ACC\",\"categoryId\":\"$INCAT\"}")"
check "create recurring rule" "201" "$(status)"
B="$(req alice GET /recurring/preview.php)"
check "preview due rules" "200" "$(status)"
B="$(req alice POST /recurring/run.php '{}')"
check "run posts due rules" "200" "$(status)"
P1="$(echo "$B" | json 'd["data"].get("posted", d["data"])')"
B="$(req alice POST /recurring/run.php '{}')"
P2="$(echo "$B" | json 'd["data"].get("posted", d["data"])')"
[ "$P2" = "0" ] || [ "$P2" = "[]" ] && ok "second run posts nothing (idempotent)" || bad "second run posted again: $P2"

say "11. Tenant isolation"
BOB="bob$STAMP@example.com"
bootstrap bob
B="$(req bob POST /auth/register.php "{\"email\":\"$BOB\",\"password\":\"CorrectHorse9!\"}")"
check "second user registers" "201" "$(status)"
verify_and_login bob "$BOB"
B="$(req bob GET "/accounts/list.php")"
contains "bob cannot see alice's account" '"accounts": []' "$(echo "$B" | python3 -c 'import json,sys;d=json.load(sys.stdin);print(json.dumps({"accounts":d["data"]["accounts"] if "accounts" in d["data"] else d["data"]}))')"
B="$(req bob POST /accounts/update.php "{\"id\":\"$ACC\",\"name\":\"Hijacked\"}")"
check "bob cannot update alice's account" "404" "$(status)"
B="$(req bob POST /transactions/delete.php "{\"id\":\"$TX\"}")"
check "bob cannot delete alice's transaction" "404" "$(status)"
B="$(req bob POST /transactions/create.php "{\"type\":\"expense\",\"amount\":100,\"accountId\":\"$ACC\",\"categoryId\":\"$CAT\",\"date\":\"$TODAY\"}")"
check "bob cannot post into alice's account" "404" "$(status)"

say "12. Auth lifecycle"
B="$(req alice POST /auth/logout.php '{}')"
check "logout" "200" "$(status)"
bootstrap alice
B="$(req alice GET /accounts/list.php)"
check "protected route needs a session" "401" "$(status)"
B="$(req alice POST /auth/login.php "{\"email\":\"$ALICE\",\"password\":\"wrong-password\"}")"
check "wrong password is 401" "401" "$(status)"
bootstrap alice
B="$(req alice POST /auth/login.php "{\"email\":\"$ALICE\",\"password\":\"CorrectHorse9!\"}")"
check "login" "200" "$(status)"
bootstrap alice
B="$(req alice GET /accounts/list.php)"
check "session restored" "200" "$(status)"

say "13. Referential integrity on delete"
B="$(req alice POST /accounts/delete.php "{\"id\":\"$ACC2\",\"mode\":\"keep\"}")"
check "delete account, keep transactions" "200" "$(status)"
NTRANSFER="$(req alice GET '/transactions/list.php?perPage=200' | json 'len([t for t in (d["data"]["transactions"] if "transactions" in d["data"] else d["data"]) if t["type"]=="transfer"])')"
check "one-legged transfers are removed" "0" "$NTRANSFER"
B="$(req alice GET /transactions/list.php)"
check "ledger still loads after detach" "200" "$(status)"
B="$(req alice POST /goals/delete.php "{\"id\":\"$GOAL\"}")"
check "delete goal" "200" "$(status)"
B="$(req alice POST /bills/delete.php "{\"id\":\"$BILL\"}")"
check "delete bill" "200" "$(status)"
B="$(req alice POST /accounts/delete.php "{\"id\":\"$ACC\",\"mode\":\"delete\"}")"
check "delete account and its transactions" "200" "$(status)"

say "14. Data tools"
B="$(req alice GET /data/counts.php)";  check "counts"  "200" "$(status)"
B="$(req alice GET /data/export.php)";  check "export"  "200" "$(status)"
B="$(req alice POST /data/reset.php '{"confirm":"RESET"}')"
[ "$(status)" = "200" ] && ok "reset" || bad "reset ($(status))"

say "Result"
printf '  %d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
