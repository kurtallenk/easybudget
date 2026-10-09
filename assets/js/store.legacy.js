/* ============================================================
   01 · STORE - schema, validation, persistence, integrity
   Persistence layer: versioned localStorage document with
   migrations, atomic writes, validation and a change bus.
   ============================================================ */
const Store = (() => {
  const KEY = 'budgetplanner.v1';
  const VERSION = 1;
  const { uid, today, monthKey, toMinor, iso, addDays, addMonths, parse, sum } = Core;

  /* ---------- defaults ---------- */
  const DEFAULT_CATEGORIES = [
    ['Salary', 'income', '#0f9d58', '💼'], ['Freelance', 'income', '#12b886', '🧑‍💻'],
    ['Business', 'income', '#2f9e44', '🏪'], ['Allowance', 'income', '#66a80f', '🎁'],
    ['Commission', 'income', '#37b24d', '📈'], ['Bonus', 'income', '#099268', '✨'],
    ['Other Income', 'income', '#748ffc', '➕'],
    ['Food', 'expense', '#f76707', '🍜'], ['Transportation', 'expense', '#4c6ef5', '🚌'],
    ['Housing', 'expense', '#7048e8', '🏠'], ['Utilities', 'expense', '#0ca678', '💡'],
    ['Internet', 'expense', '#1098ad', '🌐'], ['Phone', 'expense', '#22b8cf', '📱'],
    ['Shopping', 'expense', '#e8590c', '🛍️'], ['Health', 'expense', '#e03131', '🩺'],
    ['Entertainment', 'expense', '#d6336c', '🎬'], ['Education', 'expense', '#3b5bdb', '📚'],
    ['Family', 'expense', '#f08c00', '👨‍👩‍👧'], ['Personal', 'expense', '#9c36b5', '🧴'],
    ['Subscriptions', 'expense', '#ae3ec9', '🔁'], ['Debt', 'expense', '#c2255c', '💳'],
    ['Other Expense', 'expense', '#868e96', '📦']
  ];
  const ACCOUNT_TYPES = [
    { id: 'cash', name: 'Cash', icon: 'cash', color: '#0f9d58' },
    { id: 'bank', name: 'Bank Account', icon: 'bank', color: '#2563eb' },
    { id: 'ewallet', name: 'E-Wallet', icon: 'phone', color: '#7048e8' },
    { id: 'savings', name: 'Savings Account', icon: 'piggy', color: '#0ca678' },
    { id: 'credit', name: 'Credit Card', icon: 'card', color: '#d6336c' },
    { id: 'other', name: 'Other', icon: 'wallet', color: '#868e96' }
  ];
  const PAYMENT_METHODS = ['Cash', 'Debit Card', 'Credit Card', 'Bank Transfer', 'E-Wallet', 'Cheque', 'Auto-Debit', 'Other'];
  const FREQUENCIES = [
    { id: 'daily', name: 'Daily' }, { id: 'weekly', name: 'Weekly' },
    { id: 'biweekly', name: 'Every 2 weeks' }, { id: 'monthly', name: 'Monthly' },
    { id: 'quarterly', name: 'Quarterly' }, { id: 'yearly', name: 'Yearly' }
  ];

  const defaultSettings = () => ({
    currency: 'PHP', dateFormat: 'MMM D, YYYY', firstDayOfWeek: 0,
    theme: 'system', brandHue: 221, hideSampleBanner: false, onboarded: false
  });

  const emptyDoc = () => ({
    version: VERSION,
    createdAt: new Date().toISOString(),
    settings: defaultSettings(),
    categories: DEFAULT_CATEGORIES.map(([name, kind, color, emoji]) => ({
      id: uid('cat'), name, kind, color, emoji, system: true, archived: false
    })),
    accounts: [], transactions: [], budgets: [], goals: [], recurring: [], bills: [],
    sample: false
  });

  /* ---------- state ---------- */
  let doc = emptyDoc();
  const listeners = new Set();
  let muted = false;

  const subscribe = fn => { listeners.add(fn); return () => listeners.delete(fn); };
  const emit = () => { if (!muted) listeners.forEach(f => { try { f(doc); } catch (e) { console.error(e); } }); };
  const persist = () => {
    try { localStorage.setItem(KEY, JSON.stringify(doc)); return true; }
    catch (e) { console.error('Persist failed', e); return false; }
  };
  const commit = () => { const ok = persist(); emit(); return ok; };
  const batch = fn => { muted = true; try { fn(); } finally { muted = false; } commit(); };

  /* ---------- load + migrate ---------- */
  const migrate = d => {
    if (!d || typeof d !== 'object') return emptyDoc();
    const base = emptyDoc();
    d.version = d.version || 1;
    d.settings = Object.assign(base.settings, d.settings || {});
    for (const k of ['categories', 'accounts', 'transactions', 'budgets', 'goals', 'recurring', 'bills'])
      if (!Array.isArray(d[k])) d[k] = [];
    if (!d.categories.length) d.categories = base.categories;
    // normalise legacy float amounts -> minor units
    d.transactions.forEach(t => { if (typeof t.amount === 'number' && !Number.isInteger(t.amount)) t.amount = Math.round(t.amount * 100); });
    d.version = VERSION;
    return d;
  };
  const load = () => {
    let raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) { /* storage blocked */ }
    if (!raw) { doc = emptyDoc(); return { fresh: true }; }
    try { doc = migrate(JSON.parse(raw)); } catch (e) { console.error('Corrupt data, starting fresh', e); doc = emptyDoc(); return { fresh: true, corrupt: true }; }
    return { fresh: false };
  };

  const get = () => doc;
  const settings = () => doc.settings;
  const setSettings = patch => { Object.assign(doc.settings, patch); commit(); };

  /* ---------- lookups ---------- */
  const categories = (kind) => doc.categories.filter(c => !c.archived && (!kind || c.kind === kind || c.kind === 'both'));
  const catById = id => doc.categories.find(c => c.id === id) || null;
  const catName = id => (catById(id) || {}).name || 'Uncategorized';
  const catColor = id => (catById(id) || {}).color || '#868e96';
  const catEmoji = id => (catById(id) || {}).emoji || '📁';
  const accounts = () => doc.accounts.filter(a => !a.archived);
  const acctById = id => doc.accounts.find(a => a.id === id) || null;
  const acctName = id => (acctById(id) || {}).name || '-';
  const acctType = id => ACCOUNT_TYPES.find(t => t.id === id) || ACCOUNT_TYPES[5];

  /* ---------- validation ---------- */
  const V = {
    amount(v, { min = 1, label = 'Amount' } = {}) {
      const m = toMinor(v);
      if (!Number.isFinite(m)) return `${label} must be a number.`;
      if (m < min) return min > 0 ? `${label} must be greater than zero.` : `${label} cannot be negative.`;
      if (m > 1e13) return `${label} is unrealistically large.`;
      return null;
    },
    required(v, label) { return String(v ?? '').trim() ? null : `${label} is required.`; },
    date(v, label = 'Date') {
      if (!v) return `${label} is required.`;
      const d = parse(v); if (!d) return `${label} must be a valid date.`;
      if (d.getFullYear() < 1970 || d.getFullYear() > 2200) return `${label} is out of range.`;
      return null;
    },
    futureDate(v, label = 'Target date') {
      const e = V.date(v, label); if (e) return e;
      return Core.diffDays(today(), v) < 0 ? `${label} must be in the future.` : null;
    }
  };

  /* ---------- transactions ---------- */
  /** normalize + validate a transaction payload; returns {errors, value} */
  const normalizeTx = (input, { existingId = null } = {}) => {
    const errors = {};
    const type = ['income', 'expense', 'transfer'].includes(input.type) ? input.type : 'expense';
    const amount = toMinor(input.amount);
    let e = V.amount(input.amount); if (e) errors.amount = e;
    e = V.date(input.date); if (e) errors.date = e;
    if (type === 'transfer') {
      if (!input.accountId) errors.accountId = 'Choose a source account.';
      if (!input.toAccountId) errors.toAccountId = 'Choose a destination account.';
      if (input.accountId && input.accountId === input.toAccountId) errors.toAccountId = 'Source and destination must differ.';
    } else {
      if (!input.accountId) errors.accountId = 'Choose an account.';
      if (!input.categoryId) errors.categoryId = 'Choose a category.';
      if (input.categoryId) { const c = catById(input.categoryId); if (c && c.kind !== 'both' && c.kind !== type) errors.categoryId = `That category is for ${c.kind}.`; }
      if (!String(input.description || '').trim()) errors.description = 'Add a short description.';
    }
    const value = {
      id: existingId || uid('tx'), type, amount: Number.isFinite(amount) ? amount : 0,
      description: String(input.description || '').trim().slice(0, 140),
      categoryId: type === 'transfer' ? null : input.categoryId || null,
      date: input.date || today(),
      accountId: input.accountId || null,
      toAccountId: type === 'transfer' ? (input.toAccountId || null) : null,
      method: input.method || (type === 'transfer' ? 'Bank Transfer' : 'Cash'),
      notes: String(input.notes || '').trim().slice(0, 500),
      recurringId: input.recurringId || null,
      billId: input.billId || null,
      goalId: input.goalId || null,
      sample: !!input.sample,
      createdAt: input.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    return { errors, value, ok: Object.keys(errors).length === 0 };
  };

  /** duplicate guard: same type/amount/date/account/description within 60s */
  const isDuplicate = v => doc.transactions.some(t =>
    t.id !== v.id && t.type === v.type && t.amount === v.amount && t.date === v.date &&
    t.accountId === v.accountId && t.description.toLowerCase() === v.description.toLowerCase());

  const addTx = (input, opts = {}) => {
    const r = normalizeTx(input);
    if (!r.ok) return r;
    if (!opts.allowDuplicate && isDuplicate(r.value)) return { ok: false, duplicate: true, errors: {}, value: r.value };
    doc.transactions.push(r.value);
    if (r.value.goalId) syncGoalFromTx(r.value.goalId);
    commit(); return { ok: true, value: r.value };
  };
  const updateTx = (id, input) => {
    const i = doc.transactions.findIndex(t => t.id === id); if (i < 0) return { ok: false, errors: { _: 'Not found' } };
    const r = normalizeTx({ ...doc.transactions[i], ...input }, { existingId: id });
    if (!r.ok) return r;
    r.value.createdAt = doc.transactions[i].createdAt;
    doc.transactions[i] = r.value;
    if (r.value.goalId) syncGoalFromTx(r.value.goalId);
    commit(); return { ok: true, value: r.value };
  };
  const removeTx = id => {
    const t = doc.transactions.find(x => x.id === id);
    doc.transactions = doc.transactions.filter(x => x.id !== id);
    if (t && t.billId) { const b = doc.bills.find(b => b.id === t.billId); if (b) { b.paidOn = null; b.paidTxId = null; } }
    if (t && t.goalId) syncGoalFromTx(t.goalId);
    commit();
  };
  const syncGoalFromTx = goalId => {
    const g = doc.goals.find(x => x.id === goalId); if (!g) return;
    g.current = sum(doc.transactions.filter(t => t.goalId === goalId), t => t.type === 'expense' || t.type === 'transfer' ? t.amount : -t.amount);
    if (g.current < 0) g.current = 0;
  };

  /* ---------- accounts ---------- */
  const normalizeAccount = (input, id) => {
    const errors = {};
    let e = V.required(input.name, 'Account name'); if (e) errors.name = e;
    if (doc.accounts.some(a => a.id !== id && a.name.trim().toLowerCase() === String(input.name || '').trim().toLowerCase()))
      errors.name = 'An account with that name already exists.';
    const ob = toMinor(input.openingBalance || 0);
    if (!Number.isFinite(ob)) errors.openingBalance = 'Opening balance must be a number.';
    const type = ACCOUNT_TYPES.some(t => t.id === input.type) ? input.type : 'cash';
    return {
      errors, ok: !Object.keys(errors).length,
      value: { id: id || uid('acc'), name: String(input.name || '').trim().slice(0, 60), type,
        openingBalance: Number.isFinite(ob) ? ob : 0, color: input.color || acctType(type).color,
        note: String(input.note || '').trim().slice(0, 200), archived: false, sample: !!input.sample,
        createdAt: input.createdAt || new Date().toISOString() }
    };
  };
  const addAccount = i => { const r = normalizeAccount(i); if (r.ok) { doc.accounts.push(r.value); commit(); } return r; };
  const updateAccount = (id, i) => { const idx = doc.accounts.findIndex(a => a.id === id); if (idx < 0) return { ok: false, errors: {} };
    const r = normalizeAccount({ ...doc.accounts[idx], ...i }, id); if (r.ok) { doc.accounts[idx] = r.value; commit(); } return r; };
  const removeAccount = (id, mode = 'delete') => {
    if (mode === 'delete') doc.transactions = doc.transactions.filter(t => t.accountId !== id && t.toAccountId !== id);
    doc.accounts = doc.accounts.filter(a => a.id !== id);
    doc.bills.forEach(b => { if (b.accountId === id) b.accountId = null; });
    doc.recurring.forEach(r => { if (r.accountId === id) r.accountId = null; });
    commit();
  };

  /* ---------- categories ---------- */
  const addCategory = i => {
    const errors = {};
    const e = V.required(i.name, 'Category name'); if (e) errors.name = e;
    if (doc.categories.some(c => c.name.toLowerCase() === String(i.name || '').trim().toLowerCase() && c.kind === i.kind))
      errors.name = 'That category already exists.';
    if (Object.keys(errors).length) return { ok: false, errors };
    const v = { id: uid('cat'), name: String(i.name).trim().slice(0, 40), kind: i.kind === 'income' ? 'income' : 'expense',
      color: i.color || '#4c6ef5', emoji: i.emoji || '🏷️', system: false, archived: false };
    doc.categories.push(v); commit(); return { ok: true, value: v };
  };
  const updateCategory = (id, patch) => { const c = catById(id); if (!c) return { ok: false }; Object.assign(c, patch); commit(); return { ok: true, value: c }; };
  const removeCategory = id => {
    const used = doc.transactions.some(t => t.categoryId === id);
    if (used) { const c = catById(id); if (c) c.archived = true; }
    else doc.categories = doc.categories.filter(c => c.id !== id);
    doc.budgets.forEach(b => { b.lines = (b.lines || []).filter(l => l.categoryId !== id); });
    commit(); return { archived: used };
  };

  /* ---------- budgets (one doc per month) ---------- */
  const budgetFor = ym => doc.budgets.find(b => b.month === ym) || null;
  const ensureBudget = ym => { let b = budgetFor(ym); if (!b) { b = { id: uid('bgt'), month: ym, lines: [], incomePlan: [], savingsPlan: [], createdAt: new Date().toISOString() }; doc.budgets.push(b); } return b; };
  const setBudgetLine = (ym, categoryId, amountMinor) => {
    const b = ensureBudget(ym);
    const line = b.lines.find(l => l.categoryId === categoryId);
    if (amountMinor <= 0) b.lines = b.lines.filter(l => l.categoryId !== categoryId);
    else if (line) line.amount = amountMinor;
    else b.lines.push({ id: uid('bl'), categoryId, amount: amountMinor });
    commit();
  };
  const setPlan = (ym, key, rows) => { const b = ensureBudget(ym); b[key] = rows; commit(); };
  const copyBudget = (fromYm, toYm) => {
    const src = budgetFor(fromYm); if (!src) return false;
    const dst = ensureBudget(toYm);
    dst.lines = src.lines.map(l => ({ ...l, id: uid('bl') }));
    dst.incomePlan = (src.incomePlan || []).map(r => ({ ...r, id: uid('ip') }));
    dst.savingsPlan = (src.savingsPlan || []).map(r => ({ ...r, id: uid('sp') }));
    commit(); return true;
  };

  /* ---------- goals ---------- */
  const normalizeGoal = (i, id) => {
    const errors = {};
    let e = V.required(i.name, 'Goal name'); if (e) errors.name = e;
    e = V.amount(i.target, { label: 'Target amount' }); if (e) errors.target = e;
    const cur = toMinor(i.current || 0);
    if (!Number.isFinite(cur) || cur < 0) errors.current = 'Saved amount cannot be negative.';
    if (i.targetDate) { e = V.date(i.targetDate, 'Target date'); if (e) errors.targetDate = e; }
    return { errors, ok: !Object.keys(errors).length,
      value: { id: id || uid('goal'), name: String(i.name || '').trim().slice(0, 60), target: toMinor(i.target) || 0,
        current: Number.isFinite(cur) ? cur : 0, targetDate: i.targetDate || null, accountId: i.accountId || null,
        description: String(i.description || '').trim().slice(0, 300), emoji: i.emoji || '🎯', color: i.color || '#0ca678',
        archived: false, sample: !!i.sample, createdAt: i.createdAt || new Date().toISOString() } };
  };
  const addGoal = i => { const r = normalizeGoal(i); if (r.ok) { doc.goals.push(r.value); commit(); } return r; };
  const updateGoal = (id, i) => { const idx = doc.goals.findIndex(g => g.id === id); if (idx < 0) return { ok: false, errors: {} };
    const r = normalizeGoal({ ...doc.goals[idx], ...i }, id); if (r.ok) { doc.goals[idx] = r.value; commit(); } return r; };
  const removeGoal = id => { doc.goals = doc.goals.filter(g => g.id !== id); doc.transactions.forEach(t => { if (t.goalId === id) t.goalId = null; }); commit(); };
  const contributeGoal = (id, amountMinor, accountId, date) => {
    const g = doc.goals.find(x => x.id === id); if (!g) return { ok: false };
    const r = addTx({ type: 'transfer', amount: amountMinor / 100, date: date || today(),
      accountId, toAccountId: g.accountId && g.accountId !== accountId ? g.accountId : null,
      description: `Contribution · ${g.name}`, method: 'Bank Transfer', goalId: id }, { allowDuplicate: true });
    if (!r.ok && !g.accountId) { /* no destination account: track on goal only */ }
    g.current = Math.max(0, g.current + amountMinor);
    commit(); return { ok: true };
  };

  /* ---------- recurring ---------- */
  const normalizeRecurring = (i, id) => {
    const errors = {};
    let e = V.required(i.name, 'Name'); if (e) errors.name = e;
    e = V.amount(i.amount); if (e) errors.amount = e;
    e = V.date(i.nextDate, 'Next date'); if (e) errors.nextDate = e;
    if (!i.accountId) errors.accountId = 'Choose an account.';
    const type = i.type === 'income' ? 'income' : 'expense';
    if (!i.categoryId) errors.categoryId = 'Choose a category.';
    return { errors, ok: !Object.keys(errors).length,
      value: { id: id || uid('rec'), name: String(i.name || '').trim().slice(0, 80), type, amount: toMinor(i.amount) || 0,
        categoryId: i.categoryId || null, accountId: i.accountId || null, method: i.method || 'Auto-Debit',
        frequency: i.frequency || 'monthly', nextDate: i.nextDate || today(), endDate: i.endDate || null,
        autoPost: i.autoPost !== false, paused: !!i.paused, notes: String(i.notes || '').slice(0, 300),
        lastPosted: i.lastPosted || null, sample: !!i.sample, createdAt: i.createdAt || new Date().toISOString() } };
  };
  const addRecurring = i => { const r = normalizeRecurring(i); if (r.ok) { doc.recurring.push(r.value); commit(); } return r; };
  const updateRecurring = (id, i) => { const idx = doc.recurring.findIndex(x => x.id === id); if (idx < 0) return { ok: false, errors: {} };
    const r = normalizeRecurring({ ...doc.recurring[idx], ...i }, id); if (r.ok) { doc.recurring[idx] = r.value; commit(); } return r; };
  const removeRecurring = id => { doc.recurring = doc.recurring.filter(x => x.id !== id); commit(); };
  const advance = (date, freq) => {
    switch (freq) {
      case 'daily': return addDays(date, 1);
      case 'weekly': return addDays(date, 7);
      case 'biweekly': return addDays(date, 14);
      case 'quarterly': return shiftMonths(date, 3);
      case 'yearly': return shiftMonths(date, 12);
      default: return shiftMonths(date, 1);
    }
  };
  const shiftMonths = (date, n) => {
    const d = parse(date); const day = d.getDate();
    const t = new Date(d.getFullYear(), d.getMonth() + n, 1);
    const dim = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
    t.setDate(Math.min(day, dim)); return iso(t);
  };
  /** Post all due recurring transactions up to today. Returns count. */
  const runRecurring = () => {
    const now = today(); let n = 0; let guard = 0;
    doc.recurring.forEach(r => {
      if (r.paused || !r.autoPost) return;
      while (r.nextDate <= now && (!r.endDate || r.nextDate <= r.endDate) && guard++ < 2000) {
        const res = normalizeTx({ type: r.type, amount: r.amount / 100, description: r.name, categoryId: r.categoryId,
          date: r.nextDate, accountId: r.accountId, method: r.method, notes: r.notes, recurringId: r.id });
        const already = doc.transactions.some(t => t.recurringId === r.id && t.date === r.nextDate);
        if (res.ok && !already) { doc.transactions.push(res.value); n++; }
        r.lastPosted = r.nextDate;
        r.nextDate = advance(r.nextDate, r.frequency);
      }
    });
    if (n) commit();
    return n;
  };

  /* ---------- bills ---------- */
  const normalizeBill = (i, id) => {
    const errors = {};
    let e = V.required(i.name, 'Bill name'); if (e) errors.name = e;
    e = V.amount(i.amount); if (e) errors.amount = e;
    e = V.date(i.dueDate, 'Due date'); if (e) errors.dueDate = e;
    if (!i.categoryId) errors.categoryId = 'Choose a category.';
    return { errors, ok: !Object.keys(errors).length,
      value: { id: id || uid('bill'), name: String(i.name || '').trim().slice(0, 80), amount: toMinor(i.amount) || 0,
        dueDate: i.dueDate || today(), categoryId: i.categoryId || null, accountId: i.accountId || null,
        method: i.method || 'Auto-Debit', repeat: i.repeat || 'monthly', notes: String(i.notes || '').slice(0, 300),
        paidOn: i.paidOn || null, paidTxId: i.paidTxId || null, sample: !!i.sample,
        createdAt: i.createdAt || new Date().toISOString() } };
  };
  const addBill = i => { const r = normalizeBill(i); if (r.ok) { doc.bills.push(r.value); commit(); } return r; };
  const updateBill = (id, i) => { const idx = doc.bills.findIndex(b => b.id === id); if (idx < 0) return { ok: false, errors: {} };
    const r = normalizeBill({ ...doc.bills[idx], ...i }, id); if (r.ok) { doc.bills[idx] = r.value; commit(); } return r; };
  const removeBill = id => { doc.bills = doc.bills.filter(b => b.id !== id); commit(); };
  const payBill = (id, opts = {}) => {
    const b = doc.bills.find(x => x.id === id); if (!b) return { ok: false };
    const accountId = opts.accountId || b.accountId || (accounts()[0] || {}).id;
    if (!accountId) return { ok: false, errors: { accountId: 'Create an account first.' } };
    const r = normalizeTx({ type: 'expense', amount: b.amount / 100, description: b.name, categoryId: b.categoryId,
      date: opts.date || today(), accountId, method: b.method, notes: b.notes, billId: b.id });
    if (!r.ok) return r;
    doc.transactions.push(r.value);
    b.paidOn = r.value.date; b.paidTxId = r.value.id;
    if (b.repeat && b.repeat !== 'once') {
      doc.bills.push(normalizeBill({ ...b, id: undefined, dueDate: advance(b.dueDate, b.repeat), paidOn: null, paidTxId: null }).value);
    }
    commit(); return { ok: true, value: r.value };
  };
  const unpayBill = id => { const b = doc.bills.find(x => x.id === id); if (!b) return;
    if (b.paidTxId) doc.transactions = doc.transactions.filter(t => t.id !== b.paidTxId);
    b.paidOn = null; b.paidTxId = null; commit(); };

  /* ---------- data management ---------- */
  const exportJSON = () => JSON.stringify({ ...doc, exportedAt: new Date().toISOString() }, null, 2);
  const exportCSV = () => {
    const head = ['Date', 'Type', 'Description', 'Category', 'Account', 'To Account', 'Method', 'Amount', 'Notes'];
    const rows = Core.sortBy(doc.transactions, t => t.date, -1).map(t => [
      t.date, t.type, t.description, t.categoryId ? catName(t.categoryId) : '',
      acctName(t.accountId), t.toAccountId ? acctName(t.toAccountId) : '', t.method,
      (t.amount / 100).toFixed(2), t.notes || ''
    ]);
    const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    return [head, ...rows].map(r => r.map(esc).join(',')).join('\r\n');
  };
  const importJSON = text => {
    let parsed; try { parsed = JSON.parse(text); } catch (e) { return { ok: false, error: 'That file is not valid JSON.' }; }
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.transactions))
      return { ok: false, error: 'That file does not look like a Budget Planner backup.' };
    doc = migrate(parsed); commit();
    return { ok: true, counts: counts() };
  };
  const counts = () => ({ transactions: doc.transactions.length, accounts: doc.accounts.length,
    budgets: doc.budgets.length, goals: doc.goals.length, recurring: doc.recurring.length, bills: doc.bills.length });
  const resetAll = () => { doc = emptyDoc(); commit(); };
  const clearSample = () => {
    const sampleAcc = new Set(doc.accounts.filter(a => a.sample).map(a => a.id));
    doc.transactions = doc.transactions.filter(t => !t.sample && !sampleAcc.has(t.accountId));
    doc.accounts = doc.accounts.filter(a => !a.sample);
    doc.goals = doc.goals.filter(g => !g.sample);
    doc.recurring = doc.recurring.filter(r => !r.sample);
    doc.bills = doc.bills.filter(b => !b.sample);
    doc.budgets = doc.budgets.filter(b => !b.sample);
    doc.sample = false; commit();
  };

  /* ---------- sample data (clearly flagged) ---------- */
  const seedSample = () => {
    const d = emptyDoc(); d.sample = true; d.settings = { ...doc.settings, onboarded: true };
    const C = n => d.categories.find(c => c.name === n).id;
    const mk = (name, type, opening, color) => { const a = { id: uid('acc'), name, type, openingBalance: opening, color, note: '', archived: false, sample: true, createdAt: new Date().toISOString() }; d.accounts.push(a); return a.id; };
    const cash = mk('Cash Wallet', 'cash', 350000, '#0f9d58');
    const bank = mk('BPI Payroll', 'bank', 2850000, '#2563eb');
    const gcash = mk('GCash', 'ewallet', 620000, '#7048e8');
    const save = mk('Emergency Savings', 'savings', 7500000, '#0ca678');
    const card = mk('Credit Card', 'credit', -1250000, '#d6336c');

    const cur = Core.monthKey(today());
    const months = [Core.addMonths(cur, -5), Core.addMonths(cur, -4), Core.addMonths(cur, -3), Core.addMonths(cur, -2), Core.addMonths(cur, -1), cur];
    const push = (o) => { const r = normalizeTx({ ...o, sample: true }); if (r.ok) d.transactions.push(r.value); else console.warn('sample tx invalid', r.errors, o); };
    const rnd = (a, b) => Math.round(a + Math.random() * (b - a));
    const day = (ym, n) => `${ym}-${String(Math.min(n, Core.daysInMonth(ym))).padStart(2, '0')}`;

    months.forEach((ym, mi) => {
      const grow = 1 + mi * 0.015;
      push({ type: 'income', amount: 3500000 * grow / 100, description: 'Monthly salary', categoryId: C('Salary'), date: day(ym, 15), accountId: bank, method: 'Bank Transfer' });
      push({ type: 'income', amount: rnd(600000, 1200000) / 100, description: 'Freelance project', categoryId: C('Freelance'), date: day(ym, 22), accountId: gcash, method: 'E-Wallet' });
      if (mi % 3 === 2) push({ type: 'income', amount: 450000 / 100, description: 'Performance bonus', categoryId: C('Bonus'), date: day(ym, 28), accountId: bank, method: 'Bank Transfer' });

      push({ type: 'expense', amount: 800000 / 100, description: 'Apartment rent', categoryId: C('Housing'), date: day(ym, 5), accountId: bank, method: 'Bank Transfer' });
      push({ type: 'expense', amount: rnd(280000, 420000) / 100, description: 'Meralco electricity', categoryId: C('Utilities'), date: day(ym, 8), accountId: bank, method: 'Auto-Debit' });
      push({ type: 'expense', amount: 169900 / 100, description: 'Fiber internet', categoryId: C('Internet'), date: day(ym, 10), accountId: bank, method: 'Auto-Debit' });
      push({ type: 'expense', amount: 99900 / 100, description: 'Mobile postpaid plan', categoryId: C('Phone'), date: day(ym, 12), accountId: gcash, method: 'E-Wallet' });
      push({ type: 'expense', amount: 54900 / 100, description: 'Netflix subscription', categoryId: C('Subscriptions'), date: day(ym, 3), accountId: card, method: 'Credit Card' });
      push({ type: 'expense', amount: 24900 / 100, description: 'Spotify subscription', categoryId: C('Subscriptions'), date: day(ym, 3), accountId: card, method: 'Credit Card' });
      push({ type: 'expense', amount: 350000 / 100, description: 'Personal loan payment', categoryId: C('Debt'), date: day(ym, 20), accountId: bank, method: 'Auto-Debit' });
      // groceries + dining spread through the month
      [2, 9, 16, 23, 27].forEach((dd, i) => push({ type: 'expense', amount: rnd(90000, 210000) / 100, description: i % 2 ? 'Groceries - SM Supermarket' : 'Dining out', categoryId: C('Food'), date: day(ym, dd), accountId: i % 2 ? cash : gcash, method: i % 2 ? 'Cash' : 'E-Wallet' }));
      [4, 11, 18, 25].forEach(dd => push({ type: 'expense', amount: rnd(25000, 70000) / 100, description: 'Commute & fuel', categoryId: C('Transportation'), date: day(ym, dd), accountId: cash, method: 'Cash' }));
      push({ type: 'expense', amount: rnd(80000, 260000) / 100, description: 'Online shopping', categoryId: C('Shopping'), date: day(ym, 14), accountId: card, method: 'Credit Card' });
      push({ type: 'expense', amount: rnd(40000, 160000) / 100, description: 'Movies & leisure', categoryId: C('Entertainment'), date: day(ym, 19), accountId: gcash, method: 'E-Wallet' });
      if (mi % 2 === 0) push({ type: 'expense', amount: rnd(70000, 180000) / 100, description: 'Clinic & medicine', categoryId: C('Health'), date: day(ym, 17), accountId: cash, method: 'Cash' });
      push({ type: 'expense', amount: 300000 / 100, description: 'Family support', categoryId: C('Family'), date: day(ym, 16), accountId: gcash, method: 'E-Wallet' });
      // monthly savings transfer
      const tr = normalizeTx({ type: 'transfer', amount: 500000 / 100, description: 'Transfer to savings', date: day(ym, 16), accountId: bank, toAccountId: save, method: 'Bank Transfer', sample: true });
      if (tr.ok) d.transactions.push(tr.value);
    });

    // budgets for last 3 months incl. current
    const plan = [['Housing', 800000], ['Food', 800000], ['Transportation', 400000], ['Utilities', 450000],
      ['Internet', 200000], ['Phone', 120000], ['Shopping', 250000], ['Entertainment', 200000],
      ['Health', 200000], ['Subscriptions', 100000], ['Family', 300000], ['Debt', 350000]];
    [Core.addMonths(cur, -2), Core.addMonths(cur, -1), cur].forEach(ym => {
      d.budgets.push({ id: uid('bgt'), month: ym, sample: true,
        lines: plan.map(([n, a]) => ({ id: uid('bl'), categoryId: C(n), amount: a })),
        incomePlan: [{ id: uid('ip'), label: 'Salary', amount: 3500000 }, { id: uid('ip'), label: 'Freelance', amount: 900000 }],
        savingsPlan: [{ id: uid('sp'), label: 'Emergency Fund', amount: 500000 }, { id: uid('sp'), label: 'Vacation', amount: 300000 }],
        createdAt: new Date().toISOString() });
    });

    d.goals.push(
      { id: uid('goal'), name: 'Emergency Fund', target: 15000000, current: 7500000, targetDate: Core.iso(new Date(new Date().getFullYear() + 1, 5, 30)), accountId: save, description: 'Six months of essential expenses.', emoji: '🛟', color: '#0ca678', archived: false, sample: true, createdAt: new Date().toISOString() },
      { id: uid('goal'), name: 'New Laptop', target: 8500000, current: 2600000, targetDate: Core.iso(new Date(new Date().getFullYear(), new Date().getMonth() + 7, 15)), accountId: save, description: 'Replacement workstation for freelance work.', emoji: '💻', color: '#2563eb', archived: false, sample: true, createdAt: new Date().toISOString() },
      { id: uid('goal'), name: 'Japan Vacation', target: 12000000, current: 1800000, targetDate: Core.iso(new Date(new Date().getFullYear() + 1, 10, 1)), accountId: save, description: 'Two-week autumn trip.', emoji: '🗾', color: '#d6336c', archived: false, sample: true, createdAt: new Date().toISOString() }
    );

    const nd = n => { const t = Core.addDays(today(), n); return t; };
    d.recurring.push(
      { id: uid('rec'), name: 'Monthly salary', type: 'income', amount: 3500000, categoryId: C('Salary'), accountId: bank, method: 'Bank Transfer', frequency: 'monthly', nextDate: nd(10), endDate: null, autoPost: false, paused: false, notes: '', lastPosted: null, sample: true, createdAt: new Date().toISOString() },
      { id: uid('rec'), name: 'Apartment rent', type: 'expense', amount: 800000, categoryId: C('Housing'), accountId: bank, method: 'Bank Transfer', frequency: 'monthly', nextDate: nd(14), endDate: null, autoPost: false, paused: false, notes: '', lastPosted: null, sample: true, createdAt: new Date().toISOString() },
      { id: uid('rec'), name: 'Netflix', type: 'expense', amount: 54900, categoryId: C('Subscriptions'), accountId: card, method: 'Credit Card', frequency: 'monthly', nextDate: nd(6), endDate: null, autoPost: false, paused: false, notes: '', lastPosted: null, sample: true, createdAt: new Date().toISOString() },
      { id: uid('rec'), name: 'Fiber internet', type: 'expense', amount: 169900, categoryId: C('Internet'), accountId: bank, method: 'Auto-Debit', frequency: 'monthly', nextDate: nd(19), endDate: null, autoPost: false, paused: false, notes: '', lastPosted: null, sample: true, createdAt: new Date().toISOString() },
      { id: uid('rec'), name: 'Personal loan payment', type: 'expense', amount: 350000, categoryId: C('Debt'), accountId: bank, method: 'Auto-Debit', frequency: 'monthly', nextDate: nd(25), endDate: null, autoPost: false, paused: true, notes: 'Paused while renegotiating terms.', lastPosted: null, sample: true, createdAt: new Date().toISOString() }
    );
    d.bills.push(
      { id: uid('bill'), name: 'Meralco electricity', amount: 342000, dueDate: nd(3), categoryId: C('Utilities'), accountId: bank, method: 'Auto-Debit', repeat: 'monthly', notes: '', paidOn: null, paidTxId: null, sample: true, createdAt: new Date().toISOString() },
      { id: uid('bill'), name: 'Water bill', amount: 68000, dueDate: nd(-2), categoryId: C('Utilities'), accountId: cash, method: 'Cash', repeat: 'monthly', notes: '', paidOn: null, paidTxId: null, sample: true, createdAt: new Date().toISOString() },
      { id: uid('bill'), name: 'Credit card statement', amount: 985000, dueDate: nd(9), categoryId: C('Debt'), accountId: bank, method: 'Bank Transfer', repeat: 'monthly', notes: '', paidOn: null, paidTxId: null, sample: true, createdAt: new Date().toISOString() },
      { id: uid('bill'), name: 'Fiber internet', amount: 169900, dueDate: nd(16), categoryId: C('Internet'), accountId: bank, method: 'Auto-Debit', repeat: 'monthly', notes: '', paidOn: null, paidTxId: null, sample: true, createdAt: new Date().toISOString() },
      { id: uid('bill'), name: 'Mobile postpaid', amount: 99900, dueDate: nd(21), categoryId: C('Phone'), accountId: gcash, method: 'E-Wallet', repeat: 'monthly', notes: '', paidOn: null, paidTxId: null, sample: true, createdAt: new Date().toISOString() }
    );
    // Back-solve opening balances so every sample account ends at a realistic figure
    // instead of drifting negative. Credit cards are allowed to carry a balance.
    const targets = { [cash]: 350000, [bank]: 4200000, [gcash]: 850000, [save]: 10500000, [card]: -1850000 };
    d.accounts.forEach(a => {
      let flow = 0;
      for (const t of d.transactions) {
        if (t.type === 'income' && t.accountId === a.id) flow += t.amount;
        else if (t.type === 'expense' && t.accountId === a.id) flow -= t.amount;
        else if (t.type === 'transfer') { if (t.accountId === a.id) flow -= t.amount; if (t.toAccountId === a.id) flow += t.amount; }
      }
      a.openingBalance = (targets[a.id] ?? 0) - flow;
    });
    doc = d; commit();
  };

  const markOnboarded = () => { doc.settings.onboarded = true; commit(); };

  return { KEY, load, get, subscribe, commit, batch, settings, setSettings,
    ACCOUNT_TYPES, PAYMENT_METHODS, FREQUENCIES, DEFAULT_CATEGORIES,
    categories, catById, catName, catColor, catEmoji, accounts, acctById, acctName, acctType,
    V, normalizeTx, addTx, updateTx, removeTx, isDuplicate,
    addAccount, updateAccount, removeAccount,
    addCategory, updateCategory, removeCategory,
    budgetFor, ensureBudget, setBudgetLine, setPlan, copyBudget,
    addGoal, updateGoal, removeGoal, contributeGoal,
    addRecurring, updateRecurring, removeRecurring, runRecurring, advance,
    addBill, updateBill, removeBill, payBill, unpayBill,
    exportJSON, exportCSV, importJSON, resetAll, clearSample, seedSample, counts, markOnboarded };
})();


