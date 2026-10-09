/* ============================================================
   10 · TIPS - reusable contextual tooltips
   One floating tooltip for the whole app. Any element opts in with
   attributes produced by Tips.attrs():
     data-tip-title   short title            ("Income")
     data-tip         one-line explanation   ("Total income recorded…")
     data-tip-extra   optional dynamic line  ("From 3 income transactions.")
   Desktop: hover (short delay) and keyboard focus. Touch: tap a
   non-interactive element to toggle; tap outside, tap again, scroll,
   Escape or a 5s timeout closes it. Tips on buttons/links never
   block the tap - on touch those simply act as normal.
   The tooltip is position:fixed on <body> (never clipped by cards),
   sits above dialogs, and is clamped inside the viewport, above the
   mobile bottom navigation.
   ============================================================ */
const Tips = (() => {
  const { esc } = Core;

  /* Central dictionary: key → [title, description]. Views pass a key
     plus an optional dynamic line computed from real data. */
  const DICT = {
    balance: ['Total balance', 'Combined balance of all your accounts. Credit balances count as negative.'],
    income: ['Income', 'Total income recorded for the selected month.'],
    expenses: ['Expenses', 'Total spending recorded for the selected month.'],
    leftToSpend: ['Left to spend', 'This month’s budget minus what you spent in budgeted categories.'],
    available: ['Available', 'Income minus expenses for this month (no budget set).'],
    netSavings: ['Net savings', 'Income minus expenses for the selected month.'],
    savingsRate: ['Savings rate', 'Share of this month\u2019s income you did not spend.'],
    billsDue: ['Bills due · 30 days', 'Unpaid bills with a due date in the next 30 days.'],
    goalsProgress: ['Goals progress', 'Amount saved across all savings goals, compared with their targets.'],
    budgetUsed: ['Budget used', 'Amount spent from your current budget.'],
    sysStatus: ['System status', 'A label based on overdue bills, budget overruns and remaining money. Not a score.'],
    planned: ['Planned spending', 'Total of the category limits in this month\u2019s budget.'],
    actual: ['Actual spending', 'What you spent this month in budgeted categories.'],
    remaining: ['Remaining budget', 'Planned spending minus actual spending.'],
    unbudgeted: ['Unbudgeted spend', 'Spending this month in categories without a budget.'],
    netWorth: ['Net worth', 'Assets minus liabilities across your active accounts.'],
    assets: ['Total assets', 'Sum of accounts with a positive balance.'],
    liabilities: ['Total liabilities', 'Sum of credit and loan balances you owe.'],
    accounts: ['Accounts', 'Active accounts you track (archived ones are excluded).'],
    acctBal: ['Current balance', 'Opening balance plus every income, expense and transfer on this account.'],
    goalPerMonth: ['Suggested per month', 'Amount left to save divided by the months until the target date.'],
    goalSaved: ['Total saved', 'Current amount saved across all goals.'],
    goalTarget: ['Total target', 'Sum of all goal targets.'],
    goalOverall: ['Overall progress', 'Total saved as a share of total target.'],
    goalDone: ['Completed', 'Goals that have reached their target.'],
    billsOutstanding: ['Outstanding', 'All bills not yet marked as paid.'],
    billsOverdue: ['Overdue', 'Unpaid bills past their due date.'],
    billsSoon: ['Due within 7 days', 'Unpaid bills due in the next 7 days.'],
    billsPaid: ['Paid this month', 'Bills marked as paid in the selected month.'],
    recIncome: ['Recurring income', 'Active income rules converted to a monthly amount.'],
    recExpense: ['Recurring expenses', 'Active expense rules converted to a monthly amount.'],
    recNet: ['Net recurring', 'Recurring income minus recurring expenses, per month.'],
    recRules: ['Active rules', 'Recurring rules that are not paused.'],
    anIncome: ['Income', 'Total income recorded in the selected range.'],
    anExpenses: ['Expenses', 'Total spending recorded in the selected range.'],
    anNet: ['Net saved', 'Income minus expenses over the selected range.'],
    anRate: ['Average savings rate', 'Net saved as a share of income over the range.'],
    txCount: ['Matching entries', 'Transactions that match the current filters.'],
    txIncome: ['Income in results', 'Income among the filtered transactions.'],
    txExpense: ['Expenses in results', 'Spending among the filtered transactions.'],
    txNet: ['Net in results', 'Filtered income minus filtered expenses.']
  };

  /** Attribute string for any element. spec = key | { key?, title?, text?, extra? } */
  const attrs = (spec, extra) => {
    const o = typeof spec === 'string' ? { key: spec } : (spec || {});
    const d = DICT[o.key] || [];
    const title = o.title || d[0] || '', text = o.text || d[1] || '';
    const ex = o.extra != null ? o.extra : extra;
    if (!title && !text) return '';
    return ` data-tip-title="${esc(title)}" data-tip="${esc(text)}"${ex ? ` data-tip-extra="${esc(ex)}"` : ''}`;
  };
  /** Same, plus focusable + marker class, for non-interactive hosts (cards, values). */
  const host = (spec, extra) => { const a = attrs(spec, extra); return a ? `${a} tabindex="0"` : ''; };

  let tip = null, cur = null, timer = null, hideTimer = null, lastPointer = 'mouse';
  const INTERACTIVE = 'a,button,input,select,textarea,label,[data-action],[role="button"]';

  const ensure = () => {
    if (tip) return tip;
    tip = document.createElement('div');
    tip.id = 'ctx-tip'; tip.className = 'ctx-tip'; tip.setAttribute('role', 'tooltip');
    document.body.appendChild(tip);
    return tip;
  };

  const place = target => {
    const r = target.getBoundingClientRect();
    const vw = document.documentElement.clientWidth, vh = window.innerHeight, m = 8, gap = 8;
    // keep clear of the fixed mobile bottom nav when it is visible
    const nav = document.querySelector('.modal') ? null : document.querySelector('.bottomnav');
    let floor = vh - m;
    if (nav) { const nr = nav.getBoundingClientRect(); if (nr.height && getComputedStyle(nav).display !== 'none' && nr.top < vh) floor = Math.min(floor, nr.top - m); }
    tip.style.maxWidth = Math.min(280, vw - m * 2) + 'px';
    tip.style.left = '0px'; tip.style.top = '0px';
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    let left = r.left + r.width / 2 - tw / 2;
    left = Math.max(m, Math.min(left, vw - m - tw));
    let top = r.top - th - gap, below = false;
    if (top < m) { top = r.bottom + gap; below = true; }
    if (top + th > floor) top = Math.max(m, Math.min(r.top - th - gap, floor - th));
    tip.style.left = Math.round(left) + 'px'; tip.style.top = Math.round(top) + 'px';
    tip.classList.toggle('below', below);
  };

  const show = target => {
    clearTimeout(hideTimer);
    ensure();
    const title = target.getAttribute('data-tip-title'), text = target.getAttribute('data-tip') || '', ex = target.getAttribute('data-tip-extra');
    tip.innerHTML = `${title ? `<b class="ctx-tip-t">${esc(title)}</b>` : ''}${text ? `<span class="ctx-tip-d">${esc(text)}</span>` : ''}${ex ? `<span class="ctx-tip-x">${esc(ex)}</span>` : ''}`;
    tip.classList.add('on');
    if (cur && cur !== target) cur.removeAttribute('aria-describedby');
    cur = target; if (text) target.setAttribute('aria-describedby', 'ctx-tip');
    place(target);
  };
  const hide = () => {
    clearTimeout(timer); clearTimeout(hideTimer);
    if (cur) cur.removeAttribute('aria-describedby');
    cur = null; if (tip) tip.classList.remove('on');
  };

  // Icon-only buttons get their existing aria-label as a hover/focus tip
  // (desktop only - on touch they must act immediately).
  const ICON_BTN = '.mini-btn[aria-label],.icon-btn[aria-label]';
  const tipHost = (e, touch) => {
    if (!e.target || !e.target.closest) return null;
    const h = e.target.closest('[data-tip]'); if (h) return h;
    if (touch) return null;
    const b = e.target.closest(ICON_BTN);
    if (b && !b.querySelector('.so-label')) { if (!b.hasAttribute('data-tip-title')) b.setAttribute('data-tip-title', b.getAttribute('aria-label')); return b; }
    return null;
  };

  const init = () => {
    document.addEventListener('pointerdown', e => { lastPointer = e.pointerType || 'mouse'; }, true);
    // desktop hover
    document.addEventListener('pointerover', e => {
      if (e.pointerType === 'touch' || e.pointerType === 'pen') return;
      const h = tipHost(e); if (!h || h === cur) return;
      clearTimeout(timer); timer = setTimeout(() => show(h), 280);
    });
    document.addEventListener('pointerout', e => {
      if (e.pointerType === 'touch' || e.pointerType === 'pen') return;
      const h = tipHost(e); if (!h) return;
      if (e.relatedTarget && h.contains(e.relatedTarget)) return;
      clearTimeout(timer); if (cur === h) hide();
    });
    // keyboard focus (not for taps: focus from a tap is handled by click)
    document.addEventListener('focusin', e => {
      const h = tipHost(e); if (!h || lastPointer === 'touch') return;
      if (h.matches(':focus-visible')) show(h);
    });
    document.addEventListener('focusout', e => { const h = tipHost(e); if (h && h === cur) hide(); });
    // touch: tap toggles on non-interactive hosts; any other tap closes
    document.addEventListener('click', e => {
      if (lastPointer !== 'touch') return;
      const h = tipHost(e, true);
      const interactive = e.target.closest(INTERACTIVE);
      if (!h || (interactive && h.contains(interactive)) || (interactive && interactive.contains(h))) { hide(); return; }
      if (cur === h) { hide(); return; }
      show(h); clearTimeout(hideTimer); hideTimer = setTimeout(hide, 5000);
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && cur) hide(); }, true);
    window.addEventListener('scroll', () => { if (cur) hide(); }, { passive: true, capture: true });
    window.addEventListener('resize', () => { if (cur) hide(); });
    window.addEventListener('hashchange', hide);
  };

  return { DICT, attrs, host, show, hide, init };
})();
