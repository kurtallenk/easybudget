const { makeServer, boot, tick } = require('./harness');
(async () => {
  const S = makeServer(); const { w, doc } = await boot(S, '#/dashboard');
  let bad = 0;
  for (const r of ['dashboard','transactions','budget','accounts','goals','bills','recurring','analytics','summary','settings','grocery']) {
    w.eval(`App.go('${r}')`); await tick(80);
    const err = doc.querySelector('#main-content .empty h3')?.textContent || '';
    const broke = /went wrong/.test(err);
    if (broke) bad++;
    console.log((broke ? 'FAIL ' : 'ok   ') + r, broke ? err : '', doc.querySelector('#page-title').textContent);
  }
  console.log(bad ? 'SMOKE FAILED' : 'SMOKE OK'); process.exit(bad ? 1 : 0);
})();
