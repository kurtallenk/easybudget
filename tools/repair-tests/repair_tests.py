"""Repair verification. usage: repair_tests.py pre|post   (pre = DB without migration 010)"""
import sys, time; sys.path.insert(0,"/data/ebp/tests"); from lib import *; from lib import _do
MODE=sys.argv[1]; DB="ebp_prod"
P1="http://127.0.0.1:8085"; W="http://127.0.0.1:8086"; M1="/data/ebp/test/p1/storage/mail"; MW="/data/ebp/test/work/storage/mail"
S=f"{int(time.time())}"; PW="CorrectHorse9!x"
def env(label,c,js,ct,raw=b""): return is_json_envelope(c,js,ct)
def mkuser(base,maildir,e,pw=PW):
    b=Browser(base); b.session()
    c,js,ct,_=b.req("POST","api/auth/register.php",{"email":e,"password":pw,"passwordConfirm":pw,"displayName":"T"})
    tok=latest_mail_token(maildir,e,"verify-email"); c2,js2,_,_=b.req("POST","api/auth/verify-email.php",{"token":tok})
    return c,c2
print(f"=== MODE {MODE}: health")
a=App(W); c,js,ct,raw=a.req("GET","api/health.php",token=False)
check("health JSON envelope",is_json_envelope(c,js,ct),(c,raw[:200]))
check("health checks code modules",js and all(js["data"]["checks"][k] for k in ["apiTokensModule","authModule","mobileEndpoints","database"]),js)
check("health apiTokensTable="+("False" if MODE=="pre" else "True"), js and js["data"]["checks"]["apiTokensTable"]==(MODE=="post"),js)
check("health detects app client", js and js["data"]["request"]["mobileClientDetected"]==True,js)

print("=== Existing website user logged in on Phase 1, then repaired code deployed")
e1=f"exist{S}@example.com"; mkuser(P1,M1,e1)
b=Browser(P1); b.session(); c,js,ct,_=b.req("POST","api/auth/login.php",{"email":e1,"password":PW,"remember":True}); b.csrf=js["data"]["csrfToken"]
sid_before=b.cookie()
b.base=W
c,js=b.session(); check("existing session still authenticated on repaired code",c==200 and js["data"]["authenticated"]==True,(c,js))
check("session cookie unchanged (no forced re-login)", b.cookie()==sid_before, (sid_before,b.cookie()))
c,js,ct,_=b.req("GET","api/bootstrap.php"); check("existing user bootstrap 200",c==200 and js["data"]["csrfToken"]!="",(c,str(js)[:200]))
c,js,ct,_=b.req("POST","api/accounts/create.php",{"name":"Acc "+S,"type":"cash","openingBalance":10}); check("existing user write with CSRF",c in(200,201),(c,js))
c,js,ct,_=b.req("POST","api/accounts/create.php",{"name":"NoCsrf"+S,"type":"cash"} ) if False else (None,None,None,None)
nb=Browser(W); nb.jar=b.jar; nb.csrf=None
c,js,ct,_=nb.req("POST","api/accounts/create.php",{"name":"Forged "+S,"type":"cash"}); check("website write without CSRF still rejected (419)",c==419,(c,js))
c,js,ct,_=Browser(W).req("POST","api/accounts/create.php",{"name":"x","type":"cash"}); check("cross-site style write w/o session rejected",c in (401,419),(c,js))

print("=== Website flows on repaired code")
w=Browser(W); w.session(); e2=f"web{S}@example.com"
c,js,ct,_=w.req("POST","api/auth/register.php",{"email":e2,"password":PW,"passwordConfirm":PW,"displayName":"Web"}); check("web register 201",c==201 and js["data"]["csrfToken"]!="",(c,js))
tok=latest_mail_token(MW,e2,"verify-email"); c,js,ct,_=w.req("POST","api/auth/verify-email.php",{"token":tok}); check("web verify email",c==200 and js["data"]["status"]=="verified",(c,js))
c,js,ct,_=w.req("POST","api/auth/login.php",{"email":e2,"password":"WrongPassword1!"}); check("web invalid credentials 401",c==401 and js["error"]["code"] in("invalid_credentials","unauthenticated"),(c,js))
c,js,ct,_=w.req("POST","api/auth/login.php",{"email":e2,"password":PW}); check("web login",c==200 and js["data"]["user"]["email"]==e2,(c,js)); w.csrf=js["data"]["csrfToken"]
c,js=w.session(); check("web session persists",js["data"]["authenticated"]==True,js)
c,js,ct,_=w.req("POST","api/auth/password.php",{"currentPassword":PW,"newPassword":PW+"c"}); check("web change password",c==200 and js["data"]["csrfToken"]!="",(c,js)); 
if c==200: w.csrf=js["data"]["csrfToken"]
c,js=w.session(); check("web session kept after own password change",js["data"]["authenticated"]==True,js)
c,js,ct,_=w.req("POST","api/auth/logout.php",{}); check("web logout",c==200,(c,js))
c,js=w.session(); check("web signed out after logout",js["data"]["authenticated"]==False,js)
c,js,ct,_=w.req("POST","api/auth/login.php",{"email":e2,"password":PW+"c"}); check("web login again",c==200,(c,js)); w.csrf=js["data"]["csrfToken"]
r=Browser(W); r.session()
c,js,ct,_=r.req("POST","api/auth/forgot-password.php",{"email":e2}); check("web forgot-password",c==200,(c,js))
tok=latest_mail_token(MW,e2,"reset-password"); check("reset email sent",tok is not None)
c,js,ct,_=r.req("POST","api/auth/reset-check.php",{"token":tok}); check("web reset-check valid",c==200 and js["data"]["status"]=="valid",(c,js))
c,js,ct,_=r.req("POST","api/auth/reset-password.php",{"token":tok,"password":PW+"r","passwordConfirm":PW+"r"}); check("web reset-password (works "+MODE+"-migration)",c==200,(c,js))
c,js=w.session(); check("other web sessions signed out after reset (by design)",js["data"]["authenticated"]==False,js)
r.session()  # reset ends the current session (Phase 1 design); pages/login.html mints a fresh CSRF token on load
c,js,ct,_=r.req("POST","api/auth/login.php",{"email":e2,"password":PW+"r"}); check("web login with new password",c==200,(c,js))

print("=== Android app flows")
a=App(W); e3=f"app{S}@example.com"
c,js,ct,raw=a.req("POST","api/auth/register.php",{"email":e3,"password":PW,"passwordConfirm":PW,"displayName":"App"},token=False)
check("app register 201 JSON (no CSRF)",c==201 and js["data"]["verificationRequired"]==True and js["data"]["csrfToken"]=="",(c,js or raw[:200]))
tok=latest_mail_token(MW,e3,"verify-email"); vb=Browser(W); vb.session(); vb.req("POST","api/auth/verify-email.php",{"token":tok})
c,js,ct,raw=a.req("POST","api/auth/forgot-password.php",{"email":e3},token=False); check("app forgot-password 200 JSON",c==200 and js["data"]["sent"]==True,(c,js or raw[:200]))
c,js,ct,raw=a.req("POST","api/auth/resend-verification.php",{"email":e3},token=False); check("app resend-verification JSON",is_json_envelope(c,js,ct) and c==200,(c,js))
c,js,ct,raw=a.req("POST","api/auth/token.php",{"email":e3,"password":"WrongPassword1!","deviceName":"t"},token=False); check("app invalid credentials -> 401 JSON",c==401 and is_json_envelope(c,js,ct),(c,js or raw[:200]))
c,js,ct,raw=a.req("POST","api/auth/token.php",{"email":e3,"password":PW,"deviceName":"Pixel test"},token=False)
if MODE=="pre":
    check("app login before migration -> clear 503 JSON (not 500/HTML)",c==503 and js["error"]["code"]=="service_unavailable",(c,js or raw[:200]))
    c,js,ct,_=a.req("GET","api/auth/session.php",token=False); check("app session probe w/o token JSON",c==200 and js["data"]["authenticated"]==False and js["data"]["csrfToken"]=="",(c,js))
else:
    check("app login 200 with tokens",c==200 and js["data"]["tokens"]["accessToken"].startswith("ebp_"),(c,js or raw[:200]))
    a.access=js["data"]["tokens"]["accessToken"]; a.refresh=js["data"]["tokens"]["refreshToken"]
    c,js,ct,h=a.req("GET","api/auth/session.php"); check("app session authenticated",c==200 and js["data"]["authenticated"]==True and js["data"]["csrfToken"]=="",(c,js))
    c,js,ct,_=a.req("GET","api/bootstrap.php"); check("app bootstrap 200",c==200,(c,str(js)[:200]))
    c,js,ct,_=a.req("POST","api/accounts/create.php",{"name":"Phone "+S,"type":"bank","openingBalance":5}); check("app authed write",c in(200,201),(c,js))
    c,js,ct,_=a.req("GET","api/accounts/list.php"); check("app sees its data",c==200 and any(x["name"]=="Phone "+S for x in js["data"]),(c,str(js)[:200]))
    bad=App(W); bad.access="ebp_"+"0"*96; c,js,ct,_=bad.req("GET","api/accounts/list.php"); check("app invalid token -> 401 unauthenticated",c==401 and js["error"]["code"]=="unauthenticated",(c,js))
    no=App(W); c,js,ct,_=no.req("GET","api/accounts/list.php"); check("app no token -> 401",c==401,(c,js))
    sql(f"UPDATE api_tokens SET expires_at=UTC_TIMESTAMP()-INTERVAL 1 MINUTE WHERE kind='access' AND user_id=(SELECT id FROM users WHERE email='{e3}')",DB)
    c,js,ct,_=a.req("GET","api/accounts/list.php"); check("expired access token -> 401 token_expired",c==401 and js["error"]["code"]=="token_expired",(c,js))
    c,js,ct,_=a.req("POST","api/auth/refresh.php",{"refreshToken":a.refresh},token=False); check("refresh rotates tokens",c==200 and js["data"]["tokens"]["refreshToken"]!=a.refresh,(c,js))
    old_refresh=a.refresh; a.access=js["data"]["tokens"]["accessToken"]; a.refresh=js["data"]["tokens"]["refreshToken"]
    c,js,ct,_=a.req("GET","api/accounts/list.php"); check("new access token works",c==200,(c,js))
    # header-stripping fallbacks
    ua=App(W,send_client=False,send_auth=False,send_xtoken=True); ua.access=a.access
    c,js,ct,_=ua.req("GET","api/accounts/list.php"); check("fallback: no X-EBP-Client/Authorization, X-EBP-Token only",c==200,(c,js))
    ck=App(W,send_client=False,send_auth=False,send_xtoken=False); 
    h={"Accept":"application/json","User-Agent":"EasyBudgetPlanner-Android/1.0.0","Cookie":"ebp_at="+a.access}
    c,js,ct,_=_do(ck.op,"GET",W+"/api/accounts/list.php",None,h); check("fallback: UA + ebp_at cookie only",c==200,(c,js))
    h={"Accept":"application/json","User-Agent":"Mozilla/5.0","Cookie":"ebp_at="+a.access}
    c,js,ct,_=_do(ck.op,"GET",W+"/api/accounts/list.php",None,h); check("browser with ebp_at cookie is NOT accepted",c==401,(c,js))
    h={"Accept":"application/json","User-Agent":"EasyBudgetPlanner-Android/1.0.0","Content-Type":"application/json"}
    c,js,ct,_=_do(ck.op,"POST",W+"/api/auth/forgot-password.php",{"email":e3},h); check("fallback: UA-only app request skips CSRF",c==200,(c,js))
    c,js,ct,_=a.req("POST","api/auth/password.php",{"currentPassword":PW,"newPassword":PW+"m"}); check("app change password returns new tokens",c==200 and js["data"]["tokens"]["accessToken"].startswith("ebp_"),(c,js))
    a.access=js["data"]["tokens"]["accessToken"]; a.refresh=js["data"]["tokens"]["refreshToken"]
    c,js,ct,_=a.req("GET","api/accounts/list.php"); check("app still signed in after own password change",c==200,(c,js))
    c,js,ct,_=a.req("POST","api/auth/revoke.php",{"refreshToken":a.refresh}); check("app logout (revoke)",c==200,(c,js))
    c,js,ct,_=a.req("GET","api/accounts/list.php"); check("token unusable after logout",c==401,(c,js))
    c,js,ct,_=a.req("POST","api/auth/token.php",{"email":e3,"password":PW+"m","deviceName":"t"},token=False); check("app login after logout",c==200,(c,js))
    a.access=js["data"]["tokens"]["accessToken"]
    # password reset from app signs app out
    c,js,ct,_=App(W).req("POST","api/auth/forgot-password.php",{"email":e3},token=False)
    tok=latest_mail_token(MW,e3,"reset-password"); rb=Browser(W); rb.session()
    c,js,ct,_=rb.req("POST","api/auth/reset-password.php",{"token":tok,"password":PW+"z","passwordConfirm":PW+"z"}); check("reset (link from app request) completes",c==200,(c,js))
    c,js,ct,_=a.req("GET","api/accounts/list.php"); check("app tokens revoked after password reset",c==401,(c,js))
    c,js,ct,_=a.req("POST","api/auth/token.php",{"email":e3,"password":PW+"z","deviceName":"t"},token=False); check("app login with reset password",c==200,(c,js))
    # same account on web and app at once
    wb=Browser(W); wb.session(); c,js,ct,_=wb.req("POST","api/auth/login.php",{"email":e3,"password":PW+"z"}); check("same user on website while app signed in",c==200,(c,js))
    a.access=None; 
print("=== Every API response is JSON (sample of error paths)")
for m,p,bd in [("GET","api/auth/token.php",None),("POST","api/auth/token.php",b"{bad json"),("POST","api/auth/register.php",{"email":"bad"}),("GET","api/accounts/list.php",None),("POST","api/transactions/create.php",{})]:
    c,js,ct,raw=App(W).req(m,p,bd,token=False); check(f"JSON envelope: {m} {p} -> {c}",is_json_envelope(c,js,ct),(c,ct,raw[:120]))
n=len(FAIL); print(f"\nRESULT {MODE}: PASS {len(PASS)} FAIL {n}"); sys.exit(1 if n else 0)
