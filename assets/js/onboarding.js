/* ============================================================
   09 · ONBOARDING - optional first-run setup guide
   Seven short steps (Welcome → Accounts → Income/Transactions →
   Budget → Savings Goals → Bills & Recurring → Finish). It only
   teaches; nothing has to be completed. Every step can be skipped
   or closed, and "Set Up …" buttons jump to the real page while a
   small "Continue setup guide" bar lets the user come back.

   State
   - Per user (server): settings.onboarded (existing column) is set
     once the guide is completed or skipped, so it doesn't reappear
     on other devices.
   - Per device (localStorage): bp_onboarding_status = completed |
     skipped (legacy flag bp_onboarding_completed is still honoured),
     bp_onboarding_resume = step index while the user is visiting a
     setup page from the guide.
   Settings → "Restart Onboarding" opens it again from step 1.
   ============================================================ */
const Onboarding = (() => {
  const { el, esc, icon } = Core;
  const LEGACY = 'bp_onboarding_completed', STATUS = 'bp_onboarding_status', RESUME = 'bp_onboarding_resume';

  const steps = [
    { id: 'welcome', icon: 'sparkle', title: 'Welcome to Easy Budget Planner',
      body: 'Let\u2019s set up the basics so you can start managing your finances.',
      points: ['Takes about a minute to read', 'Nothing here is required, skip any time'] },
    { id: 'accounts', icon: 'accounts', title: 'Add your accounts',
      body: 'Add where your money lives, so Easy Budget Planner can track where your money is located.',
      points: ['Cash', 'Bank accounts', 'E-wallets', 'Credit / debit accounts, where applicable'],
      action: { label: 'Set Up Accounts', route: 'accounts' },
      spot: { target: '#main-content [data-action="add-account"]', button: 'Add account',
        title: 'Add your first account', text: 'Click \u201cAdd account\u201d to create your first account.',
        doneTitle: 'Your accounts are ready', doneText: 'You can add another account or continue to the next step.',
        count: () => Store.accounts().length, success: 'Account added' } },
    { id: 'transactions', icon: 'transactions', title: 'Record income & transactions',
      body: 'Log the money that comes in and goes out. Your dashboard, budgets and analytics are all calculated from these records.',
      points: ['Income: salary, freelance, other earnings', 'Expenses: what you spend, by category', 'Transfers: moving money between accounts'],
      action: { label: 'Add Transactions', route: 'transactions' },
      spot: { target: '#main-content [data-action="add-tx"]', button: 'Add transaction',
        title: 'Record a transaction', text: 'Record your income or expenses here.',
        doneTitle: 'You\u2019re already recording transactions', doneText: 'You can add another one or continue to the next step.',
        count: () => (Store.get().transactions || []).length, success: 'Transaction recorded' } },
    { id: 'budget', icon: 'budget', title: 'Create your first budget',
      body: 'Set a monthly limit per category. Base it on your planned income and the money available in your accounts.',
      points: ['See what\u2019s left to spend at a glance', 'Get warned before a category goes over'],
      action: { label: 'Create a Budget', route: 'budget' },
      spot: { target: '#main-content .card-head [data-action="add-budget-line"]', button: 'Add category',
        title: 'Create your first budget', text: 'Click \u201cAdd category\u201d and set a monthly limit for it.',
        doneTitle: 'Your budget is set up', doneText: 'You can add another category or continue to the next step.',
        count: () => (((Store.budgetFor(App.state.month) || {}).lines) || []).length, success: 'Budget category added' } },
    { id: 'goals', icon: 'goals', title: 'Savings goals (optional)',
      body: 'Plan for something specific (an emergency fund, a trip, a new laptop) and track your progress.',
      points: ['Set a target amount and date', 'See a suggested amount per month'],
      action: { label: 'View Savings Goals', route: 'goals' },
      spot: { target: '#main-content [data-action="add-goal"]', button: 'New goal',
        title: 'Create a savings goal', text: 'Create a savings goal to track what you\u2019re working toward.',
        doneTitle: 'You already have savings goals', doneText: 'You can add another goal or continue to the next step.',
        count: () => (Store.get().goals || []).length, success: 'Goal created' } },
    { id: 'bills', icon: 'bills', title: 'Bills & recurring payments',
      body: 'Keep upcoming and repeating expenses from sneaking up on you. Start with your bills.',
      points: ['Bills: one-off or monthly due dates, marked as paid', 'Recurring: rules that post regular income or expenses automatically (next step)'],
      action: { label: 'Open Bills', route: 'bills' },
      spot: { target: '#main-content [data-action="add-bill"]', button: 'Add bill',
        title: 'Add an upcoming bill', text: 'Add upcoming bills so you can keep track of what needs to be paid.',
        doneTitle: 'Your bills are being tracked', doneText: 'You can add another bill or continue to the next step.',
        count: () => (Store.get().bills || []).length, success: 'Bill added' } },
    { id: 'recurring', icon: 'recurring', title: 'Recurring payments',
      body: 'Set up income or expenses that repeat (salary, rent, subscriptions) and they are posted for you on schedule.',
      points: ['Pause or edit a rule any time', 'Posted entries are normal transactions'],
      action: { label: 'Open Recurring', route: 'recurring' },
      spot: { target: '#main-content [data-action="add-recurring"]', button: 'New rule',
        title: 'Set up a recurring payment', text: 'Set up recurring income or expenses here with \u201cNew rule\u201d.',
        doneTitle: 'You already have recurring rules', doneText: 'You can add another rule or continue to the next step.',
        count: () => (Store.get().recurring || []).length, success: 'Recurring rule created' } },
    { id: 'finish', icon: 'checkCircle', title: 'You\u2019re all set',
      body: 'You\u2019re ready to start managing your finances.',
      points: ['Hover or tap a number marked with a tooltip to see what it means', 'Reopen this guide any time: Settings → Restart Onboarding'] }
  ];

  let idx = 0, handle = null, closingReason = null;

  const ls = {
    get: k => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
    del: k => { try { localStorage.removeItem(k); } catch {} }
  };
  const status = () => {
    const v = ls.get(STATUS);
    if (v === 'completed' || v === 'skipped') return v;
    if (v === 'in-progress') return null;            // restarted / running guide
    return ls.get(LEGACY) === '1' ? 'completed' : null;
  };

  /** completed | skipped → remember on this device and on the account. */
  const safeCount = st => { try { return st.spot.count() || 0; } catch { return 0; } };

  const settle = how => {
    ls.set(STATUS, how); ls.set(LEGACY, '1'); ls.del(RESUME);
    hideResume(); Spotlight.hide();
    try { if (!Store.settings().onboarded) Store.markOnboarded(); } catch {}
  };

  const btn = (label, cls, onclick, extra = {}) => el('button', { type: 'button', class: `btn ${cls || ''}`, onclick, ...extra }, label);

  const paint = () => {
    if (!handle) return;
    const s = steps[idx], first = idx === 0, last = idx === steps.length - 1;
    handle.body.innerHTML = `
      <div class="onboard-step" data-step="${esc(s.id)}">
        <div class="onboard-count">Step ${idx + 1} of ${steps.length}</div>
        <div class="onboard-ico" aria-hidden="true">${icon(s.icon, 26)}</div>
        <h3 id="onboard-h">${esc(s.title)}</h3>
        <p>${esc(s.body)}</p>
        ${s.spot && safeCount(s) > 0 ? `<p class="onboard-done-note">${icon('checkCircle', 15)}<span><b>${esc(s.spot.doneTitle)}.</b> ${esc(s.spot.doneText)}</span></p>` : ''}
        ${s.points ? `<ul class="onboard-points">${s.points.map(p => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}
      </div>
      <div class="onboard-dots" aria-hidden="true">${steps.map((_, i) => `<span class="dot${i === idx ? ' on' : ''}"></span>`).join('')}</div>`;

    const foot = handle.node.querySelector('.modal-foot');
    foot.innerHTML = '';
    const row = el('div', { class: 'onboard-foot' });
    if (first) {
      row.appendChild(btn('Skip', 'onboard-skip', () => close('skipped')));
      row.appendChild(el('span', { class: 'spacer' }));
      row.appendChild(btn('Get Started', 'btn-primary onboard-next', () => go(1)));
    } else if (last) {
      row.appendChild(btn('Back', 'onboard-back', () => go(-1)));
      row.appendChild(el('span', { class: 'spacer' }));
      row.appendChild(btn('Go to Dashboard', 'btn-primary onboard-done', () => { close('completed'); App.go('dashboard'); }));
    } else {
      row.appendChild(btn('Skip guide', 'btn-ghost onboard-skip', () => close('skipped')));
      row.appendChild(el('span', { class: 'spacer' }));
      row.appendChild(btn('Back', 'onboard-back', () => go(-1)));
      [s.action, s.action2].filter(Boolean).forEach(a =>
        row.appendChild(btn(a.label, 'onboard-setup', () => (s.spot ? spotStep(idx) : visit(a.route)), { 'data-route': a.route })));
      row.appendChild(btn('Next', 'btn-primary onboard-next', () => go(1)));
    }
    foot.appendChild(row);
    const f = foot.querySelector('.btn-primary'); if (f) f.focus();
  };

  const go = d => { idx = Math.max(0, Math.min(steps.length - 1, idx + d)); paint(); };

  /** Closes the dialog. reason: completed | skipped | visit (keeps the guide resumable). */
  const close = reason => { closingReason = reason; if (handle) handle.close(); };

  const open = at => {
    if (handle) return;
    idx = at || 0;
    hideResume(); Spotlight.hide();
    closingReason = null;
    handle = UI.modal({
      title: 'Setup guide', size: 'sm onboard', body: '<div></div>', footer: '<div></div>',
      onClose: () => {
        handle = null;
        const r = closingReason || 'skipped'; // X, Esc and backdrop = "exit" = skipped
        closingReason = null;
        if (r === 'visit') return;
        settle(r);
      }
    });
    paint();
  };

  /** Jump to a setup page; the guide can be continued from the bar. */
  const visit = route => {
    ls.set(RESUME, String(idx));
    close('visit');
    App.go(route);
    showResume();
  };

  /* ---- Interactive step: go to the page, highlight the real button ----
     Explain → Navigate → Highlight → user acts → recognise → next step.
     Completion = the step's data count went up (the existing dialog
     saved something) and no dialog is open any more. */
  let spotRun = 0;
  const spotStep = async at => {
    const st = steps[at]; if (!st || !st.spot) return;
    const run = ++spotRun;
    ls.set(RESUME, String(at));
    close('visit');
    App.go(st.action.route);
    const n = await Spotlight.waitFor(st.spot.target);
    if (run !== spotRun) return;
    const base = safeCount(st), had = base > 0;
    const next = () => { Spotlight.hide(); open(Math.min(at + 1, steps.length - 1)); };
    let done = false, timer = null;
    Spotlight.show({
      target: st.spot.target,
      kicker: `Step ${at + 1} of ${steps.length}`,
      title: had ? st.spot.doneTitle : st.spot.title,
      text: had ? `${st.spot.doneText} Use \u201c${st.spot.button}\u201d to add another.` : st.spot.text,
      status: n ? '' : `Open ${st.action.route[0].toUpperCase() + st.action.route.slice(1)} to find \u201c${st.spot.button}\u201d.`,
      buttons: [
        { label: 'Back', cls: 'spot-back', onClick: () => { Spotlight.hide(); open(at); } },
        { label: had ? 'Next' : 'Skip this step', cls: had ? 'btn-primary spot-next' : 'spot-next', onClick: next }
      ],
      onExit: () => { Spotlight.hide(); settle('skipped'); },
      onMissing: () => { if (App.state.route !== st.action.route) Spotlight.update({ status: `This step is on the ${st.action.route} page.`, buttons: [
        { label: 'Take me there', cls: 'btn-primary', onClick: () => spotStep(at) }, { label: 'Next', cls: 'spot-next', onClick: next }] }); },
      onTick: () => {
        if (done || document.querySelector('.modal')) return;
        if (safeCount(st) > base) {
          done = true;
          Spotlight.update({ status: `${st.spot.success}.`, statusTone: 'ok', buttons: [{ label: 'Continue', cls: 'btn-primary spot-continue', onClick: () => { clearTimeout(timer); next(); } }] });
          timer = setTimeout(() => { if (run === spotRun && Spotlight.active()) next(); }, 1600);
        }
      }
    });
  };

  /* ---- "Continue setup guide" bar ---- */
  let bar = null;
  const showResume = () => {
    const at = Number(ls.get(RESUME));
    if (!Number.isFinite(at)) return;
    if (!bar) {
      bar = el('div', { class: 'onboard-resume', role: 'region', 'aria-label': 'Setup guide' });
      document.body.appendChild(bar);
    }
    bar.innerHTML = `<span class="onboard-resume-ico" aria-hidden="true">${icon('sparkle', 15)}</span>
      <span class="onboard-resume-t">Setup guide <span class="muted">· Step ${at + 1} of ${steps.length}</span></span>`;
    bar.appendChild(btn('Continue', 'btn-sm btn-primary onboard-continue', () => open(at)));
    bar.appendChild(el('button', { type: 'button', class: 'icon-btn onboard-resume-x', 'aria-label': 'Close setup guide', onclick: () => settle('skipped') }, icon('close', 15)));
  };
  function hideResume() { if (bar) { bar.remove(); bar = null; } }

  /** Settings → Restart Onboarding (and the legacy show-guide action). */
  const start = () => { ls.set(STATUS, 'in-progress'); ls.del(RESUME); open(0); };
  const restart = start;

  /** At boot: only for first-time users who haven't completed/skipped it. */
  const maybeStart = () => {
    if (ls.get(RESUME) != null && !status()) { showResume(); return; }
    if (status()) return;
    let st = {}; try { st = Store.settings() || {}; } catch {}
    if (st.onboarded) return;
    // Existing users with records aren't "first-time": don't interrupt them.
    const d = Store.get() || {};
    if ((d.transactions || []).length || (d.goals || []).length || (d.bills || []).length) return;
    open(0);
  };

  return { start, restart, maybeStart, steps, status, spotStep };
})();
