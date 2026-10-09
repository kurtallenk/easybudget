/* ============================================================
   08 · APP - shell, routing, global actions, keyboard, theme
   ============================================================ */
const App = (() => {
  const { el, esc, icon, $, $$, money, monthLabel, monthKey, today } = Core;

  const ROUTES = {
    dashboard: () => ViewsA.dashboard,
    transactions: () => ViewsA.transactions,
    budget: () => ViewsA.budget,
    accounts: () => ViewsB.accounts,
    goals: () => ViewsB.goals,
    bills: () => ViewsB.bills,
    grocery: () => ViewsGrocery.grocery,
    recurring: () => ViewsB.recurring,
    analytics: () => ViewsB.analytics,
    summary: () => ViewsB.summary,
    inbox: () => Notifications.view,
    admin: () => Admin.view,
    settings: () => ViewsB.settings
  };
  // Sidebar groups. Presentation only: every id is an existing ROUTES key.
  const NAV = [
    { group: 'Overview', items: [['dashboard', 'Dashboard', 'dashboard']] },
    { group: 'Money', items: [['transactions', 'Transactions', 'transactions'], ['accounts', 'Accounts', 'accounts'], ['budget', 'Budget', 'budget']] },
    { group: 'Planning', items: [['goals', 'Savings Goals', 'goals'], ['bills', 'Bills', 'bills'], ['recurring', 'Recurring', 'recurring'], ['grocery', 'Live Grocery List', 'cart']] },
    { group: 'Insights', items: [['analytics', 'Analytics', 'analytics'], ['summary', 'Monthly Summary', 'calendar']] },
    { group: 'System', items: [['inbox', 'Notifications', 'bell'], ['settings', 'Settings', 'settings']] }
  ];
  // Bottom navigation (≤1024px): four destinations + quick add; "More" opens the full drawer.
  const BOTTOM_NAV = [['dashboard', 'Home', 'dashboard'], ['transactions', 'Activity', 'transactions'], null, ['budget', 'Budget', 'budget']];

  /*
   * Design templates. Selecting one only sets html[data-template]; every
   * visual difference lives in the token blocks of assets/css/app.css §3.
   * `preview` feeds the swatch in Settings (CSS custom properties, --tp-*).
   * To add a template: add an entry here, a token block in app.css, and the
   * id to Defaults::TEMPLATES + migration ENUM on the server.
   */
  const TEMPLATES = [
    { id: 'modern', name: 'Modern Finance', desc: 'Balanced default with clear, structured panels',
      preview: { bg: 'var(--surface-3)', side: 'var(--surface)', 'side-rule': 'var(--border)', 'side-ink': 'var(--border-strong)', 'card-rule': 'var(--border)', radius: '5px', shadow: 'var(--shadow-sm)' } },
    { id: 'classic', name: 'Classic', desc: 'Conservative, denser layout with a navy sidebar',
      preview: { bg: 'var(--surface-3)', side: '#15223a', 'side-rule': '#15223a', 'side-ink': 'rgba(255,255,255,.28)', 'card-rule': 'var(--border-strong)', radius: '1px', shadow: 'none' } },
    { id: 'minimal', name: 'Minimal', desc: 'Light and quiet: flat surfaces, fewer decorations',
      preview: { bg: 'var(--surface)', side: 'var(--surface)', 'side-rule': 'var(--border)', 'side-ink': 'var(--surface-3)', 'card-rule': 'var(--border)', radius: '4px', shadow: 'none' } },
    // Game HUD look: always dark, cyan telemetry accents, technical panels.
    // `hud: true` swaps the Settings swatch for a telemetry preview.
    { id: 'futuristic', name: 'Futuristic', desc: 'Game HUD command center: dark, cyan telemetry, technical panels', hud: true,
      preview: { bg: '#060b11', side: '#070d14', 'side-rule': '#17313b', 'side-ink': '#1d3a45', 'card-rule': '#1f4450', radius: '2px', shadow: '0 0 10px -3px rgba(0,229,255,.45)' } }
  ];
  const templateId = () => { const v = Store.settings().designTemplate; return TEMPLATES.some(x => x.id === v) ? v : 'modern'; };
  const MONTH_AWARE = new Set(['dashboard', 'budget', 'analytics', 'summary']);

  const state = {
    route: 'dashboard',
    month: monthKey(today()),
    page: 1,
    range: 6,
    showFilters: false,
    billFilter: 'open',
    txFilter: { q: '', type: 'all', categoryId: '', accountId: '', method: '', from: '', to: '', min: '', max: '', recurringOnly: false, sortBy: 'date', sortDir: 'desc' }
  };

  /* ---------- theme ---------- */
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const applyTheme = () => {
    const t = Store.settings().theme;
    const dark = t === 'dark' || (t === 'system' && mq.matches);
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    document.documentElement.style.setProperty('--brand-h', String(Store.settings().brandHue || 221));
    document.documentElement.setAttribute('data-template', templateId());
    const meta = $('meta[name="theme-color"]'); if (meta) meta.content = templateId() === 'futuristic' ? '#060a10' : dark ? '#0e1013' : '#f6f7f9';
  };
  mq.addEventListener('change', () => { if (Store.settings().theme === 'system') { applyTheme(); render(); } });
  const toggleTheme = () => {
    const cur = document.documentElement.getAttribute('data-theme');
    Store.setSettings({ theme: cur === 'dark' ? 'light' : 'dark' });
    applyTheme(); render();
    UI.toast(`${cur === 'dark' ? 'Light' : 'Dark'} mode on`, null, 'info', 1800);
  };

  /* ---------- shell ---------- */
  const sampleBanner = () => Store.get().sample && !Store.settings().hideSampleBanner ? `
    <div class="sample-banner">${icon('info', 16)}
      <span>You're viewing <b>sample data</b> so every feature has something to show.</span>
      <span class="spacer"></span>
      <button class="btn btn-sm" data-action="clear-sample">Start fresh</button>
      <button class="mini-btn" data-action="hide-sample" aria-label="Dismiss">${icon('close', 14)}</button>
    </div>` : '';

  // Super Admin group: only listed for accounts the server flags as Super Admin.
  // Presentation only - every admin API re-checks the role server-side.
  const isAdmin = () => !!(Store.user() && Store.user().isSuperAdmin);
  const navGroups = () => isAdmin() ? NAV.concat([{ group: 'Super Admin', admin: true, items: [['admin', 'Super Admin', 'shield']] }]) : NAV;
  const navHTML = () => navGroups().map(g => `
    <div class="nav-group${g.admin ? ' nav-admin' : ''}" role="group" aria-label="${esc(g.group)}">
    <div class="nav-label" aria-hidden="true">${esc(g.group)}</div>
    ${g.items.map(([id, label, ic]) => {
      const badge = id === 'bills' ? Compute.billsDueCount() : id === 'inbox' ? Notifications.unreadCount() : 0;
      return `<button class="nav-item" data-action="go" data-arg="${id}" ${state.route === id ? 'aria-current="page"' : ''}>
        ${icon(ic, 17)}<span>${esc(label)}</span>${badge ? `<span class="nav-badge" aria-label="${badge} ${id === 'inbox' ? 'unread' : 'due'}">${badge}</span>` : ''}</button>`;
    }).join('')}</div>`).join('');

  const shell = () => {
    document.body.innerHTML = `
      <a href="#main-content" class="sr-only">Skip to main content</a>
      <div class="app">
        <aside class="sidebar" id="sidebar" aria-label="Main navigation">
          <div class="brand">
            <span class="brand-mark"><img src="/assets/images/budgetPlannerLogo.avif" alt=""></span>
            <span class="brand-text"><span class="brand-name">Easy Budget Planner</span><span class="brand-sub">Personal finance</span></span>
            <button class="icon-btn mobile-only" style="margin-left:auto" data-action="close-nav" aria-label="Close navigation">${icon('close', 17)}</button>
          </div>
          <nav class="nav" id="nav"></nav>
          <div class="sidebar-foot">
            <button class="btn btn-primary btn-block" data-action="quick-add">${icon('plus', 16)}Add transaction</button>
            <div class="side-user">
              <span class="side-avatar" aria-hidden="true">${esc(((Store.user() && Store.user().email) || 'U').slice(0, 2))}</span>
              <span class="side-user-text"><span class="side-user-name" title="${esc((Store.user() && Store.user().email) || '')}">${esc((Store.user() && Store.user().email) || 'Signed in')}</span><span class="side-user-sub">Your account</span></span>
              <button class="icon-btn side-signout" data-action="sign-out" aria-label="Sign out" title="Sign out">${icon('logout', 16)}<span class="so-label">Sign out</span></button>
            </div>
          </div>
        </aside>
        <div class="scrim-nav" id="nav-scrim" data-action="close-nav"></div>
        <div class="main">
          <header class="topbar">
            <button class="icon-btn mobile-only" data-action="open-nav" aria-label="Open navigation">${icon('menu', 18)}</button>
            <div class="topbar-title"><h1 id="page-title">Dashboard</h1><span id="page-sub"></span></div>
            <div class="topbar-actions">
              <div class="period" id="period-switch" role="group" aria-label="Month selector">
                <button data-action="month" data-arg="-1" aria-label="Previous month">${icon('chevL', 16)}</button>
                <span class="period-label num" id="period-label"></span>
                <button data-action="month" data-arg="1" aria-label="Next month">${icon('chevR', 16)}</button>
              </div>
              <button class="icon-btn" data-action="today" id="today-btn" aria-label="Jump to current month" title="Current month">${icon('calendar', 17)}</button>
              <span class="topbar-sep" aria-hidden="true"></span>
              <button class="icon-btn ntf-bell" data-action="go" data-arg="inbox" id="ntf-bell" aria-label="Notifications">${icon('bell', 17)}<span class="ntf-bell-dot" aria-hidden="true"></span></button>
              <button class="icon-btn" data-action="toggle-theme" id="theme-btn" aria-label="Toggle dark mode"></button>
              <button class="btn btn-primary" data-action="quick-add" style="display:none" id="top-add">${icon('plus', 15)}Add</button>
            </div>
          </header>
          <main class="content" id="main-content" tabindex="-1"></main>
        </div>
      </div>
      <nav class="bottomnav" aria-label="Primary">
        ${BOTTOM_NAV.map(item => item
          ? `<button data-action="go" data-arg="${item[0]}" ${state.route === item[0] ? 'aria-current="page"' : ''}><span class="bn-ico">${icon(item[2], 20)}</span><span>${esc(item[1])}</span></button>`
          : `<div class="fab-slot"><button class="fab" data-action="quick-add" aria-label="Quick add">${icon('plus', 22)}</button></div>`).join('')}
        <button data-action="open-nav" id="bn-more" aria-label="More pages" aria-haspopup="true"><span class="bn-ico">${icon('menu', 20)}</span><span>More</span></button>
      </nav>`;
  };

  /* ---------- render ---------- */
  let rendering = false;
  const render = (opts = {}) => {
    if (rendering) return; rendering = true;
    if (typeof Tips !== 'undefined') Tips.hide();
    try {
      const view = (ROUTES[state.route] || ROUTES.dashboard)();
      $('#nav').innerHTML = navHTML();
      $$('.bottomnav button[data-arg]').forEach(b => {
        if (b.dataset.arg === state.route) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
      });
      const nUnread = Notifications.unreadCount(), bell = $('#ntf-bell');
      if (bell) { bell.classList.toggle('has-unread', nUnread > 0); bell.setAttribute('aria-label', nUnread ? `Notifications, ${nUnread} unread` : 'Notifications');
        if (state.route === 'inbox') bell.setAttribute('aria-current', 'page'); else bell.removeAttribute('aria-current'); }
      $('#page-title').textContent = view.title;
      $('#page-sub').textContent = typeof view.subtitle === 'function' ? view.subtitle() : (view.subtitle || '');
      $('#period-label').textContent = monthLabel(state.month, window.innerWidth < 640);
      $('#period-switch').style.display = MONTH_AWARE.has(state.route) ? '' : 'none';
      $('#today-btn').style.display = MONTH_AWARE.has(state.route) ? '' : 'none';
      // "More" reads as current when the page lives only in the drawer
      const bnMore = $('#bn-more');
      if (bnMore) { if (BOTTOM_NAV.some(x => x && x[0] === state.route)) bnMore.removeAttribute('aria-current'); else bnMore.setAttribute('aria-current', 'true'); }
      const dark = document.documentElement.getAttribute('data-theme') === 'dark';
      $('#theme-btn').innerHTML = icon(dark ? 'sun' : 'moon', 17);
      $('#theme-btn').setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
      const host = $('#main-content');
      host.innerHTML = '<div class="view"></div>';
      view.render(host.firstElementChild);
      document.title = `${view.title} · Budget Planner`;
      if (opts.keepFocus) { const n = document.getElementById(opts.keepFocus); if (n) { n.focus(); n.setSelectionRange?.(n.value.length, n.value.length); } }
    } catch (e) {
      console.error(e);
      $('#main-content').innerHTML = `<div class="card card-pad"><div class="empty"><div class="ill" style="color:var(--neg)">${icon('alert', 24)}</div>
        <h3>Something went wrong rendering this page</h3><p>${esc(e.message)}</p>
        <button class="btn" data-action="go" data-arg="dashboard">Back to dashboard</button></div></div>`;
    } finally { rendering = false; }
  };

  const go = route => {
    if (!ROUTES[route]) route = 'dashboard';
    state.route = route; state.page = 1;
    closeNav();
    location.hash = '#/' + route;
    render();
    $('#main-content').scrollIntoView({ block: 'start' });
    window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
  };
  const openNav = () => { $('#sidebar').classList.add('open'); $('#nav-scrim').classList.add('on'); };
  const closeNav = () => { $('#sidebar')?.classList.remove('open'); $('#nav-scrim')?.classList.remove('on'); };

  /* ---------- actions ---------- */
  const ACTIONS = {
    go: arg => go(arg),
    'open-nav': openNav, 'close-nav': closeNav,
    'toggle-theme': toggleTheme,
    'quick-add': () => Forms.quickAdd(),
    'add-tx': () => Forms.transaction({ type: 'expense' }),
    'add-transfer': () => Forms.transaction({ type: 'transfer' }),
    'edit-tx': id => { const t = Store.get().transactions.find(x => x.id === id); if (t) Forms.transaction({ tx: t }); },
    'del-tx': id => { const t = Store.get().transactions.find(x => x.id === id); if (!t) return;
      UI.confirm({ title: 'Delete transaction?', message: `"${t.description}" (${money(t.amount)}) will be permanently removed.`, confirmLabel: 'Delete',
        onConfirm: () => { Store.removeTx(id); UI.toast('Transaction deleted', null, 'warn'); } }); },
    month: d => { const n = Number(d); state.month = n === 0 ? monthKey(today()) : Core.addMonths(state.month, n); render(); },
    today: () => { state.month = monthKey(today()); render(); UI.toast('Jumped to ' + monthLabel(state.month), null, 'info', 1600); },
    range: n => { state.range = Number(n); render(); },
    page: p => { state.page = Math.max(1, Number(p)); render(); window.scrollTo({ top: 0 }); },
    'toggle-filters': () => { state.showFilters = !state.showFilters; render(); },
    'reset-filters': () => { Object.assign(state.txFilter, { q: '', type: 'all', categoryId: '', accountId: '', method: '', from: '', to: '', min: '', max: '', recurringOnly: false }); state.page = 1; render(); UI.toast('Filters cleared', null, 'info', 1600); },
    'export-filtered': () => { const rows = Compute.filterTx(state.txFilter);
      const head = ['Date', 'Type', 'Description', 'Category', 'Account', 'Method', 'Amount', 'Notes'];
      const esc2 = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const csv = [head, ...rows.map(t => [t.date, t.type, t.description, t.categoryId ? Store.catName(t.categoryId) : '', Store.acctName(t.accountId), t.method, (t.amount / 100).toFixed(2), t.notes])]
        .map(r => r.map(esc2).join(',')).join('\r\n');
      UI.download(`transactions-${today()}.csv`, csv, 'text/csv'); UI.toast('CSV exported', `${rows.length} rows`); },

    'add-account': () => Forms.account(),
    'edit-account': id => Forms.account({ account: Store.acctById(id) }),
    'del-account': id => { const a = Store.acctById(id); if (!a) return;
      const n = Store.get().transactions.filter(t => t.accountId === id || t.toAccountId === id).length;
      UI.confirm({ title: 'Delete account?', confirmLabel: 'Delete account',
        message: `"${a.name}" will be removed${n ? ` along with its ${n} transaction${n === 1 ? '' : 's'}` : ''}. This cannot be undone.`,
        onConfirm: () => { Store.removeAccount(id); UI.toast('Account deleted', a.name, 'warn'); } }); },

    'add-goal': () => Forms.goal(),
    'edit-goal': id => Forms.goal({ goal: Store.get().goals.find(g => g.id === id) }),
    'del-goal': id => { const g = Store.get().goals.find(x => x.id === id); if (!g) return;
      UI.confirm({ title: 'Delete goal?', message: `"${g.name}" and its progress tracking will be removed. Linked transactions stay intact.`, confirmLabel: 'Delete',
        onConfirm: () => { Store.removeGoal(id); UI.toast('Goal deleted', null, 'warn'); } }); },
    contribute: id => Forms.contribute(id),

    'add-bill': () => Forms.bill(),
    'edit-bill': id => Forms.bill({ bill: Store.get().bills.find(b => b.id === id) }),
    'del-bill': id => { const b = Store.get().bills.find(x => x.id === id); if (!b) return;
      UI.confirm({ title: 'Delete bill?', message: `"${b.name}" will be removed from your bill list.`, confirmLabel: 'Delete',
        onConfirm: () => { Store.removeBill(id); UI.toast('Bill deleted', null, 'warn'); } }); },
    'pay-bill': id => { const r = Store.payBill(id);
      if (!r.ok) return UI.toast('Could not record payment', r.errors?.accountId || 'Check the bill details.', 'error');
      UI.toast('Bill marked paid', `${money(r.value.amount)} recorded as an expense`); },
    'unpay-bill': id => { Store.unpayBill(id); UI.toast('Payment undone', 'The expense entry was removed.', 'warn'); },
    'bill-filter': v => { state.billFilter = v; render(); },

    'add-recurring': () => Forms.recurring(),
    'edit-recurring': id => Forms.recurring({ rec: Store.get().recurring.find(r => r.id === id) }),
    'del-recurring': id => { const r = Store.get().recurring.find(x => x.id === id); if (!r) return;
      UI.confirm({ title: 'Delete recurring rule?', message: `"${r.name}" will stop generating transactions. Existing entries are kept.`, confirmLabel: 'Delete',
        onConfirm: () => { Store.removeRecurring(id); UI.toast('Recurring rule deleted', null, 'warn'); } }); },
    'toggle-recurring': id => { const r = Store.get().recurring.find(x => x.id === id); if (!r) return;
      Store.updateRecurring(id, { paused: !r.paused }); UI.toast(r.paused ? 'Rule resumed' : 'Rule paused', r.name, 'info'); },
    'run-recurring': async () => { const n = await Store.runRecurring();
      UI.toast(n ? `${n} transaction${n === 1 ? '' : 's'} posted` : 'Nothing due right now', n ? 'Generated from your recurring rules.' : 'All rules are up to date.', n ? 'success' : 'info'); },
    'sign-out': () => UI.confirm({ title: 'Sign out?', confirmLabel: 'Sign out', danger: false,
      message: 'Your data stays on the server and will be here when you sign back in.',
      onConfirm: async () => { try { await Api.logout(); } finally { try { localStorage.removeItem('bp_remember_me'); } catch {} location.replace('pages/login.html'); } } }),
    'show-guide': () => Onboarding.restart(),
    'ntf-open': id => Notifications.open(id),
    'ntf-all': () => Notifications.readAll(),
    'ntf-filter': f => Notifications.setFilter(f),

    'budget-save': () => ViewsA.saveBudget(),
    'budget-clear': () => ViewsA.clearBudget(),
    'budget-preview': id => ViewsA.previewSavedBudget(id),
    'budget-saved': () => ViewsA.openSavedBudgets(),
    'budget-load': id => ViewsA.loadSavedBudget(id),
    'budget-saved-del': id => ViewsA.removeSavedBudget(id),
    'grocery-add': () => ViewsGrocery.openAdd(),
    'grocery-lists': () => ViewsGrocery.openLists(),
    'grocery-get': id => ViewsGrocery.getItem(id),
    'grocery-undo': id => ViewsGrocery.undo(id),
    'grocery-toggle': id => ViewsGrocery.toggle(id),
    'grocery-del': id => ViewsGrocery.remove(id),
    'grocery-submit': () => ViewsGrocery.openConfirm(),
    'grocery-clear': () => ViewsGrocery.clearList(),
    'grocery-save': () => ViewsGrocery.save(),
    'grocery-list-preview': id => ViewsGrocery.previewList(id),
    'grocery-list-load': id => ViewsGrocery.loadList(id),
    'grocery-list-del': id => ViewsGrocery.removeList(id),

    'add-budget-line': () => Forms.budgetLine(state.month),
    'edit-budget-line': cid => Forms.budgetLine(state.month, cid),
    'del-budget-line': cid => UI.confirm({ title: 'Remove from budget?', message: `${Store.catName(cid)} will no longer have a limit for ${monthLabel(state.month)}.`, confirmLabel: 'Remove',
      onConfirm: () => { Store.setBudgetLine(state.month, cid, 0); UI.toast('Budget line removed', null, 'warn'); } }),
    'copy-budget': () => { const prev = Core.addMonths(state.month, -1);
      if (Store.copyBudget(prev, state.month)) UI.toast('Budget copied', `From ${monthLabel(prev)}`); },
    'add-plan': key => {
      const form = el('form', { novalidate: 'true', id: 'plan-form' }, `<div class="form-grid">
        ${UI.fieldHTML({ name: 'label', label: key === 'incomePlan' ? 'Income source' : 'Savings target', required: true, placeholder: key === 'incomePlan' ? 'e.g. Salary' : 'e.g. Emergency Fund' })}
        ${UI.fieldHTML({ name: 'amount', label: 'Amount', type: 'money', required: true })}</div>`);
      const foot = el('div', { class: 'row', style: 'width:100%;gap:9px' });
      foot.innerHTML = '<span class="spacer"></span>';
      foot.appendChild(el('button', { class: 'btn', type: 'button', onclick: () => UI.closeTop() }, 'Cancel'));
      foot.appendChild(el('button', { class: 'btn btn-primary', type: 'submit', form: 'plan-form' }, 'Add'));
      const m = UI.modal({ title: key === 'incomePlan' ? 'Add planned income' : 'Add savings target', size: 'sm', body: form, footer: foot });
      form.addEventListener('submit', e => { e.preventDefault();
        const d = UI.readForm(form); const errors = {};
        const e1 = Store.V.required(d.label, 'Label'); if (e1) errors.label = e1;
        const e2 = Store.V.amount(d.amount); if (e2) errors.amount = e2;
        if (Object.keys(errors).length) return UI.showErrors(form, errors);
        const b = Compute.budgetSummary(state.month);
        Store.setPlan(state.month, key, [...(b[key] || []), { id: Core.uid('pl'), label: d.label, amount: Core.toMinor(d.amount) }]);
        m.close(); UI.toast('Plan updated'); });
    },
    'del-plan': arg => { const [key, id] = arg.split(':');
      const b = Compute.budgetSummary(state.month);
      Store.setPlan(state.month, key, (b[key] || []).filter(r => r.id !== id)); UI.toast('Removed', null, 'warn', 1600); },

    'add-category': () => Forms.category(),
    'edit-category': id => Forms.category({ cat: Store.catById(id) }),
    'del-category': id => { const c = Store.catById(id); if (!c) return;
      const used = Store.get().transactions.filter(t => t.categoryId === id).length;
      UI.confirm({ title: 'Delete category?', confirmLabel: used ? 'Archive' : 'Delete',
        message: used ? `${c.name} is used by ${used} transaction${used === 1 ? '' : 's'}, so it will be archived instead of deleted.` : `${c.name} will be removed.`,
        onConfirm: () => { const r = Store.removeCategory(id); UI.toast(r.archived ? 'Category archived' : 'Category deleted', null, 'warn'); } }); },

    theme: v => { Store.setSettings({ theme: v }); applyTheme(); render(); },
    hue: v => { Store.setSettings({ brandHue: Number(v) }); applyTheme(); render(); UI.toast('Accent colour updated'); },
    // Presentation only: stores settings.designTemplate and re-renders in place (route and data untouched).
    'design-template': v => {
      const tpl = TEMPLATES.find(x => x.id === v); if (!tpl || templateId() === v) return;
      Store.setSettings({ designTemplate: v }); applyTheme(); render();
      UI.toast('Design template applied', tpl.name, 'success', 2200);
    },
    'export-json': () => { UI.download(`budget-planner-backup-${today()}.json`, Store.exportJSON()); UI.toast('Backup exported', 'Keep it somewhere safe.'); },
    'export-csv': () => { UI.download(`budget-planner-transactions-${today()}.csv`, Store.exportCSV(), 'text/csv'); UI.toast('Transactions exported'); },
    'import-json': () => { const inp = el('input', { type: 'file', accept: 'application/json,.json' });
      inp.addEventListener('change', () => { const f = inp.files[0]; if (!f) return;
        const rd = new FileReader();
        rd.onload = () => UI.confirm({ title: 'Replace all data?', confirmLabel: 'Import and replace',
          message: 'Importing a backup replaces everything currently stored in this browser.',
          onConfirm: () => { const r = Store.importJSON(String(rd.result));
            if (!r.ok) return UI.toast('Import unavailable', r.error, 'error');
            boot({ skipRecurring: true }); UI.toast('Backup imported', `${r.counts.transactions} transactions restored`); } });
        rd.readAsText(f); });
      inp.click(); },
    'load-sample': () => UI.confirm({ title: 'Load sample data?', danger: false, confirmLabel: 'Load sample data',
      message: 'This replaces your current data with a realistic demo dataset you can delete at any time.',
      onConfirm: () => { Store.seedSample(); } }),
    'clear-sample': () => UI.confirm({ title: 'Remove sample data?', confirmLabel: 'Remove sample data',
      message: 'All sample accounts, transactions, budgets, goals and bills will be deleted so you can start with your own numbers.',
      onConfirm: () => { Store.clearSample(); UI.toast('Sample data removed', 'Your workspace is now empty.'); render(); } }),
    'hide-sample': () => { Store.setSettings({ hideSampleBanner: true }); render(); },
    'reset-all': () => UI.confirm({ title: 'Reset everything?', confirmLabel: 'Delete all data',
      message: 'Every account, transaction, budget, goal and bill will be permanently deleted from this browser.',
      onConfirm: () => { Store.resetAll(); UI.toast('All data reset', null, 'warn'); } })
  };

  document.addEventListener('click', e => {
    const t = e.target.closest('[data-action]'); if (!t) return;
    const fn = ACTIONS[t.dataset.action]; if (!fn) return;
    e.preventDefault(); fn(t.dataset.arg);
  });

  /* ---------- keyboard ---------- */
  document.addEventListener('keydown', e => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
    if (e.key === 'Escape' && !document.querySelector('.modal')) closeNav();
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
    if (document.querySelector('.modal')) return;
    const k = e.key.toLowerCase();
    if (k === 'n') { e.preventDefault(); Forms.transaction({ type: 'expense' }); }
    else if (k === 'q') { e.preventDefault(); Forms.quickAdd(); }
    else if (k === 'd') { e.preventDefault(); toggleTheme(); }
    else if (e.key === '/') { if (state.route === 'transactions') { e.preventDefault(); $('#tx-q')?.focus(); } else go('transactions'); }
    else if (e.key === 'ArrowLeft' && MONTH_AWARE.has(state.route)) { ACTIONS.month('-1'); }
    else if (e.key === 'ArrowRight' && MONTH_AWARE.has(state.route)) { ACTIONS.month('1'); }
  });

  window.addEventListener('hashchange', () => {
    const r = location.hash.replace('#/', '');
    if (r && ROUTES[r] && r !== state.route) { state.route = r; render(); }
  });
  window.addEventListener('resize', Core.debounce(() => {
    const lbl = $('#period-label'); if (lbl) lbl.textContent = monthLabel(state.month, window.innerWidth < 640);
  }, 180));
  // Notifications: pick up read state / new items from other devices when the tab regains focus.
  const refreshInbox = Core.debounce(() => {
    if (!Store.user()) return;
    const before = JSON.stringify(Notifications.list().map(a => [a.id, a.read]));
    Notifications.load(true).then(() => {
      if (JSON.stringify(Notifications.list().map(a => [a.id, a.read])) !== before && state.route !== 'admin' && !document.querySelector('.modal')) render();
    });
  }, 300);
  window.addEventListener('focus', refreshInbox);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshInbox(); });
  // keep multiple tabs consistent
  window.addEventListener('storage', e => {
    if (e.key === Store.CACHE_KEY) { Store.hydrate().then(render).catch(() => {}); }
  });

  /* ---------- boot ---------- */
  /**
   * Boot is asynchronous now: the document lives on the server, so the first
   * paint waits for api/bootstrap.php. A signed-out visitor is sent to the
   * login page before anything renders.
   */
  const boot = async (opts = {}) => {
    if (!tipsReady && typeof Tips !== 'undefined') { Tips.init(); tipsReady = true; }
    Api.setUnauthenticatedHandler(() => { location.replace('pages/login.html'); });
    Store.setErrorHandler(message => UI.toast('That change was not saved', message, 'error', 7000));

    let offline = false;
    try {
      await Store.hydrate();
    } catch (e) {
      if (e && e.isAuth) return;            // redirecting to the login page
      offline = true;
      Store.load();                         // paint from the last good snapshot
    }

    Core.setCurrency(Store.settings().currency);
    Core.setDateFormat(Store.settings().dateFormat);
    applyTheme();
    shell();
    const hash = location.hash.replace('#/', '');
    if (ROUTES[hash]) state.route = hash;
    render();

    if (offline) {
      UI.toast('Working offline', 'We could not reach the server, so this is your last saved view.', 'error', 8000);
    } else if (!opts.skipRecurring) {
      const posted = await Store.runRecurring();
      if (posted) { UI.toast(`${posted} recurring transaction${posted === 1 ? '' : 's'} posted`, 'Generated automatically from your rules.', 'info'); render(); }
    }

    if (!subscribed) { Store.subscribe(Core.debounce(() => render(), 40)); subscribed = true; }
    Notifications.load().then(() => render());
    if (!offline) Onboarding.maybeStart();
  };
  let subscribed = false;
  let tipsReady = false;

  return { state, render, go, boot, sampleBanner, ACTIONS, TEMPLATES, templateId };
})();

document.addEventListener('DOMContentLoaded', () => { App.boot().catch(e => console.error('Boot failed', e)); });
window.addEventListener('error', e => { console.error('Uncaught', e.error || e.message); });

