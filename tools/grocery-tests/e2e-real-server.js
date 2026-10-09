// Round 10 end-to-end test against the REAL PHP + MySQL stack (Playwright).
// Usage: BASE=http://127.0.0.1:8080 DB_CLI="mysql -u root -p… budget_planner" SHOTS=/tmp \
//        NODE_PATH=/vercel/sandbox/node_modules node tools/grocery-tests/e2e-real-server.js
// Registers two users, promotes one by SQL, drives admin + user + second device in separate browser contexts.
const { chromium } = require('playwright');
const { execSync } = require('child_process');
const BASE = process.env.BASE || 'http://127.0.0.1:8080';
const DB_CLI = process.env.DB_CLI || 'mysql budget_planner';
const sql = q => execSync(`${DB_CLI} -N -B -e "${q}"`).toString().trim();
const stamp = Date.now();
const ADMIN = `boss${stamp}@example.com`, USER = `maria${stamp}@example.com`, PW = 'CorrectHorse9!';
let pass = 0, fail = 0; const t = (n, c, x) => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'} ${n}${c ? '' : ' ' + JSON.stringify(x ?? '')}`); };
(async () => {
  const browser = await chromium.launch({ executablePath: execSync('which chromium').toString().trim(), args: ['--no-sandbox'] });
  const ctx = async (vp) => browser.newContext({ viewport: vp, deviceScaleFactor: 1 });
  const api = async (page, path, body) => page.evaluate(async ([path, body]) => {
    const s = await (await fetch('/api/auth/session.php')).json();
    const r = await fetch('/api/' + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': s.data.csrfToken }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json().catch(() => null) };
  }, [path, body]);
  // Registration leaves the account unverified; confirm it by SQL (the link flow
  // is covered by tools/auth_runtime_tests.py) so login() can sign in.
  const register = async (page, email, name) => { await page.goto(BASE + '/api/auth/session.php'); const r = await api(page, 'auth/register.php', { email, password: PW, displayName: name }); sql(`UPDATE users SET email_verified_at = UTC_TIMESTAMP() WHERE email='${email}'`); return r; };
  const login = async (page, email) => { await page.goto(BASE + '/api/auth/session.php'); await api(page, 'auth/login.php', { email, password: PW }); await page.goto(BASE + '/index.html#/dashboard'); await page.waitForSelector('.app'); await page.waitForTimeout(600); };
  const overflow = page => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

  // setup users
  const a = await (await ctx({ width: 1280, height: 900 })).newPage();
  const u = await (await ctx({ width: 390, height: 844 })).newPage();
  t('register admin', (await register(a, ADMIN, 'Boss Admin')).status === 201);
  t('register user', (await register(u, USER, 'Maria Cruz')).status === 201);
  sql(`UPDATE users SET role='super_admin' WHERE email='${ADMIN}'`);
  sql(`UPDATE user_settings s JOIN users x ON x.id=s.user_id SET s.onboarded=1 WHERE x.email IN ('${ADMIN}','${USER}')`);
  await login(a, ADMIN); await login(u, USER);

  // normal user: no admin
  t('normal user has no Super Admin menu', !(await u.$('.nav-admin')));
  await u.goto(BASE + '/index.html#/admin'); await u.reload(); await u.waitForSelector('.app'); await u.waitForTimeout(700);
  t('normal user sees access denied on #/admin', (await u.textContent('#main-content')).includes('Super Admin access required'));
  t('normal user admin API → 403', (await api(u, 'admin/overview.php')).status === 403);

  // admin area
  await a.click('.nav-admin [data-arg="admin"]'); await a.waitForSelector('.adm-banner');
  await a.screenshot({ path: (process.env.SHOTS || '/tmp') + '/admin-dashboard-1280.png', fullPage: true });
  await a.click('.adm-tab[data-id="messages"]'); await a.waitForSelector('#adm-msg-form');
  await a.fill('#adm_m_title', 'Budget system maintenance'); await a.fill('#adm_m_body', 'The budget page will be offline tonight at 10pm for 15 minutes.');
  await a.selectOption('#adm_m_type', 'important');
  await a.click('#adm-msg-send'); await a.waitForTimeout(900);
  t('admin sent message to all users', sql(`SELECT COUNT(*) FROM admin_posts WHERE title='Budget system maintenance' AND audience='all'`) !== '0');
  await a.check('input[name="audience"][value="selected"]'); await a.waitForSelector('#adm-pick-q');
  await a.fill('#adm-pick-q', USER); await a.waitForTimeout(700);
  await a.check('[data-pick]'); await a.fill('#adm_m_title', 'Welcome, Maria'); await a.fill('#adm_m_body', 'Thanks for trying Easy Budget Planner.');
  await a.screenshot({ path: (process.env.SHOTS || '/tmp') + '/admin-messages-1280.png', fullPage: true });
  await a.click('#adm-msg-send'); await a.waitForTimeout(900);
  const uid = sql(`SELECT id FROM users WHERE email='${USER}'`);
  t('specific-user message delivered only to Maria', sql(`SELECT GROUP_CONCAT(n.user_id) FROM notifications n WHERE n.id=(SELECT id FROM admin_posts WHERE title='Welcome, Maria' ORDER BY created_at DESC LIMIT 1)`) === uid);
  await a.click('.adm-tab[data-id="news"]'); await a.waitForSelector('#adm-news-form');
  await a.fill('#adm_n_title', 'NEW FEATURE ADDED'); await a.fill('#adm_n_body', 'Savings Goals have been improved.'); await a.fill('#adm_n_details', 'Track progress with new charts.'); await a.fill('#adm_n_link', 'goals');
  await a.click('#adm-news-send'); await a.waitForTimeout(900);
  t('news persisted', sql(`SELECT COUNT(*) FROM admin_posts WHERE kind='news' AND title='NEW FEATURE ADDED'`) !== '0');
  await a.screenshot({ path: (process.env.SHOTS || '/tmp') + '/admin-news-1280.png', fullPage: true });

  // user phone: receives
  await u.goto(BASE + '/index.html#/inbox'); await u.reload(); await u.waitForSelector('.ntf-item'); await u.waitForTimeout(500);
  const titles = await u.$$eval('.ntf-item.unread .ntf-title', n => n.map(x => x.textContent));
  t('user inbox shows admin items unread', ['NEW FEATURE ADDED', 'Welcome, Maria', 'Budget system maintenance'].every(x => titles.includes(x)), titles);
  const unread1 = await u.evaluate(() => Notifications.unreadCount());
  await u.screenshot({ path: (process.env.SHOTS || '/tmp') + '/user-inbox-390.png', fullPage: true });
  t('inbox 390: no horizontal overflow', (await overflow(u)) <= 0);
  await u.click('.ntf-item.unread:has-text("Welcome, Maria") .ntf-open'); await u.waitForTimeout(700);

  // second device (fresh context, no localStorage) sees the same state
  const d2 = await (await ctx({ width: 1280, height: 900 })).newPage(); await login(d2, USER);
  let unread2 = await d2.evaluate(() => Notifications.unreadCount());
  t('second device: same unread count after read on phone', unread2 === unread1 - 1, [unread1, unread2]);
  const readOnD2 = await d2.evaluate(() => Notifications.list().find(x => x.title === 'Welcome, Maria').read);
  t('second device: message shows as read', readOnD2 === true);
  await d2.goto(BASE + '/index.html#/inbox'); await d2.waitForTimeout(400);
  await d2.click('[data-action="ntf-all"]'); await d2.waitForTimeout(800);
  await u.evaluate(() => window.dispatchEvent(new Event('focus'))); await u.waitForTimeout(1200);
  t('Mark all on device 2 → phone updates on focus (no reload)', (await u.evaluate(() => Notifications.unreadCount())) === 0);
  await u.reload(); await u.waitForSelector('.app'); await u.waitForTimeout(700);
  t('phone after refresh: still all read', (await u.evaluate(() => Notifications.unreadCount())) === 0 && !(await u.$('#nav [data-arg="inbox"] .nav-badge')));
  t('DB rows: all read for Maria', sql(`SELECT COUNT(*) FROM notifications WHERE user_id=${uid} AND read_at IS NULL`) === '0');

  // mobile admin screenshots at 390 + 320 in futuristic + modern
  for (const [w, h, tpl] of [[390, 844, 'modern'], [320, 568, 'futuristic'], [390, 844, 'futuristic'], [834, 1112, 'classic']]) {
    const p = await (await ctx({ width: w, height: h })).newPage(); await login(p, ADMIN);
    await p.evaluate(tpl => { document.documentElement.setAttribute('data-template', tpl); }, tpl);
    await p.goto(BASE + '/index.html#/admin'); await p.waitForSelector('.adm-banner'); await p.evaluate(tpl => document.documentElement.setAttribute('data-template', tpl), tpl);
    for (const tab of ['dashboard', 'users', 'messages', 'news']) {
      await p.click(`.adm-tab[data-id="${tab}"]`); await p.waitForTimeout(600);
      if (tab === 'messages') { await p.check('input[name="audience"][value="selected"]'); await p.waitForTimeout(700); }
      const ov = await overflow(p);
      t(`admin ${tab} @${w} ${tpl}: no horizontal overflow`, ov <= 0, ov);
      const small = await p.$$eval('.adm-post-actions .btn, .adm-tab, .adm-radio, .adm-pick-item, .adm-form-foot .btn', els => els.filter(e => e.offsetParent && e.getBoundingClientRect().height < 44).length);
      if (w <= 640) t(`admin ${tab} @${w}: touch targets ≥44px`, small === 0, small);
      await p.screenshot({ path: `/data/shots/admin-${tab}-${w}-${tpl}.png`, fullPage: true });
    }
    await p.click('.adm-tab[data-id="news"]'); await p.waitForTimeout(400);
    const ed = await p.$('[data-adm="edit"]'); if (ed) { await ed.click(); await p.waitForSelector('.modal');
      const r = await p.$eval('.modal', m => { const b = m.getBoundingClientRect(); return [b.left, b.right, b.top, b.bottom, innerWidth, innerHeight]; });
      t(`edit dialog fits @${w}`, r[0] >= 0 && r[1] <= r[4] && r[2] >= 0 && r[3] <= r[5], r);
      await p.screenshot({ path: `/data/shots/admin-edit-${w}-${tpl}.png` }); }
    await p.context().close();
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
