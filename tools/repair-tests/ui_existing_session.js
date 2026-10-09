// Real browser: sign in on the Phase 1 site, then the repaired code is "deployed" (same host, other port,
// same session store + DB). The signed-in user must still see the app, not the login page.
const { chromium } = require('playwright'); const { execSync } = require('child_process');
const P1 = 'http://127.0.0.1:8085', W = 'http://127.0.0.1:8086';
const email = process.argv[2], pw = process.argv[3];
(async () => {
  const browser = await chromium.launch({ executablePath: execSync('which chromium').toString().trim(), args: ['--no-sandbox'] });
  const page = await browser.newPage(); let ok = 0, bad = 0;
  const check = (l, c) => { c ? ok++ : bad++; console.log((c ? '  PASS ' : '  FAIL ') + l); };
  await page.goto(P1 + '/pages/login.html');
  await page.fill('#email', email); await page.fill('#password', pw); await page.check('#remember');
  await Promise.all([page.waitForURL(/index\.html|\/$/, { timeout: 20000 }), page.click('#submit')]);
  check('signed in on Phase 1 site (URL ' + page.url() + ')', !/login/.test(page.url()));
  const sess1 = await page.evaluate(async () => (await (await fetch('api/auth/session.php')).json()).data.authenticated);
  check('Phase 1 session authenticated', sess1 === true);
  // "deploy": same browser, same cookie, repaired code
  await page.goto(W + '/index.html'); await page.waitForTimeout(4000);
  check('after deploy: still on the app, not redirected to login (URL ' + page.url() + ')', !/login/.test(page.url()));
  const sess2 = await page.evaluate(async () => (await (await fetch('api/auth/session.php')).json()).data.authenticated);
  check('after deploy: session authenticated', sess2 === true);
  const boot = await page.evaluate(async () => (await fetch('api/bootstrap.php')).status);
  check('after deploy: bootstrap 200', boot === 200);
  await page.screenshot({ path: '/data/ebp/tests/logs/existing_session_after_deploy.png' });
  // sign out through the API the SPA uses, then sign in again through the UI
  await page.evaluate(async () => { const s = await (await fetch('api/auth/session.php')).json(); await fetch('api/auth/logout.php', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': s.data.csrfToken }, body: '{}' }); });
  await page.goto(W + '/index.html'); await page.waitForTimeout(3000);
  check('after logout: index redirects to login', /login/.test(page.url()));
  await page.goto(W + '/pages/login.html'); await page.fill('#email', email); await page.fill('#password', pw);
  await Promise.all([page.waitForURL(/index\.html|\/$/, { timeout: 20000 }), page.click('#submit')]);
  check('login again through the UI on repaired code', !/login/.test(page.url()));
  console.log(`RESULT PASS ${ok} FAIL ${bad}`); await browser.close(); process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
