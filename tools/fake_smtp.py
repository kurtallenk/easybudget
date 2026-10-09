#!/usr/bin/env python3
"""Tiny SMTP sink for testing the native SMTP transport (dev/test only).

  python3 tools/fake_smtp.py PORT OUTDIR [CERT KEY]

Supports EHLO, STARTTLS (when CERT/KEY are given), AUTH LOGIN/PLAIN,
MAIL, RCPT, DATA, QUIT. Each message is saved as OUTDIR/<n>.eml together
with OUTDIR/<n>.json holding the envelope and decoded AUTH credentials.
"""
import base64, json, os, socket, ssl, sys, threading

port, out = int(sys.argv[1]), sys.argv[2]
cert = sys.argv[3] if len(sys.argv) > 4 else None
key = sys.argv[4] if len(sys.argv) > 4 else None
os.makedirs(out, exist_ok=True)
count = [0]

def handle(conn):
    f = conn.makefile('rwb')
    def send(l): f.write((l + "\r\n").encode()); f.flush()
    def line(): return f.readline().decode(errors='replace').rstrip("\r\n")
    send("220 fake ESMTP")
    env = {"auth": None, "from": None, "rcpt": [], "tls": False}
    while True:
        l = line()
        if not l: break
        u = l.upper()
        if u.startswith("EHLO") or u.startswith("HELO"):
            caps = ["250-fake", "250-AUTH LOGIN PLAIN"]
            if cert and not env["tls"]: caps.append("250-STARTTLS")
            caps.append("250 8BITMIME")
            for c in caps: send(c)
        elif u == "STARTTLS" and cert:
            send("220 go ahead")
            ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER); ctx.load_cert_chain(cert, key)
            conn = ctx.wrap_socket(conn, server_side=True); f = conn.makefile('rwb'); env["tls"] = True
        elif u == "AUTH LOGIN":
            send("334 VXNlcm5hbWU6"); us = base64.b64decode(line()).decode()
            send("334 UGFzc3dvcmQ6"); pw = base64.b64decode(line()).decode()
            env["auth"] = [us, pw]; send("235 ok")
        elif u.startswith("AUTH PLAIN "):
            p = base64.b64decode(l[11:]).decode().split("\0"); env["auth"] = p[1:]; send("235 ok")
        elif u.startswith("MAIL FROM:"): env["from"] = l[10:]; send("250 ok")
        elif u.startswith("RCPT TO:"): env["rcpt"].append(l[8:]); send("250 ok")
        elif u == "DATA":
            send("354 end with .")
            data = []
            while True:
                d = f.readline().decode(errors='replace')
                if d in (".\r\n", ".\n", ""): break
                data.append(d[1:] if d.startswith("..") else d)
            count[0] += 1; n = count[0]
            open(os.path.join(out, f"{n}.eml"), "w").write("".join(data))
            json.dump(env, open(os.path.join(out, f"{n}.json"), "w"))
            send("250 queued")
        elif u == "QUIT": send("221 bye"); break
        else: send("502 unknown")
    conn.close()

s = socket.socket(); s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
s.bind(("127.0.0.1", port)); s.listen(5)
while True:
    c, _ = s.accept(); threading.Thread(target=handle, args=(c,), daemon=True).start()
