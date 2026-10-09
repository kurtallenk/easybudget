// Visual QA: node tools/grocery-tests/shoot.js <outDir> <routes,comma> <widths,comma> [query]
// Needs NODE_PATH pointing at a playwright install and a server on :8731.
const { chromium } = require('playwright');
(async () => {
  const [out = '/data/shots', routes = 'dashboard', widths = '1280', query = ''] = process.argv.slice(2);
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/local/bin/chromium', args: ['--no-sandbox'] });
  const report = [];
  for (const w of widths.split(',').map(Number)) {
    const h = w >= 1024 ? 900 : w >= 768 ? 1112 : w >= 380 ? 844 : 568;
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    for (const r of routes.split(',')) {
      await page.goto(`http://127.0.0.1:8731/tools/grocery-tests/preview.html${query}#/${r}`);
      await page.waitForTimeout(700);
      const o = await page.evaluate(() => {
        const vw = document.documentElement.clientWidth;
        const off = [...document.querySelectorAll('#main-content *, .topbar *, .bottomnav *')].filter(n => {
          const b = n.getBoundingClientRect(); if (!b.width) return false;
          const cs = getComputedStyle(n); if (cs.position === 'fixed') return false;
          return b.right > vw + 1 || b.left < -1;
        }).filter(n => !n.closest('.tbl-wrap:not(.responsive)')).slice(0, 5).map(n => n.className || n.tagName);
        return { sw: document.documentElement.scrollWidth, vw, off };
      });
      const file = `${out}/${r}-${w}${query.replace(/[^a-z0-9]/gi, '_')}.png`;
      await page.screenshot({ path: file, fullPage: true });
      report.push(`${r}@${w}: scrollW=${o.sw} vw=${o.vw} ${o.sw > o.vw ? 'OVERFLOW' : 'ok'} ${o.off.length ? 'offenders=' + JSON.stringify(o.off) : ''}`);
    }
    if (errors.length) report.push(`ERRORS@${w}: ${errors.slice(0, 5).join(' | ')}`);
    await page.close();
  }
  console.log(report.join('\n'));
  await browser.close();
})();
