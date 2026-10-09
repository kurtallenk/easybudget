// Real-time (animations ON) run of the design-template suite via Playwright.
// Complements run.sh, whose template passes use reduced motion because CSS
// animations stall Chromium's --virtual-time-budget clock.
// Usage (server on 127.0.0.1:8731 serving the project root):
//   NODE_PATH=/vercel/sandbox/node_modules node tools/grocery-tests/realtime.js
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/local/bin/chromium', args: ['--no-sandbox'] });
  let failed = 0;
  for (const [w, h] of [[1280, 900], [390, 844]]) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('http://127.0.0.1:8731/tools/grocery-tests/runner.html?only=template');
    await page.waitForFunction(() => /__RESULTS_END__/.test(document.body.innerText), null, { timeout: 120000 });
    const text = await page.evaluate(() => document.body.innerText);
    const line = (text.match(/\d+ passed, \d+ failed/) || ['no result'])[0];
    const fails = text.split('\n').filter(l => /^\s*FAIL/.test(l));
    console.log(`template · animated · ${w}x${h}: ${line}${errors.length ? ` · page errors: ${errors.length}` : ''}`);
    fails.forEach(f => console.log('  ' + f.trim()));
    if (!/ 0 failed/.test(line) || errors.length) failed = 1;
    await page.close();
  }
  await browser.close();
  process.exit(failed);
})();
