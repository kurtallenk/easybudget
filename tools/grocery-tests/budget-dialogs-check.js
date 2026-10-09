// Budget page "Load Saved Budgets" dialog + chart tooltip geometry (Playwright).
// NODE_PATH=/vercel/sandbox/node_modules node tools/grocery-tests/budget-dialogs-check.js [WxH,...] [template] [shotDir] [theme]
const { chromium } = require('playwright');
(async () => {
  const sizes = (process.argv[2] || '320x568,375x667,390x844,430x932,834x1112,1280x900,1440x900').split(',');
  const tpl = process.argv[3] || 'modern', dir = process.argv[4] || '', theme = process.argv[5] || '';
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/local/bin/chromium', args: ['--no-sandbox'] });
  let bad = 0;
  for (const s of sizes) {
    const [w, h] = s.split('x').map(Number);
    const p = await b.newPage({ viewport: { width: w, height: h } }); const errs = [];
    p.on('pageerror', e => errs.push(e.message));
    await p.goto(`http://127.0.0.1:8731/tools/grocery-tests/preview.html?tpl=${tpl}#/budget`); await p.waitForTimeout(900);
    if (theme) { await p.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme); }
    // Seed two saved budgets through the real Store API when the preview has none.
    await p.evaluate(async () => {
      if (Store.savedBudgets().length) return;
      const ym = App.state.month;
      if (!((Store.budgetFor(ym) || {}).lines || []).length) Store.setBudgetLine(ym, Store.get().categories.find(c => c.type !== 'income').id, 50000);
      await Store.saveBudget({ name: 'Monthly Budget' }); await Store.saveBudget({ name: 'Family Budget with a rather long descriptive name' });
      App.render();
    }).catch(e => errs.push('seed: ' + e.message));
    await p.waitForTimeout(300);
    const geo = () => p.evaluate(() => {
      const m = [...document.querySelectorAll('.modal')].pop(); if (!m) return { open: false };
      const r = m.getBoundingClientRect(), vw = innerWidth, vh = innerHeight;
      const btns = [...m.querySelectorAll('button')].map(x => x.getBoundingClientRect()).filter(x => x.width);
      const escapees = [...m.querySelectorAll('*')].filter(e => { const x = e.getBoundingClientRect(); return x.width > 0 && x.height > 0 && (x.right > r.right + 1 || x.left < r.left - 1); }).length;
      return { open: true, title: m.getAttribute('aria-label'), cards: m.querySelectorAll('.saved-tpl-card').length, inside: r.left >= 0 && r.top >= 0 && r.right <= vw && r.bottom <= vh,
        btnsInside: btns.every(x => x.right <= r.right + 1 && x.left >= r.left - 1), escapees, pageX: document.documentElement.scrollWidth > vw };
    });
    const page = await p.evaluate(() => ({ savedOnPage: !!document.querySelector('#main-content .bud-saved'), btn: !!document.querySelector('[data-action="budget-saved"]'), pageX: document.documentElement.scrollWidth > innerWidth }));
    if (dir) await p.screenshot({ path: `${dir}/bud-${tpl}${theme}-${w}.png`, fullPage: true });
    await p.click('[data-action="budget-saved"]'); await p.waitForTimeout(350);
    const dlg = await geo();
    if (dir) await p.screenshot({ path: `${dir}/bud-dlg-${tpl}${theme}-${w}.png` });
    await p.keyboard.press('Escape'); await p.waitForTimeout(250);
    // Tooltips: focus every chart target on the budget page and the dashboard.
    const tips = async () => p.evaluate(async () => {
      const out = [];
      for (const n of document.querySelectorAll('.chart [tabindex]')) {
        const host = n.closest('.chart'); n.dispatchEvent(new Event('focus')); await new Promise(r => setTimeout(r, 20));
        const tip = host.querySelector('.tip'); if (!tip) continue;
        const hr = host.getBoundingClientRect(), tr = tip.getBoundingClientRect(), cs = getComputedStyle(tip);
        const ok = tr.top >= hr.top - 0.5 && tr.bottom <= hr.bottom + 0.5 && tr.left >= hr.left - 0.5 && tr.right <= hr.right + 0.5 && cs.color !== cs.backgroundColor && tip.textContent.trim().length > 0;
        if (!ok) out.push({ id: host.id, tip: tip.textContent.slice(0, 40), tr: [tr.left, tr.top, tr.right, tr.bottom].map(Math.round), hr: [hr.left, hr.top, hr.right, hr.bottom].map(Math.round) });
        n.dispatchEvent(new Event('blur'));
      }
      return { checked: document.querySelectorAll('.chart [tabindex]').length, bad: out };
    });
    const tBud = await tips();
    await p.evaluate(() => App.go('dashboard')); await p.waitForTimeout(500);
    const tDash = await tips();
    await p.evaluate(() => App.go('analytics')); await p.waitForTimeout(500);
    const tAn = await tips();
    const ok = !page.savedOnPage && page.btn && !page.pageX && dlg.open && dlg.cards >= 1 && dlg.inside && dlg.btnsInside && !dlg.escapees && !dlg.pageX
      && !tBud.bad.length && !tDash.bad.length && !tAn.bad.length && !errs.length;
    if (!ok) bad++;
    console.log(`${s} ${tpl}${theme ? '/' + theme : ''} ${ok ? 'OK ' : 'BAD'} page=${JSON.stringify(page)} dlg=${JSON.stringify(dlg)} tips=${tBud.checked}/${tDash.checked}/${tAn.checked} badTips=${JSON.stringify([...tBud.bad, ...tDash.bad, ...tAn.bad]).slice(0, 400)} errs=${JSON.stringify(errs)}`);
    await p.close();
  }
  await b.close(); process.exit(bad ? 1 : 0);
})();
