// Browser tests for the authentication screens against the REAL PHP + MySQL stack.
//
//   BASE=http://127.0.0.1:8080 DB_CLI="mysql -u root -p... budget_planner" SHOTS=/tmp/auth-shots \
//     node tools/auth_ui_tests.js
//
// Needs tools/dev_server.sh (MAIL_DRIVER=log, RELAX_THROTTLE=1) so emails land in
// storage/mail/ (MAIL_DIR overrides). Drives register -> verify -> login -> app,
// forgot -> reset -> login, the error states, then checks every screen at desktop,
// laptop, tablet, mobile portrait and mobile landscape sizes for horizontal overflow.
const { chromium } = require('playwright');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const BASE = process.env.BASE || 'http://127.0.0.1:8080';
const DB_CLI = process.env.DB_CLI || 'mysql budget_planner';
const MAIL_DIR = process.env.MAIL_DIR || path.join(__dirname, '..', 'storage', 'mail');
const SHOTS = process.env.SHOTS || '';
const sql = q => execSync(`${DB_CLI} -N -B -e "${q}"`).toString().trim();
const stamp = Date.now();
const PW = 'CorrectHorse9!', NEWPW = 'FreshStart42!';
let pass = 0, fail = 0;
const t = (n, c, x) => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'} ${n}${c ? '' : ' ' + JSON.stringify(x ?? '')}`); };

const tokenFor = (addr, page) => {
  const files = fs.readdirSync(MAIL_DIR).filter(f => f.endsWith('.eml')).map(f => path.join(MAIL_DIR, f))
    .sort((a, b) => fs.statSync(a).mtimeMs - fs.statSync(b).mtimeMs);
  let tok = null;
  for (const f of files) {
    const raw = fs.readFileSync(f, 'utf8');
    const to = (raw.match(/^To: (.*)$/m) || [])[1] || '';
    if (!to.toLowerCase().includes(addr.toLowerCase())) continue;
    const parts = raw.split(/\r\n\r\n/);
    for (let i = 1; i < parts.length; i++) {
      try {
        const txt = Buffer.from(parts[i].split(/\r\n--/)[0].replace(/\s+/g, ''), 'base64').toString('utf8');
        const m = txt.match(new RegExp(page.replace('.', '\\.') + '\\?token=([a-f0-9]{96})'));
        if (m) tok = m[1];
      } catch {}
    }
  }
  return tok;
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const waitToken = async (addr, page, not) => { for (let i = 0; i < 25; i++) { const k = tokenFor(addr, page); if (k && k !== not) return k; await sleep(200); } return null; };

(async () => {
  const browser = await chromium.launch({ executablePath: execSync('which chromium').toString().trim(), args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const visible = sel => page.locator(sel).first().isVisible();
  const text = sel => page.locator(sel).first().innerText();
  const A = `ui${stamp}@example.com`;

  // ---------------- registration ----------------
  await page.goto(BASE + '/pages/register.html');
  await page.waitForLoadState('networkidle');
  await page.fill('#email', 'not-an-email');
  await page.fill('#password', PW); await page.fill('#passwordConfirm', PW);
  await page.click('#submit');
  t('register: invalid email shows a field error', (await text('[data-for="email"]')).includes('valid email'));
  await page.fill('#email', A);
  await page.fill('#password', 'weakweakweak'); await page.fill('#passwordConfirm', 'weakweakweak');
  await page.click('#submit');
  t('register: weak password shows a field error', (await text('[data-for="password"]')).includes('at least 3'));
  t('register: rules list shows length met but kinds not', await page.locator('[data-rule="length"].ok').count() === 1 && await page.locator('[data-rule="upper"].ok').count() === 0);
  await page.fill('#password', PW); await page.fill('#passwordConfirm', PW + 'x');
  await page.click('#submit');
  t('register: mismatch shows a field error', (await text('[data-for="passwordConfirm"]')).includes('do not match'));
  t('register: all requirement rules satisfied for a good password', await page.locator('#pw-rules li.ok').count() === 5);
  await page.click('.auth-pw-toggle >> nth=0');
  t('register: show password toggle reveals text', await page.getAttribute('#password', 'type') === 'text');
  await page.click('.auth-pw-toggle >> nth=0');
  await page.fill('#displayName', 'Uma Interface');
  await page.fill('#passwordConfirm', PW);
  await page.click('#submit');
  await page.waitForSelector('[data-view="sent"]:not([hidden])', { timeout: 8000 });
  t('register: "check your inbox" screen shown', await visible('text=Check your inbox'));
  t('register: shows the address the link went to', (await text('#sent-email')) === A);
  t('register: resend is on a cooldown right after sending', await page.isDisabled('#resend'));
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/register-sent.png`, fullPage: true });

  // unverified login
  await page.goto(BASE + '/pages/login.html');
  await page.fill('#email', A); await page.fill('#password', PW); await page.click('#submit');
  await page.waitForSelector('#alert.is-warn', { timeout: 8000 });
  t('login: unverified account gets a clear verification message', (await text('#alert')).includes('confirm your email'));
  t('login: unverified message offers a resend button', await visible('#alert .btn-link'));
  sql(`UPDATE login_attempts SET attempted_at = attempted_at - INTERVAL 2 MINUTE WHERE email='${A}'`);
  const firstTok = await waitToken(A, 'verify-email.html');
  await page.click('#alert .btn-link');
  await page.waitForSelector('#alert.is-success', { timeout: 8000 });
  t('login: resend confirms another email was sent', (await text('#alert')).includes('sent a new verification link'));
  const vt = await waitToken(A, 'verify-email.html', firstTok);
  t('login: resend produced a new token', !!vt && vt !== firstTok);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/login-resent.png`, fullPage: true });

  // ---------------- verification ----------------
  await page.goto(BASE + '/pages/verify-email.html?token=' + firstTok);
  await page.waitForSelector('[data-view="result"]:not([hidden])');
  t('verify: replaced (old) link is reported as not valid', (await text('#status-title')).includes('not valid'));
  t('verify: invalid link offers a resend form', await visible('#resend-form'));
  await page.goto(BASE + '/pages/verify-email.html?token=' + vt);
  await page.waitForSelector('[data-view="result"]:not([hidden])');
  t('verify: success message', (await text('#status-title')) === 'Email confirmed');
  t('verify: token removed from the address bar', !page.url().includes('token='));
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/verify-success.png`, fullPage: true });
  await page.click('#status-primary');
  await page.waitForSelector('#alert.is-success');
  t('verify -> login shows "email confirmed" notice', (await text('#alert')).includes('email is confirmed'));
  await page.goto(BASE + '/pages/verify-email.html?token=' + vt);
  await page.waitForSelector('[data-view="result"]:not([hidden])');
  t('verify: reused link says already confirmed', (await text('#status-title')) === 'Already confirmed');
  await page.goto(BASE + '/pages/verify-email.html?token=' + 'c'.repeat(96));
  await page.waitForSelector('[data-view="result"]:not([hidden])');
  t('verify: invalid token message', (await text('#status-title')).includes('not valid'));
  await page.goto(BASE + '/pages/verify-email.html');
  await page.waitForSelector('[data-view="result"]:not([hidden])');
  t('verify: missing token handled gracefully', (await text('#status-text')).includes('incomplete'));
  // expired link
  const B = `exp${stamp}@example.com`;
  const pb = await ctx.newPage();
  await pb.goto(BASE + '/pages/register.html'); await pb.waitForLoadState('networkidle');
  await pb.fill('#email', B); await pb.fill('#password', PW); await pb.fill('#passwordConfirm', PW); await pb.click('#submit');
  await pb.waitForSelector('[data-view="sent"]:not([hidden])');
  const bt = await waitToken(B, 'verify-email.html');
  sql(`UPDATE auth_tokens SET expires_at = UTC_TIMESTAMP() - INTERVAL 1 MINUTE WHERE selector='${bt.slice(0, 32)}'`);
  await pb.goto(BASE + '/pages/verify-email.html?token=' + bt);
  await pb.waitForSelector('[data-view="result"]:not([hidden])');
  t('verify: expired link message', (await pb.locator('#status-title').innerText()).includes('expired'));
  if (SHOTS) await pb.screenshot({ path: `${SHOTS}/verify-expired.png`, fullPage: true });
  sql(`UPDATE login_attempts SET attempted_at = attempted_at - INTERVAL 2 MINUTE WHERE email='${B}'`);
  await pb.fill('#resend-email', B); await pb.click('#resend-submit');
  await pb.waitForSelector('#resend-alert.is-success');
  t('verify: resend from expired page confirms', (await pb.locator('#resend-alert').innerText()).includes('sent a new verification link'));
  await pb.close();

  // ---------------- login ----------------
  // Skip the first-run guide so it does not cover the sidebar in this test.
  sql(`UPDATE user_settings s JOIN users u ON u.id = s.user_id SET s.onboarded = 1 WHERE u.email='${A}'`);
  await page.goto(BASE + '/pages/login.html');
  t('login: "Forgot password?" link is visible', await visible('#forgot-link'));
  await page.fill('#email', A); await page.fill('#password', 'WrongPass1!'); await page.click('#submit');
  await page.waitForSelector('#alert.is-error');
  t('login: incorrect password message', (await text('#alert')).includes('incorrect'));
  await page.fill('#email', `nobody${stamp}@example.com`); await page.fill('#password', PW); await page.click('#submit');
  await page.waitForTimeout(400);
  t('login: unknown email gets the same message', (await text('#alert')).includes('incorrect'));
  await page.fill('#email', 'bad'); await page.click('#submit');
  t('login: invalid email format caught', (await text('[data-for="email"]')).includes('valid email'));
  await page.fill('#email', A); await page.fill('#password', PW); await page.click('#submit');
  await page.waitForSelector('.app', { timeout: 15000 });
  t('login: verified user enters the application', page.url().includes('index.html'));
  await page.goto(BASE + '/pages/login.html');
  await page.waitForURL(/index\.html/, { timeout: 8000 }).catch(() => {});
  t('login page redirects a signed-in user to the app', page.url().includes('index.html'));
  await page.waitForSelector('.app');
  // sign out through the app UI
  await page.locator('[data-action="sign-out"]').first().click();
  await page.waitForTimeout(300);
  const confirmBtn = page.locator('.modal button.btn-primary, .modal button.btn-danger, [role="dialog"] button.btn-primary, [role="dialog"] button.btn-danger').last();
  await confirmBtn.click();
  await page.waitForURL(/login\.html/, { timeout: 8000 }).catch(() => {});
  t('logout: returns to the sign-in page', page.url().includes('login.html'));
  await page.goto(BASE + '/index.html#/dashboard');
  await page.waitForURL(/login\.html/, { timeout: 8000 }).catch(() => {});
  t('protected app redirects to sign-in after logout', page.url().includes('login.html'));

  // ---------------- forgot / reset ----------------
  await page.click('#forgot-link');
  await page.waitForURL(/forgot-password\.html/);
  t('forgot: page opens from the login link', await visible('text=Forgot your password?'));
  await page.fill('#email', 'nope@'); await page.click('#submit');
  t('forgot: invalid email format caught', (await text('[data-for="email"]')).includes('valid email'));
  await page.fill('#email', `unknown${stamp}@example.com`); await page.click('#submit');
  await page.waitForSelector('[data-view="sent"]:not([hidden])');
  const genericUnknown = await text('#sent-text');
  t('forgot: unknown email gets the generic "check your email" screen', genericUnknown.includes('If an account exists'));
  await page.click('#change-email');
  sql(`UPDATE login_attempts SET attempted_at = attempted_at - INTERVAL 2 MINUTE WHERE email='${A}'`);
  await page.fill('#email', A); await page.click('#submit');
  await page.waitForSelector('[data-view="sent"]:not([hidden])');
  t('forgot: known email gets the identical screen', (await text('#sent-text')) === genericUnknown);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/forgot-sent.png`, fullPage: true });
  const rt = await waitToken(A, 'reset-password.html');
  t('forgot: reset email delivered with a link', !!rt);

  await page.goto(BASE + '/pages/reset-password.html?token=' + rt);
  await page.waitForSelector('[data-view="form"]:not([hidden])');
  t('reset: form shown for a valid link', await visible('#password'));
  t('reset: token removed from the address bar', !page.url().includes('token='));
  t('reset: password requirements visible', await visible('#pw-rules'));
  await page.fill('#password', NEWPW); await page.fill('#passwordConfirm', NEWPW + '?'); await page.click('#submit');
  t('reset: mismatch caught', (await text('[data-for="passwordConfirm"]')).includes('do not match'));
  await page.fill('#password', 'short'); await page.fill('#passwordConfirm', 'short'); await page.click('#submit');
  t('reset: weak password caught', (await text('[data-for="password"]')).includes('at least 10'));
  await page.fill('#password', PW); await page.fill('#passwordConfirm', PW); await page.click('#submit');
  await page.waitForSelector('#alert.is-error');
  t('reset: server refuses the current password', (await text('#alert')).includes('not used here before'));
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/reset-error.png`, fullPage: true });
  await page.fill('#password', NEWPW); await page.fill('#passwordConfirm', NEWPW); await page.click('#submit');
  await page.waitForSelector('[data-view="done"]:not([hidden])');
  t('reset: success screen', (await text('#done-title')) === 'Password updated');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/reset-done.png`, fullPage: true });
  await page.click('[data-view="done"] a.btn-primary');
  await page.waitForSelector('#alert.is-success');
  t('reset -> login shows the "password changed" notice', (await text('#alert')).includes('password was changed'));
  await page.fill('#email', A); await page.fill('#password', PW); await page.click('#submit');
  await page.waitForSelector('#alert.is-error');
  t('reset: old password rejected', (await text('#alert')).includes('incorrect'));
  await page.fill('#password', NEWPW); await page.click('#submit');
  await page.waitForSelector('.app', { timeout: 15000 });
  t('reset: login with the new password enters the app', page.url().includes('index.html'));

  const p2 = await ctx.newPage();
  await p2.goto(BASE + '/pages/reset-password.html?token=' + rt);
  await p2.waitForSelector('[data-view="problem"]:not([hidden])');
  t('reset: reused link shows "already used"', (await p2.locator('#problem-title').innerText()).includes('already used'));
  await p2.goto(BASE + '/pages/reset-password.html?token=' + 'd'.repeat(96));
  await p2.waitForSelector('[data-view="problem"]:not([hidden])');
  t('reset: invalid link message', (await p2.locator('#problem-title').innerText()).includes('not valid'));
  if (SHOTS) await p2.screenshot({ path: `${SHOTS}/reset-invalid.png`, fullPage: true });
  sql(`UPDATE login_attempts SET attempted_at = attempted_at - INTERVAL 2 HOUR WHERE email='${A}'`);
  await p2.goto(BASE + '/pages/forgot-password.html');
  await p2.fill('#email', A); await p2.click('#submit'); await p2.waitForSelector('[data-view="sent"]:not([hidden])');
  const et = await waitToken(A, 'reset-password.html', rt);
  sql(`UPDATE auth_tokens SET expires_at = UTC_TIMESTAMP() - INTERVAL 1 MINUTE WHERE selector='${et.slice(0, 32)}'`);
  await p2.goto(BASE + '/pages/reset-password.html?token=' + et);
  await p2.waitForSelector('[data-view="problem"]:not([hidden])');
  t('reset: expired link message', (await p2.locator('#problem-title').innerText()).includes('expired'));
  await p2.close();
  t('no JavaScript errors on the auth pages', errors.length === 0, errors);

  // ---------------- responsive ----------------
  const sizes = [['desktop', 1440, 900], ['laptop', 1280, 720], ['tablet', 834, 1112], ['tablet-landscape', 1112, 834],
                 ['mobile', 390, 844], ['small-mobile', 320, 568], ['mobile-landscape', 844, 390], ['small-landscape', 568, 320]];
  const screens = [
    ['login', '/pages/login.html', null],
    ['login-error', '/pages/login.html', async p => { await p.fill('#email', 'a-very-long-address-that-keeps-going@an-even-longer-domain-name.example.com'); await p.fill('#password', 'x'); await p.click('#submit'); await p.waitForSelector('#alert:not([hidden])'); }],
    ['register', '/pages/register.html', async p => { await p.fill('#password', 'abc'); await p.click('#submit'); }],
    ['register-sent', '/pages/register.html', async p => { await p.evaluate(() => { document.querySelector('#sent-email').textContent = 'a-very-long-address-that-keeps-going@an-even-longer-domain-name.example.com'; document.querySelectorAll('[data-view]').forEach(v => { v.hidden = v.dataset.view !== 'sent'; }); }); }],
    ['verify-invalid', '/pages/verify-email.html?token=' + 'e'.repeat(96), async p => { await p.waitForSelector('[data-view="result"]:not([hidden])'); }],
    ['forgot', '/pages/forgot-password.html', null],
    ['reset-form', '/pages/reset-password.html?token=x', async p => { await p.waitForSelector('[data-view="problem"]:not([hidden])'); await p.evaluate(() => document.querySelectorAll('[data-view]').forEach(v => { v.hidden = v.dataset.view !== 'form'; })); await p.fill('#password', 'Abc'); await p.click('#submit'); }],
    ['reset-invalid', '/pages/reset-password.html?token=x', async p => { await p.waitForSelector('[data-view="problem"]:not([hidden])'); }],
  ];
  for (const [label, w, h] of sizes) {
    const c = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: w < 900 && label.includes('mobile'), hasTouch: label.includes('mobile') });
    const p = await c.newPage();
    for (const [name, url, prep] of screens) {
      await p.goto(BASE + url); await p.waitForLoadState('networkidle');
      if (prep) await prep(p);
      await p.waitForTimeout(150);
      const m = await p.evaluate(() => {
        const de = document.documentElement;
        const card = document.querySelector('.auth-card').getBoundingClientRect();
        const offenders = [...document.querySelectorAll('.auth-card *')].filter(el => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && (r.right > card.right + 1 || r.left < card.left - 1) && getComputedStyle(el).position !== 'absolute';
        }).map(el => el.tagName + '.' + el.className).slice(0, 3);
        const btns = [...document.querySelectorAll('.auth-card button, .auth-card .btn')].filter(b => b.offsetParent && b.getBoundingClientRect().height < 30 && !b.classList.contains('btn-link') && !b.classList.contains('auth-pw-toggle'));
        return { overflow: de.scrollWidth - de.clientWidth, cardFits: card.left >= 0 && card.right <= de.clientWidth + 0.5, offenders, smallButtons: btns.length };
      });
      t(`${label} ${w}x${h} ${name}: no horizontal overflow`, m.overflow <= 0 && m.cardFits && m.offenders.length === 0, m);
      t(`${label} ${w}x${h} ${name}: buttons are comfortably tappable`, m.smallButtons === 0, m);
      if (SHOTS && ['desktop', 'tablet', 'mobile', 'mobile-landscape', 'small-mobile'].includes(label)) await p.screenshot({ path: `${SHOTS}/${label}-${name}.png`, fullPage: true });
    }
    await c.close();
  }

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
