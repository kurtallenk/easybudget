/* ============================================================
   Round 3 · design templates, shell and responsive regression
   ?only=template  - run by run.sh at desktop and mobile widths.
   Verifies: template switching + persistence (server + local mirror),
   no data mutation, theme/accent still work, grouped nav, bottom nav,
   every route renders under every template without horizontal overflow.
   ============================================================ */
window.TemplateTests = async ({ t, log, tick, $, $$, txt, click, S }) => {
  const html = document.documentElement;
  const W = window.innerWidth;
  const dataSnap = () => { const d = Store.get(); const o = {}; Object.keys(d).filter(k => k !== 'settings').forEach(k => { o[k] = d[k]; }); return JSON.stringify(o); };
  const ROUTES = ['dashboard', 'transactions', 'accounts', 'budget', 'goals', 'bills', 'recurring', 'grocery', 'analytics', 'summary', 'settings'];
  const card = id => $(`.tpl-card[data-arg="${id}"]`);

  log(`SHELL (${W}px)`);
  App.go('dashboard'); await tick(120);
  t('five nav groups', $$('#nav .nav-group').length === 5, $$('#nav .nav-group').length);
  t('group labels', ['Overview', 'Money', 'Planning', 'Insights', 'System'].every(g => $$('#nav .nav-label').some(l => txt(l) === g)));
  t('every route reachable from nav', ROUTES.every(r => $(`#nav [data-action="go"][data-arg="${r}"]`)));
  t('active nav item marked', $('#nav [aria-current="page"]')?.dataset.arg === 'dashboard');
  t('bottom nav has More', !!$('#bn-more') && $('#bn-more').dataset.action === 'open-nav');
  App.go('goals'); await tick(80);
  t('More reads as current for drawer-only pages', $('#bn-more').getAttribute('aria-current') === 'true');
  App.go('budget'); await tick(80);
  t('bottom nav marks Budget', $('.bottomnav [data-arg="budget"]').getAttribute('aria-current') === 'page' && !$('#bn-more').hasAttribute('aria-current'));
  click($('#bn-more')); await tick(60);
  t('More opens the drawer', $('#sidebar').classList.contains('open'));
  await tick(320);                       // let the slide-in transition finish
  const onTop = e => { if (!e) return false; const r = e.getBoundingClientRect(); const h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!h && e.contains(h); };
  const so = $('.sidebar [data-action="sign-out"]'), qa = $('.sidebar [data-action="quick-add"]'), sb = $('#sidebar').getBoundingClientRect();
  t('drawer fits the viewport', sb.top >= 0 && sb.bottom <= window.innerHeight + 1);
  t('drawer Sign out not covered (bottom nav / viewport)', onTop(so) && so.getBoundingClientRect().bottom <= window.innerHeight);
  t('drawer Add transaction not covered', onTop(qa));
  t('drawer Sign out has a visible label and 44px target', window.innerWidth > 1024 || (txt(so).includes('Sign out') && so.getBoundingClientRect().height >= 44));
  t('drawer footer does not overlap the nav list', $('#nav').getBoundingClientRect().bottom <= $('.sidebar-foot').getBoundingClientRect().top + 1);
  click($('#nav-scrim')); await tick(60);
  t('scrim closes the drawer', !$('#sidebar').classList.contains('open'));
  t('sign-out button labelled', $('.sidebar [data-action="sign-out"]')?.getAttribute('aria-label') === 'Sign out');

  log('DASHBOARD');
  App.go('dashboard'); await tick(150);
  t('four primary KPIs', $$('.kpis .kpi').length === 4);
  t('supporting metrics row', $$('.minis .mini').length === 4);
  t('charts mounted', !!$('#ch-ie svg'));
  t('needs-attention panel', !!$('#dash-attn-h'));
  t('dashboard keeps add-tx action', !!$('#main-content [data-action="add-tx"]'));

  log('TEMPLATE SWITCH');
  App.go('settings'); await tick(120);
  t('four template cards', $$('.tpl-card').length === 4 && !!card('futuristic'));
  t('modern selected by default', html.dataset.template === 'modern' && card('modern').getAttribute('aria-pressed') === 'true');
  const before = dataSnap();
  const callsBefore = S.calls.length;
  click(card('classic')); await tick(150);
  t('html[data-template] switches immediately', html.dataset.template === 'classic');
  t('route preserved', App.state.route === 'settings' && location.hash === '#/settings');
  t('card shows selected', card('classic').getAttribute('aria-pressed') === 'true' && card('modern').getAttribute('aria-pressed') === 'false');
  t('saved on the server', S.settings.designTemplate === 'classic');
  t('only the settings endpoint was called', S.calls.slice(callsBefore).every(c => c === 'settings/update.php'), S.calls.slice(callsBefore));
  t('local mirror written', localStorage.getItem('bp_design_template') === 'classic');
  t('confirmation toast', $$('.toast.success').some(x => txt(x).includes('Design template applied')));
  t('financial data untouched', dataSnap() === before);
  t('tokens applied (classic card radius)', getComputedStyle(html).getPropertyValue('--card-radius').trim() === '6px');

  log('PERSISTENCE');
  await Store.hydrate(); App.render(); await tick(80);
  t('survives re-hydration from the server', Store.settings().designTemplate === 'classic' && html.dataset.template === 'classic');
  S.templateColumn = false;              // server without migration 006
  click(card('minimal')); await tick(150);
  t('un-migrated server: switch still applies', html.dataset.template === 'minimal');
  t('un-migrated server: no error toast', !$$('.toast.error').length);
  await Store.hydrate(); App.render(); await tick(80);
  t('un-migrated server: local mirror keeps choice', Store.settings().designTemplate === 'minimal' && html.dataset.template === 'minimal');
  S.templateColumn = true;

  log('THEME + ACCENT');
  click($('[data-action="theme"][data-arg="dark"]')); await tick(80);
  t('theme dark applies', html.dataset.theme === 'dark' && html.dataset.template === 'minimal');
  click($('[data-action="hue"][data-arg="160"]')); await tick(80);
  t('accent hue applies', html.style.getPropertyValue('--brand-h') === '160');
  click($('[data-action="theme"][data-arg="light"]')); await tick(80);
  click($('[data-action="hue"][data-arg="221"]')); await tick(80);
  t('theme back to light', html.dataset.theme === 'light');

  log('FUTURISTIC (GAME HUD)');
  App.go('dashboard'); await tick(150);
  const kpiText = () => $$('.kpis .kpi-value').map(e => e.textContent.trim()).join('|');
  const modernKpis = kpiText();
  t('HUD modules hidden in other templates', !!$('.hud-cmd') && getComputedStyle($('.hud-cmd')).display === 'none');
  App.go('settings'); await tick(80);
  const fBefore = dataSnap();
  click(card('futuristic')); await tick(150);
  t('futuristic applies immediately', html.dataset.template === 'futuristic' && card('futuristic').getAttribute('aria-pressed') === 'true');
  t('futuristic saved on the server', S.settings.designTemplate === 'futuristic');
  t('futuristic local mirror written', localStorage.getItem('bp_design_template') === 'futuristic');
  t('HUD palette is dark even in light theme', html.dataset.theme === 'light' && getComputedStyle(document.body).color === 'rgb(227, 244, 248)');
  t('HUD settings label shown', getComputedStyle($('.hud-page-kicker')).display !== 'none');
  App.go('dashboard'); await tick(150);
  const cmd = $('.hud-cmd');
  t('command center visible', !!cmd && getComputedStyle(cmd).display !== 'none');
  t('system status is a real label', /System status (Stable|Caution|Alert)/.test(txt($('.hud-status'))));
  t('four HUD gauges', $$('.hud-gauge').length === 4);
  t('HUD gauges expose progressbar semantics', $$('.hud-bar[role="progressbar"]').every(b => b.hasAttribute('aria-valuenow') && b.getAttribute('aria-label')));
  t('budget status stated in text', !$('.bud-total') || /Status: (Within limit|Near limit|Over limit)/.test(txt($('.bud-total .hud-state'))));
  t('same KPI values as modern', kpiText() === modernKpis);
  t('activity feed timestamps', !$$('#main-content .list-row').length || $$('.feed-ts').some(e => getComputedStyle(e).display !== 'none'));
  t('goal ring replaced by linear gauge', !$('.goal-mini') || (getComputedStyle($('.goal-mini .goal-ring')).display === 'none' && !!$('.goal-mini .gm-hud .hud-bar')));
  t('charts still mounted', !!$('#ch-ie svg'));
  t('dashboard actions preserved', !!$('#main-content [data-action="add-tx"]') && !!$('#main-content [data-action="go"][data-arg="budget"]'));
  t('no horizontal overflow (futuristic dashboard)', document.documentElement.scrollWidth <= window.innerWidth + 1);
  t('futuristic switch did not touch data', dataSnap() === fBefore);
  await Store.hydrate(); App.render(); await tick(80);
  t('futuristic survives re-hydration', html.dataset.template === 'futuristic');

  log(`ROUTES × TEMPLATES (${W}px)`);
  for (const tpl of ['modern', 'classic', 'minimal', 'futuristic']) {
    App.go('settings'); await tick(60);
    if (html.dataset.template !== tpl) { click(card(tpl)); await tick(100); }
    const broken = [], wide = [];
    for (const r of ROUTES) {
      App.go(r); await tick(90);
      if (/went wrong/.test(txt($('#main-content .empty h3')) || '')) broken.push(r);
      if (document.documentElement.scrollWidth > window.innerWidth + 1) wide.push(r);
    }
    t(`${tpl}: every route renders`, !broken.length, broken);
    t(`${tpl}: no horizontal page overflow`, !wide.length, wide);
  }
  App.go('settings'); await tick(60); click(card('modern')); await tick(120);
  t('ends on modern', html.dataset.template === 'modern' && S.settings.designTemplate === 'modern');
  t('data still untouched after all switches', dataSnap() === before);
};
