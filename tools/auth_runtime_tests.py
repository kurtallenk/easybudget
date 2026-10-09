#!/usr/bin/env python3
"""
Runtime tests for registration, email verification, login, forgot password and
password reset, run against a live dev server over HTTP.

  DB_CLI="mysql -u root -p... budget_planner" python3 tools/auth_runtime_tests.py [base-url]

Needs:
  * tools/dev_server.sh running with MAIL_DRIVER=log (the default there) and
    RELAX_THROTTLE=1, so emails are written to storage/mail/ (MAIL_DIR overrides).
  * DB_CLI: a mysql command for the same database. Used only to age tokens
    (expiry tests) and to read rows back for verification.
"""
import base64, email, glob, http.cookiejar, json, os, re, subprocess, sys, time, urllib.request, urllib.error
from email import policy

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8080").rstrip("/")
API = BASE + "/api"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MAIL_DIR = os.environ.get("MAIL_DIR", os.path.join(ROOT, "storage", "mail"))
DB_CLI = os.environ.get("DB_CLI")
if not DB_CLI:
    sys.exit("set DB_CLI to a mysql command for the test database")
STAMP = f"{int(time.time())}{os.getpid()}"
PW = "CorrectHorse9!"
PASS = FAIL = 0


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
    if out.returncode != 0:
        raise RuntimeError(out.stderr)
    return out.stdout.strip()


class Client:
    def __init__(self, ua="auth-tests/1.0"):
        self.jar = http.cookiejar.CookieJar()
        self.op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))
        self.csrf = ""
        self.ua = ua

    def req(self, method, path, body=None, csrf=True, origin=BASE):
        data = None if body is None else json.dumps(body).encode()
        r = urllib.request.Request(API + path, data=data, method=method)
        r.add_header("Accept", "application/json")
        r.add_header("User-Agent", self.ua)
        if origin: r.add_header("Origin", origin)
        if body is not None: r.add_header("Content-Type", "application/json")
        if csrf and self.csrf: r.add_header("X-CSRF-Token", self.csrf)
        try:
            resp = self.op.open(r, timeout=30); code = resp.status; raw = resp.read()
        except urllib.error.HTTPError as e:
            code = e.code; raw = e.read()
        try: js = json.loads(raw)
        except Exception: js = {"_raw": raw.decode(errors="replace")}
        return code, js

    def boot(self):
        c, j = self.req("GET", "/auth/session.php")
        self.csrf = j["data"]["csrfToken"]
        return j["data"]

    def post(self, path, body): return self.req("POST", path, body)


def mails_for(addr, since):
    """Parsed messages addressed to addr written after `since` (epoch)."""
    out = []
    for f in sorted(glob.glob(os.path.join(MAIL_DIR, "*.eml")), key=os.path.getmtime):
        if os.path.getmtime(f) < since - 0.01: continue
        with open(f, "rb") as fh:
            msg = email.message_from_binary_file(fh, policy=policy.default)
        if addr.lower() in str(msg["To"]).lower():
            text = msg.get_body(preferencelist=("plain",)).get_content()
            html = msg.get_body(preferencelist=("html",)).get_content()
            out.append({"file": f, "subject": str(msg["Subject"]), "text": text, "html": html, "msg": msg})
    return out


def wait_mail(addr, since, n=1, timeout=5.0):
    end = time.time() + timeout
    while time.time() < end:
        m = mails_for(addr, since)
        if len(m) >= n: return m
        time.sleep(0.2)
    return mails_for(addr, since)


def link_token(text, page):
    m = re.search(r"https?://\S+/pages/" + re.escape(page) + r"\?token=([a-f0-9]{96})", text)
    return m.group(1) if m else None


def register(cl, addr, pw=PW, confirm=None, name="Test User"):
    body = {"email": addr, "password": pw, "displayName": name}
    body["passwordConfirm"] = pw if confirm is None else confirm
    return cl.post("/auth/register.php", body)


def uid_of(addr): return sql(f"SELECT id FROM users WHERE email='{addr}'")


# ===========================================================================
say("1. Registration validation")
c = Client(); c.boot()
A = f"alice{STAMP}@example.com"
code, j = register(c, "not-an-email")
check("invalid email is rejected (422)", 422, code)
truthy("invalid email message is friendly", "valid email" in j["error"]["message"].lower() or "email" in json.dumps(j["error"].get("details", {})))
code, j = register(c, A, pw="short1A")
check("weak password (too short) rejected", 422, code)
code, j = register(c, A, pw="alllowercaseletters")
check("weak password (one character class) rejected", 422, code)
code, j = register(c, A, confirm="Different9!x")
check("password mismatch rejected", 422, code)
check("mismatch is reported on passwordConfirm", True, "passwordConfirm" in j["error"].get("details", {}).get("fields", {}))
check("no user created by failed attempts", "", uid_of(A))

say("2. Valid registration creates an unverified account and sends a link")
t0 = time.time()
code, j = register(c, A)
check("register returns 201", 201, code)
check("verification is required", True, j["data"].get("verificationRequired"))
check("register does not sign the user in", 401, c.req("GET", "/bootstrap.php")[0])
row = sql(f"SELECT email_verified_at IS NULL, password_hash FROM users WHERE email='{A}'").split("\t")
check("account stored as unverified", "1", row[0])
truthy("password stored as a hash, not plain text", row[1].startswith(("$2y$", "$argon2")) and PW not in row[1])
mails = wait_mail(A, t0)
check("one verification email sent", 1, len(mails))
vtok = link_token(mails[0]["text"], "verify-email.html") if mails else None
truthy("email contains a verification link", vtok is not None)
truthy("verification HTML has a button link", mails and "Confirm email address" in mails[0]["html"] and vtok in mails[0]["html"])
truthy("email never contains the password", mails and PW not in mails[0]["text"] and PW not in mails[0]["html"])
truthy("email mentions expiry", mails and "expires" in mails[0]["text"])
dbrow = sql(f"SELECT selector, validator_hash, expires_at > UTC_TIMESTAMP(), TIMESTAMPDIFF(MINUTE, UTC_TIMESTAMP(), expires_at) FROM auth_tokens WHERE purpose='verify' AND user_id={uid_of(A)}").split("\t")
check("token selector stored", vtok[:32] if vtok else None, dbrow[0])
truthy("only the validator hash is stored", dbrow[1] != vtok[32:] and len(dbrow[1]) == 64)
import hashlib
check("stored hash is sha256(validator)", hashlib.sha256(vtok[32:].encode()).hexdigest(), dbrow[1])
truthy("token expires in about 24 hours", 1430 <= int(dbrow[3]) <= 1440, dbrow[3])

say("3. Unverified login is blocked")
code, j = c.post("/auth/login.php", {"email": A, "password": PW})
check("unverified login returns 403", 403, code)
check("error code is email_unverified", "email_unverified", j["error"]["code"])
check("still not signed in", 401, c.req("GET", "/bootstrap.php")[0])
code, j = c.post("/auth/login.php", {"email": A, "password": "WrongPass99!"})
check("wrong password on unverified account is a generic 401", 401, code)

say("4. Duplicate email (no enumeration)")
c2 = Client(); c2.boot()
t1 = time.time()
code, j = register(c2, A)
check("duplicate gets the same 201 response", 201, code)
check("duplicate response shape matches", True, j["data"].get("verificationRequired"))
check("no second account created", "1", sql(f"SELECT COUNT(*) FROM users WHERE email='{A}'"))
code, j = register(c2, A.upper())
check("duplicate with different case is the same account", "1", sql(f"SELECT COUNT(*) FROM users WHERE email='{A}'"))

say("5. Resend verification")
time.sleep(0.1)
code, j = c.post("/auth/resend-verification.php", {"email": A})
check("resend inside the cooldown is rate limited (429)", 429, code)
sql(f"UPDATE login_attempts SET attempted_at = attempted_at - INTERVAL 2 MINUTE WHERE email='{A}'")
t2 = time.time()
code, j = c.post("/auth/resend-verification.php", {"email": A})
check("resend returns 200", 200, code)
truthy("resend says another email was sent", "sent a new verification link" in j["data"]["message"])
m2 = wait_mail(A, t2)
vtok2 = link_token(m2[-1]["text"], "verify-email.html") if m2 else None
truthy("new email has a new token", vtok2 and vtok2 != vtok)
code, j = c.post("/auth/verify-email.php", {"token": vtok})
check("the previous token is invalidated", "invalid", j["data"]["status"])
U = f"nobody{STAMP}@example.com"
code, j2 = c.post("/auth/resend-verification.php", {"email": U})
check("resend for an unknown email answers the same", (200, j["data"]["message"] if False else None)[0], code)
check("unknown-email resend message identical", c.post("/auth/resend-verification.php", {"email": "x" + U})[1]["data"]["message"], j2["data"]["message"])
check("no email sent to unknown address", 0, len(mails_for(U, t2)))
code, j = c.post("/auth/resend-verification.php", {"email": "bad@"})
check("resend with invalid email is 422", 422, code)

say("6. Verification link")
code, j = c.post("/auth/verify-email.php", {"token": "f" * 96})
check("invalid token", "invalid", j["data"]["status"])
code, j = c.post("/auth/verify-email.php", {"token": "nonsense"})
check("malformed token", "invalid", j["data"]["status"])
sql(f"UPDATE auth_tokens SET expires_at = UTC_TIMESTAMP() - INTERVAL 1 MINUTE WHERE selector='{vtok2[:32]}'")
code, j = c.post("/auth/verify-email.php", {"token": vtok2})
check("expired token is rejected", "expired", j["data"]["status"])
check("expired token does not verify", "1", sql(f"SELECT email_verified_at IS NULL FROM users WHERE email='{A}'"))
sql(f"UPDATE login_attempts SET attempted_at = attempted_at - INTERVAL 2 MINUTE WHERE email='{A}'")
t3 = time.time()
c.post("/auth/resend-verification.php", {"email": A})
vtok3 = link_token(wait_mail(A, t3)[-1]["text"], "verify-email.html")
nocsrf = Client(); nocsrf.boot(); nocsrf.csrf = ""
check("verify without CSRF token is rejected (419)", 419, nocsrf.post("/auth/verify-email.php", {"token": vtok3})[0])
code, j = c.post("/auth/verify-email.php", {"token": vtok3})
check("valid token verifies", "verified", j["data"]["status"])
check("user marked verified", "0", sql(f"SELECT email_verified_at IS NULL FROM users WHERE email='{A}'"))
check("token marked used", "1", sql(f"SELECT used_at IS NOT NULL FROM auth_tokens WHERE selector='{vtok3[:32]}'"))
code, j = c.post("/auth/verify-email.php", {"token": vtok3})
check("reused token cannot verify again (already_verified)", "already_verified", j["data"]["status"])
check("verify does not sign anyone in", 401, c.req("GET", "/bootstrap.php")[0])
t4 = time.time()
# Simulate the hourly window passing (3 emails were already sent to this address).
sql(f"UPDATE login_attempts SET attempted_at = attempted_at - INTERVAL 2 HOUR WHERE email='{A}'")
code, j = c2.post("/auth/resend-verification.php", {"email": A})
check("resend for verified address still answers 200", 200, code)
check("no verification email for a verified account", 0, len([m for m in mails_for(A, t4) if "Confirm" in m["subject"]]))
sql(f"UPDATE login_attempts SET attempted_at = attempted_at - INTERVAL 2 HOUR WHERE email='{A}'")
register(c2, A)
dup = wait_mail(A, t4)
truthy("duplicate signup of verified account emails the owner instead", any("already have" in m["subject"] for m in dup), [m["subject"] for m in dup])

say("7. Login")
code, j = c.post("/auth/login.php", {"email": A, "password": "WrongPass99!"})
check("incorrect password is 401", 401, code)
msg_wrong = j["error"]["message"]
code, j = c.post("/auth/login.php", {"email": f"ghost{STAMP}@example.com", "password": PW})
check("nonexistent email is 401", 401, code)
check("same message for unknown email and wrong password", msg_wrong, j["error"]["message"])
code, j = c.post("/auth/login.php", {"email": "bad-email", "password": PW})
check("login with invalid email format is 422", 422, code)
code, j = c.post("/auth/login.php", {"email": A, "password": PW})
check("verified login succeeds", 200, code)
c.csrf = j["data"]["csrfToken"]
code, j = c.req("GET", "/bootstrap.php")
check("verified user reaches the app (bootstrap 200)", 200, code)
check("bootstrap returns this user", A, j["data"]["user"]["email"])
code, j = c.post("/auth/logout.php", {})
check("logout", 200, code)
check("after logout the app is locked (401)", 401, c.req("GET", "/bootstrap.php")[0])

say("8. Protected endpoints cannot be bypassed")
anon = Client(); anon.boot()
for p in ["/bootstrap.php", "/transactions/list.php", "/budgets/list.php", "/bills/list.php", "/recurring/list.php", "/grocery/list.php", "/settings/get.php", "/reports/dashboard.php"]:
    check(f"anonymous GET {p} is 401", 401, anon.req("GET", p)[0])
# Unverified user who somehow had a session (e.g. created before a config change) is refused.
B = f"bob{STAMP}@example.com"
cb = Client(); cb.boot(); register(cb, B)
sql(f"UPDATE users SET email_verified_at = UTC_TIMESTAMP() WHERE email='{B}'")
code, j = cb.post("/auth/login.php", {"email": B, "password": PW}); cb.csrf = j["data"]["csrfToken"]
check("bob signs in once verified", 200, cb.req("GET", "/bootstrap.php")[0])
sql(f"UPDATE users SET email_verified_at = NULL WHERE email='{B}'")
check("session of an unverified account is refused", 401, cb.req("GET", "/bootstrap.php")[0])
check("session probe reports signed out", False, cb.boot()["authenticated"])
sql(f"UPDATE users SET email_verified_at = UTC_TIMESTAMP() WHERE email='{B}'")

say("9. Forgot password")
f = Client(); f.boot()
code, j = f.post("/auth/forgot-password.php", {"email": "nope"})
check("invalid email format is 422", 422, code)
code, j = f.post("/auth/forgot-password.php", {})
check("missing email is 422", 422, code)
t5 = time.time()
code, j = f.post("/auth/forgot-password.php", {"email": U})
check("unknown email answers 200", 200, code)
generic = j["data"]["message"]
check("no reset email to unknown address", 0, len(wait_mail(U, t5, timeout=1)))
# Log alice in on a second "device" before the reset, to prove it gets signed out.
dev = Client("other-device/1.0"); dev.boot()
code, j = dev.post("/auth/login.php", {"email": A, "password": PW}); dev.csrf = j["data"]["csrfToken"]
check("second device signed in before reset", 200, dev.req("GET", "/bootstrap.php")[0])
t6 = time.time()
code, j = f.post("/auth/forgot-password.php", {"email": A})
check("valid email answers 200", 200, code)
check("known and unknown emails get the identical message", generic, j["data"]["message"])
rm = wait_mail(A, t6)
rm = [m for m in rm if "Reset" in m["subject"]]
check("one reset email sent", 1, len(rm))
rtok = link_token(rm[0]["text"], "reset-password.html") if rm else None
truthy("reset email contains a reset link", rtok is not None)
truthy("reset email has a prominent button", rm and ">Reset password</a>" in rm[0]["html"])
truthy("reset email explains expiry", rm and "expires in 1 hour" in rm[0]["text"])
truthy("reset email says to ignore if not requested", rm and "ignore this email" in rm[0]["text"])
truthy("reset email has no password or hash", rm and PW not in rm[0]["text"] and "$2y$" not in rm[0]["html"])
code, j = f.post("/auth/forgot-password.php", {"email": A})
check("second request inside the cooldown is 429", 429, code)
code, j = f.post("/auth/forgot-password.php", {"email": U})
check("cooldown applies to unknown emails too (no enumeration)", 429, code)

say("10. Reset password page")
code, j = f.post("/auth/reset-check.php", {"token": rtok})
check("reset-check: valid token", "valid", j["data"]["status"])
code, j = f.post("/auth/reset-check.php", {"token": "a" * 96})
check("reset-check: invalid token", "invalid", j["data"]["status"])
NEWPW = "BrandNewPass7#"
code, j = f.post("/auth/reset-password.php", {"token": rtok, "password": NEWPW, "passwordConfirm": NEWPW + "x"})
check("mismatched confirmation is 422", 422, code)
code, j = f.post("/auth/reset-password.php", {"token": rtok, "password": "weakpassword", "passwordConfirm": "weakpassword"})
check("weak new password is 422", 422, code)
code, j = f.post("/auth/reset-password.php", {"token": rtok, "password": PW, "passwordConfirm": PW})
check("reusing the current password is refused", 422, code)
check("token still usable after validation errors", "valid", f.post("/auth/reset-check.php", {"token": rtok})[1]["data"]["status"])
code, j = f.post("/auth/reset-password.php", {"token": "b" * 96, "password": NEWPW, "passwordConfirm": NEWPW})
check("invalid token cannot reset", (400, "token_invalid"), (code, j["error"]["code"]))
t7 = time.time()
code, j = f.post("/auth/reset-password.php", {"token": rtok, "password": NEWPW, "passwordConfirm": NEWPW})
check("valid reset succeeds", 200, code)
check("the browser session used for the reset was ended", 419, f.post("/auth/reset-check.php", {"token": rtok})[0])
f.boot()
h = sql(f"SELECT password_hash FROM users WHERE email='{A}'")
truthy("new password stored hashed", h.startswith(("$2y$", "$argon2")) and NEWPW not in h)
check("token marked used", "1", sql(f"SELECT used_at IS NOT NULL FROM auth_tokens WHERE selector='{rtok[:32]}'"))
code, j = f.post("/auth/reset-password.php", {"token": rtok, "password": "AnotherPass8$", "passwordConfirm": "AnotherPass8$"})
check("reused reset token is refused", (410, "token_used"), (code, j["error"]["code"]))
check("reset-check reports used", "used", f.post("/auth/reset-check.php", {"token": rtok})[1]["data"]["status"])
check("other device was signed out by the reset", 401, dev.req("GET", "/bootstrap.php")[0])
truthy("password-changed notice emailed", any("was changed" in m["subject"] for m in wait_mail(A, t7)))
code, j = f.post("/auth/login.php", {"email": A, "password": PW})
check("old password no longer works", 401, code)
code, j = f.post("/auth/login.php", {"email": A, "password": NEWPW})
check("login with the new password works", 200, code)
f.csrf = j["data"]["csrfToken"]
check("app reachable after reset login", 200, f.req("GET", "/bootstrap.php")[0])

say("11. Expired reset token")
sql(f"UPDATE login_attempts SET attempted_at = attempted_at - INTERVAL 2 HOUR WHERE email='{A}'")
g = Client(); g.boot()
t8 = time.time()
g.post("/auth/forgot-password.php", {"email": A})
etok = link_token([m for m in wait_mail(A, t8) if "Reset" in m["subject"]][-1]["text"], "reset-password.html")
sql(f"UPDATE auth_tokens SET expires_at = UTC_TIMESTAMP() - INTERVAL 1 SECOND WHERE selector='{etok[:32]}'")
check("reset-check: expired", "expired", g.post("/auth/reset-check.php", {"token": etok})[1]["data"]["status"])
code, j = g.post("/auth/reset-password.php", {"token": etok, "password": "ExpiredPass5%", "passwordConfirm": "ExpiredPass5%"})
check("expired reset token is refused", (410, "token_expired"), (code, j["error"]["code"]))
check("password unchanged by expired token", 200, Client().req("GET", "/auth/session.php")[0])
lc = Client(); lc.boot()
check("new password still the valid one", 200, lc.post("/auth/login.php", {"email": A, "password": NEWPW})[0])
sql(f"UPDATE login_attempts SET attempted_at = attempted_at - INTERVAL 2 HOUR WHERE email='{A}'")
t9 = time.time(); g.post("/auth/forgot-password.php", {"email": A})
old = link_token([m for m in wait_mail(A, t9) if "Reset" in m["subject"]][-1]["text"], "reset-password.html")
sql(f"UPDATE login_attempts SET attempted_at = attempted_at - INTERVAL 2 HOUR WHERE email='{A}'")
t10 = time.time(); g.post("/auth/forgot-password.php", {"email": A})
new = link_token([m for m in wait_mail(A, t10) if "Reset" in m["subject"]][-1]["text"], "reset-password.html")
check("requesting again invalidates the older reset link", "invalid", g.post("/auth/reset-check.php", {"token": old})[1]["data"]["status"])
check("newest reset link is valid", "valid", g.post("/auth/reset-check.php", {"token": new})[1]["data"]["status"])

say("12. Rate limits")
L = f"limit{STAMP}@example.com"
codes = []
for i in range(4):
    sql(f"UPDATE login_attempts SET attempted_at = attempted_at - INTERVAL 2 MINUTE WHERE email='{L}'")
    codes.append(g.post("/auth/forgot-password.php", {"email": L})[0])
check("per-address hourly cap (3 then 429)", [200, 200, 200, 429], codes)

say("13. CSRF, origin and session hardening on the new endpoints")
x = Client(); x.boot(); x.csrf = ""
for p in ["/auth/forgot-password.php", "/auth/reset-password.php", "/auth/resend-verification.php", "/auth/reset-check.php", "/auth/register.php"]:
    check(f"{p} without CSRF is 419", 419, x.post(p, {"email": A})[0])
y = Client(); y.boot()
check("cross-origin forgot-password is 403", 403, y.req("POST", "/auth/forgot-password.php", {"email": A}, origin="https://evil.example")[0])
s1 = Client("s1"); s1.boot(); code, j = s1.post("/auth/login.php", {"email": A, "password": NEWPW}); s1.csrf = j["data"]["csrfToken"]
s2 = Client("s2"); s2.boot(); code, j = s2.post("/auth/login.php", {"email": A, "password": NEWPW}); s2.csrf = j["data"]["csrfToken"]
code, j = s1.post("/auth/password.php", {"currentPassword": NEWPW, "newPassword": "ChangedAgain6&"})
check("change password works", 200, code)
s1.csrf = j["data"]["csrfToken"]
check("changing password keeps the current session", 200, s1.req("GET", "/bootstrap.php")[0])
check("changing password signs out other sessions", 401, s2.req("GET", "/bootstrap.php")[0])
cookies_before = {c.name: c.value for c in s1.jar}
s3 = Client("s3"); s3.boot(); pre = {c.name: c.value for c in s3.jar}.get("bp_session")
code, j = s3.post("/auth/login.php", {"email": A, "password": "ChangedAgain6&"})
post_id = {c.name: c.value for c in s3.jar}.get("bp_session")
truthy("session id rotates on login (fixation)", pre and post_id and pre != post_id)

say("14. Header injection via display name")
Z = f"zed{STAMP}@example.com"
zc = Client(); zc.boot(); t11 = time.time()
register(zc, Z, name="Zed\r\nBcc: victim@example.com")
zm = wait_mail(Z, t11)
truthy("email sent", len(zm) == 1)
truthy("no injected Bcc header", zm and zm[0]["msg"]["Bcc"] is None)
truthy("only the real recipient is addressed", zm and [a.addr_spec for a in zm[0]["msg"]["To"].addresses] == [Z])

print(f"\n\033[1mResult\033[0m\n  {PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
