/* ============================================================
   Round 7 · greeting, optional onboarding, contextual tooltips
   Loaded by tests.js with ?only=onboarding (run.sh: several sizes).
   ============================================================ */
window.OnboardingTests = async ({ t, log, tick, $, $$, txt, click, submit, S }) => {
  const W = () => document.documentElement.clientWidth, H = () => window.innerHeight;
  const label = `${W()}×${H()}`;
  const h3 = () => txt($('.modal .onboard-step h3'));
  const foot = l => $$('.modal .modal-foot button').find(b => txt(b) === l);
  const tipEl = () => $('#ctx-tip');
  const tipOn = () => !!tipEl() && tipEl().classList.contains('on');
  const inView = r => r.left >= 0 && r.top >= 0 && r.right <= W() + 0.5 && r.bottom <= H() + 0.5;
  const tap = el => {
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }));
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  };

  log(`GREETING @ ${label}`);
  App.go('dashboard'); await tick(200);
  const u = Store.user();
  const had = u.displayName;
  delete u.displayName; App.render(); await tick(80);
  t('greeting shown without a name', txt($('.dash-hello-t')) === 'Welcome back', txt($('.dash-hello-t')));
  t('fallback flagged', $('.dash-hello').dataset.hasName === 'no');
  u.displayName = '  Maria  Clara '; App.render(); await tick(80);
  t('greeting uses the account display name', txt($('.dash-hello-t')) === 'Welcome back, Maria', txt($('.dash-hello-t')));
  u.displayName = '<img src=x onerror=alert(1)>'; App.render(); await tick(80);
  t('name is escaped', !$('.dash-hello img'));
  u.displayName = 'Maria Clara'; App.render(); await tick(80);
  t('overview line names the month', txt($('.dash-hello-s')).includes(Core.monthLabel(App.state.month)));
  t('greeting does not overflow', $('.dash-hello').scrollWidth <= $('.dash-hello').clientWidth + 1 && document.documentElement.scrollWidth <= W() + 1);

  log(`ONBOARDING @ ${label}`);
  localStorage.removeItem('bp_onboarding_completed'); localStorage.removeItem('bp_onboarding_status'); localStorage.removeItem('bp_onboarding_resume');
  Onboarding.maybeStart(); await tick(80);
  t('not shown when the account is already onboarded', !$('.modal'));
  Store.settings().onboarded = false; S.settings.onboarded = false;
  Onboarding.maybeStart(); await tick(120);
  t('shown to a first-time user', !!$('.modal') && $('.modal').getAttribute('aria-label') === 'Setup guide');
  t('step 1 is Welcome', h3() === 'Welcome to Easy Budget Planner', h3());
  t('step 1 offers Skip and Get Started', !!foot('Skip') && !!foot('Get Started'));
  t('close button present', !!$('.modal .modal-head .icon-btn'));
  click(foot('Skip')); await tick(250);
  t('Skip closes the guide', !$('.modal'));
  t('skipped remembered on this device', localStorage.getItem('bp_onboarding_status') === 'skipped');
  t('skipped remembered on the account', S.settings.onboarded === true, S.settings.onboarded);
  Store.settings().onboarded = false;
  Onboarding.maybeStart(); await tick(120);
  t('does not reappear after skip', !$('.modal'));

  App.go('settings'); await tick(150);
  const rb = $$('[data-action="show-guide"]').find(b => txt(b).includes('Restart Onboarding'));
  t('Settings has Restart Onboarding', !!rb);
  click(rb); await tick(150);
  t('restart opens step 1', h3() === 'Welcome to Easy Budget Planner');
  click(foot('Get Started')); await tick(60);
  const order = [h3()];
  t('step 2 explains accounts', h3() === 'Add your accounts' && ['Cash', 'Bank accounts', 'E-wallets'].every(w => txt($('.modal-body')).includes(w)));
  t('step 2 offers Set Up Accounts and Next', !!foot('Set Up Accounts') && !!foot('Next') && !!foot('Back'));
  t('step counter', txt($('.onboard-count')) === 'Step 2 of 8');
  for (let i = 0; i < 6; i++) { click(foot('Next')); await tick(40); order.push(h3()); }
  t('flow: Accounts → Transactions → Budget → Goals → Bills/Recurring → Finish',
    JSON.stringify(order) === JSON.stringify(['Add your accounts', 'Record income & transactions', 'Create your first budget', 'Savings goals (optional)', 'Bills & recurring payments', 'Recurring payments', 'You\u2019re all set']), order);
  t('finish message', txt($('.modal-body')).includes('You\u2019re ready to start managing your finances.'));
  t('finish offers Go to Dashboard', !!foot('Go to Dashboard'));
  t('guide footer buttons stay inside the dialog', $$('.modal .modal-foot button').every(b => { const r = b.getBoundingClientRect(), m = $('.modal').getBoundingClientRect(); return r.left >= m.left - 0.5 && r.right <= m.right + 0.5; }));
  t('guide dialog inside the viewport', inView($('.modal').getBoundingClientRect()));
  click(foot('Back')); await tick(40);
  t('Back works', h3() === 'Recurring payments' && !!foot('Open Recurring'));
  App.go('settings'); await tick(60);
  // jump to the Accounts step, visit the page, come back
  UI.closeAll(); await tick(200);
  t('closing with X / Esc counts as skipped', localStorage.getItem('bp_onboarding_status') === 'skipped');
  click($('[data-action="show-guide"]')); await tick(150);
  click(foot('Get Started')); await tick(60);
  const accBefore = Store.accounts().length;
  t('accounts step recognises existing accounts', !accBefore || txt($('.onboard-done-note')).includes('Your accounts are ready'));
  click(foot('Set Up Accounts')); await tick(400);
  t('Set Up Accounts opens the Accounts page', App.state.route === 'accounts' && !$('.modal'), App.state.route);
  t('guide not marked done while visiting', !['completed', 'skipped'].includes(localStorage.getItem('bp_onboarding_status')));
  const ring = $('.spot-ring'), call = $('.spot-callout');
  const target = $('#main-content [data-action="add-account"]');
  t('spotlight on the real Add account button', !!ring && !!call && !!target && target.classList.contains('spot-target'));
  const rr = ring.getBoundingClientRect(), tr = target.getBoundingClientRect(), cr = call.getBoundingClientRect();
  t('highlight surrounds the target', rr.left <= tr.left && rr.top <= tr.top && rr.right >= tr.right && rr.bottom >= tr.bottom, [rr, tr].map(r => [r.left, r.top, r.right, r.bottom].map(Math.round)));
  t('rest of the page dimmed', getComputedStyle(ring).boxShadow.includes('rgba'));
  t('highlight inside the viewport', inView(rr));
  t('callout inside the viewport', inView(cr), [cr.left, cr.top, cr.right, cr.bottom].map(Math.round));
  t('callout does not cover the target', cr.bottom <= tr.top || cr.top >= tr.bottom || cr.right <= tr.left || cr.left >= tr.right);
  const nav = $('.bottomnav');
  if (nav && getComputedStyle(nav).display !== 'none') {
    const nr = nav.getBoundingClientRect();
    t('target not hidden behind the bottom nav', tr.bottom <= nr.top, [tr.bottom, nr.top]);
    t('callout clear of the bottom nav', cr.bottom <= nr.top + 0.5, [cr.bottom, nr.top]);
  }
  t('callout explains what to click', txt(call).includes('Add account') || txt(call).includes('account'));
  t('callout offers Back, Skip/Next and exit', !!call.querySelector('.spot-back') && !!call.querySelector('.spot-next') && !!call.querySelector('.spot-x'));
  t('no horizontal overflow with the spotlight', document.documentElement.scrollWidth <= W() + 1);
  t('dim layer never blocks clicks', getComputedStyle(ring).pointerEvents === 'none');
  // the user clicks the real button → the existing dialog opens
  click(target); await tick(300);
  t('target button works normally (Add account dialog)', !!$('.modal'));
  t('spotlight steps aside while the dialog is open', document.documentElement.classList.contains('spot-paused'));
  const form = $('.modal form');
  form.querySelector('[name="name"]').value = 'Onboarding Wallet';
  submit(form); await tick(600);
  t('account created through the normal form', Store.accounts().length === accBefore + 1, Store.accounts().length);
  t('onboarding recognises the completed action', !$('.modal') && /Account added/.test(txt($('.spot-callout')) || '') || h3() === 'Record income & transactions', txt($('.spot-callout')));
  await tick(1900);
  t('auto-advances to the next step', h3() === 'Record income & transactions' && !$('.spot-ring'), h3());
  // Skip this step from a spotlight
  click(foot('Add Transactions')); await tick(400);
  t('transactions step highlights the real Add transaction button', App.state.route === 'transactions' && !!$('#main-content [data-action="add-tx"].spot-target'));
  click($('.spot-callout .spot-next')); await tick(200);
  t('Skip this step moves on without acting', h3() === 'Create your first budget' && !$('.spot-ring'));
  // every remaining step targets its real button
  for (const [lbl, sel, route] of [['Create a Budget', '.card-head [data-action="add-budget-line"]', 'budget'], ['View Savings Goals', '[data-action="add-goal"]', 'goals'], ['Open Bills', '[data-action="add-bill"]', 'bills'], ['Open Recurring', '[data-action="add-recurring"]', 'recurring']]) {
    click(foot(lbl)); await tick(400);
    const tg = $(`#main-content ${sel}`), c2 = $('.spot-callout');
    t(`${route}: real button highlighted`, App.state.route === route && !!tg && tg.classList.contains('spot-target'));
    t(`${route}: callout inside the viewport`, !!c2 && inView(c2.getBoundingClientRect()) && document.documentElement.scrollWidth <= W() + 1);
    click(c2.querySelector('.spot-next')); await tick(200);
  }
  t('reaches the finish step', h3() === 'You\u2019re all set');
  click(foot('Go to Dashboard')); await tick(250);
  t('Go to Dashboard finishes the guide', !$('.modal') && App.state.route === 'dashboard');
  t('completed remembered', localStorage.getItem('bp_onboarding_status') === 'completed');
  Onboarding.maybeStart(); await tick(100);
  t('does not reappear after completion', !$('.modal'));
  // exiting from a spotlight = skipped
  App.go('settings'); await tick(120);
  click($('[data-action="show-guide"]')); await tick(150); click(foot('Get Started')); await tick(50); click(foot('Set Up Accounts')); await tick(400);
  click($('.spot-callout .spot-x')); await tick(100);
  t('exit from the spotlight skips the guide', !$('.spot-ring') && !$('.modal') && localStorage.getItem('bp_onboarding_status') === 'skipped');
  // after a reload mid-step the Continue bar lets the user resume
  localStorage.setItem('bp_onboarding_status', 'in-progress'); localStorage.setItem('bp_onboarding_resume', '3');
  Onboarding.maybeStart(); await tick(80);
  t('Continue bar after a reload', !!$('.onboard-resume') && txt($('.onboard-resume')).includes('Step 4 of 8'));
  click($('.onboard-resume-x')); await tick(80);
  t('closing the Continue bar skips the guide', !$('.onboard-resume') && localStorage.getItem('bp_onboarding_status') === 'skipped');

  log(`TOOLTIPS @ ${label}`);
  App.go('dashboard'); await tick(250);
  const kpis = $$('.kpis .kpi');
  t('every dashboard KPI has a tooltip', kpis.length === 4 && kpis.every(k => k.hasAttribute('data-tip') && k.getAttribute('tabindex') === '0'), kpis.length);
  const incK = kpis.find(k => k.getAttribute('data-tip-title') === 'Income');
  const monthTx = Compute.txOfMonth(App.state.month);
  const nInc = monthTx.filter(x => x.type === 'income').length, nExp = monthTx.filter(x => x.type === 'expense').length;
  t('income tooltip count comes from real data', !!incK && incK.getAttribute('data-tip-extra').startsWith(`From ${nInc} income transaction${nInc === 1 ? '' : 's'}`), incK && incK.getAttribute('data-tip-extra'));
  const expK = kpis.find(k => k.getAttribute('data-tip-title') === 'Expenses');
  t('expense tooltip count comes from real data', !!expK && expK.getAttribute('data-tip-extra').startsWith(`From ${nExp} expense transaction`), expK && expK.getAttribute('data-tip-extra'));
  t('minis have tooltips', $$('.minis .mini[data-tip]').length === 4);
  // every tip on the page stays inside the viewport
  const hosts = $$('#main-content [data-tip]').filter(h => h.getBoundingClientRect().width > 0);
  const bad = [];
  for (const h of hosts) {
    h.scrollIntoView({ block: 'center' }); Tips.show(h);
    const r = tipEl().getBoundingClientRect();
    if (!inView(r) || document.documentElement.scrollWidth > W() + 1 || !txt(tipEl())) bad.push([h.getAttribute('data-tip-title'), Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)]);
  }
  Tips.hide();
  t('all dashboard tooltips stay inside the viewport', hosts.length >= 8 && !bad.length, { n: hosts.length, bad });
  t('tooltip above dialogs and navigation', Number(getComputedStyle(tipEl()).zIndex) > 200);
  t('tooltip never takes pointer events', getComputedStyle(tipEl()).pointerEvents === 'none');
  // show via focus
  Tips.show(incK);
  t('shows title, text and data line', txt(tipEl()).includes('Income') && txt(tipEl()).includes('Total income recorded') && txt(tipEl()).includes('From '));
  t('aria-describedby linked while shown', incK.getAttribute('aria-describedby') === 'ctx-tip');
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  t('Escape hides it', !tipOn() && !incK.hasAttribute('aria-describedby'));
  // touch
  incK.scrollIntoView({ block: 'center' }); await tick(30);
  tap(incK); await tick(30);
  t('tap shows the tooltip', tipOn());
  tap(incK); await tick(30);
  t('tapping again hides it', !tipOn());
  tap(incK); await tick(30);
  tap(document.querySelector('.dash-hello')); await tick(30);
  t('tapping outside hides it', !tipOn());
  const addBtn = $('[data-action="add-tx"]');
  tap(addBtn); await tick(200);
  t('tapping a button still performs its action', !!$('.modal') && !tipOn());
  UI.closeAll(); await tick(80);
  // mouse hover on an icon-only button uses its label
  App.go('accounts'); await tick(200);
  const mb = $('#main-content .mini-btn[aria-label]');
  if (mb) {
    mb.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' })); await tick(350);
    t('hovering an icon button shows its label', tipOn() && txt(tipEl()) === mb.getAttribute('aria-label'), txt(tipEl()));
    mb.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, pointerType: 'mouse' })); await tick(30);
    t('leaving hides it', !tipOn());
  }
  // stat cards on the other pages
  for (const [route, min] of [['budget', 4], ['accounts', 4], ['goals', 4], ['bills', 4], ['recurring', 4], ['analytics', 4], ['transactions', 4]]) {
    App.go(route); await tick(200);
    t(`${route}: stat cards have tooltips`, $$('#main-content .stat[data-tip]').length >= min, $$('#main-content .stat[data-tip]').length);
  }
  App.go('dashboard'); await tick(150);
  t('navigation hides any open tooltip', (Tips.show($('.kpi')), App.go('budget'), !tipOn()));
  App.go('grocery'); await tick(150);
  localStorage.setItem('bp_onboarding_completed', '1');
  if (had === undefined) delete u.displayName; else u.displayName = had;
};
