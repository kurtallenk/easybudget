/* ============================================================
   02 · COMPUTE - derived financial figures
   Pure selectors over the store document. All amounts in minor
   units. Transfers never count as income or expense.
   ============================================================ */
const Compute = (() => {
  const { sum, monthKey, today, addMonths, diffDays, pct, monthsBetween, daysInMonth, monthStart, monthEnd } = Core;
  const D = () => Store.get();

  const inMonth = (t, ym) => monthKey(t.date) === ym;
  const txOfMonth = ym => D().transactions.filter(t => inMonth(t, ym));
  const txUpTo = dateStr => D().transactions.filter(t => t.date <= dateStr);
  const txBefore = dateStr => D().transactions.filter(t => t.date < dateStr);

  const incomeOf = list => sum(list.filter(t => t.type === 'income'), t => t.amount);
  const expenseOf = list => sum(list.filter(t => t.type === 'expense'), t => t.amount);

  /* ---- account balances ---- */
  const accountBalance = (id, upTo) => {
    const a = Store.acctById(id); if (!a) return 0;
    const list = upTo ? txUpTo(upTo) : D().transactions;
    let b = a.openingBalance;
    for (const t of list) {
      if (t.type === 'income' && t.accountId === id) b += t.amount;
      else if (t.type === 'expense' && t.accountId === id) b -= t.amount;
      else if (t.type === 'transfer') { if (t.accountId === id) b -= t.amount; if (t.toAccountId === id) b += t.amount; }
    }
    return b;
  };
  const allBalances = upTo => Object.fromEntries(Store.accounts().map(a => [a.id, accountBalance(a.id, upTo)]));
  const netWorth = upTo => sum(Store.accounts(), a => accountBalance(a.id, upTo));
  const liquidBalance = upTo => sum(Store.accounts().filter(a => a.type !== 'credit'), a => accountBalance(a.id, upTo));

  /* ---- monthly summary ---- */
  const monthSummary = ym => {
    const list = txOfMonth(ym);
    const income = incomeOf(list), expenses = expenseOf(list);
    const net = income - expenses;
    const startBalance = sum(Store.accounts(), a => {
      let b = a.openingBalance;
      for (const t of txBefore(monthStart(ym))) {
        if (t.type === 'income' && t.accountId === a.id) b += t.amount;
        else if (t.type === 'expense' && t.accountId === a.id) b -= t.amount;
        else if (t.type === 'transfer') { if (t.accountId === a.id) b -= t.amount; if (t.toAccountId === a.id) b += t.amount; }
      }
      return b;
    });
    const savingsAcc = new Set(Store.accounts().filter(a => a.type === 'savings').map(a => a.id));
    const savedIn = sum(list.filter(t => t.type === 'transfer' && savingsAcc.has(t.toAccountId)), t => t.amount);
    const savedOut = sum(list.filter(t => t.type === 'transfer' && savingsAcc.has(t.accountId)), t => t.amount);
    const transferSavings = savedIn - savedOut;
    const savings = Math.max(net, 0) || 0;
    const byCat = {};
    list.filter(t => t.type === 'expense').forEach(t => { byCat[t.categoryId] = (byCat[t.categoryId] || 0) + t.amount; });
    const byIncomeCat = {};
    list.filter(t => t.type === 'income').forEach(t => { byIncomeCat[t.categoryId] = (byIncomeCat[t.categoryId] || 0) + t.amount; });
    const largestExpense = list.filter(t => t.type === 'expense').sort((a, b) => b.amount - a.amount)[0] || null;
    const largestIncome = list.filter(t => t.type === 'income').sort((a, b) => b.amount - a.amount)[0] || null;
    const b = budgetSummary(ym);
    return {
      ym, income, expenses, net, savings, transferSavings, startBalance, endBalance: startBalance + net,
      savingsRate: income > 0 ? pct(net, income) : 0,
      expenseRatio: income > 0 ? pct(expenses, income) : 0,
      byCat, byIncomeCat, largestExpense, largestIncome, count: list.length,
      budget: b, avgDailySpend: expenses / daysInMonth(ym)
    };
  };

  /* ---- budgets ---- */
  const budgetSummary = ym => {
    const bgt = Store.budgetFor(ym);
    const spentByCat = {};
    txOfMonth(ym).filter(t => t.type === 'expense').forEach(t => { spentByCat[t.categoryId] = (spentByCat[t.categoryId] || 0) + t.amount; });
    const lines = (bgt?.lines || []).map(l => {
      const spent = spentByCat[l.categoryId] || 0;
      const used = pct(spent, l.amount);
      return { ...l, spent, remaining: l.amount - spent, used,
        state: used > 100 ? 'over' : used >= 85 ? 'warn' : 'ok' };
    }).sort((a, b) => b.used - a.used);
    const planned = sum(lines, l => l.amount);
    const spent = sum(lines, l => l.spent);
    const unbudgeted = sum(Object.entries(spentByCat).filter(([c]) => !lines.some(l => l.categoryId === c)), e => e[1]);
    return { exists: !!bgt, month: ym, lines, planned, spent, remaining: planned - spent,
      utilization: pct(spent, planned), unbudgeted,
      incomePlan: bgt?.incomePlan || [], savingsPlan: bgt?.savingsPlan || [],
      overCount: lines.filter(l => l.state === 'over').length,
      warnCount: lines.filter(l => l.state === 'warn').length };
  };

  /* ---- series ---- */
  const monthRange = (endYm, n) => Array.from({ length: n }, (_, i) => addMonths(endYm, -(n - 1 - i)));
  const series = (endYm, n) => monthRange(endYm, n).map(ym => {
    const l = txOfMonth(ym);
    const income = incomeOf(l), expenses = expenseOf(l);
    return { ym, label: Core.monthLabel(ym, true), income, expenses, net: income - expenses,
      savingsRate: income > 0 ? pct(income - expenses, income) : 0 };
  });
  const cumulativeSavings = (endYm, n) => {
    const months = monthRange(endYm, n);
    let running = 0; const first = months[0];
    running = sum(txBefore(monthStart(first)).filter(t => t.type !== 'transfer'), t => t.type === 'income' ? t.amount : -t.amount);
    return months.map(ym => { const s = monthSummary(ym); running += s.net; return { ym, label: Core.monthLabel(ym, true), value: running }; });
  };
  const categoryTrend = (endYm, n, categoryIds) => {
    const months = monthRange(endYm, n);
    return categoryIds.map(cid => ({
      id: cid, name: Store.catName(cid), color: Store.catColor(cid),
      points: months.map(ym => ({ ym, label: Core.monthLabel(ym, true),
        value: sum(txOfMonth(ym).filter(t => t.type === 'expense' && t.categoryId === cid), t => t.amount) }))
    }));
  };
  const topCategories = (ym, n = 6, type = 'expense') => {
    const m = {};
    txOfMonth(ym).filter(t => t.type === type).forEach(t => { m[t.categoryId] = (m[t.categoryId] || 0) + t.amount; });
    return Object.entries(m).map(([id, value]) => ({ id, value, name: Store.catName(id), color: Store.catColor(id), emoji: Store.catEmoji(id) }))
      .sort((a, b) => b.value - a.value).slice(0, n);
  };
  const dailySpend = ym => {
    const n = daysInMonth(ym); const arr = Array.from({ length: n }, (_, i) => ({ day: i + 1, value: 0 }));
    txOfMonth(ym).filter(t => t.type === 'expense').forEach(t => { const d = Number(t.date.slice(8, 10)); if (arr[d - 1]) arr[d - 1].value += t.amount; });
    return arr;
  };

  /* ---- goals ---- */
  const goalProgress = g => {
    const p = Core.clamp(pct(g.current, g.target), 0, 100);
    const remaining = Math.max(0, g.target - g.current);
    let monthsLeft = null, perMonth = null, onTrack = null;
    if (g.targetDate) {
      const days = diffDays(today(), g.targetDate);
      monthsLeft = Math.max(0, monthsBetween(monthKey(today()), monthKey(g.targetDate)));
      const denom = Math.max(1, monthsLeft);
      perMonth = Math.ceil(remaining / denom);
      onTrack = days < 0 ? (remaining === 0) : true;
      if (days < 0 && remaining > 0) onTrack = false;
    }
    return { pct: p, remaining, monthsLeft, perMonth, complete: g.current >= g.target, onTrack };
  };

  /* ---- bills ---- */
  const billStatus = b => {
    if (b.paidOn) return 'paid';
    const d = diffDays(today(), b.dueDate);
    if (d < 0) return 'overdue';
    if (d <= 7) return 'due-soon';
    return 'upcoming';
  };
  const upcomingBills = (days = 45) => D().bills
    .map(b => ({ ...b, status: billStatus(b), inDays: diffDays(today(), b.dueDate) }))
    .filter(b => b.status !== 'paid' && b.inDays <= days)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const billsDueCount = () => D().bills.filter(b => !b.paidOn && diffDays(today(), b.dueDate) <= 7).length;

  /* ---- recurring ---- */
  const upcomingRecurring = (days = 45) => D().recurring.filter(r => !r.paused)
    .map(r => ({ ...r, inDays: diffDays(today(), r.nextDate) }))
    .filter(r => r.inDays <= days).sort((a, b) => a.nextDate.localeCompare(b.nextDate));
  const monthlyRecurringLoad = () => {
    const factor = { daily: 30, weekly: 4.345, biweekly: 2.17, monthly: 1, quarterly: 1 / 3, yearly: 1 / 12 };
    const act = D().recurring.filter(r => !r.paused);
    return {
      income: Math.round(sum(act.filter(r => r.type === 'income'), r => r.amount * (factor[r.frequency] || 1))),
      expense: Math.round(sum(act.filter(r => r.type === 'expense'), r => r.amount * (factor[r.frequency] || 1)))
    };
  };

  /* ---- health + insights ---- */
  const health = ym => {
    const s = monthSummary(ym);
    const metrics = [
      { key: 'savingsRate', label: 'Savings rate', value: s.savingsRate, unit: '%',
        help: 'Money left after expenses ÷ income. 20% or more is a common personal benchmark.',
        score: Core.clamp(s.savingsRate / 35 * 100, 0, 100) },
      { key: 'expenseRatio', label: 'Expense ratio', value: s.expenseRatio, unit: '%',
        help: 'Expenses ÷ income. Lower means more breathing room.', invert: true,
        score: Core.clamp((100 - s.expenseRatio) / 40 * 100, 0, 100) },
      { key: 'utilization', label: 'Budget utilization', value: s.budget.planned ? s.budget.utilization : null, unit: '%',
        help: 'Actual spending ÷ planned budget for the month.',
        score: s.budget.planned ? Core.clamp(100 - Math.max(0, s.budget.utilization - 90) * 4, 0, 100) : null },
      { key: 'cashflow', label: 'Monthly cash flow', value: s.net, unit: 'money',
        help: 'Income − expenses for the selected month.',
        score: s.income ? Core.clamp(pct(s.net, s.income) / 35 * 100, 0, 100) : null }
    ];
    const scored = metrics.filter(m => m.score != null);
    const overall = scored.length ? Math.round(sum(scored, m => m.score) / scored.length) : null;
    const band = overall == null ? '-' : overall >= 75 ? 'Strong' : overall >= 50 ? 'Steady' : overall >= 30 ? 'Tight' : 'At risk';
    return { metrics, overall, band, summary: s };
  };

  /** Insight sentences computed strictly from stored data. */
  const insights = ym => {
    const out = [];
    const cur = monthSummary(ym), prevYm = addMonths(ym, -1), prev = monthSummary(prevYm);
    const money = Core.money;
    if (cur.count === 0) return out;
    if (prev.count > 0 && prev.expenses > 0) {
      const d = pct(cur.expenses - prev.expenses, prev.expenses);
      out.push({ tone: d <= 0 ? 'good' : 'warn', icon: d <= 0 ? 'trendDown' : 'trendUp',
        text: `You spent ${Core.percent(Math.abs(d))} ${d <= 0 ? 'less' : 'more'} this month than in ${Core.monthLabel(prevYm)} (${money(cur.expenses, { decimals: false })} vs ${money(prev.expenses, { decimals: false })}).` });
    }
    if (prev.income > 0 && cur.income > 0) {
      const a = prev.savingsRate, b = cur.savingsRate;
      if (Math.abs(b - a) >= 1) out.push({ tone: b >= a ? 'good' : 'warn', icon: b >= a ? 'trendUp' : 'trendDown',
        text: `Your savings rate ${b >= a ? 'increased' : 'decreased'} from ${Core.percent(a)} to ${Core.percent(b)}.` });
    }
    const b = cur.budget;
    if (b.exists && b.lines.length) {
      const top = b.lines[0];
      out.push({ tone: top.state === 'over' ? 'bad' : top.state === 'warn' ? 'warn' : 'info', icon: 'budget',
        text: top.state === 'over'
          ? `${Store.catName(top.categoryId)} is over budget by ${money(-top.remaining, { decimals: false })} (${Core.percent(top.used)} of ${money(top.amount, { decimals: false })}).`
          : `The ${Store.catName(top.categoryId)} category used ${Core.percent(top.used)} of its ${money(top.amount, { decimals: false })} monthly budget.` });
      if (b.unbudgeted > 0) out.push({ tone: 'info', icon: 'info',
        text: `${money(b.unbudgeted, { decimals: false })} of spending fell outside your budgeted categories.` });
    } else {
      out.push({ tone: 'info', icon: 'budget', text: `No budget is set for ${Core.monthLabel(ym)}. Setting one makes over-spending easy to catch early.` });
    }
    const tops = topCategories(ym, 1);
    if (tops.length) out.push({ tone: 'info', icon: 'analytics',
      text: `${tops[0].name} was your largest expense category at ${money(tops[0].value, { decimals: false })} (${Core.percent(pct(tops[0].value, cur.expenses))} of spending).` });
    if (cur.net < 0) out.push({ tone: 'bad', icon: 'alert',
      text: `Cash flow is negative this month by ${money(-cur.net, { decimals: false })}: expenses exceeded income.` });
    const due = upcomingBills(14);
    if (due.length) out.push({ tone: 'warn', icon: 'bills',
      text: `${due.length} bill${due.length > 1 ? 's' : ''} totalling ${money(sum(due, x => x.amount), { decimals: false })} ${due.length > 1 ? 'are' : 'is'} due within 14 days.` });
    return out.slice(0, 6);
  };

  /* ---- search / filter ---- */
  const filterTx = (f = {}) => {
    const q = (f.q || '').trim().toLowerCase();
    const amt = v => v == null || v === '' ? null : Core.toMinor(v);
    const minA = amt(f.min), maxA = amt(f.max);
    let list = D().transactions.filter(t => {
      if (f.type && f.type !== 'all' && t.type !== f.type) return false;
      if (f.categoryId && t.categoryId !== f.categoryId) return false;
      if (f.accountId && t.accountId !== f.accountId && t.toAccountId !== f.accountId) return false;
      if (f.method && t.method !== f.method) return false;
      if (f.from && t.date < f.from) return false;
      if (f.to && t.date > f.to) return false;
      if (f.recurringOnly && !t.recurringId) return false;
      if (minA != null && Number.isFinite(minA) && t.amount < minA) return false;
      if (maxA != null && Number.isFinite(maxA) && t.amount > maxA) return false;
      if (q) {
        const hay = [t.description, t.notes, Store.catName(t.categoryId), Store.acctName(t.accountId),
          t.toAccountId ? Store.acctName(t.toAccountId) : '', t.method, (t.amount / 100).toFixed(2), t.date].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    const dir = f.sortDir === 'asc' ? 1 : -1;
    const key = f.sortBy || 'date';
    list.sort((a, b) => {
      let A, B;
      if (key === 'amount') { A = a.amount; B = b.amount; }
      else if (key === 'description') { A = a.description.toLowerCase(); B = b.description.toLowerCase(); }
      else if (key === 'category') { A = Store.catName(a.categoryId); B = Store.catName(b.categoryId); }
      else if (key === 'account') { A = Store.acctName(a.accountId); B = Store.acctName(b.accountId); }
      else { A = a.date + a.createdAt; B = b.date + b.createdAt; }
      return A < B ? -dir : A > B ? dir : 0;
    });
    return list;
  };

  return { txOfMonth, incomeOf, expenseOf, accountBalance, allBalances, netWorth, liquidBalance,
    monthSummary, budgetSummary, series, monthRange, cumulativeSavings, categoryTrend, topCategories, dailySpend,
    goalProgress, billStatus, upcomingBills, billsDueCount, upcomingRecurring, monthlyRecurringLoad,
    health, insights, filterTx };
})();


