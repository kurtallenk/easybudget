#!/usr/bin/env python3
"""
Runtime tests for the mobile (Android) API surface: bearer-token sign-in,
refresh rotation, revocation, per-user isolation (IDOR) and every feature
endpoint the app uses, run against a live dev server over HTTP.

  DB_CLI="mysql -u bp -pbp bp_test" python3 tools/mobile_api_tests.py [base-url]

Needs the dev server with MAIL_DRIVER=log and relaxed throttles (see
tools/auth_runtime_tests.py). DB_CLI is used to age tokens and read rows back.
"""
import email, glob, json, os, re, subprocess, sys, time, urllib.request, urllib.error
from email import policy

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8080").rstrip("/")
API = BASE + "/api"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MAIL_DIR = os.environ.get("MAIL_DIR", os.path.join(ROOT, "storage", "mail"))
DB_CLI = os.environ.get("DB_CLI") or sys.exit("set DB_CLI")
STAMP = f"{int(time.time())}{os.getpid()}"
PW = "CorrectHorse9!"
PASS = FAIL = 0
TODAY = time.strftime("%Y-%m-%d")
MONTH = TODAY[:7]


def say(t): print(f"\n\033[1m{t}\033[0m")
def ok(t):
    global PASS; PASS += 1; print(f"  \033[32mPASS\033[0m {t}")
def bad(t):
    global FAIL; FAIL += 1; print(f"  \033[31mFAIL\033[0m {t}")
def check(label, expected, actual):
    ok(label) if expected == actual else bad(f"{label} (expected {expected!r}, got {actual!r})")
def truthy(label, cond, extra=""):
    ok(label) if cond else bad(f"{label} {extra}")
def sql(q):
    out = subprocess.run(DB_CLI + " -N -B -e " + json.dumps(q), shell=True, capture_output=True, text=True)
    if out.returncode != 0: raise RuntimeError(out.stderr)
    return out.stdout.strip()


def raw(method, path, body=None, headers=None):
    data = None if body is None else json.dumps(body).encode()
    r = urllib.request.Request(API + path, data=data, method=method)
    r.add_header("Accept", "application/json")
    if body is not None: r.add_header("Content-Type", "application/json")
    for k, v in (headers or {}).items(): r.add_header(k, v)
    try:
        resp = urllib.request.urlopen(r, timeout=30); code = resp.status; b = resp.read(); h = resp.headers
    except urllib.error.HTTPError as e:
        code = e.code; b = e.read(); h = e.headers
    try: js = json.loads(b) if b else {}
    except Exception: js = {"_raw": b.decode(errors="replace")}
    return code, js, h


class App:
    """Behaves like the Android client: no cookies, X-EBP-Client header, bearer token."""
    def __init__(self): self.access = None; self.refresh = None
    def hdr(self, token=True, client=True):
        h = {"User-Agent": "EasyBudgetPlanner-Android/1.0 (tests)"}
        if client: h["X-EBP-Client"] = "android"
        if token and self.access: h["Authorization"] = "Bearer " + self.access
        return h
    def req(self, method, path, body=None, **kw):
        c, j, h = raw(method, path, body, self.hdr(**kw)); self.last_headers = h; return c, j
    def get(self, path, **kw): return self.req("GET", path, **kw)
    def post(self, path, body=None, **kw): return self.req("POST", path, {} if body is None else body, **kw)
    def login(self, addr, pw=PW):
        c, j = self.post("/auth/token.php", {"email": addr, "password": pw, "deviceName": "Pixel test"}, token=False)
        if c == 200:
            self.access = j["data"]["tokens"]["accessToken"]; self.refresh = j["data"]["tokens"]["refreshToken"]
        return c, j


def mails_for(addr, since):
    out = []
    for f in sorted(glob.glob(os.path.join(MAIL_DIR, "*.eml")), key=os.path.getmtime):
        if os.path.getmtime(f) < since - 0.01: continue
        with open(f, "rb") as fh: msg = email.message_from_binary_file(fh, policy=policy.default)
        if addr.lower() in str(msg["To"]).lower():
            out.append(msg.get_body(preferencelist=("plain",)).get_content())
    return out


def wait_token(addr, since, page):
    end = time.time() + 6
    while time.time() < end:
        for t in reversed(mails_for(addr, since)):
            m = re.search(r"/pages/" + re.escape(page) + r"\?token=([a-f0-9]{96})", t)
            if m: return m.group(1)
        time.sleep(0.2)
    return None


def make_user(tag):
    addr = f"mob-{tag}-{STAMP}@example.test"
    a = App(); since = time.time()
    c, j = a.post("/auth/register.php", {"email": addr, "password": PW, "passwordConfirm": PW, "displayName": "Mobile " + tag}, token=False)
    tok = wait_token(addr, since, "verify-email.html")
    c2, j2 = a.post("/auth/verify-email.php", {"token": tok}, token=False)
    return addr, a, c, c2, j2


# ===========================================================================
say("1. Registration and verification as the app (no cookies, no CSRF)")
addrA, A, c, c2, j2 = make_user("a")
check("register via X-EBP-Client without CSRF -> 201/200", True, c in (200, 201))
check("verify-email via app -> 200", 200, c2)
check("verify status", "verified", j2.get("data", {}).get("status"))
truthy("no Set-Cookie on API client responses", "Set-Cookie" not in str(A.last_headers))

c, j, _h = raw("POST", "/auth/register.php", {"email": f"x-{STAMP}@example.test", "password": PW, "passwordConfirm": PW},
           {"Origin": "https://evil.example"})
check("browser-style register without CSRF still rejected", True, c in (403, 419))

say("2. Token sign-in")
B = App()
addrU = f"mob-unverified-{STAMP}@example.test"
B.post("/auth/register.php", {"email": addrU, "password": PW, "passwordConfirm": PW}, token=False)
c, j = B.login(addrU)
check("unverified account cannot get tokens", 403, c)
check("unverified code", "email_unverified", j.get("error", {}).get("code"))
c, j = A.login(addrA, "WrongPassword1!")
check("wrong password -> 401", 401, c)
check("wrong password code", "invalid_credentials", j.get("error", {}).get("code"))
c, j, _h = raw("POST", "/auth/token.php", {"email": addrA, "password": PW})
check("token.php without X-EBP-Client rejected", True, c in (400, 419))
c, j = A.login(addrA)
check("token login -> 200", 200, c)
t = j.get("data", {}).get("tokens", {})
truthy("access token format", re.fullmatch(r"ebp_[0-9a-f]{96}", t.get("accessToken", "")) is not None)
truthy("refresh token format", re.fullmatch(r"ebp_[0-9a-f]{96}", t.get("refreshToken", "")) is not None)
check("tokenType", "Bearer", t.get("tokenType"))
check("access ttl", 3600, t.get("accessExpiresIn"))
check("user email returned", addrA, j["data"]["user"]["email"])
truthy("password hash never returned", "password" not in json.dumps(j["data"]["user"]).lower())
uidA = sql(f"SELECT id FROM users WHERE email='{addrA}'")
stored = sql(f"SELECT token_hash FROM api_tokens WHERE user_id={uidA} LIMIT 1")
truthy("only a hash is stored (no raw validator in DB)", t["accessToken"][36:] not in sql(f"SELECT GROUP_CONCAT(token_hash) FROM api_tokens WHERE user_id={uidA}") and len(stored) == 64)

say("3. Bearer access")
c, j = A.get("/bootstrap.php")
check("bootstrap with bearer -> 200", 200, c)
boot = j.get("data", {})
for k in ("settings", "categories", "accounts", "budgets", "bills", "recurring", "grocery", "groceryLists", "savedBudgets", "transactions"):
    truthy(f"bootstrap has {k}", k in boot, str(list(boot.keys())))
check("bootstrap csrfToken empty for app", "", boot.get("csrfToken", ""))
c, j = A.get("/auth/session.php")
check("session.php with bearer reports authenticated", True, j.get("data", {}).get("authenticated"))
c, j = A.get("/bootstrap.php", token=False)
check("no token -> 401", 401, c)
c, j, _h = raw("GET", "/bootstrap.php", None, {"Authorization": "Bearer ebp_" + "0" * 96})
check("forged token -> 401", 401, c)
c, j, _h = raw("GET", "/bootstrap.php", None, {"Authorization": "Bearer " + A.access[:-1] + ("0" if A.access[-1] != "0" else "1")})
check("tampered validator -> 401", 401, c)
c, j, _h = raw("GET", "/bootstrap.php", None, {"Authorization": "Bearer " + A.refresh})
check("refresh token not usable as access token", 401, c)
c, j, _h = raw("GET", "/bootstrap.php", None, {"X-EBP-Token": A.access})
check("X-EBP-Token header fallback works", 200, c)
cats = boot["categories"]
exp_cat = next(x["id"] for x in cats if x.get("kind") in ("expense", "both"))
inc_cat = next(x["id"] for x in cats if x.get("kind") in ("income", "both"))
c, j = A.post("/accounts/create.php", {"name": "Wallet", "type": "cash", "openingBalance": 100000})
check("create account", 201, c); acct = j["data"]["id"]
c, j = A.post("/accounts/create.php", {"name": ""})
check("account without name -> 422", 422, c)
c, j, _h = raw("POST", "/transactions/create.php", {"type": "expense", "amount": 100, "date": TODAY, "accountId": acct, "categoryId": exp_cat},
           {"Authorization": "Bearer " + A.access, "Origin": "https://evil.example"})
check("bearer write needs no CSRF and ignores Origin", 201, c)


say("4. Feature endpoints as the app")
c, j = A.post("/transactions/create.php", {"type": "expense", "amount": 1234, "date": TODAY, "description": "Coffee", "categoryId": exp_cat, "accountId": acct, "method": "Cash"})
check("create expense 201", 201, c); tx = j["data"]["id"]
c, j = A.post("/transactions/create.php", {"type": "expense", "amount": 1234, "date": TODAY, "description": "Coffee", "categoryId": exp_cat, "accountId": acct, "method": "Cash"})
check("duplicate -> 409", 409, c)
check("duplicate code", "duplicate_transaction", j.get("error", {}).get("code"))
c, j = A.post("/transactions/create.php", {"type": "income", "amount": 500000, "date": TODAY, "description": "Salary", "categoryId": inc_cat, "accountId": acct})
check("create income 201", 201, c); txi = j["data"]["id"]
c, j = A.post("/transactions/create.php", {"type": "expense", "amount": -5, "date": "2026-13-40"})
check("invalid amount/date -> 422", 422, c)
truthy("field errors returned", "amount" in j.get("error", {}).get("details", {}).get("fields", {}))
c, j = A.post(f"/transactions/update.php?id={tx}", {"amount": 1500, "description": "Coffee x2"})
check("update tx", (200, 1500), (c, j.get("data", {}).get("amount")))
c, j = A.get("/transactions/list.php?type=expense&perPage=5")
check("list expenses", 200, c); truthy("list has meta.total", "total" in j.get("meta", {}), str(j.get("meta")))
c, j = A.get("/reports/dashboard.php?month=" + MONTH)
check("dashboard report", 200, c)

c, j = A.post("/budgets/line.php", {"month": MONTH, "categoryId": exp_cat, "amount": 50000})
check("budget line", 200, c)
c, j = A.post("/budgets/plan.php", {"month": MONTH, "kind": "income", "rows": [{"label": "Salary", "amount": 500000}]})
check("budget income plan", 200, c)
c, j = A.get("/budgets/get.php?month=" + MONTH)
check("budget get", 200, c)
c, j = A.post("/saved-budgets/create.php", {"name": "Mobile template", "sourceMonth": MONTH, "lines": [{"categoryId": exp_cat, "amount": 50000}], "incomePlan": [{"label": "Salary", "amount": 500000}]})
check("saved budget create", 201, c); sb = j["data"]["id"]
c, j = A.get("/saved-budgets/list.php")
check("saved budget list contains it", True, any(x["id"] == sb for x in j["data"]))
c, j = A.post(f"/saved-budgets/load.php?id={sb}", {"month": MONTH})
check("saved budget load", 200, c)
c, j = A.post("/budgets/delete.php", {"month": MONTH})
check("clear working budget", True, c in (200, 204))

c, j = A.post("/bills/create.php", {"name": "Internet", "amount": 7999, "dueDate": TODAY, "categoryId": exp_cat, "accountId": acct, "repeat": "monthly", "reminderDays": 3})
check("bill create", 201, c); bill = j["data"]["id"]
c, j = A.post(f"/bills/pay.php?id={bill}", {"accountId": acct, "date": TODAY})
check("bill pay", 201, c)
c, j = A.post(f"/bills/unpay.php?id={bill}", {})
check("bill unpay", 200, c)

c, j = A.post("/recurring/create.php", {"name": "Gym", "type": "expense", "amount": 3000, "categoryId": exp_cat, "accountId": acct, "frequency": "monthly", "nextDate": TODAY, "autoPost": False})
check("recurring create", 201, c); rule = j["data"]["id"]
c, j = A.post(f"/recurring/pause.php?id={rule}", {"paused": True})
check("recurring pause", 200, c)

c, j = A.post("/grocery/create.php", {"name": "Milk", "categoryId": exp_cat})
check("grocery add", 201, c); g1 = j["data"]["id"]
c, j = A.post("/grocery/create.php", {"name": "Bread"})
g2 = j["data"]["id"]
c, j = A.post(f"/grocery/update.php?id={g1}", {"checked": True})
check("check without price -> 422", 422, c)
c, j = A.post(f"/grocery/update.php?id={g1}", {"checked": True, "price": 349})
check("check with price", (200, True, 349), (c, j["data"].get("checked"), j["data"].get("price")))
c, j = A.post("/grocery-lists/create.php", {"name": "Weekly", "items": [{"name": "Milk", "categoryId": exp_cat}, {"name": "Bread"}]})
check("saved grocery list create", 201, c); gl = j["data"]["id"]
c, j = A.post("/grocery/submit.php", {"accountId": acct, "date": TODAY, "method": "Cash", "items": [{"id": g1}]})
check("submit purchased items", 200, c) if c == 200 else check("submit purchased items", 201, c)
check("one expense created", 1, len(j.get("data", {}).get("transactions", [])))
c, j = A.post("/grocery/submit.php", {"accountId": acct, "date": TODAY, "items": [{"id": g1}]})
check("resubmit -> 409 grocery_changed", 409, c)
c, j = A.post(f"/grocery-lists/load.php?id={gl}", {"replace": True})
check("load saved list", 200, c)
check("loaded items unpurchased", True, all(not x["checked"] for x in j["data"]["grocery"]))
c, j = A.post("/grocery/clear.php", {})
check("clear grocery", 200, c)

say("5. Cross-user isolation (IDOR)")
addrB, Bv, *_ = make_user("b")
c, _ = Bv.login(addrB); check("user B login", 200, c)
for label, method, path, body in [
    ("read A's saved budget", "POST", f"/saved-budgets/load.php?id={sb}", {"month": MONTH}),
    ("update A's transaction", "POST", f"/transactions/update.php?id={tx}", {"amount": 1}),
    ("delete A's transaction", "POST", f"/transactions/delete.php?id={tx}", {}),
    ("pay A's bill", "POST", f"/bills/pay.php?id={bill}", {}),
    ("update A's bill", "POST", f"/bills/update.php?id={bill}", {"amount": 1}),
    ("pause A's recurring", "POST", f"/recurring/pause.php?id={rule}", {"paused": False}),
    ("update A's saved budget", "POST", f"/saved-budgets/update.php?id={sb}", {"name": "pwn"}),
    ("load A's grocery list", "POST", f"/grocery-lists/load.php?id={gl}", {}),
    ("update A's grocery list", "POST", f"/grocery-lists/update.php?id={gl}", {"name": "pwn"}),
    ("A's bill payments", "GET", f"/bills/payments.php?billId={bill}", None),
]:
    c, j = Bv.req(method, path, body)
    check(f"B cannot {label} -> 404", 404, c)
c, j = Bv.post("/transactions/create.php", {"type": "expense", "amount": 100, "date": TODAY, "categoryId": exp_cat, "accountId": acct})
check("B cannot use A's category/account id", True, c in (404, 422))
c, j = Bv.post("/accounts/create.php", {"name": "B wallet"}); acctB = j["data"]["id"]
catB = next(x["id"] for x in Bv.get("/categories/list.php")[1]["data"] if x.get("kind") in ("expense", "both"))
c, j = Bv.post("/transactions/create.php", {"type": "expense", "amount": 100, "date": TODAY, "accountId": acctB, "categoryId": catB, "user_id": int(uidA), "userId": int(uidA), "description": "spoof"})
uidB = sql(f"SELECT id FROM users WHERE email='{addrB}'")
check("user_id in body ignored", uidB, sql(f"SELECT user_id FROM transactions WHERE id='{j['data']['id']}'"))
c, j = Bv.get("/transactions/list.php?perPage=200")
truthy("B never sees A's rows", all(r["id"] not in (tx, txi) for r in j["data"]))
c, j = Bv.req("POST", "/saved-budgets/delete.php?id=" + sb, {})
c2, j2 = A.get("/saved-budgets/list.php")
check("B delete of A's saved budget is a no-op", True, any(x["id"] == sb for x in j2["data"]))
c, j = A.get("/transactions/list.php?perPage=200")
truthy("A's transaction still intact", any(r["id"] == tx and r["amount"] == 1500 for r in j["data"]))

say("6. Expiry, refresh rotation and reuse detection")
sql(f"UPDATE api_tokens SET expires_at = NOW() - INTERVAL 1 MINUTE WHERE user_id={uidA} AND kind='access'")
c, j = A.get("/bootstrap.php")
check("expired access -> 401 token_expired", (401, "token_expired"), (c, j.get("error", {}).get("code")))
old_refresh = A.refresh
c, j = A.post("/auth/refresh.php", {"refreshToken": old_refresh}, token=False)
check("refresh -> 200", 200, c)
A.access = j["data"]["tokens"]["accessToken"]; A.refresh = j["data"]["tokens"]["refreshToken"]
truthy("refresh rotated", A.refresh != old_refresh)
c, j = A.get("/bootstrap.php"); check("new access works", 200, c)
c, j = A.post("/auth/refresh.php", {"refreshToken": old_refresh}, token=False)
check("reusing old refresh -> 401", 401, c)
c, j = A.get("/bootstrap.php")
check("reuse detection revoked the whole family", 401, c)
c, j = A.post("/auth/refresh.php", {"refreshToken": A.refresh}, token=False)
check("rotated refresh also revoked", 401, c)
c, j = A.post("/auth/refresh.php", {"refreshToken": "garbage"}, token=False)
check("garbage refresh -> 401", 401, c)
A.login(addrA)
sql(f"UPDATE api_tokens SET expires_at = NOW() - INTERVAL 1 MINUTE WHERE user_id={uidA} AND kind='refresh' AND revoked_at IS NULL")
c, j = A.post("/auth/refresh.php", {"refreshToken": A.refresh}, token=False)
check("expired refresh -> 401", 401, c)

say("7. Logout, password change, reset, deactivation")
A.login(addrA); A2 = App(); A2.login(addrA)
c, j = A.post("/auth/revoke.php", {"refreshToken": A.refresh})
check("revoke -> 200", 200, c)
c, j = A.get("/bootstrap.php"); check("revoked access -> 401", 401, c)
c, j = A.post("/auth/refresh.php", {"refreshToken": A.refresh}, token=False); check("revoked refresh -> 401", 401, c)
c, j = A2.get("/bootstrap.php"); check("other device unaffected by logout", 200, c)

NEWPW = "BatteryStaple7?"
A.login(addrA)
c, j = A.post("/auth/password.php", {"currentPassword": PW, "newPassword": NEWPW})
check("change password via app", 200, c)
nt = j.get("data", {}).get("tokens") or {}
truthy("fresh tokens reissued", bool(nt.get("accessToken")))
c, j = A2.get("/bootstrap.php"); check("other device signed out after password change", 401, c)
c, j = A.get("/bootstrap.php"); check("old token of this device revoked", 401, c)
A.access, A.refresh = nt.get("accessToken"), nt.get("refreshToken")
c, j = A.get("/bootstrap.php"); check("reissued token works", 200, c)
c, j = A.login(addrA, PW); check("old password rejected", 401, c)
c, j = A.login(addrA, NEWPW); check("new password works", 200, c)

since = time.time()
c, j = A.post("/auth/forgot-password.php", {"email": addrA}, token=False)
check("forgot-password via app", 200, c)
rtok = wait_token(addrA, since, "reset-password.html")
truthy("reset email sent", rtok is not None)
c, j = A.post("/auth/reset-check.php", {"token": rtok}, token=False); check("reset-check", 200, c)
c, j = A.post("/auth/reset-password.php", {"token": rtok, "password": PW, "passwordConfirm": PW}, token=False)
check("reset-password via app", 200, c)
c, j = A.get("/bootstrap.php"); check("reset revokes app tokens", 401, c)
c, j = A.login(addrA, PW); check("login with reset password", 200, c)

sql(f"UPDATE users SET status='suspended' WHERE id={uidA}")
c, j = A.get("/bootstrap.php"); check("deactivated user's token rejected", 401, c)
c, j = A.post("/auth/refresh.php", {"refreshToken": A.refresh}, token=False); check("deactivated user cannot refresh", 401, c)
sql(f"UPDATE users SET status='active' WHERE id={uidA}")

say("8. Web session unaffected")
c, j, h = raw("GET", "/auth/session.php")
truthy("browser session still mints CSRF", bool(j["data"]["csrfToken"]))
c, j, h = raw("POST", "/transactions/create.php", {"type": "expense", "amount": 1, "date": TODAY})
check("browser write without session -> 401/419", True, c in (401, 403, 419))

print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
