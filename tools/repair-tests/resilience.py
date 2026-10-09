"""Partial-upload resilience of the REPAIRED code: the website must survive any single missing/old file."""
import sys, time, shutil, subprocess, os; sys.path.insert(0,"/data/ebp/tests"); from lib import *
P1="/data/ebp/test/p1"; WK="/data/ebp/test/work"; MX="/data/ebp/test/mixed"; URL="http://127.0.0.1:8083"
b=Browser("http://127.0.0.1:8085"); b.session(); S=str(int(time.time())); PW="CorrectHorse9!x"; e=f"res{S}@example.com"
b.req("POST","api/auth/register.php",{"email":e,"password":PW,"passwordConfirm":PW}); tok=latest_mail_token(P1+"/storage/mail",e,"verify-email"); b.req("POST","api/auth/verify-email.php",{"token":tok})
c,js,_,_=b.req("POST","api/auth/login.php",{"email":e,"password":PW,"remember":True}); b.csrf=js["data"]["csrfToken"]
changed=["includes/api.php","includes/Auth.php","includes/AuthFlows.php","includes/Repositories.php","api/auth/session.php","api/auth/password.php","api/auth/register.php","api/auth/login.php","api/bootstrap.php"]
cases=[("missing includes/ApiTokens.php",lambda: os.remove(MX+"/includes/ApiTokens.php"))]
for f in changed: cases.append((f"Phase 1 {f}", (lambda f=f: shutil.copy(P1+"/"+f, MX+"/"+f))))
for label,mut in cases:
    shutil.rmtree(MX,ignore_errors=True); shutil.copytree(WK,MX); mut()
    subprocess.run("/data/ebp/stop.sh 8083; /data/ebp/serve.sh "+MX+" 8083 ebp_prod >/dev/null",shell=True); time.sleep(0.8)
    b.base=URL; c,js=b.session(); ins=bool(js and js.get("data",{}).get("authenticated"))
    c2,_,_,_=b.req("GET","api/accounts/list.php")
    w=Browser(URL); w.session(); c3,js3,_,_=w.req("POST","api/auth/register.php",{"email":f"r{time.time()}@example.com","password":PW,"passwordConfirm":PW})
    check(f"website OK with {label}", ins and c2==200 and c3==201, (ins,c2,c3,js3))
print("PASS",len(PASS),"FAIL",len(FAIL))
