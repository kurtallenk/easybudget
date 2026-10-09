import sys, time; sys.path.insert(0,"/data/ebp/tests"); from lib import *
P1="http://127.0.0.1:8081"; P2="http://127.0.0.1:8082"; M1="/data/ebp/test/p1/storage/mail"; M2="/data/ebp/test/p2/storage/mail"
S=str(int(time.time())); PW="CorrectHorse9!x"; email_=f"rca{S}@example.com"
print("== 1. Website user on Phase 1 (pre-010 DB)")
b=Browser(P1); b.session()
c,js,ct,_=b.req("POST","api/auth/register.php",{"email":email_,"password":PW,"passwordConfirm":PW,"displayName":"RCA"}); check("P1 register",c==201,(c,js))
tok=latest_mail_token(M1,email_,"verify-email"); c,js,ct,_=b.req("POST","api/auth/verify-email.php",{"token":tok}); check("P1 verify email",c==200 and js["data"]["status"]=="verified",(c,js))
c,js,ct,_=b.req("POST","api/auth/login.php",{"email":email_,"password":PW,"remember":True}); check("P1 login",c==200,(c,js)); b.csrf=js["data"]["csrfToken"]
c,js=b.session(); check("P1 session authenticated",js["data"]["authenticated"]==True,js)
print("== 2. Same browser session after deploying Phase 2 code (no migration 010 run)")
b.base=P2
c,js=b.session(); check("P2 keeps existing session",c==200 and js and js["data"]["authenticated"]==True,(c,js))
c,js,ct,_=b.req("GET","api/accounts/list.php"); check("P2 authed GET works",c==200,(c,js))
c,js,ct,_=b.req("POST","api/accounts/create.php",{"name":"Wallet "+S,"type":"cash","openingBalance":0}); check("P2 authed POST (CSRF) works",c in (200,201),(c,js))
print("== 3. Website flows on Phase 2 without migration 010")
w=Browser(P2); w.session(); e2=f"rcaw{S}@example.com"
c,js,ct,_=w.req("POST","api/auth/register.php",{"email":e2,"password":PW,"passwordConfirm":PW}); check("P2 web register",c==201,(c,js))
c,js,ct,_=w.req("POST","api/auth/forgot-password.php",{"email":email_}); check("P2 web forgot-password",c==200,(c,js))
tok=latest_mail_token(M2,email_,"reset-password"); check("P2 reset mail sent", tok is not None)
c,js,ct,_=w.req("POST","api/auth/reset-password.php",{"token":tok,"password":PW+"2","passwordConfirm":PW+"2"}); check("P2 web reset-password",c==200,(c,js))
PWX = PW+"2" if c==200 else PW
c,js,ct,_=w.req("POST","api/auth/login.php",{"email":email_,"password":PWX}); check("P2 web login",c==200,(c,js))
print("== 4. Android app against Phase 2 without migration 010")
a=App(P2); c,js,ct,raw=a.req("POST","api/auth/token.php",{"email":email_,"password":PWX,"deviceName":"test"},token=False)
check("P2 app token login",c==200,(c,js or raw[:200]))
print("== 5. Android app against Phase 1 (what the live server runs)")
a=App(P1)
for p,bd in [("api/auth/token.php",{"email":email_,"password":PWX}),("api/auth/register.php",{"email":"x"+e2,"password":PW,"passwordConfirm":PW}),("api/auth/forgot-password.php",{"email":email_})]:
    c,js,ct,raw=a.req("POST",p,bd,token=False); print("   ",p,c,ct,(js or raw[:120]))
print("PASS",len(PASS),"FAIL",len(FAIL))
