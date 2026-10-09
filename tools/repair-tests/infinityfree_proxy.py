"""Worst-case InfinityFree emulator in front of the local PHP server:
 1. answers every request without the right __test cookie with the aes.js JavaScript challenge page;
 2. strips Authorization, X-EBP-Client and X-EBP-Token (hosts that drop non-standard headers);
 3. turns a 404 for a missing file (non-JSON) into a 302 to an HTML error page (like errors.infinityfree.net);
 4. turns 419 into 500 (observed on the live host)."""
import http.server, http.client, subprocess, sys, os
UP=("127.0.0.1", int(sys.argv[2])); PORT=int(sys.argv[1])
A,B,C=os.urandom(16).hex(),os.urandom(16).hex(),os.urandom(16).hex()
EXPECTED=subprocess.run(["php","-r",f'echo bin2hex(openssl_decrypt(hex2bin("{C}"),"aes-128-cbc",hex2bin("{A}"),OPENSSL_RAW_DATA|OPENSSL_ZERO_PADDING,hex2bin("{B}")));'],capture_output=True,text=True).stdout
PAGE=('<html><body><script type="text/javascript" src="/aes.js" ></script><script>function toNumbers(d){var e=[];d.replace(/(..)/g,function(d){e.push(parseInt(d,16))});return e}'
      f'var a=toNumbers("{A}"),b=toNumbers("{B}"),c=toNumbers("{C}");document.cookie="__test="+toHex(slowAES.decrypt(c,2,a,b))+"; path=/"; location.href="/?i=1";</script></body></html>').encode()
STRIP={"authorization","x-ebp-client","x-ebp-token","host","connection"}
class H(http.server.BaseHTTPRequestHandler):
    protocol_version="HTTP/1.1"
    def log_message(self,*a): pass
    def handle_one(self):
        n=int(self.headers.get("Content-Length") or 0); body=self.rfile.read(n) if n else None
        ck=self.headers.get("Cookie","")
        if f"__test={EXPECTED}" not in ck:
            self.send_response(200); self.send_header("Content-Type","text/html"); self.send_header("Content-Length",str(len(PAGE))); self.end_headers(); self.wfile.write(PAGE); return
        hdr={k:v for k,v in self.headers.items() if k.lower() not in STRIP}
        c=http.client.HTTPConnection(*UP,timeout=60); c.request(self.command,self.path,body=body,headers=hdr); r=c.getresponse(); data=r.read()
        st=r.status
        if st==404 and 'json' not in (r.getheader('Content-Type') or ''):  # Apache-level 404 (missing file) only
            self.send_response(302); self.send_header("Location","https://errors.infinityfree.net/errors/404/"); self.send_header("Content-Type","text/html"); b=b"<h1>Found</h1>"; self.send_header("Content-Length",str(len(b))); self.end_headers(); self.wfile.write(b); return
        if st==419: st=500
        self.send_response(st)
        for k,v in r.getheaders():
            if k.lower() not in ("transfer-encoding","connection","content-length"): self.send_header(k,v)
        self.send_header("Content-Length",str(len(data))); self.end_headers(); self.wfile.write(data)
    do_GET=do_POST=do_DELETE=handle_one
http.server.ThreadingHTTPServer(("127.0.0.1",PORT),H).serve_forever()
