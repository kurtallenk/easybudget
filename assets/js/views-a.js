/* ============================================================
   06 · VIEWS A - Dashboard, Transactions, Budget
   ============================================================ */
const ViewsA = (() => {
  const { el, esc, icon, $, $$, money, percent, fdate, monthLabel, today, monthKey } = Core;

  const txIcon = t => {
    if (t.type === 'transfer') return `<span class="cat-ico" style="background:var(--info-soft);color:var(--info)">${icon('transfer', 16)}</span>`;
    const c = Store.catById(t.categoryId);
    const col = c?.color || '#868e96';
    return `<span class="cat-ico" style="background:${col}1f;color:${col}">${c?.emoji || '📁'}</span>`;
  };
  const txAmount = t => {
    const cls = t.type === 'income' ? 'pos' : t.type === 'expense' ? 'neg' : '';
    const pre = t.type === 'income' ? '+' : t.type === 'expense' ? '−' : '';
    return `<span class="t-amt ${cls} num">${pre}${money(t.amount, { abs: true })}</span>`;
  };
  const txSub = t => t.type === 'transfer'
    ? `${Store.acctName(t.accountId)} → ${Store.acctName(t.toAccountId)}`
    : `${Store.catName(t.categoryId)} · ${Store.acctName(t.accountId)}`;

  const txRowsHTML = list => list.map(t => `
    <tr data-id="${t.id}">
      <td style="width:44px">${txIcon(t)}</td>
      <td><div class="lr-title">${esc(t.description)}</div><div class="lr-sub">${esc(txSub(t))}${t.recurringId ? ' · recurring' : ''}</div></td>
      <td class="muted small" style="white-space:nowrap">${esc(fdate(t.date))}</td>
      <td class="muted small" style="white-space:nowrap">${esc(t.method || '')}</td>
      <td class="t-amt">${txAmount(t)}</td>
      <td style="width:76px"><div class="row-actions">
        <button class="mini-btn" data-action="edit-tx" data-arg="${t.id}" aria-label="Edit ${esc(t.description)}">${icon('edit', 15)}</button>
        <button class="mini-btn danger" data-action="del-tx" data-arg="${t.id}" aria-label="Delete ${esc(t.description)}">${icon('trash', 15)}</button>
      </div></td>
    </tr>`).join('');

  const dueTile = (iso, status) => {
    const d = new Date(iso + 'T00:00:00');
    return `<span class="due-tile ${status || ''}" aria-hidden="true"><span class="m">${d.toLocaleString('en', { month: 'short' })}</span><span class="d">${d.getDate()}</span></span>`;
  };
  const txCardsHTML = list => {
    const groups = Core.groupBy(list, t => t.date);
    return Object.keys(groups).sort((a, b) => b.localeCompare(a)).map(d => `
      <div class="date-sep">${esc(Core.dayHeading(d))}</div>
      ${groups[d].map(t => `
        <div class="list-row" data-id="${t.id}">
          ${txIcon(t)}
          <div class="lr-main"><div class="lr-title">${esc(t.description)}</div><div class="lr-sub">${esc(txSub(t))}</div></div>
          <div class="lr-right">${txAmount(t)}
            <div class="row-actions" style="opacity:1;margin-top:3px">
              <button class="mini-btn" data-action="edit-tx" data-arg="${t.id}" aria-label="Edit">${icon('edit', 14)}</button>
              <button class="mini-btn danger" data-action="del-tx" data-arg="${t.id}" aria-label="Delete">${icon('trash', 14)}</button>
            </div></div>
        </div>`).join('')}`).join('');
  };

  /* ==================== DASHBOARD ====================
     Presentation over existing Compute results only. Reading order answers:
     how much do I have → what happened this month → am I within budget →
     what needs attention → where did money go → recent activity → bills → goals. */
  const TONE_ORDER = { bad: 0, warn: 1, info: 2, good: 3 };
  const insightAction = i => i.icon === 'bills' ? ['go', 'bills', 'View bills']
    : i.icon === 'budget' ? ['go', 'budget', 'Open budget']
    : i.icon === 'analytics' ? ['go', 'analytics', 'Analyse'] : null;

  /* Futuristic (Game HUD) template helpers. Everything they render carries
     .hud-only, so the other templates never show it (app.css §3b). They only
     re-present values the dashboard already computes - no new calculations. */
  const HUD_STATE = { ok: 'Within limit', warn: 'Near limit', over: 'Over limit' };
  const hudBar = (value, state, label) => `<div class="hud-bar ${state || ''}" role="progressbar" aria-valuemin="0" aria-valuemax="100"
      aria-valuenow="${Math.round(Core.clamp(value, 0, 100))}" aria-label="${esc(label)}"><i style="width:${Core.clamp(value, 0, 100)}%"></i></div>`;
  const hudDays = d => d < 0 ? `${-d} day${d === -1 ? '' : 's'} overdue` : d === 0 ? 'Due today' : `Due in ${d} day${d === 1 ? '' : 's'}`;

  /* Personal greeting. The name comes from the signed-in account
     (users.display_name → session payload → Store.user().displayName);
     no name → a neutral greeting. Nothing is hard-coded or guessed. */
  const userFirstName = () => {
    const u = Store.user && Store.user();
    const n = u && typeof u.displayName === 'string' ? u.displayName.trim() : '';
    return n ? n.split(/\s+/)[0].slice(0, 40) : '';
  };
  const greetingHTML = ym => {
    const name = userFirstName();
    return `<div class="dash-hello" data-has-name="${name ? 'yes' : 'no'}">
      <p class="dash-hello-t">${name ? `Welcome back, <b>${esc(name)}</b>` : 'Welcome back'}</p>
      <p class="dash-hello-s">Here\u2019s your financial overview for ${esc(monthLabel(ym))}.</p>
    </div>`;
  };

  const dashboard = {
    title: 'Dashboard',
    subtitle: () => `Your financial snapshot for ${monthLabel(App.state.month)}`,
    render(host) {
      const ym = App.state.month;
      const s = Compute.monthSummary(ym);
      const prev = Compute.monthSummary(Core.addMonths(ym, -1));
      const ser = Compute.series(ym, 6);
      const bal = Compute.netWorth();
      const liquid = Compute.liquidBalance();
      const goals = Store.get().goals;
      const bills = Compute.upcomingBills(30);
      const recent = Core.sortBy(Compute.txOfMonth(ym), t => t.date + t.createdAt, -1).slice(0, 6);
      const ins = Compute.insights(ym);
      const b = s.budget;
      const cats = Compute.topCategories(ym, 5);
      const nAcc = Store.accounts().length;
      const overdue = bills.filter(x => x.status === 'overdue');
      const goalTarget = Core.sum(goals, g => g.target), goalSaved = Core.sum(goals, g => g.current);
      const budState = b.utilization > 100 ? 'over' : b.utilization >= 85 ? 'warn' : 'ok';
      // Tooltip context lines - counted from the same month's real records.
      const monthTx = Compute.txOfMonth(ym);
      const nInc = monthTx.filter(t => t.type === 'income').length, nExp = monthTx.filter(t => t.type === 'expense').length;
      const nTx = (n, kind) => `From ${n} ${kind} transaction${n === 1 ? '' : 's'} in ${monthLabel(ym)}.`;
      const tipBudget = b.planned ? `${money(b.spent)} spent of ${money(b.planned)} planned.` : 'No budget set for this month.';
      const tipBills = bills.length ? `${bills.length} bill${bills.length === 1 ? '' : 's'}${overdue.length ? ` · ${overdue.length} overdue` : ''}.` : 'Nothing due in the next 30 days.';
      const tipGoals = goals.length ? `${goals.length} goal${goals.length === 1 ? '' : 's'} · ${money(goalSaved)} of ${money(goalTarget)}.` : 'No savings goals yet.';

      const delta = (cur, prv, invert) => {
        if (!prv) return { text: 'no prior month', move: 'flat', good: null };
        const d = Core.pct(cur - prv, Math.abs(prv));
        const flat = Math.abs(d) < 0.05;
        return { text: `${d >= 0 ? '+' : ''}${percent(d)} vs last month`,
          move: flat ? 'flat' : d > 0 ? 'up' : 'down',
          good: flat ? null : (invert ? d < 0 : d > 0) };
      };

      // attention list: overdue bills and budget overruns first, then insights by severity
      const attn = [];
      if (overdue.length) attn.push({ tone: 'bad', icon: 'alert', html: `<b>${overdue.length} overdue bill${overdue.length === 1 ? '' : 's'}</b> totalling <b class="num">${money(Core.sum(overdue, x => x.amount))}</b>.`, act: ['go', 'bills', 'Pay bills'] });
      if (b.overCount > 1) attn.push({ tone: 'bad', icon: 'budget', html: `<b>${b.overCount} categories</b> are over budget this month.`, act: ['go', 'budget', 'Review'] });
      ins.slice().sort((x, y) => (TONE_ORDER[x.tone] ?? 2) - (TONE_ORDER[y.tone] ?? 2))
        .forEach(i => attn.push({ tone: i.tone, icon: i.icon, html: esc(i.text), act: insightAction(i) }));
      const attnShown = attn.slice(0, 5);

      const leftToSpend = b.planned ? b.remaining : s.income - s.expenses;

      // HUD system status: a label derived from existing states (overdue bills,
      // budget line states, remaining money). Not a score.
      const dueSoon = bills.filter(x => x.status === 'due-soon').length;
      const sys = overdue.length || b.overCount || leftToSpend < 0
        ? { tone: 'over', label: 'Alert', why: [overdue.length && `${overdue.length} overdue bill${overdue.length === 1 ? '' : 's'}`, b.overCount && `${b.overCount} over budget`, leftToSpend < 0 && 'spending exceeds plan'].filter(Boolean).join(' · ') }
        : b.warnCount || budState === 'warn' || dueSoon
          ? { tone: 'warn', label: 'Caution', why: [b.warnCount && `${b.warnCount} near limit`, dueSoon && `${dueSoon} bill${dueSoon === 1 ? '' : 's'} due within 7 days`].filter(Boolean).join(' · ') || 'budget nearly used' }
          : { tone: 'ok', label: 'Stable', why: 'No overdue bills or budget overruns' };
      const goalPct = goals.length ? Core.pct(goalSaved, goalTarget) : 0;

      host.innerHTML = `
        ${App.sampleBanner()}
        ${greetingHTML(ym)}
        <section class="hud-cmd hud-only mb" aria-labelledby="hud-cmd-h">
          <div class="hud-cmd-head">
            <div class="hud-cmd-title"><span class="hud-kicker">Financial command center</span>
              <h2 id="hud-cmd-h">Current financial status</h2></div>
            <div class="hud-cmd-meta">
              <span class="hud-status ${sys.tone}"${Tips.host('sysStatus', sys.why)}><span class="hud-dot" aria-hidden="true"></span>System status <b>${sys.label}</b></span>
              <span class="hud-tag">Period <b>${esc(monthLabel(ym))}</b></span>
            </div>
            <p class="hud-why">${esc(sys.why)}</p>
          </div>
          <div class="hud-gauges">
            <div class="hud-gauge"${Tips.host('budgetUsed', tipBudget)}><span class="hud-k">Budget utilization</span>
              ${b.planned ? `<span class="hud-v num ${budState === 'over' ? 'neg' : ''}">${percent(b.utilization)}</span>
                ${hudBar(b.utilization, budState, `Budget utilization ${percent(b.utilization)}`)}
                <span class="hud-s">${b.remaining >= 0 ? `${percent(Math.max(0, 100 - b.utilization))} remaining` : `${money(-b.remaining, { decimals: false })} over`} · <b>${HUD_STATE[budState]}</b></span>`
                : '<span class="hud-v">-</span><span class="hud-s">No budget set this month</span>'}</div>
            <div class="hud-gauge"${Tips.host('billsDue', tipBills)}><span class="hud-k">Bills · next 30 days</span>
              <span class="hud-v num ${overdue.length ? 'neg' : ''}">${bills.length}</span>
              <span class="hud-s">${bills.length ? `${money(Core.sum(bills, x => x.amount), { decimals: false })} due${overdue.length ? ` · <b class="neg">${overdue.length} overdue</b>` : dueSoon ? ` · <b>${dueSoon} this week</b>` : ''}` : 'Nothing scheduled'}</span></div>
            <div class="hud-gauge"${Tips.host('goalsProgress', tipGoals)}><span class="hud-k">Savings goals</span>
              ${goals.length ? `<span class="hud-v num">${percent(goalPct)}</span>
                ${hudBar(goalPct, 'ok', `Savings goals ${percent(goalPct)} complete`)}
                <span class="hud-s num">${money(goalSaved, { decimals: false })} / ${money(goalTarget, { decimals: false })}</span>`
                : '<span class="hud-v">-</span><span class="hud-s">No goals yet</span>'}</div>
            <div class="hud-gauge"${Tips.host('netSavings', nTx(nInc + nExp, 'income/expense'))}><span class="hud-k">Net savings</span>
              <span class="hud-v num ${s.net < 0 ? 'neg' : 'pos'}">${money(s.net, { decimals: false })}</span>
              <span class="hud-s">Savings rate <b>${percent(s.savingsRate)}</b></span></div>
          </div>
        </section>
        <section class="card dash-summary mb" aria-labelledby="dash-sum-h">
          <div class="card-head"><h2 id="dash-sum-h">Summary</h2><span class="period-chip">${esc(monthLabel(ym))}</span>
            <span class="spacer"></span>
            <button class="btn btn-sm hide-sm" data-action="go" data-arg="transactions">${icon('transactions', 14)}Activity</button>
            <button class="btn btn-sm btn-primary" data-action="add-tx">${icon('plus', 14)}Add transaction</button></div>
          <div class="kpis">
            ${UI.kpi({ label: 'Total balance', value: money(bal), tone: bal >= 0 ? 'blue' : 'red', valueClass: bal < 0 ? 'neg' : '',
              sub: `${nAcc} account${nAcc === 1 ? '' : 's'} · ${money(liquid, { decimals: false })} liquid`, sparkId: 'sp-bal',
              tip: 'balance', tipExtra: `Across ${nAcc} account${nAcc === 1 ? '' : 's'}; ${money(liquid)} excluding credit accounts.` })}
            ${UI.kpi({ label: 'Income', value: money(s.income), tone: 'green', delta: delta(s.income, prev.income), sparkId: 'sp-inc', tip: 'income', tipExtra: nTx(nInc, 'income') })}
            ${UI.kpi({ label: 'Expenses', value: money(s.expenses), tone: 'red', delta: delta(s.expenses, prev.expenses, true), sparkId: 'sp-exp', tip: 'expenses', tipExtra: nTx(nExp, 'expense') })}
            ${UI.kpi({ label: b.planned ? 'Left to spend' : 'Available (income − expenses)', value: money(leftToSpend), tone: leftToSpend >= 0 ? 'blue' : 'red', valueClass: leftToSpend < 0 ? 'neg' : '',
              sub: b.planned ? `${percent(b.utilization)} of ${money(b.planned, { decimals: false })} budget used` : 'No budget set this month',
              extra: b.planned ? `<div style="margin-top:9px">${UI.progressBar(b.utilization, budState)}</div>` : '',
              tip: b.planned ? 'leftToSpend' : 'available', tipExtra: b.planned ? tipBudget : '' })}
          </div>
          <div class="minis">
            <div class="mini"${Tips.host('netSavings')}><span class="k">Net savings</span><span class="v num ${s.net < 0 ? 'neg' : 'pos'}">${money(s.net)}</span></div>
            <div class="mini"${Tips.host('savingsRate')}><span class="k">Savings rate</span><span class="v num">${percent(s.savingsRate)}${prev.income ? ` <span class="small muted" style="font-weight:500">was ${percent(prev.savingsRate)}</span>` : ''}</span></div>
            <div class="mini"${Tips.host('billsDue', tipBills)}><span class="k">Bills due · 30 days</span><span class="v num ${overdue.length ? 'neg' : ''}">${bills.length ? `${bills.length} · ${money(Core.sum(bills, x => x.amount), { decimals: false })}` : 'None'}</span></div>
            <div class="mini"${Tips.host('goalsProgress', tipGoals)}><span class="k">Goals progress</span><span class="v num">${goals.length ? `${percent(Core.pct(goalSaved, goalTarget))} of ${money(goalTarget, { decimals: false })}` : 'No goals'}</span></div>
          </div>
        </section>

        <div class="grid g-wide mb">
          <section class="card">
            <div class="card-head"><h2>Budget overview</h2><span class="sub">${esc(monthLabel(ym))}</span>
              <span class="spacer"></span><button class="btn btn-sm" data-action="go" data-arg="budget">Manage</button></div>
            ${b.lines.length ? `<div class="card-body">
              <div class="bud-total">
                <div class="row wrap" style="gap:6px 12px;align-items:baseline">
                  <span class="big num"${Tips.host('budgetUsed', tipBudget)}>${money(b.spent)}</span><span class="muted small">spent of <b class="num" style="color:var(--text)">${money(b.planned)}</b> planned</span>
                  <span class="spacer"></span>
                  ${b.overCount ? `<span class="badge red">${b.overCount} over</span>` : ''}${b.warnCount ? `<span class="badge amber">${b.warnCount} near limit</span>` : ''}${!b.overCount && !b.warnCount ? '<span class="badge green">On track</span>' : ''}
                </div>
                ${UI.progressBar(b.utilization, budState, true)}
                <div class="row small muted"><span>${percent(b.utilization)} used</span>
                  <span class="hud-only hud-state ${budState}">Status: ${HUD_STATE[budState]}</span><span class="spacer"></span>
                  <span class="${b.remaining < 0 ? 'neg strong' : ''}">${b.remaining < 0 ? `${money(-b.remaining)} over plan` : `${money(b.remaining)} remaining`}</span></div>
              </div>
              <div class="stack-md">
              ${b.lines.slice().sort((x, y) => y.used - x.used).slice(0, 5).map(l => `
                <div>
                  <div class="bud-line-head">
                    <span aria-hidden="true">${esc(Store.catEmoji(l.categoryId))}</span><span class="nm">${esc(Store.catName(l.categoryId))}</span>
                    <span class="spacer"></span>
                    <span class="small num ${l.state === 'over' ? 'neg strong' : 'muted'}">${money(l.spent, { decimals: false })} / ${money(l.amount, { decimals: false })}</span>
                  </div>
                  ${UI.progressBar(l.used, l.state)}
                  <div class="bud-line-foot"><span>${percent(l.used)} used</span><span class="spacer"></span>
                    <span class="${l.remaining < 0 ? 'neg' : ''}">${l.remaining < 0 ? `${money(-l.remaining, { decimals: false })} over` : `${money(l.remaining, { decimals: false })} left`}</span></div>
                </div>`).join('')}
              </div>
              ${b.lines.length > 5 ? `<button class="btn btn-sm btn-ghost btn-block" style="margin-top:12px" data-action="go" data-arg="budget">View all ${b.lines.length} categories</button>` : ''}
            </div>` : UI.emptyState({ icon: 'budget', title: 'No budget for this month', desc: 'A budget shows at a glance whether spending is on plan. Set limits for the categories you care about.', action: { label: 'Create budget', action: 'go', arg: 'budget' } })}
          </section>

          <section class="card" aria-labelledby="dash-attn-h">
            <div class="card-head"><h2 id="dash-attn-h">Needs attention</h2>${attn.length ? `<span class="badge ${attn.some(a => a.tone === 'bad') ? 'red' : attn.some(a => a.tone === 'warn') ? 'amber' : 'gray'}">${attn.length}</span>` : ''}</div>
            ${attnShown.length ? `<div class="attn">${attnShown.map(a => `
              <div class="attn-row"><span class="attn-ico ${esc(a.tone)}" aria-hidden="true">${icon(a.icon, 15)}</span>
                <p class="attn-text">${a.html}</p>
                ${a.act ? `<button class="btn btn-sm btn-ghost" data-action="${a.act[0]}" data-arg="${a.act[1]}">${esc(a.act[2])}</button>` : ''}</div>`).join('')}</div>
              <p class="hint" style="padding:8px var(--card-pad) 12px">Calculated from your own records. Informational only, not financial advice.</p>`
              : `<div class="attn-ok"><span class="attn-ico good" aria-hidden="true">${icon('checkCircle', 15)}</span><span>Nothing needs your attention right now. Add transactions to get insights for ${esc(monthLabel(ym))}.</span></div>`}
          </section>
        </div>

        <div class="grid g-wide mb">
          <section class="card">
            <div class="card-head"><h2>Income vs expenses</h2><span class="sub">Last 6 months</span>
              <span class="spacer"></span><button class="btn btn-sm btn-ghost" data-action="go" data-arg="analytics">Analytics ${icon('chevR', 14)}</button></div>
            <div class="card-body"><div class="chart" id="ch-ie"></div></div>
          </section>
          <section class="card">
            <div class="card-head"><h2>Where money went</h2><span class="sub">${esc(monthLabel(ym, true))}</span></div>
            <div class="card-body">
              ${s.expenses ? `<div class="donut-wrap"><div class="chart" id="ch-donut"></div>
                <div class="cat-rank" aria-label="Top spending categories">${cats.map(c => `
                  <div class="cat-rank-row"><span class="nm"><span class="dot" style="background:${c.color}"></span>${esc(c.emoji)} ${esc(c.name)}</span>
                    <span class="am">${money(c.value, { decimals: false })} <span class="muted small" style="font-weight:500">${percent(Core.pct(c.value, s.expenses))}</span></span>
                    ${UI.progressBar(Core.pct(c.value, s.expenses), '')}</div>`).join('')}</div></div>`
                : UI.emptyState({ icon: 'analytics', title: 'No spending recorded', desc: 'Expenses for this month appear here, split by category, so you can see where money goes.', compact: true })}
            </div>
          </section>
        </div>

        <div class="grid g-half mb">
          <section class="card">
            <div class="card-head"><h2>Recent transactions</h2><span class="sub">${esc(monthLabel(ym, true))}</span>
              <span class="spacer"></span><button class="btn btn-sm" data-action="go" data-arg="transactions">See all</button></div>
            ${recent.length ? `<div class="list">${recent.map(t => `
              <div class="list-row">
                <span class="hud-only feed-ts num" aria-hidden="true">${esc(fdate(t.date, 'short'))}</span>
                ${txIcon(t)}
                <div class="lr-main"><div class="lr-title">${esc(t.description)}</div><div class="lr-sub">${esc(txSub(t))} · ${esc(fdate(t.date, 'short'))}</div></div>
                <div class="lr-right">${txAmount(t)}</div>
              </div>`).join('')}</div>`
              : UI.emptyState({ title: 'No transactions this month', desc: 'Record income and expenses to see your balance, budget and insights come to life.', action: { label: 'Add transaction', action: 'add-tx' }, compact: true })}
          </section>

          <section class="card">
            <div class="card-head"><h2>Upcoming bills</h2><span class="sub">Next 30 days</span>
              <span class="spacer"></span><button class="btn btn-sm" data-action="go" data-arg="bills">All bills</button></div>
            ${bills.length ? `<div class="list">${bills.slice(0, 5).map(b2 => {
              const st = b2.status;
              const badge = st === 'overdue' ? '<span class="badge red">Overdue</span>' : st === 'due-soon' ? '<span class="badge amber">Due soon</span>' : '<span class="badge gray">Upcoming</span>';
              return `<div class="list-row">
                ${dueTile(b2.dueDate, st)}
                <div class="lr-main"><div class="lr-title"><span class="hud-only hud-dot ${st}" aria-hidden="true"></span>${esc(b2.name)}</div>
                  <div class="hud-only hud-due ${st}">${esc(hudDays(b2.inDays))}</div><div class="lr-sub">${esc(Core.relDate(b2.dueDate))} · ${esc(Store.catName(b2.categoryId))}</div></div>
                <div class="lr-right"><div class="lr-amt">${money(b2.amount)}</div><div style="margin-top:3px">${badge}</div></div>
              </div>`; }).join('')}</div>`
              : UI.emptyState({ icon: 'bills', title: 'No bills due', desc: 'Nothing is scheduled in the next 30 days. Track bills so due dates never slip.', action: { label: 'Add bill', action: 'add-bill' }, compact: true })}
          </section>
        </div>

        <section class="card">
          <div class="card-head"><h2>Savings goals</h2>${goals.length ? `<span class="sub num">${money(goalSaved, { decimals: false })} of ${money(goalTarget, { decimals: false })} saved</span>` : ''}
            <span class="spacer"></span><button class="btn btn-sm" data-action="go" data-arg="goals">Manage</button></div>
          ${goals.length ? `<div class="card-body grid g-3">${goals.slice(0, 6).map(g => {
            const p = Compute.goalProgress(g);
            return `<div class="goal-mini">
              ${Charts.ring(48, p.pct, g.color, 6)}
              <div class="gm-main">
                <div class="lr-title">${esc(g.emoji)} ${esc(g.name)}</div>
                <div class="lr-sub num">${money(g.current, { decimals: false })} of ${money(g.target, { decimals: false })}</div>
                <div class="hud-only gm-hud">${hudBar(p.pct, p.complete ? 'ok' : '', `${g.name} ${Math.round(p.pct)}% complete`)}
                  <span class="num">${Math.round(p.pct)}% complete</span></div>
                <div class="small muted">${p.complete ? 'Goal reached 🎉' : p.perMonth ? `${money(p.perMonth, { decimals: false })}/mo to hit ${esc(fdate(g.targetDate, 'short'))}` : `${money(p.remaining, { decimals: false })} to go`}</div>
              </div></div>`; }).join('')}</div>`
            : UI.emptyState({ icon: 'goals', title: 'No savings goals yet', desc: 'Goals turn saving into visible progress: an emergency fund, a trip, a new laptop.', action: { label: 'Create goal', action: 'add-goal' }, compact: true })}
        </section>`;

      // charts
      const ie = $('#ch-ie', host); if (ie) Charts.incomeExpense(ie, ser);
      const dn = $('#ch-donut', host);
      if (dn) Charts.donut(dn, Compute.topCategories(ym, 7).map(c => ({ name: c.name, value: c.value, color: c.color })), { centerLabel: 'Spent', legend: false });
      const spB = $('#sp-bal', host); if (spB) Charts.spark(spB, Compute.cumulativeSavings(ym, 6).map(x => x.value), 'var(--brand)');
      const spI = $('#sp-inc', host); if (spI) Charts.spark(spI, ser.map(x => x.income), 'var(--pos)');
      const spE = $('#sp-exp', host); if (spE) Charts.spark(spE, ser.map(x => x.expenses), 'var(--neg)');
    }
  };

  /* ==================== TRANSACTIONS ==================== */
  const transactions = {
    title: 'Transactions',
    subtitle: () => 'Search, filter and manage every entry',
    render(host) {
      const f = App.state.txFilter;
      const all = Compute.filterTx(f);
      const perPage = 25;
      const pages = Math.max(1, Math.ceil(all.length / perPage));
      if (App.state.page > pages) App.state.page = pages;
      const page = App.state.page;
      const slice = all.slice((page - 1) * perPage, page * perPage);
      const totals = { income: Compute.incomeOf(all), expense: Compute.expenseOf(all) };
      const activeFilters = ['type', 'categoryId', 'accountId', 'method', 'from', 'to', 'min', 'max'].filter(k => f[k] && f[k] !== 'all').length;

      host.innerHTML = `
        <div class="card mb">
          <div class="card-body" style="padding:14px">
            <div class="row wrap" style="gap:9px">
              <div class="search"><span class="ic">${icon('search', 16)}</span>
                <input class="input" id="tx-q" type="search" placeholder="Search description, category, account, amount, notes…" value="${esc(f.q || '')}" aria-label="Search transactions"></div>
              <button class="btn" data-action="toggle-filters" aria-expanded="${App.state.showFilters}">${icon('filter', 15)}Filters${activeFilters ? ` <span class="badge blue" style="margin-left:2px">${activeFilters}</span>` : ''}</button>
              <button class="btn btn-primary" data-action="add-tx">${icon('plus', 15)}<span class="hide-xs">Add transaction</span></button>
            </div>
            <div id="filter-panel" style="${App.state.showFilters ? '' : 'display:none'};margin-top:14px;padding-top:14px;border-top:1px solid var(--border)">
              <div class="form-grid" style="grid-template-columns:repeat(auto-fit,minmax(170px,1fr))">
                ${UI.fieldHTML({ name: 'type', label: 'Type', type: 'select', value: f.type || 'all', options: [{ value: 'all', label: 'All types' }, { value: 'income', label: 'Income' }, { value: 'expense', label: 'Expense' }, { value: 'transfer', label: 'Transfer' }] , idPrefix: 'flt' })}
                ${UI.fieldHTML({ name: 'categoryId', label: 'Category', type: 'select', value: f.categoryId || '', options: [{ value: '', label: 'All categories' }].concat(Store.categories().map(c => ({ value: c.id, label: `${c.emoji} ${c.name}` }))) , idPrefix: 'flt' })}
                ${UI.fieldHTML({ name: 'accountId', label: 'Account', type: 'select', value: f.accountId || '', options: [{ value: '', label: 'All accounts' }].concat(Store.accounts().map(a => ({ value: a.id, label: a.name }))) , idPrefix: 'flt' })}
                ${UI.fieldHTML({ name: 'method', label: 'Payment method', type: 'select', value: f.method || '', options: [{ value: '', label: 'Any method' }].concat(Store.PAYMENT_METHODS.map(m => ({ value: m, label: m }))) , idPrefix: 'flt' })}
                ${UI.fieldHTML({ name: 'from', label: 'From date', type: 'date', value: f.from || '', idPrefix: 'flt' })}
                ${UI.fieldHTML({ name: 'to', label: 'To date', type: 'date', value: f.to || '', idPrefix: 'flt' })}
                ${UI.fieldHTML({ name: 'min', label: 'Min amount', type: 'money', value: f.min || '', idPrefix: 'flt' })}
                ${UI.fieldHTML({ name: 'max', label: 'Max amount', type: 'money', value: f.max || '', idPrefix: 'flt' })}
              </div>
              <div class="row wrap" style="margin-top:12px;gap:9px">
                <label class="row" style="gap:8px;cursor:pointer"><span class="switch"><input type="checkbox" id="fx-rec" ${f.recurringOnly ? 'checked' : ''}><span></span></span><span class="small">Recurring only</span></label>
                <span class="spacer"></span>
                <button class="btn btn-sm" data-action="reset-filters">Clear filters</button>
                <button class="btn btn-sm" data-action="export-filtered">${icon('download', 14)}Export CSV</button>
              </div>
            </div>
          </div>
        </div>

        <div class="grid g-stats mb">
          ${UI.statCard({ tip: 'txCount', label: 'Matching entries', value: String(all.length), iconName: 'transactions', tone: 'gray', sub: `of ${Store.get().transactions.length} total` })}
          ${UI.statCard({ tip: 'txIncome', label: 'Income in results', value: money(totals.income), iconName: 'up', tone: 'green' })}
          ${UI.statCard({ tip: 'txExpense', label: 'Expenses in results', value: money(totals.expense), iconName: 'down', tone: 'red' })}
          ${UI.statCard({ tip: 'txNet', label: 'Net in results', value: money(totals.income - totals.expense), iconName: 'wallet', tone: totals.income - totals.expense >= 0 ? 'blue' : 'red' })}
        </div>

        <section class="card">
          ${slice.length ? `
          <div class="tbl-wrap responsive">
            <table class="tbl"><thead><tr>
              <th></th>
              <th class="sortable${f.sortBy === 'description' ? ' sorted' : ''}" data-sort="description" aria-sort="${f.sortBy === 'description' ? (f.sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}" tabindex="0">Description</th>
              <th class="sortable${f.sortBy === 'date' ? ' sorted' : ''}" data-sort="date" aria-sort="${f.sortBy === 'date' ? (f.sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}" tabindex="0">Date</th>
              <th>Method</th>
              <th class="sortable${f.sortBy === 'amount' ? ' sorted' : ''}" data-sort="amount" aria-sort="${f.sortBy === 'amount' ? (f.sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}" tabindex="0" style="text-align:right">Amount</th>
              <th></th></tr></thead>
              <tbody>${txRowsHTML(slice)}</tbody></table>
          </div>
          <div class="tx-cards">${txCardsHTML(slice)}</div>
          <div class="pager">
            <span class="info">Showing ${(page - 1) * perPage + 1}-${Math.min(page * perPage, all.length)} of ${all.length}</span>
            <span class="spacer"></span>
            <button class="btn btn-sm" data-action="page" data-arg="${page - 1}" ${page <= 1 ? 'disabled' : ''}>${icon('chevL', 14)}Prev</button>
            <span class="info">Page ${page} of ${pages}</span>
            <button class="btn btn-sm" data-action="page" data-arg="${page + 1}" ${page >= pages ? 'disabled' : ''}>Next${icon('chevR', 14)}</button>
          </div>`
          : UI.emptyState({ icon: 'search', title: Store.get().transactions.length ? 'No matching transactions' : 'No transactions yet',
              desc: Store.get().transactions.length ? 'Try changing or clearing your filters.' : 'Start by adding your first income or expense.',
              action: Store.get().transactions.length ? { label: 'Clear filters', action: 'reset-filters' } : { label: 'Add transaction', action: 'add-tx' } })}
        </section>`;

      const q = $('#tx-q', host);
      if (q) {
        q.addEventListener('input', Core.debounce(e => { App.state.txFilter.q = e.target.value; App.state.page = 1; App.render({ keepFocus: 'tx-q' }); }, 260));
      }
      $$('#filter-panel select,#filter-panel input', host).forEach(inp => {
        const field = inp.closest('[data-field]')?.dataset.field;
        if (!field) return;
        inp.addEventListener('change', () => { App.state.txFilter[field] = inp.value; App.state.page = 1; App.render(); });
      });
      const rec = $('#fx-rec', host);
      if (rec) rec.addEventListener('change', () => { App.state.txFilter.recurringOnly = rec.checked; App.state.page = 1; App.render(); });
      $$('th.sortable', host).forEach(th => th.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); th.click(); } }));
      $$('th.sortable', host).forEach(th => th.addEventListener('click', () => {
        const k = th.dataset.sort;
        if (App.state.txFilter.sortBy === k) App.state.txFilter.sortDir = App.state.txFilter.sortDir === 'asc' ? 'desc' : 'asc';
        else { App.state.txFilter.sortBy = k; App.state.txFilter.sortDir = k === 'date' ? 'desc' : 'asc'; }
        App.render();
      }));
    }
  };

  /* ==================== SAVED BUDGETS (templates) ====================
     Save / Load / Delete named budgets plus a read-only Quick Preview.
     A saved budget is a plan snapshot, never ledger data: loading one only
     rewrites the selected month's plan, and deleting one changes nothing
     else. Every dialog uses the shared UI.modal / UI.confirm. */

  const budgetUi = { loadedId: null };

  const bPlural = (n, word) => `${n} ${n === 1 ? word : /[^aeiou]y$/.test(word) ? word.slice(0, -1) + 'ies' : word + 's'}`;
  const bStamp = v => (v ? fdate(String(v).slice(0, 10)) : '-');
  const savedBudgetList = () => Store.savedBudgets()
    .slice()
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  const bTotal = sb => Core.sum(sb.lines || [], l => l.amount);
  const bPeriod = sb => (sb.sourceMonth ? monthLabel(sb.sourceMonth) : 'No month recorded');

  /** One saved budget as a card inside the Saved Budgets dialog. */
  const savedBudgetCard = sb => `
    <div class="saved-tpl-card" data-saved-id="${esc(sb.id)}">
      <div class="saved-tpl-main">
        <div class="saved-tpl-name">${esc(sb.name)}${budgetUi.loadedId === sb.id ? '<span class="saved-chip">Loaded</span>' : ''}</div>
        <div class="lr-sub">${bPlural((sb.lines || []).length, 'category')} · ${money(bTotal(sb))} · from ${esc(bPeriod(sb))} · updated ${bStamp(sb.updatedAt)}</div>
      </div>
      <div class="saved-tpl-actions">
        <button type="button" class="btn btn-sm" data-action="budget-preview" data-arg="${esc(sb.id)}" aria-label="Preview ${esc(sb.name)}">Preview</button>
        <button type="button" class="btn btn-sm btn-primary" data-action="budget-load" data-arg="${esc(sb.id)}" aria-label="Load ${esc(sb.name)}">Load</button>
        <span class="gro-saved-sep" aria-hidden="true"></span>
        <button type="button" class="mini-btn danger" data-action="budget-saved-del" data-arg="${esc(sb.id)}" aria-label="Delete ${esc(sb.name)}">${icon('trash', 16)}</button>
      </div>
    </div>`;

  /* Saved Budgets dialog: the list that used to sit permanently at the
     bottom of the page. Same actions (data-action delegation), same
     Store calls; the dialog only re-renders its body when the page does. */
  const savedBudgetsBodyHTML = () => {
    const list = savedBudgetList();
    if (!list.length) {
      const canSave = !!((Store.budgetFor(App.state.month) || {}).lines || []).length;
      return UI.emptyState({ icon: 'inbox', title: 'No saved budgets yet',
        desc: 'Save a budget so you can reuse the same plan in another month.',
        action: canSave ? { label: 'Save Budget', action: 'budget-save' } : undefined });
    }
    return `<p class="lr-sub saved-tpl-intro">Loading a budget replaces the plan for ${esc(monthLabel(App.state.month))}. Your expenses, bills and recurring rules are never changed.</p>
      <div class="saved-tpl-cards">${list.map(savedBudgetCard).join('')}</div>`;
  };
  const topModalA = () => { const ms = $$('.modal'); return ms[ms.length - 1] || null; };
  const openSavedBudgets = () => {
    const body = el('div', { class: 'saved-tpl bud-saved' }, savedBudgetsBodyHTML());
    const foot = el('div', { class: 'row', style: 'width:100%;gap:9px' });
    foot.innerHTML = '<span class="spacer"></span>';
    foot.appendChild(el('button', { class: 'btn', type: 'button', onclick: () => UI.closeTop() }, 'Close'));
    const m = UI.modal({ title: 'Saved Budgets', subtitle: 'Reusable budget plans you saved earlier', body, footer: foot,
      onClose: () => { budgetUi.savedDlg = null; } });
    budgetUi.savedDlg = { node: m.node, body };
  };
  const refreshSavedBudgets = () => {
    const d = budgetUi.savedDlg; if (!d) return;
    if (!document.body.contains(d.node)) { budgetUi.savedDlg = null; return; }
    const hadFocus = d.node.contains(document.activeElement);
    d.body.innerHTML = savedBudgetsBodyHTML();
    if (hadFocus || document.activeElement === document.body) {
      const f = $('.saved-tpl-card button, .empty button', d.body) || $('.icon-btn', d.node);
      if (f && topModalA() === d.node) f.focus();
    }
  };
  const closeSavedBudgets = () => { const d = budgetUi.savedDlg; if (d && topModalA() === d.node) UI.closeTop(); };

  /**
   * "Save Budget": name dialogue. Saving a budget that was loaded from a
   * template offers Save (overwrite) and Save as New; otherwise it is always
   * a new template. An empty name falls back to budget-YYYY-MM-DD-HH-MM.
   */
  const saveBudget = () => {
    const ym = App.state.month;
    const snap = Store.budgetSnapshot(ym);
    if (!snap.lines.length) return UI.toast('Nothing to save', 'Add at least one budget category before saving.', 'error');

    const loaded = budgetUi.loadedId ? Store.savedBudgets().find(b => b.id === budgetUi.loadedId) : null;
    const suggested = loaded ? loaded.name : Store.defaultBudgetName();

    const form = el('form', { novalidate: 'true', id: 'bud-save-form' }, `
      ${UI.fieldHTML({ name: 'name', label: 'Budget name', value: suggested, required: false, idPrefix: 'bus',
        attrs: 'maxlength="80" enterkeyhint="done"', hint: `Leave it empty to use ${Store.defaultBudgetName()}` })}
      <p class="lr-sub">${bPlural(snap.lines.length, 'category')} · ${money(Core.sum(snap.lines, l => l.amount))} from ${esc(monthLabel(ym))} will be saved, together with your planned income and savings rows. Your actual spending is never part of a saved budget.</p>`);

    const foot = el('div', { class: 'row', style: 'width:100%;gap:9px' });
    foot.innerHTML = '<span class="spacer"></span>';
    const cancel = el('button', { class: 'btn', type: 'button', onclick: () => UI.closeTop() }, 'Cancel');
    const saveNew = el('button', { class: `btn ${loaded ? '' : 'btn-primary'}`, type: loaded ? 'button' : 'submit', form: 'bud-save-form' }, loaded ? 'Save as New' : 'Save');
    foot.appendChild(cancel); foot.appendChild(saveNew);
    let overwrite = null;
    if (loaded) {
      overwrite = el('button', { class: 'btn btn-primary', type: 'submit', form: 'bud-save-form' }, 'Save');
      foot.appendChild(overwrite);
    }

    const m = UI.modal({ title: 'Save Budget', size: 'sm', body: form, footer: foot });

    let busy = false;
    const buttons = () => [cancel, saveNew, overwrite];
    const run = async budgetId => {
      if (busy) return;
      busy = true; buttons().forEach(b => b && (b.disabled = true));
      try {
        const typed = UI.readForm(form).name;
        const name = typed || (budgetId && loaded ? loaded.name : '');
        const r = await Store.saveBudget({ name, budgetId, month: ym });
        if (!r.ok) { busy = false; buttons().forEach(b => b && (b.disabled = false)); return void UI.showErrors(form, r.errors); }
        budgetUi.loadedId = r.value.id;
        m.close();
        UI.toast(budgetId ? 'Saved budget updated' : 'Budget saved', `${r.value.name} · ${bPlural((r.value.lines || []).length, 'category')}`);
        App.render();
      } catch (err) {
        busy = false; buttons().forEach(b => b && (b.disabled = false));
        if (err && err.isAuth) return;
        if (err && err.fields && Object.keys(err.fields).length) UI.showErrors(form, err.fields);
        UI.toast('Could not save the budget', (err && err.message) || 'Please try again.', 'error', 6000);
      }
    };

    if (loaded) saveNew.addEventListener('click', () => run(null));
    form.addEventListener('submit', e => { e.preventDefault(); run(loaded ? loaded.id : null); });
  };

  /** Loads a saved budget into the current month, replacing that month's plan. */
  const loadSavedBudget = id => {
    const sb = Store.savedBudgets().find(b => b.id === id); if (!sb) return;
    const ym = App.state.month;
    const current = Store.budgetFor(ym);
    const busyLines = ((current && current.lines) || []).length;

    const run = async () => {
      try {
        await Store.loadSavedBudget(id, ym);
        budgetUi.loadedId = sb.id;
        closeSavedBudgets();
        UI.toast('Budget loaded', `${sb.name} · ${bPlural((sb.lines || []).length, 'category')} applied to ${monthLabel(ym)}. No transactions were changed.`);
        App.render();
      } catch (err) {
        if (err && err.isAuth) return;
        UI.toast('Could not load the budget', (err && err.message) || 'Please try again.', 'error', 6000);
      }
    };

    if (!busyLines) return void run();
    UI.confirm({
      title: 'Replace this month\u2019s budget?',
      message: `Your current plan for ${monthLabel(ym)} (${bPlural(busyLines, 'category')}) will be replaced by "${sb.name}". Your expenses, bills and recurring rules are not affected.`,
      confirmLabel: 'Load Budget', danger: false, onConfirm: run
    });
  };

  const removeSavedBudget = id => {
    const sb = Store.savedBudgets().find(b => b.id === id); if (!sb) return;
    UI.confirm({
      title: 'Delete Saved Budget?',
      message: `Are you sure you want to delete "${sb.name}"? Budgets you already loaded from it stay exactly as they are.`,
      confirmLabel: 'Delete',
      onConfirm: () => {
        if (budgetUi.loadedId === id) budgetUi.loadedId = null;
        Store.removeSavedBudget(id);
        UI.toast('Saved budget deleted', sb.name, 'warn', 2400);
      }
    });
  };

  /**
   * Saved Budget Quick Preview: read-only. Nothing here can change data -
   * the only way out is Close or Load Budget (which runs the normal load
   * flow, confirmation included).
   */
  const previewSavedBudget = id => {
    const sb = Store.savedBudgets().find(b => b.id === id); if (!sb) return;
    const lines = sb.lines || [], income = sb.incomePlan || [], savings = sb.savingsPlan || [];
    const total = bTotal(sb);

    const planRows = rows => `<div class="prev-list">${rows.map(r => `
      <div class="prev-row"><span class="nm">${esc(r.label || 'Unnamed')}</span><span class="am num">${money(r.amount)}</span></div>`).join('')}</div>`;

    const body = el('div', { class: 'bud-preview' }, `
      <div class="prev-meta">
        <span><span class="k">Period</span> <span class="v">${esc(bPeriod(sb))}</span></span>
        <span><span class="k">Created</span> <span class="v">${esc(bStamp(sb.createdAt))}</span></span>
        <span><span class="k">Updated</span> <span class="v">${esc(bStamp(sb.updatedAt))}</span></span>
      </div>
      <div class="prev-h">Categories (${lines.length})</div>
      ${lines.length ? `<div class="prev-list">${lines.map(l => `
        <div class="prev-row">
          <span class="cat-ico" style="background:${Store.catColor(l.categoryId)}1f;color:${Store.catColor(l.categoryId)};width:26px;height:26px;font-size:13px">${esc(Store.catEmoji(l.categoryId))}</span>
          <span class="nm">${esc(Store.catName(l.categoryId))}</span>
          <span class="am num">${money(l.amount)}</span>
        </div>`).join('')}</div>`
        : '<p class="hint">This budget has no categories.</p>'}
      <div class="prev-total"><span>Total allocated</span><span class="spacer"></span><span class="num" id="bud-prev-total">${money(total)}</span></div>
      ${income.length ? `<div class="prev-h">Planned income (${income.length})</div>${planRows(income)}` : ''}
      ${savings.length ? `<div class="prev-h">Savings targets (${savings.length})</div>${planRows(savings)}` : ''}
      <p class="lr-sub" style="margin-top:12px">This is a preview only. Nothing is changed until you choose Load Budget.</p>`);

    const foot = el('div', { class: 'row', style: 'width:100%;gap:9px' });
    foot.innerHTML = '<span class="spacer"></span>';
    foot.appendChild(el('button', { class: 'btn', type: 'button', onclick: () => UI.closeTop() }, 'Close'));
    const loadBtn = el('button', { class: 'btn btn-primary', type: 'button' }, 'Load Budget');
    foot.appendChild(loadBtn);

    const m = UI.modal({ title: sb.name, subtitle: `Saved budget · ${bPlural(lines.length, 'category')} · ${money(total)}`, body, footer: foot });
    loadBtn.addEventListener('click', () => { m.close(); loadSavedBudget(id); });
  };

  /** "Clear Budget": empties the working plan of the month, nothing else. */
  const clearBudget = () => {
    const ym = App.state.month;
    const b = Store.budgetFor(ym);
    const lines = ((b && b.lines) || []).length;
    const plans = (((b && b.incomePlan) || []).length) + (((b && b.savingsPlan) || []).length);
    if (!lines && !plans) return UI.toast('This budget is already empty', null, 'info', 2000);

    UI.confirm({
      title: 'Clear Budget?',
      message: `Are you sure you want to clear your budget for ${monthLabel(ym)}? This removes ${bPlural(lines, 'category')} and ${bPlural(plans, 'planned row')} from this month's plan. Your saved budgets, expenses, bills and recurring rules are kept.`,
      confirmLabel: 'Clear Budget',
      onConfirm: async () => {
        try {
          await Store.clearBudget(ym);
          budgetUi.loadedId = null;            // the month no longer mirrors a template
          UI.toast('Budget cleared', 'Saved budgets and your expenses were not affected.', 'warn', 3000);
          App.render();
        } catch (err) {
          if (err && err.isAuth) return;
          UI.toast('Could not clear the budget', (err && err.message) || 'Please try again.', 'error', 6000);
        }
      }
    });
  };

  /* ==================== BUDGET ==================== */
  const budget = {
    title: 'Budget',
    subtitle: () => `Plan and track ${monthLabel(App.state.month)}`,
    render(host) {
      const ym = App.state.month;
      const b = Compute.budgetSummary(ym);
      const s = Compute.monthSummary(ym);
      const plannedIncome = Core.sum(b.incomePlan, r => r.amount);
      const plannedSavings = Core.sum(b.savingsPlan, r => r.amount);
      const allocated = b.planned + plannedSavings;
      const unallocated = plannedIncome - allocated;
      const prevYm = Core.addMonths(ym, -1);

      host.innerHTML = `
        <div class="grid g-stats mb">
          ${UI.statCard({ tip: 'planned', label: 'Planned spending', value: money(b.planned), iconName: 'budget', tone: 'blue', sub: `${b.lines.length} categor${b.lines.length === 1 ? 'y' : 'ies'}` })}
          ${UI.statCard({ tip: 'actual', label: 'Actual spending', value: money(b.spent), iconName: 'trendDown', tone: b.spent > b.planned && b.planned ? 'red' : 'gray', sub: b.planned ? `${percent(b.utilization)} of budget` : 'No budget set' })}
          ${UI.statCard({ tip: 'remaining', label: 'Remaining budget', value: money(b.remaining), iconName: 'wallet', tone: b.remaining < 0 ? 'red' : 'green', sub: b.overCount ? `${b.overCount} categor${b.overCount === 1 ? 'y' : 'ies'} over` : 'On plan' })}
          ${UI.statCard({ tip: 'unbudgeted', label: 'Unbudgeted spend', value: money(b.unbudgeted), iconName: 'alert', tone: b.unbudgeted > 0 ? 'amber' : 'gray', sub: 'Outside budgeted categories' })}
        </div>

        <div class="grid g-main">
          <section class="card">
            <div class="card-head"><h2>Category budgets</h2><span class="sub">${esc(monthLabel(ym))}</span>
              <span class="spacer"></span>
              ${Store.budgetFor(prevYm) && !b.lines.length ? `<button class="btn btn-sm" data-action="copy-budget">Copy ${esc(monthLabel(prevYm, true))}</button>` : ''}
              <button class="btn btn-sm btn-primary" data-action="add-budget-line">${icon('plus', 14)}Add category</button></div>
            <div class="row wrap bud-actions" style="gap:8px;padding:10px 14px 0">
              <button type="button" class="btn btn-sm btn-danger-ghost" data-action="budget-clear" ${b.lines.length || b.incomePlan.length || b.savingsPlan.length ? '' : 'disabled'}>${icon('trash', 15)}Clear Budget</button>
              <button type="button" class="btn btn-sm" data-action="budget-save" ${b.lines.length ? '' : 'disabled'}>${icon('download', 15)}Save Budget</button>
              <button type="button" class="btn btn-sm" data-action="budget-saved" aria-haspopup="dialog">${icon('upload', 15)}Load Saved Budgets${Store.savedBudgets().length ? ` <span class="badge">${Store.savedBudgets().length}</span>` : ''}</button>
            </div>
            ${b.lines.length ? `<div class="card-body stack">
              ${b.lines.map(l => `
                <div data-line="${l.categoryId}">
                  <div class="row" style="margin-bottom:6px;gap:8px">
                    <span class="cat-ico" style="background:${Store.catColor(l.categoryId)}1f;color:${Store.catColor(l.categoryId)};width:28px;height:28px;font-size:14px">${esc(Store.catEmoji(l.categoryId))}</span>
                    <span class="strong">${esc(Store.catName(l.categoryId))}</span>
                    ${l.state === 'over' ? '<span class="badge red">Over budget</span>' : l.state === 'warn' ? '<span class="badge amber">Approaching limit</span>' : '<span class="badge green">On track</span>'}
                    <span class="spacer"></span>
                    <button class="mini-btn" data-action="edit-budget-line" data-arg="${l.categoryId}" aria-label="Edit ${esc(Store.catName(l.categoryId))} budget">${icon('edit', 15)}</button>
                    <button class="mini-btn danger" data-action="del-budget-line" data-arg="${l.categoryId}" aria-label="Remove ${esc(Store.catName(l.categoryId))} from budget">${icon('trash', 15)}</button>
                  </div>
                  ${UI.progressBar(l.used, l.state, true)}
                  <div class="row small" style="margin-top:6px;gap:12px;flex-wrap:wrap">
                    <span class="muted">Budget <b class="num" style="color:var(--text)">${money(l.amount)}</b></span>
                    <span class="muted">Spent <b class="num" style="color:var(--text)">${money(l.spent)}</b></span>
                    <span class="muted">${l.remaining < 0 ? 'Over by' : 'Remaining'} <b class="num ${l.remaining < 0 ? 'neg' : 'pos'}">${money(Math.abs(l.remaining))}</b></span>
                    <span class="spacer"></span><span class="strong ${l.state === 'over' ? 'neg' : 'muted'}">${percent(l.used)} used</span>
                  </div>
                </div>`).join('')}
            </div>` : UI.emptyState({ icon: 'budget', title: 'No budgets created', desc: 'Create a monthly budget to start tracking your spending.', action: { label: 'Add your first category', action: 'add-budget-line' } })}
          </section>

          <div class="stack">
            <section class="card">
              <div class="card-head"><h2>Monthly plan</h2><span class="sub">Allocate your income</span></div>
              <div class="card-body stack">
                <div>
                  <div class="row" style="margin-bottom:8px"><h3>Planned income</h3><span class="spacer"></span>
                    <button class="btn btn-sm" data-action="add-plan" data-arg="incomePlan">${icon('plus', 13)}Add</button></div>
                  ${b.incomePlan.length ? b.incomePlan.map(r => `
                    <div class="kv"><span class="k">${esc(r.label)}</span><span class="v num">${money(r.amount)}
                      <button class="mini-btn danger" data-action="del-plan" data-arg="incomePlan:${r.id}" aria-label="Remove ${esc(r.label)}">${icon('close', 13)}</button></span></div>`).join('')
                    : '<p class="hint">Add your expected income sources for this month.</p>'}
                  <div class="kv" style="border-top:1px solid var(--border);margin-top:4px"><span class="k strong">Total income</span><span class="v num">${money(plannedIncome)}</span></div>
                </div>
                <div>
                  <div class="row" style="margin-bottom:8px"><h3>Savings targets</h3><span class="spacer"></span>
                    <button class="btn btn-sm" data-action="add-plan" data-arg="savingsPlan">${icon('plus', 13)}Add</button></div>
                  ${b.savingsPlan.length ? b.savingsPlan.map(r => `
                    <div class="kv"><span class="k">${esc(r.label)}</span><span class="v num">${money(r.amount)}
                      <button class="mini-btn danger" data-action="del-plan" data-arg="savingsPlan:${r.id}" aria-label="Remove ${esc(r.label)}">${icon('close', 13)}</button></span></div>`).join('')
                    : '<p class="hint">Set aside targets before you plan spending.</p>'}
                  <div class="kv" style="border-top:1px solid var(--border);margin-top:4px"><span class="k strong">Total savings</span><span class="v num">${money(plannedSavings)}</span></div>
                </div>
                <div class="divider"></div>
                <div class="kv"><span class="k">Planned spending</span><span class="v num">${money(b.planned)}</span></div>
                <div class="kv"><span class="k">Planned savings</span><span class="v num">${money(plannedSavings)}</span></div>
                <div class="kv"><span class="k">Total allocated</span><span class="v num">${money(allocated)}</span></div>
                <div class="insight" style="background:${unallocated < 0 ? 'var(--neg-soft)' : 'var(--pos-soft)'};border-color:transparent">
                  <span class="ic" style="color:${unallocated < 0 ? 'var(--neg)' : 'var(--pos)'}">${icon(unallocated < 0 ? 'alert' : 'checkCircle', 16)}</span>
                  <p><b>${money(Math.abs(unallocated))}</b> ${unallocated < 0 ? 'over-allocated: your plan exceeds planned income.' : 'left unallocated from planned income.'}</p>
                </div>
              </div>
            </section>

            <section class="card">
              <div class="card-head"><h2>Budget vs actual</h2></div>
              <div class="card-body">${b.lines.length ? '<div class="chart" id="ch-ba"></div>' : '<p class="hint">Add budget categories to compare planned against actual spending.</p>'}</div>
            </section>

            <section class="card">
              <div class="card-head"><h2>This month at a glance</h2></div>
              <div class="card-body">
                <div class="kv"><span class="k">Actual income</span><span class="v num pos">${money(s.income)}</span></div>
                <div class="kv"><span class="k">Actual expenses</span><span class="v num neg">${money(s.expenses)}</span></div>
                <div class="kv"><span class="k">Cash flow</span><span class="v num ${s.net >= 0 ? 'pos' : 'neg'}">${money(s.net)}</span></div>
                <div class="kv"><span class="k">Savings rate</span><span class="v num">${percent(s.savingsRate)}</span></div>
              </div>
            </section>
          </div>
        </div>`;
      refreshSavedBudgets();

      const ba = $('#ch-ba', host);
      if (ba) Charts.budgetActual(ba, b.lines.map(l => ({ name: Store.catName(l.categoryId), planned: l.amount, actual: l.spent })));
    }
  };

  return {
    dashboard, transactions, budget, txIcon, txAmount, txSub, dueTile,
    saveBudget, loadSavedBudget, removeSavedBudget, previewSavedBudget, clearBudget, openSavedBudgets
  };
})();


