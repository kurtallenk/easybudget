// Live Grocery List dialogs: geometry + overflow check (Playwright, real time).
// NODE_PATH=/vercel/sandbox/node_modules node tools/grocery-tests/grocery-dialogs-check.js [WxH,...] [template] [shotDir]
const { chromium } = require('playwright');
(async () => {
  const sizes = (process.argv[2] || '320x568,375x667,390x844,430x932,834x1112,1280x900,1440x900').split(',');
  const tpl = process.argv[3] || 'modern', dir = process.argv[4] || '';
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/local/bin/chromium', args: ['--no-sandbox'] });
  let bad = 0;
  for (const s of sizes) {
    const [w, h] = s.split('x').map(Number);
    const p = await b.newPage({ viewport: { width: w, height: h } }); const errs = [];
    p.on('pageerror', e => errs.push(e.message));
    await p.goto(`http://127.0.0.1:8731/tools/grocery-tests/preview.html?tpl=${tpl}#/grocery`); await p.waitForTimeout(900);
    if (dir) await p.screenshot({ path: `${dir}/gro-${tpl}-${w}.png`, fullPage: true });
    const geo = () => p.evaluate(() => {
      const m = [...document.querySelectorAll('.modal')].pop(); if (!m) return { open: false };
      const r = m.getBoundingClientRect(), vw = innerWidth, vh = innerHeight;
      const btns = [...m.querySelectorAll('.modal-foot button, .modal-head button')].map(x => x.getBoundingClientRect());
      const wide = [...m.querySelectorAll('*')].filter(e => { const x = e.getBoundingClientRect(); return x.width > 0 && x.height > 0 && (x.right > r.right + 1 || x.left < r.left - 1); }).length;
      return { open: true, inside: r.left >= 0 && r.top >= 0 && r.right <= vw && r.bottom <= vh, btnsInside: btns.every(x => x.bottom <= r.bottom + 1 && x.right <= r.right + 1 && x.left >= r.left - 1),
        escapees: wide, pageX: document.documentElement.scrollWidth > vw, focusIn: m.contains(document.activeElement), label: m.getAttribute('aria-label') };
    });
    const onPage = await p.evaluate(() => ({ formOnPage: !!document.querySelector('#main-content #gro-form'), savedOnPage: !!document.querySelector('#main-content .gro-saved'), pageX: document.documentElement.scrollWidth > innerWidth }));
    await p.click('[data-action="grocery-add"]'); await p.waitForTimeout(350);
    const add = await geo();
    if (dir && w <= 430) await p.screenshot({ path: `${dir}/gro-add-${tpl}-${w}.png` });
    await p.keyboard.press('Escape'); await p.waitForTimeout(250);
    await p.click('[data-action="grocery-lists"]'); await p.waitForTimeout(350);
    const lists = await geo();
    if (dir) await p.screenshot({ path: `${dir}/gro-lists-${tpl}-${w}.png` });
    const ok = !onPage.formOnPage && !onPage.savedOnPage && !onPage.pageX && add.inside && add.btnsInside && !add.escapees && !add.pageX && add.focusIn && lists.inside && lists.btnsInside && !lists.escapees && !lists.pageX && !errs.length;
    if (!ok) bad++;
    console.log(`${s} ${tpl} ${ok ? 'OK ' : 'BAD'} page=${JSON.stringify(onPage)} add=${JSON.stringify(add)} lists=${JSON.stringify(lists)} errs=${errs.length}`);
    await p.close();
  }
  await b.close(); process.exit(bad ? 1 : 0);
})();
