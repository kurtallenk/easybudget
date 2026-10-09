import json, glob, os, re, time, urllib.request, urllib.error, http.cookiejar, subprocess, email
from email import policy
PASS=[]; FAIL=[]
def check(label, cond, extra=""):
    (PASS if cond else FAIL).append(label); print(("  PASS " if cond else "  FAIL ")+label+("" if cond else f"  -> {extra}"))
def sql(q, db="ebp_test"):
    r=subprocess.run(["sudo","mysql","-S","/run/mysqld/mysqld.sock","-N","-B",db,"-e",q],capture_output=True,text=True)
    if r.returncode: raise RuntimeError(r.stderr)
    return r.stdout.strip()
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*a,**k): return None
def _do(opener, method, url, body, headers):
    data=None if body is None else (body if isinstance(body,bytes) else json.dumps(body).encode())
    r=urllib.request.Request(url,data=data,method=method)
    for k,v in headers.items(): r.add_header(k,v)
    try: resp=opener.open(r,timeout=60); code=resp.status; b=resp.read(); h=resp.headers
    except urllib.error.HTTPError as e: code=e.code; b=e.read(); h=e.headers
    ct=h.get("Content-Type","")
    try: js=json.loads(b) if b else None
    except Exception: js=None
    return code, js, ct, b
class Browser:
    """Website client: cookie jar, Origin header, CSRF token from session.php (like assets/js/api.js)."""
    def __init__(self, base, ua="Mozilla/5.0 TestBrowser"):
        self.base=base.rstrip("/"); self.jar=http.cookiejar.CookieJar(); self.ua=ua
        self.op=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar), NoRedirect)
        self.csrf=None
    def req(self, method, path, body=None, csrf=True):
        h={"Accept":"application/json","User-Agent":self.ua,"Origin":self.base}
        if body is not None: h["Content-Type"]="application/json"
        if csrf and self.csrf and method!="GET": h["X-CSRF-Token"]=self.csrf
        return _do(self.op, method, self.base+"/"+path.lstrip("/"), body, h)
    def session(self):
        c,js,ct,b=self.req("GET","api/auth/session.php")
        if js and js.get("ok"): self.csrf=js["data"].get("csrfToken") or self.csrf
        return c,js
    def cookie(self, name="bp_session"):
        for ck in self.jar:
            if ck.name==name: return ck.value
class App:
    """Android client, behaves like ApiClient.kt: no cookies, X-EBP-Client, Bearer + X-EBP-Token."""
    def __init__(self, base, send_client=True, send_auth=True, send_xtoken=True):
        self.base=base.rstrip("/"); self.access=None; self.refresh=None
        self.sc=send_client; self.sa=send_auth; self.sx=send_xtoken
        self.op=urllib.request.build_opener(NoRedirect)
    def req(self, method, path, body=None, token=True):
        h={"Accept":"application/json","User-Agent":"EasyBudgetPlanner-Android"}
        if self.sc: h["X-EBP-Client"]="android"
        if method!="GET": h["Content-Type"]="application/json; charset=utf-8"; body = {} if body is None else body
        if token and self.access:
            if self.sa: h["Authorization"]="Bearer "+self.access
            if self.sx: h["X-EBP-Token"]=self.access
        return _do(self.op, method, self.base+"/"+path.lstrip("/"), body, h)
def latest_mail_token(maildir, to, kind):
    files=sorted(glob.glob(os.path.join(maildir,"*.eml")), key=os.path.getmtime)
    for f in reversed(files):
        m=email.message_from_bytes(open(f,"rb").read(), policy=policy.default)
        if to.lower() not in str(m["To"]).lower(): continue
        body=m.get_body(("plain",)).get_content()
        mm=re.search(r"(verify-email|reset-password)\.html\?token=([a-f0-9]+)", body)
        if mm and mm.group(1)==kind: return mm.group(2)
def is_json_envelope(code, js, ct):
    return js is not None and isinstance(js,dict) and "ok" in js and "application/json" in ct
