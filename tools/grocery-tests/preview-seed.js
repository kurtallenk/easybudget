/* Visual QA only: seeds the mock server with a realistic month of data so
   every page has something to show. Loaded by preview.html, never by tests. */
(() => {
  const S = window.MockServer;
  const q = new URLSearchParams(location.search);
  const pad = n => String(n).padStart(2, '0');
  const d0 = new Date();
  const iso = (dy, mo = 0) => { const d = new Date(d0.getFullYear(), d0.getMonth() + mo, dy); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const rel = days => { const d = new Date(d0); d.setDate(d.getDate() + days); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const ym = iso(1).slice(0, 7), ymPrev = iso(1, -1).slice(0, 7);
  if (q.get('empty') === '1') { S.settings.designTemplate = q.get('tpl') || 'modern'; S.settings.theme = q.get('theme') || 'light'; return; }
  S.categories.push(
    { id: 'c_transport', name: 'Transport', kind: 'expense', color: '#1098ad', emoji: '🚌', archived: false },
    { id: 'c_fun', name: 'Entertainment with a very long category name', kind: 'expense', color: '#ae3ec9', emoji: '🎬', archived: false },
    { id: 'c_util', name: 'Utilities', kind: 'expense', color: '#f59f00', emoji: '💡', archived: false },
    { id: 'c_free', name: 'Freelance', kind: 'income', color: '#37b24d', emoji: '💻', archived: false });
  S.accounts.push(
    { id: 'a_bank', name: 'BDO Savings Account', type: 'bank', openingBalance: 8500000, color: '#1c7ed6', archived: false },
    { id: 'a_card', name: 'Credit Card', type: 'credit', openingBalance: -1250000, color: '#e03131', archived: false });
  let n = 0;
  const tx = (type, amount, date, description, categoryId, accountId = 'a_bank', method = 'Bank transfer') =>
    S.transactions.push({ id: 'tx_' + (++n), type, amount, date, description, categoryId, accountId, toAccountId: null, method, notes: '', recurringId: null, createdAt: date + 'T08:00:00Z' });
  [[ym, 1], [ymPrev, 0.9]].forEach(([m, f]) => {
    const day = dd => `${m}-${pad(Math.min(dd, m === ym ? Math.max(1, d0.getDate()) : 28))}`;
    tx('income', Math.round(6500000 * f), day(1), 'Monthly salary', 'c_salary');
    tx('income', Math.round(1200000 * f), day(3), 'Website project - Acme Corporation international rebrand', 'c_free');
    tx('expense', Math.round(1860000 * f), day(2), 'Weekly groceries', 'c_food', 'a_cash', 'Cash');
    tx('expense', Math.round(420000 * f), day(4), 'Pharmacy', 'c_health', 'a_card', 'Credit card');
    tx('expense', Math.round(310000 * f), day(5), 'Jeepney & Grab rides', 'c_transport', 'a_cash', 'Cash');
    tx('expense', Math.round(560000 / f), day(6), 'Concert tickets', 'c_fun', 'a_card', 'Credit card');
    tx('expense', Math.round(475000 * f), day(7), 'Electricity bill', 'c_util');
    tx('expense', Math.round(920000 * f), day(8), 'Home repairs', 'c_house');
  });
  S.budgets.push({ id: 'bgt_1', month: ym, lines: [
    { id: 'bl1', categoryId: 'c_food', amount: 2000000 }, { id: 'bl2', categoryId: 'c_transport', amount: 400000 },
    { id: 'bl3', categoryId: 'c_fun', amount: 400000 }, { id: 'bl4', categoryId: 'c_util', amount: 500000 }, { id: 'bl5', categoryId: 'c_health', amount: 600000 }],
    incomePlan: [{ id: 'p1', label: 'Salary', amount: 6500000 }], savingsPlan: [{ id: 'p2', label: 'Emergency fund', amount: 1000000 }], createdAt: new Date().toISOString() });
  S.bills.push(
    { id: 'b1', name: 'Internet - Fiber 200 Mbps', amount: 169900, dueDate: rel(-2), categoryId: 'c_util', accountId: 'a_bank', paidOn: null, frequency: 'monthly', notes: '' },
    { id: 'b2', name: 'Condo rent', amount: 1800000, dueDate: rel(4), categoryId: 'c_house', accountId: 'a_bank', paidOn: null, frequency: 'monthly', notes: '' },
    { id: 'b3', name: 'Netflix', amount: 54900, dueDate: rel(15), categoryId: 'c_fun', accountId: 'a_card', paidOn: null, frequency: 'monthly', notes: '' });
  S.goals.push(
    { id: 'g1', name: 'Emergency fund', emoji: '🛟', color: '#0ca678', target: 15000000, current: 9200000, targetDate: rel(240), description: 'Six months of expenses', accountId: 'a_bank' },
    { id: 'g2', name: 'Japan trip', emoji: '✈️', color: '#4c6ef5', target: 8000000, current: 2100000, targetDate: rel(300), description: '', accountId: null },
    { id: 'g3', name: 'New laptop', emoji: '💻', color: '#f76707', target: 7000000, current: 7000000, targetDate: null, description: '', accountId: null });
  S.recurring.push(
    { id: 'r1', name: 'Monthly salary', type: 'income', amount: 6500000, frequency: 'monthly', nextDate: rel(20), categoryId: 'c_salary', accountId: 'a_bank', method: 'Bank transfer', autoPost: true, paused: false, description: 'Monthly salary' },
    { id: 'r2', name: 'Spotify', type: 'expense', amount: 19400, frequency: 'monthly', nextDate: rel(9), categoryId: 'c_fun', accountId: 'a_card', method: 'Credit card', autoPost: false, paused: true, description: 'Spotify' });
  S.grocery.push(
    { id: 'gro_1', name: 'Rice 5kg', categoryId: 'c_food', price: null, checked: false, checkedAt: null, createdAt: new Date().toISOString() },
    { id: 'gro_2', name: 'Dish soap', categoryId: 'c_house', price: 8900, checked: true, checkedAt: new Date().toISOString(), createdAt: new Date().toISOString() });
  S.groceryLists.push({ id: 'gl_1', name: 'Weekly basics', items: [{ name: 'Rice 5kg', categoryId: 'c_food' }, { name: 'Eggs', categoryId: 'c_food' }], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  S.savedBudgets.push({ id: 'sb_1', name: 'Standard month', sourceMonth: ymPrev, lines: [{ kind: 'category', categoryId: 'c_food', label: 'Food', amount: 2000000 }], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  S.settings.designTemplate = q.get('tpl') || 'modern';
  S.settings.theme = q.get('theme') || 'light';
})();
