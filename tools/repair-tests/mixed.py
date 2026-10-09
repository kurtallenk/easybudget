import sys, time, shutil, subprocess, os; sys.path.insert(0,"/data/ebp/tests"); from lib import *
P1="/data/ebp/test/p1"; P2="/data/ebp/test/p2"; MX="/data/ebp/test/mixed"; URL="http://127.0.0.1:8083"
files=["includes/api.php","includes/Request.php","includes/Session.php","includes/Auth.php","includes/AuthFlows.php","api/auth/session.php","api/auth/password.php"]
# existing logged-in user from P1
b=Browser("http://127.0.0.1:8081"); b.session(); S=str(int(time.time())); PW="CorrectHorse9!x"; e=f"mx{S}@example.com"
b.req("POST","api/auth/register.php",{"email":e,"password":PW,"passwordConfirm":PW}); tok=latest_mail_token(P1+"/storage/mail",e,"verify-email"); b.req("POST","api/auth/verify-email.php",{"token":tok})
c,js,_,_=b.req("POST","api/auth/login.php",{"email":e,"password":PW,"remember":True}); b.csrf=js["data"]["csrfToken"]
def run(label):
    subprocess.run("/data/ebp/stop.sh 8083; /data/ebp/serve.sh "+MX+" 8083 >/dev/null",shell=True)
    time.sleep(0.8); b.base=URL; old=b.csrf
    c,js=b.session(); sess = "in" if (js and js.get("data",{}).get("authenticated")) else f"OUT({c})"
    c2,js2,_,_=b.req("GET","api/accounts/list.php")
    w=Browser(URL); w.session(); c3,js3,_,_=w.req("POST","api/auth/register.php",{"email":f"n{time.time()}@example.com","password":PW,"passwordConfirm":PW})
    print(f"{label:55s} existing-session:{sess:8s} authed-GET:{c2} web-register:{c3} {(js3 or {}).get('error',{}).get('code','')}")
for direction,base,src in [("P2 file over P1",P1,P2),("P1 file over P2 (restore partial)",P2,P1)]:
    for f in files:
        shutil.rmtree(MX,ignore_errors=True); shutil.copytree(base,MX); shutil.copy(os.path.join(src,f),os.path.join(MX,f))
        if direction.startswith("P2") and f=="includes/api.php": pass
        run(f"{direction}: {f}")
# P2 api.php without ApiTokens.php (file not uploaded)
shutil.rmtree(MX,ignore_errors=True); shutil.copytree(P2,MX); os.remove(MX+"/includes/ApiTokens.php"); run("P2 without includes/ApiTokens.php")
