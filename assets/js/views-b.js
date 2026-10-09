/* ============================================================
   07 · VIEWS B - Accounts, Goals, Bills, Recurring, Analytics,
   Monthly Summary, Settings
   ============================================================ */
const ViewsB = (() => {
  const { el, esc, icon, $, $$, money, percent, fdate, monthLabel, today } = Core;

  /* ==================== ACCOUNTS ==================== */
  const accounts = {
    title: 'Accounts',
    subtitle: () => 'Balances across your wallets and cards',
    render(host) {
      const list = Store.accounts();
      const balances = Compute.allBalances();
      const net = Core.sum(list, a => balances[a.id] || 0);
      const assets = Core.sum(list.filter(a => (balances[a.id] || 0) > 0), a => balances[a.id]);
      const debts = Core.sum(list.filter(a => (balances[a.id] || 0) < 0), a => balances[a.id]);

      host.innerHTML = `
        <div class="grid g-stats mb">
          ${UI.statCard({ tip: 'netWorth', label: 'Net worth', value: money(net), iconName: 'wallet', tone: net >= 0 ? 'blue' : 'red', sub: 'Assets minus liabilities' })}
          ${UI.statCard({ tip: 'assets', label: 'Total assets', value: money(assets), iconName: 'trendUp', tone: 'green' })}
          ${UI.statCard({ tip: 'liabilities', label: 'Total liabilities', value: money(Math.abs(debts)), iconName: 'card', tone: debts < 0 ? 'red' : 'gray' })}
          ${UI.statCard({ tip: 'accounts', label: 'Accounts', value: String(list.length), iconName: 'accounts', tone: 'gray', sub: 'Active accounts' })}
        </div>

        <div class="section-head">
          <h2>Your accounts</h2><span class="sub">${list.length} active</span>
          <span class="actions">
          ${list.length > 1 ? `<button class="btn btn-sm" data-action="add-transfer">${icon('transfer', 14)}Transfer</button>` : ''}
          <button class="btn btn-sm btn-primary" data-action="add-account">${icon('plus', 14)}Add account</button></span>
        </div>

        ${list.length ? `<div class="grid g-3">${list.map(a => {
          const t = Store.acctType(a.type);
          const bal = balances[a.id] || 0;
          const recent = Core.sortBy(Store.get().transactions.filter(x => x.accountId === a.id || x.toAccountId === a.id), x => x.date, -1).slice(0, 3);
          return `<div class="acct-card">
            <span class="accent" style="background:${a.color}"></span>
            <div class="row" style="gap:10px;margin-bottom:12px">
              <span class="cat-ico" style="background:${a.color}1f;color:${a.color}">${icon(t.icon, 17)}</span>
              <div style="min-width:0"><div class="strong" style="overflow-wrap:anywhere">${esc(a.name)}</div><span class="badge gray acct-type">${esc(t.name)}</span></div>
              <span class="spacer"></span>
              <button class="mini-btn" data-action="edit-account" data-arg="${a.id}" aria-label="Edit ${esc(a.name)}">${icon('edit', 15)}</button>
              <button class="mini-btn danger" data-action="del-account" data-arg="${a.id}" aria-label="Delete ${esc(a.name)}">${icon('trash', 15)}</button>
            </div>
            <div class="small muted">Current balance</div>
            <div class="acct-bal num ${bal < 0 ? 'neg' : ''}"${Tips.host('acctBal', (n => `${n} transaction${n === 1 ? '' : 's'} recorded on this account.`)(Store.get().transactions.filter(x => x.accountId === a.id || x.toAccountId === a.id).length))}>${money(bal)}</div>
            ${a.note ? `<div class="small muted" style="margin-top:4px">${esc(a.note)}</div>` : ''}
            <div class="acct-recent"><div class="divider" style="margin:0 0 6px"></div>
            <div class="small muted" style="margin-bottom:4px">Recent activity</div>
            ${recent.length ? recent.map(x => `<div class="row small" style="padding:3px 0">
              <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(x.description)}</span><span class="spacer"></span>
              <span class="num ${x.type === 'income' || x.toAccountId === a.id ? 'pos' : 'neg'}">${x.type === 'income' || x.toAccountId === a.id ? '+' : '−'}${money(x.amount, { abs: true, decimals: false })}</span></div>`).join('')
              : '<div class="small muted">No transactions yet.</div>'}</div>
          </div>`; }).join('')}</div>`
          : UI.emptyState({ icon: 'accounts', title: 'No accounts yet', desc: 'Accounts hold your balances. Add a cash wallet, bank account, card or e-wallet so every transaction has a home.', action: { label: 'Add account', action: 'add-account' } })}`;
    }
  };

  /* ==================== GOALS ==================== */
  const goals = {
    title: 'Savings Goals',
    subtitle: () => 'Track progress towards what matters',
    render(host) {
      const list = Store.get().goals;
      const target = Core.sum(list, g => g.target), saved = Core.sum(list, g => g.current);
      host.innerHTML = `
        <div class="grid g-stats mb">
          ${UI.statCard({ tip: 'goalSaved', label: 'Total saved', value: money(saved), iconName: 'piggy', tone: 'green', sub: `across ${list.length} goal${list.length === 1 ? '' : 's'}` })}
          ${UI.statCard({ tip: 'goalTarget', label: 'Total target', value: money(target), iconName: 'goals', tone: 'blue' })}
          ${UI.statCard({ tip: 'goalOverall', label: 'Overall progress', value: percent(Core.pct(saved, target)), iconName: 'sparkle', tone: 'blue', sub: `${money(Math.max(0, target - saved), { decimals: false })} to go` })}
          ${UI.statCard({ tip: 'goalDone', label: 'Completed', value: String(list.filter(g => g.current >= g.target).length), iconName: 'checkCircle', tone: 'green' })}
        </div>
        <div class="section-head"><h2>Goals</h2><span class="sub">${list.length} tracked</span>
          <span class="actions"><button class="btn btn-sm btn-primary" data-action="add-goal">${icon('plus', 14)}New goal</button></span></div>
        ${list.length ? `<div class="grid g-2">${list.map(g => {
          const p = Compute.goalProgress(g);
          return `<div class="card card-pad goal-card">
            <div class="row" style="gap:14px;align-items:flex-start">
              ${Charts.ring(72, p.pct, g.color, 8)}
              <div style="flex:1;min-width:0">
                <div class="row" style="align-items:flex-start"><h3 style="min-width:0;overflow-wrap:anywhere">${esc(g.emoji)} ${esc(g.name)}</h3><span class="spacer"></span>
                  <button class="mini-btn" data-action="edit-goal" data-arg="${g.id}" aria-label="Edit ${esc(g.name)}">${icon('edit', 15)}</button>
                  <button class="mini-btn danger" data-action="del-goal" data-arg="${g.id}" aria-label="Delete ${esc(g.name)}">${icon('trash', 15)}</button></div>
                <div class="num" style="font-size:18px;font-weight:670;margin-top:4px">${money(g.current)} <span class="muted" style="font-size:14px;font-weight:500">/ ${money(g.target)}</span></div>
                <div class="small muted">${percent(p.pct)} complete · ${money(p.remaining, { decimals: false })} remaining</div>
                ${g.description ? `<p class="small muted" style="margin-top:6px">${esc(g.description)}</p>` : ''}
              </div>
            </div>
            <div class="gc-amounts">
              <div><div class="k">Saved</div><div class="v num pos">${money(g.current, { decimals: false })}</div></div>
              <div><div class="k">Target</div><div class="v num">${money(g.target, { decimals: false })}</div></div>
              <div><div class="k">Remaining</div><div class="v num">${money(p.remaining, { decimals: false })}</div></div>
            </div>
            <div style="margin-top:12px">${UI.progressBar(p.pct, p.complete ? 'ok' : '', true)}</div>
            <div class="row wrap small muted" style="margin-top:8px;gap:12px">
              ${g.targetDate ? `<span>${icon('calendar', 13)} Target ${esc(fdate(g.targetDate))}</span>` : '<span>No target date</span>'}
              ${p.perMonth && !p.complete ? `<span class="strong" style="color:var(--text)"${Tips.host('goalPerMonth')}>${money(p.perMonth, { decimals: false })}/month suggested</span>` : ''}
              ${p.complete ? '<span class="badge green">Goal reached</span>' : p.onTrack === false ? '<span class="badge red">Past target date</span>' : ''}
            </div>
            <div class="row" style="margin-top:12px;gap:8px">
              <button class="btn btn-sm btn-primary" data-action="contribute" data-arg="${g.id}">${icon('plus', 14)}Add contribution</button>
              ${g.accountId ? `<span class="small muted">Linked to ${esc(Store.acctName(g.accountId))}</span>` : ''}
            </div>
          </div>`; }).join('')}</div>`
          : UI.emptyState({ icon: 'goals', title: 'No savings goals yet', desc: 'Goals turn saving into visible progress. Set a target and a date, then log contributions as you save.', action: { label: 'Create goal', action: 'add-goal' } })}`;
    }
  };

  /* ==================== BILLS ==================== */
  const bills = {
    title: 'Bills',
    subtitle: () => 'Upcoming payments, sorted by due date',
    render(host) {
      const all = Store.get().bills.map(b => ({ ...b, status: Compute.billStatus(b), inDays: Core.diffDays(today(), b.dueDate) }));
      const filter = App.state.billFilter || 'open';
      const shown = Core.sortBy(all.filter(b => filter === 'all' ? true : filter === 'paid' ? b.status === 'paid' : b.status !== 'paid'), b => b.dueDate, 1);
      const openBills = all.filter(b => b.status !== 'paid');
      const overdue = all.filter(b => b.status === 'overdue');
      const soon = all.filter(b => b.status === 'due-soon');
      const badge = st => st === 'overdue' ? '<span class="badge red">Overdue</span>' : st === 'due-soon' ? '<span class="badge amber">Due soon</span>' : st === 'paid' ? '<span class="badge green">Paid</span>' : '<span class="badge gray">Upcoming</span>';

      host.innerHTML = `
        <div class="grid g-stats mb">
          ${UI.statCard({ tip: 'billsOutstanding', label: 'Outstanding', value: money(Core.sum(openBills, b => b.amount)), iconName: 'bills', tone: 'amber', sub: `${openBills.length} unpaid bill${openBills.length === 1 ? '' : 's'}` })}
          ${UI.statCard({ tip: 'billsOverdue', label: 'Overdue', value: money(Core.sum(overdue, b => b.amount)), iconName: 'alert', tone: overdue.length ? 'red' : 'gray', sub: `${overdue.length} bill${overdue.length === 1 ? '' : 's'}` })}
          ${UI.statCard({ tip: 'billsSoon', label: 'Due within 7 days', value: money(Core.sum(soon, b => b.amount)), iconName: 'calendar', tone: soon.length ? 'amber' : 'gray', sub: `${soon.length} bill${soon.length === 1 ? '' : 's'}` })}
          ${UI.statCard({ tip: 'billsPaid', label: 'Paid this month', value: money(Core.sum(all.filter(b => b.paidOn && Core.monthKey(b.paidOn) === App.state.month), b => b.amount)), iconName: 'checkCircle', tone: 'green' })}
        </div>
        <div class="toolbar">
          <div class="chips" role="group" aria-label="Filter bills">
            ${[['open', 'Unpaid'], ['paid', 'Paid'], ['all', 'All']].map(([v, l]) => `<button class="chip" data-action="bill-filter" data-arg="${v}" aria-pressed="${filter === v}">${l}</button>`).join('')}
          </div>
          <span class="spacer"></span>
          <button class="btn btn-sm btn-primary" data-action="add-bill">${icon('plus', 14)}Add bill</button>
        </div>
        <section class="card">
          ${shown.length ? `<div class="list">${shown.map(b => `
            <div class="list-row lr-act-row">
              ${ViewsA.dueTile(b.status === 'paid' && b.paidOn ? b.paidOn : b.dueDate, b.status)}
              <div class="lr-main">
                <div class="lr-title">${esc(b.name)} ${badge(b.status)}</div>
                <div class="lr-sub">${b.status === 'paid' ? `Paid ${esc(fdate(b.paidOn))}` : `Due ${esc(fdate(b.dueDate))} · ${esc(Core.relDate(b.dueDate))}`} · ${esc(Store.catEmoji(b.categoryId))} ${esc(Store.catName(b.categoryId))}${b.accountId ? ` · ${esc(Store.acctName(b.accountId))}` : ''}</div>
              </div>
              <div class="lr-right">
                <div class="lr-amt">${money(b.amount)}</div>
                <div class="lr-actions">
                  ${b.status === 'paid'
                    ? `<button class="btn btn-sm btn-ghost" data-action="unpay-bill" data-arg="${b.id}">Undo</button>`
                    : `<button class="btn btn-sm btn-primary" data-action="pay-bill" data-arg="${b.id}">${icon('check', 13)}Mark paid</button>`}
                  <button class="mini-btn" data-action="edit-bill" data-arg="${b.id}" aria-label="Edit ${esc(b.name)}">${icon('edit', 15)}</button>
                  <button class="mini-btn danger" data-action="del-bill" data-arg="${b.id}" aria-label="Delete ${esc(b.name)}">${icon('trash', 15)}</button>
                </div>
              </div>
            </div>`).join('')}</div>`
            : UI.emptyState({ icon: 'bills', title: filter === 'paid' ? 'No paid bills' : 'No bills tracked', desc: 'Track rent, utilities and subscriptions so nothing slips past its due date. Marking a bill paid records the expense for you.', action: { label: 'Add bill', action: 'add-bill' } })}
        </section>`;
    }
  };

  /* ==================== RECURRING ==================== */
  const recurring = {
    title: 'Recurring',
    subtitle: () => 'Automatic income and expenses',
    render(host) {
      const list = Core.sortBy(Store.get().recurring, r => r.nextDate, 1);
      const load = Compute.monthlyRecurringLoad();
      const freqName = f => (Store.FREQUENCIES.find(x => x.id === f) || {}).name || f;
      host.innerHTML = `
        <div class="grid g-stats mb">
          ${UI.statCard({ tip: 'recIncome', label: 'Recurring income', value: money(load.income), iconName: 'trendUp', tone: 'green', sub: 'Monthly equivalent' })}
          ${UI.statCard({ tip: 'recExpense', label: 'Recurring expenses', value: money(load.expense), iconName: 'trendDown', tone: 'red', sub: 'Monthly equivalent' })}
          ${UI.statCard({ tip: 'recNet', label: 'Net recurring', value: money(load.income - load.expense), iconName: 'wallet', tone: load.income - load.expense >= 0 ? 'blue' : 'red' })}
          ${UI.statCard({ tip: 'recRules', label: 'Active rules', value: String(list.filter(r => !r.paused).length), iconName: 'recurring', tone: 'gray', sub: `${list.filter(r => r.paused).length} paused` })}
        </div>
        <div class="section-head"><h2>Recurring rules</h2><span class="sub">Sorted by next occurrence</span>
          <span class="actions"><button class="btn btn-sm" data-action="run-recurring">${icon('play', 14)}Post due now</button>
          <button class="btn btn-sm btn-primary" data-action="add-recurring">${icon('plus', 14)}New rule</button></span></div>
        <section class="card">
          ${list.length ? `<div class="list">${list.map(r => `
            <div class="list-row lr-act-row" style="${r.paused ? 'opacity:.62' : ''}">
              <span class="cat-ico" style="background:${Store.catColor(r.categoryId)}1f;color:${Store.catColor(r.categoryId)}">${esc(Store.catEmoji(r.categoryId))}</span>
              <div class="lr-main">
                <div class="lr-title">${esc(r.name)} ${r.paused ? '<span class="badge gray">Paused</span>' : r.autoPost ? '<span class="badge blue">Auto-post</span>' : '<span class="badge gray">Manual</span>'}</div>
                <div class="lr-sub">${esc(freqName(r.frequency))} · next ${esc(fdate(r.nextDate))} (${esc(Core.relDate(r.nextDate))}) · ${esc(Store.acctName(r.accountId))}</div>
              </div>
              <div class="lr-right">
                <div class="lr-amt ${r.type === 'income' ? 'pos' : 'neg'}">${r.type === 'income' ? '+' : '−'}${money(r.amount)}</div>
                <div class="lr-actions">
                  <button class="mini-btn" data-action="toggle-recurring" data-arg="${r.id}" aria-label="${r.paused ? 'Resume' : 'Pause'} ${esc(r.name)}">${icon(r.paused ? 'play' : 'pause', 15)}</button>
                  <button class="mini-btn" data-action="edit-recurring" data-arg="${r.id}" aria-label="Edit ${esc(r.name)}">${icon('edit', 15)}</button>
                  <button class="mini-btn danger" data-action="del-recurring" data-arg="${r.id}" aria-label="Delete ${esc(r.name)}">${icon('trash', 15)}</button>
                </div>
              </div>
            </div>`).join('')}</div>`
            : UI.emptyState({ icon: 'recurring', title: 'No recurring transactions', desc: 'Rules post repeating income and expenses (salary, rent, subscriptions) so you never have to re-enter them.', action: { label: 'Create rule', action: 'add-recurring' } })}
        </section>`;
    }
  };

  /* ==================== ANALYTICS ==================== */
  const analytics = {
    title: 'Analytics',
    subtitle: () => 'Trends across your financial history',
    render(host) {
      const ym = App.state.month;
      const range = App.state.range || 6;
      const ser = Compute.series(ym, range);
      const cats = Compute.topCategories(ym, 8);
      const trendCats = Compute.topCategories(ym, 4).map(c => c.id);
      const budget = Compute.budgetSummary(ym);
      const daily = Compute.dailySpend(ym);
      const totalExp = Core.sum(ser, s => s.expenses), totalInc = Core.sum(ser, s => s.income);

      host.innerHTML = `
        <div class="toolbar"><span class="small muted strong">Period</span>
          <div class="chips" role="group" aria-label="Analytics period">${[3, 6, 12].map(n => `<button class="chip" data-action="range" data-arg="${n}" aria-pressed="${range === n}">Last ${n} months</button>`).join('')}</div>
        </div>
        <div class="grid g-stats mb">
          ${UI.statCard({ tip: 'anIncome', label: `Income · ${range}mo`, value: money(totalInc), iconName: 'trendUp', tone: 'green', sub: `avg ${money(totalInc / range, { decimals: false })}/mo` })}
          ${UI.statCard({ tip: 'anExpenses', label: `Expenses · ${range}mo`, value: money(totalExp), iconName: 'trendDown', tone: 'red', sub: `avg ${money(totalExp / range, { decimals: false })}/mo` })}
          ${UI.statCard({ tip: 'anNet', label: `Net saved · ${range}mo`, value: money(totalInc - totalExp), iconName: 'piggy', tone: totalInc - totalExp >= 0 ? 'green' : 'red' })}
          ${UI.statCard({ tip: 'anRate', label: 'Average savings rate', value: percent(totalInc ? Core.pct(totalInc - totalExp, totalInc) : 0), iconName: 'sparkle', tone: 'blue' })}
        </div>
        <div class="grid g-2 g-charts">
          <section class="card"><div class="card-head"><h2>Income vs expenses</h2><span class="sub">Monthly totals, green = income, red = expenses</span></div>
            <div class="card-body"><div class="chart" id="a-ie"></div></div></section>
          <section class="card"><div class="card-head"><h2>Expense breakdown</h2><span class="sub">${esc(monthLabel(ym))}</span></div>
            <div class="card-body" style="display:grid;place-items:center">${cats.length ? '<div class="chart" id="a-donut" style="max-width:300px"></div>' : UI.emptyState({ icon: 'analytics', title: 'No expenses this month', desc: 'Record expenses to see how spending splits by category.' })}</div></section>
          <section class="card"><div class="card-head"><h2>Monthly spending</h2><span class="sub">Total expenses per month</span></div>
            <div class="card-body"><div class="chart" id="a-bars"></div></div></section>
          <section class="card"><div class="card-head"><h2>Savings trend</h2><span class="sub">Running total of income minus expenses</span></div>
            <div class="card-body"><div class="chart" id="a-line"></div></div></section>
          <section class="card"><div class="card-head"><h2>Budget vs actual</h2><span class="sub">${esc(monthLabel(ym))}</span></div>
            <div class="card-body">${budget.lines.length ? '<div class="chart" id="a-ba"></div>' : UI.emptyState({ icon: 'budget', title: 'No budget for this month', desc: 'Create a budget to compare planned against actual spending.', action: { label: 'Open budget', action: 'go', arg: 'budget' } })}</div></section>
          <section class="card"><div class="card-head"><h2>Category trends</h2><span class="sub">Top 4 categories over time</span></div>
            <div class="card-body">${trendCats.length ? '<div class="chart" id="a-trend"></div>' : '<p class="hint">Not enough category data yet.</p>'}</div></section>
          <section class="card" style="grid-column:1/-1"><div class="card-head"><h2>Daily spending</h2><span class="sub">${esc(monthLabel(ym))}</span></div>
            <div class="card-body"><div class="chart" id="a-daily"></div></div></section>
        </div>
        <section class="card" style="margin-top:var(--gap)">
          <div class="card-head"><h2>Category detail</h2><span class="sub">${esc(monthLabel(ym))}</span></div>
          ${cats.length ? `<div class="tbl-wrap"><table class="tbl">
            <thead><tr><th>Category</th><th style="text-align:right">Spent</th><th style="text-align:right">Share</th><th style="text-align:right">Budget</th><th style="text-align:right">Variance</th></tr></thead>
            <tbody>${cats.map(c => {
              const line = budget.lines.find(l => l.categoryId === c.id);
              const variance = line ? line.amount - c.value : null;
              return `<tr>
                <td><span class="row" style="gap:8px"><span class="dot" style="background:${c.color}"></span>${esc(c.emoji)} ${esc(c.name)}</span></td>
                <td class="t-amt num">${money(c.value)}</td>
                <td class="t-amt num muted">${percent(Core.pct(c.value, Core.sum(cats, x => x.value)))}</td>
                <td class="t-amt num muted">${line ? money(line.amount) : '-'}</td>
                <td class="t-amt num ${variance == null ? 'muted' : variance < 0 ? 'neg' : 'pos'}">${variance == null ? '-' : (variance < 0 ? `${money(-variance)} over` : `${money(variance)} left`)}</td>
              </tr>`; }).join('')}</tbody></table></div>` : ''}
        </section>`;

      const g = id => $('#' + id, host);
      if (g('a-ie')) Charts.incomeExpense(g('a-ie'), ser, { height: 280 });
      if (g('a-donut')) Charts.donut(g('a-donut'), cats.map(c => ({ name: c.name, value: c.value, color: c.color })), { centerLabel: 'Spent' });
      if (g('a-bars')) Charts.bars(g('a-bars'), ser.map(s => ({ label: s.label, value: s.expenses })), { color: 'var(--neg)', label: 'Monthly spending' });
      if (g('a-line')) Charts.line(g('a-line'), [{ name: 'Cumulative net', color: 'var(--pos)', points: Compute.cumulativeSavings(ym, range) }], { area: true, label: 'Savings trend' });
      if (g('a-ba')) Charts.budgetActual(g('a-ba'), budget.lines.map(l => ({ name: Store.catName(l.categoryId), planned: l.amount, actual: l.spent })));
      if (g('a-trend')) Charts.line(g('a-trend'), Compute.categoryTrend(ym, range, trendCats).map(c => ({ name: c.name, color: c.color, points: c.points })), { label: 'Category trends' });
      if (g('a-daily')) Charts.bars(g('a-daily'), daily.map(d => ({ label: String(d.day), value: d.value })), { color: 'var(--brand)', height: 200, label: 'Daily spending' });
    }
  };

  /* ==================== MONTHLY SUMMARY ==================== */
  const summary = {
    title: 'Monthly Summary',
    subtitle: () => `A full picture of ${monthLabel(App.state.month)}`,
    render(host) {
      const ym = App.state.month;
      const s = Compute.monthSummary(ym);
      const prev = Compute.monthSummary(Core.addMonths(ym, -1));
      const h = Compute.health(ym);
      const ins = Compute.insights(ym);
      const months = Compute.monthRange(Core.monthKey(today()), 13).reverse();

      host.innerHTML = `
        <div class="row wrap" style="margin-bottom:14px;gap:9px">
          <div class="field" style="max-width:230px;flex:1">
            <label for="sum-month">Select month</label>
            <select class="select" id="sum-month">${months.map(m => `<option value="${m}" ${m === ym ? 'selected' : ''}>${monthLabel(m)}</option>`).join('')}</select>
          </div>
          <div class="row" style="gap:8px;align-self:flex-end;padding-bottom:1px">
            <button class="btn btn-sm" data-action="month" data-arg="-1">${icon('chevL', 14)}Previous</button>
            <button class="btn btn-sm" data-action="month" data-arg="0">This month</button>
            <button class="btn btn-sm" data-action="month" data-arg="1">Next${icon('chevR', 14)}</button>
          </div>
        </div>

        <div class="grid g-main">
          <div class="stack">
            <section class="card">
              <div class="card-head"><h2>${esc(monthLabel(ym))} statement</h2><span class="sub">${s.count} transaction${s.count === 1 ? '' : 's'}</span></div>
              <div class="card-body">
                <div class="kv"><span class="k">Starting balance</span><span class="v num">${money(s.startBalance)}</span></div>
                <div class="kv"><span class="k">Total income</span><span class="v num pos">+${money(s.income)}</span></div>
                <div class="kv"><span class="k">Total expenses</span><span class="v num neg">−${money(s.expenses)}</span></div>
                <div class="kv"><span class="k">Net cash flow</span><span class="v num ${s.net >= 0 ? 'pos' : 'neg'}">${money(s.net)}</span></div>
                <div class="kv"><span class="k">Moved into savings accounts</span><span class="v num">${money(s.transferSavings)}</span></div>
                <div class="kv"><span class="k strong">Ending balance</span><span class="v num" style="font-size:15px">${money(s.endBalance)}</span></div>
                <div class="divider"></div>
                <div class="kv"><span class="k">Savings rate</span><span class="v num">${percent(s.savingsRate)}${prev.income ? ` <span class="small muted">(was ${percent(prev.savingsRate)})</span>` : ''}</span></div>
                <div class="kv"><span class="k">Expense ratio</span><span class="v num">${percent(s.expenseRatio)}</span></div>
                <div class="kv"><span class="k">Budget utilization</span><span class="v num">${s.budget.planned ? percent(s.budget.utilization) : '-'}</span></div>
                <div class="kv"><span class="k">Average daily spend</span><span class="v num">${money(s.avgDailySpend)}</span></div>
                <div class="kv"><span class="k">Largest expense</span><span class="v">${s.largestExpense ? `${esc(s.largestExpense.description)} · <span class="num">${money(s.largestExpense.amount)}</span>` : '-'}</span></div>
                <div class="kv"><span class="k">Largest income source</span><span class="v">${s.largestIncome ? `${esc(s.largestIncome.description)} · <span class="num">${money(s.largestIncome.amount)}</span>` : '-'}</span></div>
              </div>
            </section>

            <section class="card">
              <div class="card-head"><h2>Spending by category</h2></div>
              ${Object.keys(s.byCat).length ? `<div class="tbl-wrap"><table class="tbl">
                <thead><tr><th>Category</th><th style="text-align:right">Spent</th><th style="text-align:right">Share</th><th style="text-align:right">vs last month</th></tr></thead>
                <tbody>${Object.entries(s.byCat).sort((a, b) => b[1] - a[1]).map(([cid, v]) => {
                  const p = prev.byCat[cid] || 0;
                  const d = p ? Core.pct(v - p, p) : null;
                  return `<tr><td><span class="row" style="gap:8px">${esc(Store.catEmoji(cid))} ${esc(Store.catName(cid))}</span></td>
                    <td class="t-amt num">${money(v)}</td>
                    <td class="t-amt num muted">${percent(Core.pct(v, s.expenses))}</td>
                    <td class="t-amt num ${d == null ? 'muted' : d > 0 ? 'neg' : 'pos'}">${d == null ? 'new' : `${d > 0 ? '+' : ''}${percent(d)}`}</td></tr>`;
                }).join('')}</tbody></table></div>` : UI.emptyState({ icon: 'analytics', title: 'No expenses recorded', desc: 'This month has no expense transactions yet.' })}
            </section>
          </div>

          <div class="stack">
            <section class="card">
              <div class="card-head"><h2>Financial health</h2><span class="sub">Informational only</span></div>
              <div class="card-body">
                <div class="row" style="gap:14px;margin-bottom:14px">
                  ${Charts.ring(76, h.overall || 0, h.overall >= 75 ? 'var(--pos)' : h.overall >= 50 ? 'var(--brand)' : h.overall >= 30 ? 'var(--warn)' : 'var(--neg)', 8)}
                  <div><div class="strong" style="font-size:17px">${esc(h.band)}</div>
                    <p class="small muted">A blended view of savings rate, expense ratio, budget discipline and cash flow.</p></div>
                </div>
                <div class="stack-sm">
                  ${h.metrics.map(m => `<div>
                    <div class="row small"><span class="strong">${esc(m.label)}</span><span class="spacer"></span>
                      <span class="num strong">${m.value == null ? '-' : m.unit === 'money' ? money(m.value) : percent(m.value)}</span></div>
                    <p class="hint">${esc(m.help)}</p></div>`).join('')}
                </div>
                <p class="hint" style="margin-top:12px">These indicators describe your recorded data. They are not professional financial advice.</p>
              </div>
            </section>
            ${ins.length ? `<section class="card"><div class="card-head"><h2>What changed</h2></div>
              <div class="card-body stack-sm">${ins.map(i => `<div class="insight"><span class="ic" style="color:${i.tone === 'good' ? 'var(--pos)' : i.tone === 'bad' ? 'var(--neg)' : i.tone === 'warn' ? 'var(--warn)' : 'var(--info)'}">${icon(i.icon, 16)}</span><p>${esc(i.text)}</p></div>`).join('')}</div></section>` : ''}
            <section class="card"><div class="card-head"><h2>Income sources</h2></div>
              ${Object.keys(s.byIncomeCat).length ? `<div class="card-body">${Object.entries(s.byIncomeCat).sort((a, b) => b[1] - a[1]).map(([cid, v]) =>
                `<div class="kv"><span class="k">${esc(Store.catEmoji(cid))} ${esc(Store.catName(cid))}</span><span class="v num pos">${money(v)}</span></div>`).join('')}</div>`
                : UI.emptyState({ icon: 'trendUp', title: 'No income recorded', desc: 'Add income entries to see the breakdown by source.' })}
            </section>
          </div>
        </div>`;

      const sel = $('#sum-month', host);
      if (sel) sel.addEventListener('change', () => { App.state.month = sel.value; App.render(); });
    }
  };

  /* ==================== SETTINGS ==================== */
  const settings = {
    title: 'Settings',
    subtitle: () => 'Appearance, preferences, categories and your data',
    render(host) {
      const st = Store.settings();
      const c = Store.counts();
      const cats = Store.get().categories.filter(x => !x.archived);
      const hueOptions = [['Indigo', 221], ['Emerald', 160], ['Violet', 265], ['Rose', 345], ['Amber', 35], ['Teal', 186]];

      const tplNow = App.templateId();
      const section = (id, title, desc, body) => `
        <section class="set-section" id="set-${id}" aria-labelledby="set-${id}-h">
          <div class="set-intro"><h2 id="set-${id}-h">${title}</h2><p>${desc}</p></div>
          <div class="set-body">${body}</div>
        </section>`;

      host.innerHTML = `
        <p class="hud-only hud-kicker hud-page-kicker">System configuration</p>
        ${section('appearance', 'Appearance', 'How the app looks on this account. Purely visual. Your financial data is never changed.', `
          <div class="card card-pad">
            <div class="set-row" data-field="theme"><span class="lbl" id="theme-lbl">Theme</span>
              <div class="segmented" role="group" aria-labelledby="theme-lbl" style="max-width:420px">
                ${[['light', 'Light', 'sun'], ['dark', 'Dark', 'moon'], ['system', 'System', 'settings']].map(([v, l, ic]) => `<button type="button" data-action="theme" data-arg="${v}" aria-pressed="${st.theme === v}"><span class="row" style="gap:6px;justify-content:center">${icon(ic, 14)}${l}</span></button>`).join('')}
              </div>
              <span class="hint">System follows your device's light or dark setting.</span>
              <span class="hint hud-only">The Futuristic template always uses its dark HUD palette; your theme choice is kept for the other templates.</span></div>
            <div class="set-row"><span class="lbl" id="accent-lbl">Accent colour</span>
              <div class="chips" role="group" aria-labelledby="accent-lbl">${hueOptions.map(([n, hv]) => `<button class="chip" data-action="hue" data-arg="${hv}" aria-pressed="${st.brandHue === hv}">
                <span class="dot" style="background:hsl(${hv} 83% 53%)"></span>${n}</button>`).join('')}</div>
              <span class="hint">Changes the primary colour across the whole app.</span></div>
            <div class="set-row"><span class="lbl" id="tpl-lbl">Design template</span>
              <div class="tpl-grid" role="group" aria-labelledby="tpl-lbl">
                ${App.TEMPLATES.map(tp => `
                  <button type="button" class="tpl-card" data-action="design-template" data-arg="${tp.id}" aria-pressed="${tplNow === tp.id}"
                    aria-label="${esc(tp.name)} design template${tplNow === tp.id ? ' (selected)' : ''}"
                    style="${Object.entries(tp.preview).map(([k, v]) => `--tp-${k}:${v}`).join(';')}">
                    <span class="tpl-prev${tp.hud ? ' hud' : ''}" aria-hidden="true"><span class="tp-side"><i></i><i></i><i></i><i></i></span>
                      <span class="tp-main"><span class="tp-kpis"><b></b><b></b><b></b></span><span class="tp-panel">${tp.hud ? '<span class="tp-spark"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></span>' : ''}</span></span></span>
                    <span class="tpl-meta"><span><span class="nm">${esc(tp.name)}</span><span class="ds" style="display:block">${esc(tp.desc)}</span></span>
                      ${tplNow === tp.id ? `<span class="badge blue">${icon('check', 12)}Selected</span>` : '<span class="badge gray">Use</span>'}</span>
                  </button>`).join('')}
              </div>
              <span class="hint">Templates change layout density, panels and navigation style. Theme and accent colour apply to Modern, Classic and Minimal; Futuristic always uses its own dark, cyan HUD palette.</span></div>
          </div>`)}

        ${section('prefs', 'Preferences', 'Regional formats used for amounts, dates and calendars.', `
          <div class="card card-pad form-grid">
            ${UI.fieldHTML({ name: 'currency', label: 'Currency', type: 'select', value: st.currency, options: Object.values(Core.CURRENCIES).map(x => ({ value: x.code, label: `${x.symbol} ${x.name} (${x.code})` })), idPrefix: 'set' })}
            ${UI.fieldHTML({ name: 'dateFormat', label: 'Date format', type: 'select', value: st.dateFormat, options: ['MMM D, YYYY', 'DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'].map(v => ({ value: v, label: v })), idPrefix: 'set' })}
            ${UI.fieldHTML({ name: 'firstDayOfWeek', label: 'First day of week', type: 'select', value: String(st.firstDayOfWeek), options: [{ value: '0', label: 'Sunday' }, { value: '1', label: 'Monday' }], idPrefix: 'set' })}
          </div>`)}

        ${section('categories', 'Categories', 'Used to group transactions, budgets and reports.', `
          <div class="card">
            <div class="card-head"><h2>Your categories</h2><span class="sub">${cats.length} active</span><span class="spacer"></span>
              <button class="btn btn-sm btn-primary" data-action="add-category">${icon('plus', 14)}New category</button></div>
            <div class="card-body stack">
              ${['expense', 'income'].map(kind => `
                <div><h3 class="small muted" style="text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">${kind === 'expense' ? 'Expense' : 'Income'} categories · ${cats.filter(x => x.kind === kind).length}</h3>
                ${cats.some(x => x.kind === kind) ? `<div class="cat-grid">
                  ${cats.filter(x => x.kind === kind).map(x => `
                    <div class="cat-item">
                      <span class="cat-ico" style="background:${x.color}1f;color:${x.color};width:28px;height:28px;font-size:14px">${esc(x.emoji)}</span>
                      <span class="nm" title="${esc(x.name)}">${esc(x.name)}</span>
                      <button class="mini-btn" data-action="edit-category" data-arg="${x.id}" aria-label="Edit ${esc(x.name)}">${icon('edit', 14)}</button>
                      <button class="mini-btn danger" data-action="del-category" data-arg="${x.id}" aria-label="Delete ${esc(x.name)}">${icon('trash', 14)}</button>
                    </div>`).join('')}
                </div>` : `<p class="hint">No ${kind} categories yet.</p>`}</div>`).join('')}
            </div>
          </div>`)}

        ${section('data', 'Your data', 'Stored with your account on the server. Export a backup before resetting or importing.', `
          <div class="card card-pad stack">
            <div class="set-counts">
              ${[['Transactions', c.transactions], ['Accounts', c.accounts], ['Budgets', c.budgets], ['Savings goals', c.goals], ['Recurring rules', c.recurring], ['Bills', c.bills]]
                .map(([k, v]) => `<div><div class="k">${k}</div><div class="v num">${v}</div></div>`).join('')}
            </div>
            <div class="set-row"><span class="lbl">Backup &amp; import</span>
              <div class="row wrap" style="gap:8px">
                <button class="btn btn-sm" data-action="export-json">${icon('download', 14)}Export backup (JSON)</button>
                <button class="btn btn-sm" data-action="export-csv">${icon('download', 14)}Export transactions (CSV)</button>
                <button class="btn btn-sm" data-action="import-json">${icon('upload', 14)}Import backup</button>
              </div></div>
            <div class="set-row"><span class="lbl">Sample data</span>
              <div class="row wrap" style="gap:8px">
                ${Store.get().sample ? '<button class="btn btn-sm" data-action="clear-sample">Remove sample data</button>' : '<button class="btn btn-sm" data-action="load-sample">Load sample data</button>'}
                <span class="hint">A realistic demo dataset you can remove at any time.</span>
              </div></div>
            <div class="set-row"><span class="lbl" style="color:var(--neg-text)">Danger zone</span>
              <div class="row wrap" style="gap:8px">
                <button class="btn btn-sm btn-danger" data-action="reset-all">${icon('trash', 14)}Reset everything</button>
                <span class="hint">Permanently deletes every account, transaction, budget, goal and bill.</span>
              </div></div>
          </div>`)}

        ${section('help', 'Help', 'Get re-oriented, or work faster with the keyboard.', `
          <div class="card card-pad stack">
            <div class="row wrap" style="gap:10px">
              <p class="muted small" style="flex:1;min-width:200px">New here, or want a refresher on what's where?</p>
              <button class="btn btn-sm" data-action="show-guide">${icon('info', 14)}Restart Onboarding</button>
            </div>
            <div class="set-row"><span class="lbl">Keyboard shortcuts</span>
              <div class="shortcuts">
                ${[['N', 'Add a transaction'], ['Q', 'Open quick add'], ['/', 'Focus search on Transactions'], ['D', 'Toggle dark mode'], ['← / →', 'Previous / next month'], ['Esc', 'Close dialog']]
                  .map(([k, d]) => `<div class="row"><kbd>${esc(k)}</kbd><span class="muted">${esc(d)}</span></div>`).join('')}
              </div></div>
          </div>`)}`;


      const bind = (name, fn) => { const n = $(`[data-field="${name}"] select`, host); if (n) n.addEventListener('change', () => fn(n.value)); };
      bind('currency', v => { Store.setSettings({ currency: v }); Core.setCurrency(v); UI.toast('Currency updated', Core.CURRENCIES[v].name); App.render(); });
      bind('dateFormat', v => { Store.setSettings({ dateFormat: v }); Core.setDateFormat(v); UI.toast('Date format updated'); App.render(); });
      bind('firstDayOfWeek', v => { Store.setSettings({ firstDayOfWeek: Number(v) }); UI.toast('Preference saved'); });
    }
  };

  return { accounts, goals, bills, recurring, analytics, summary, settings };
})();


