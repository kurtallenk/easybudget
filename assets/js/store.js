/* ============================================================
   01 · STORE - API-backed document store
   Same public surface as the original localStorage store
   (see store.legacy.js) so no view had to change, but the
   server is the source of truth:

     · hydrate()  pulls the document from api/bootstrap.php
     · every mutation is applied locally, emitted immediately
       for a responsive UI, then persisted through the REST API
     · a failed write rolls the document back to the server's
       state and reports the error through Store.onError

   localStorage is NOT the source of truth here. It is used for
   one thing only: a read-only cache of the last good document
   so a reload can paint before the network answers.
   ============================================================ */
const Store = (() => {
  const KEY = 'budgetplanner.v1';
  const CACHE_KEY = 'budgetplanner.cache.v2';
  const VERSION = 1;
  const { uid, today, monthKey, toMinor, iso, addDays, addMonths, parse, sum } = Core;

  /* ---------- reference data (mirrors includes/Defaults.php) ---------- */
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
  const DEFAULT_CATEGORIES = [];   // the server seeds these; kept for API compatibility

  const defaultSettings = () => ({
    currency: 'PHP', dateFormat: 'MMM D, YYYY', firstDayOfWeek: 0,
    theme: 'system', brandHue: 221, designTemplate: 'modern', hideSampleBanner: false, onboarded: false
  });

  /*
   * Presentation-only preferences mirrored in localStorage. The server
   * (user_settings.design_template) stays the source of truth; the mirror
   * only fills the gap when a server response does not carry the key (for
   * example before migration 006 is applied), so a chosen template never
   * silently snaps back to the default. Never holds financial data.
   */
  const PREF_KEY = 'bp_design_template';
  const localPrefs = () => {
    try { const v = localStorage.getItem(PREF_KEY); return v ? { designTemplate: v } : {}; } catch { return {}; }
  };
  const rememberPrefs = s => {
    try { if (s && s.designTemplate) localStorage.setItem(PREF_KEY, s.designTemplate); } catch {}
  };
  const mergeSettings = s => Object.assign(defaultSettings(), localPrefs(), s || {});

  const emptyDoc = () => ({
    version: VERSION, createdAt: new Date().toISOString(), settings: defaultSettings(),
    categories: [], accounts: [], transactions: [], budgets: [], goals: [], recurring: [], bills: [], grocery: [], groceryLists: [], savedBudgets: [],
    sample: false
  });

  /* ---------- state ---------- */
  let doc = emptyDoc();
  let hydration = { fresh: true, loaded: false, meta: null };
  let user = null;
  const listeners = new Set();
  let muted = false;
  let onError = (message, error) => console.error('[store]', message, error);

  const subscribe = fn => { listeners.add(fn); return () => listeners.delete(fn); };
  const emit = () => { if (!muted) listeners.forEach(f => { try { f(doc); } catch (e) { console.error(e); } }); };

  /** Offline paint cache. Never read as truth - hydrate() always overwrites it. */
  const cache = () => {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), doc })); }
    catch (e) { /* private mode or quota: the cache is optional */ }
  };
  const readCache = () => {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && parsed.doc ? parsed.doc : null;
    } catch (e) { return null; }
  };

  const commit = () => { cache(); emit(); return true; };
  const batch = fn => { muted = true; try { fn(); } finally { muted = false; } commit(); };

  /* ---------- write queue ----------
     Writes are serialised so two quick edits cannot race, and any failure
     resyncs from the server rather than leaving the UI lying. */
  let chain = Promise.resolve();
  let pending = 0;

  const persist = (label, run, rollback) => {
    pending++;
    // The stored chain never stays rejected: a rejected chain would skip every
    // later write's `run` and roll each one back, so one failed save would
    // silently disable saving until the page was reloaded.
    chain = chain.then(run).then(result => { pending--; return result; }).catch(async error => {
      pending--;
      console.error('[store] ' + label + ' failed', error);
      try { if (rollback) rollback(); } catch (e) { /* fall through to resync */ }
      try { await hydrate({ silent: true }); } catch (e) { /* offline: keep what we have */ }
      commit();
      onError(error && error.message ? error.message : 'That change could not be saved.', error);
    });
    return chain;   // callers stay synchronous
  };

  const busy = () => pending > 0;

  /** Swap an optimistic local id for the id the server assigned. */
  const reconcile = (collection, tempId, serverRow) => {
    if (!serverRow || !serverRow.id) return;
    const list = doc[collection];
    const i = list.findIndex(x => x.id === tempId);
    if (i < 0) { list.push(serverRow); commit(); return; }
    const serverId = serverRow.id;
    list[i] = { ...list[i], ...serverRow };
    if (serverId !== tempId) {
      if (collection === 'accounts') {
        doc.transactions.forEach(t => {
          if (t.accountId === tempId) t.accountId = serverId;
          if (t.toAccountId === tempId) t.toAccountId = serverId;
        });
        doc.bills.forEach(b => { if (b.accountId === tempId) b.accountId = serverId; });
        doc.recurring.forEach(r => { if (r.accountId === tempId) r.accountId = serverId; });
        doc.goals.forEach(g => { if (g.accountId === tempId) g.accountId = serverId; });
      }
      if (collection === 'categories') {
        doc.transactions.forEach(t => { if (t.categoryId === tempId) t.categoryId = serverId; });
        doc.bills.forEach(b => { if (b.categoryId === tempId) b.categoryId = serverId; });
        doc.recurring.forEach(r => { if (r.categoryId === tempId) r.categoryId = serverId; });
        doc.budgets.forEach(b => (b.lines || []).forEach(l => { if (l.categoryId === tempId) l.categoryId = serverId; }));
      }
    }
    commit();
  };

  /* ---------- hydration ---------- */
  /**
   * Pulls the whole document from the server. Called by App.boot() before the
   * first render, and again after any failed write.
   */
  const hydrate = async ({ silent = false } = {}) => {
    const payload = await Api.bootstrap();
    Api.setToken(payload.csrfToken);
    user = payload.user || null;

    doc = {
      version: VERSION,
      createdAt: (payload.user && payload.user.createdAt) || new Date().toISOString(),
      settings: mergeSettings(payload.settings),
      categories: payload.categories || [],
      accounts: payload.accounts || [],
      transactions: payload.transactions || [],
      budgets: payload.budgets || [],
      goals: payload.goals || [],
      recurring: payload.recurring || [],
      bills: payload.bills || [],
      grocery: payload.grocery || [],
      groceryLists: payload.groceryLists || [],
      savedBudgets: payload.savedBudgets || [],
      sample: !!(payload.settings && payload.settings.hasSampleData)
    };

    hydration = { fresh: doc.transactions.length === 0, loaded: true, meta: payload.$meta || null };
    if (!silent) commit(); else cache();
    return hydration;
  };

  /**
   * Legacy synchronous entry point. The document is loaded by hydrate(); this
   * only reports the outcome and, before the first hydration, paints from the
   * offline cache.
   */
  const load = () => {
    if (!hydration.loaded) {
      const cached = readCache();
      if (cached) doc = Object.assign(emptyDoc(), cached);
    }
    return hydration;
  };

  const get = () => doc;
  const currentUser = () => user;
  const settings = () => doc.settings;
  const setSettings = patch => {
    const previous = { ...doc.settings };
    Object.assign(doc.settings, patch);
    rememberPrefs(patch);
    commit();
    persist('settings.update', () => Api.settings.update(patch).then(s => {
      doc.settings = mergeSettings(s);
      commit();
    }), () => { doc.settings = previous; rememberPrefs(previous); });
  };
  const markOnboarded = () => setSettings({ onboarded: true });

  /* ---------- lookups (unchanged) ---------- */
  const categories = kind => doc.categories.filter(c => !c.archived && (!kind || c.kind === kind || c.kind === 'both'));
  const catById = id => doc.categories.find(c => c.id === id) || null;
  const catName = id => (catById(id) || {}).name || 'Uncategorized';
  const catColor = id => (catById(id) || {}).color || '#868e96';
  const catEmoji = id => (catById(id) || {}).emoji || '📁';
  const accounts = () => doc.accounts.filter(a => !a.archived);
  const acctById = id => doc.accounts.find(a => a.id === id) || null;
  const acctName = id => (acctById(id) || {}).name || '-';
  const acctType = id => ACCOUNT_TYPES.find(t => t.id === id) || ACCOUNT_TYPES[5];

  /* ---------- validation (identical rules to the server) ---------- */
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

  const isDuplicate = v => doc.transactions.some(t =>
    t.id !== v.id && t.type === v.type && t.amount === v.amount && t.date === v.date &&
    t.accountId === v.accountId && (t.description || '').toLowerCase() === (v.description || '').toLowerCase());

  const txPayload = v => ({
    type: v.type, amount: v.amount, date: v.date, description: v.description,
    categoryId: v.categoryId, accountId: v.accountId, toAccountId: v.toAccountId,
    method: v.method, notes: v.notes, goalId: v.goalId
  });

  const addTx = (input, opts = {}) => {
    const r = normalizeTx(input);
    if (!r.ok) return r;
    if (!opts.allowDuplicate && isDuplicate(r.value)) return { ok: false, duplicate: true, errors: {}, value: r.value };
    const tempId = r.value.id;
    doc.transactions.push(r.value);
    commit();
    persist('transaction.create',
      () => Api.transactions.create({ ...txPayload(r.value), allowDuplicate: true })
        .then(row => reconcile('transactions', tempId, row)),
      () => { doc.transactions = doc.transactions.filter(t => t.id !== tempId); });
    return { ok: true, value: r.value };
  };

  const updateTx = (id, input) => {
    const i = doc.transactions.findIndex(t => t.id === id);
    if (i < 0) return { ok: false, errors: { _: 'Not found' } };
    const before = doc.transactions[i];
    const r = normalizeTx({ ...before, ...input }, { existingId: id });
    if (!r.ok) return r;
    r.value.createdAt = before.createdAt;
    doc.transactions[i] = r.value;
    commit();
    persist('transaction.update',
      () => Api.transactions.update(id, txPayload(r.value)).then(row => reconcile('transactions', id, row)),
      () => { doc.transactions[i] = before; });
    return { ok: true, value: r.value };
  };

  const removeTx = id => {
    const t = doc.transactions.find(x => x.id === id);
    if (!t) return;
    const bill = t.billId ? doc.bills.find(b => b.id === t.billId) : null;
    const billBefore = bill ? { ...bill } : null;
    doc.transactions = doc.transactions.filter(x => x.id !== id);
    if (bill) { bill.paidOn = null; bill.paidTxId = null; }
    commit();
    persist('transaction.delete',
      () => Api.transactions.remove(id),
      () => {
        doc.transactions.push(t);
        if (bill && billBefore) Object.assign(bill, billBefore);
      });
  };

  /* ---------- grocery list ----------
     The working shopping list. Items become expenses only through
     submitGrocery(), which the server runs through TransactionRepo.
     An item is "purchased" when the shopper pressed Get Item and entered the
     price they paid; `price` holds that amount in minor units and is what the
     expense is created from. Moving an item back to the active list clears it. */
  const groceryItems = () => doc.grocery || (doc.grocery = []);

  const normalizeGrocery = input => {
    const errors = {};
    const name = String(input.name || '').trim();
    if (!name) errors.name = 'Enter an item name.';
    if (!input.categoryId) errors.categoryId = 'Choose a category.';
    else { const c = catById(input.categoryId); if (!c || c.archived || (c.kind !== 'both' && c.kind !== 'expense')) errors.categoryId = 'Choose an expense category.'; }
    return { errors, ok: !Object.keys(errors).length, name: name.slice(0, 120) };
  };

  const addGrocery = input => {
    const r = normalizeGrocery(input);
    if (!r.ok) return r;
    const item = { id: uid('gro'), name: r.name, categoryId: input.categoryId, price: null, checked: false, checkedAt: null,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    groceryItems().push(item);
    commit();
    // The server accepts the client id, so there is nothing to reconcile: copying
    // the response back could overwrite a check made while the save was queued.
    persist('grocery.create',
      () => Api.grocery.create({ id: item.id, name: item.name, categoryId: item.categoryId }),
      () => { doc.grocery = groceryItems().filter(g => g.id !== item.id); });
    return { ok: true, value: item, errors: {} };
  };

  /**
   * Marks an item purchased with the price that was actually paid, or moves it
   * back to the active list. Same rules as GroceryRepo::update:
   *   · purchased   -> a price greater than zero is required
   *   · unpurchased -> the price is cleared (a price always belongs to a real purchase)
   * `price` is accepted as text (the dialogue input) or as minor units.
   */
  const setGroceryChecked = (id, checked, price) => {
    const item = groceryItems().find(g => g.id === id);
    if (!item) return { ok: false, errors: {} };
    const next = checked === undefined ? !item.checked : !!checked;
    let minor = null;
    if (next) {
      minor = typeof price === 'number' ? Math.round(price) : toMinor(price);
      const e = V.amount(Number.isFinite(minor) ? minor / 100 : '', { label: 'Price' });
      if (e) return { ok: false, errors: { price: e } };
    }
    if (next === item.checked && (!next || minor === item.price)) return { ok: true, value: item, errors: {} };
    const before = { checked: item.checked, checkedAt: item.checkedAt, price: item.price };
    item.checked = next;
    item.price = next ? minor : null;
    item.checkedAt = next ? (item.checkedAt || new Date().toISOString()) : null;
    commit();
    persist('grocery.update',
      () => Api.grocery.update(id, { checked: next, price: item.price }),
      () => { const g = groceryItems().find(x => x.id === id); if (g) Object.assign(g, before); });
    return { ok: true, value: item, errors: {} };
  };

  /** "Get Item" -> price dialogue -> Confirm. */
  const purchaseGrocery = (id, price) => setGroceryChecked(id, true, price);
  /** Undo a purchase: back to the active list, price cleared. */
  const unpurchaseGrocery = id => setGroceryChecked(id, false);

  const removeGrocery = id => {
    const item = groceryItems().find(g => g.id === id);
    if (!item) return;
    doc.grocery = groceryItems().filter(g => g.id !== id);
    commit();
    persist('grocery.delete', () => Api.grocery.remove(id), () => { groceryItems().push(item); });
  };

  /**
   * Empties the current shopping session. Awaited (not optimistic) so the list
   * is only cleared locally once the server confirms. Saved grocery lists and
   * existing expenses are untouched - this only deletes `grocery_items`.
   */
  const clearGrocery = async () => {
    await chain;                                   // never rejects (see persist)
    const res = await Api.grocery.clear();
    doc.grocery = [];
    commit();
    return res;
  };

  /**
   * Submits the whole list as expenses. Not optimistic: the list is only
   * cleared once the server confirms, so a failure loses nothing. Queued
   * writes are awaited first so an item added a moment ago exists server-side.
   * Only purchased items are sent; the server uses the price stored on each
   * item, so nobody is asked for an amount twice. Unpurchased items stay put.
   * payload = { accountId, date, method, items: [{ id, categoryId? }] }
   */
  const submitGrocery = async payload => {
    await chain;                                   // never rejects (see persist)
    const result = await Api.grocery.submit(payload);
    try { await hydrate({ silent: true }); } catch (e) { /* the server write succeeded; the next hydrate will catch up */ }
    commit();
    return result;
  };


  /* ---------- saved grocery lists ----------
     Reusable shopping templates: { id, name, items:[{id,name,categoryId}],
     createdAt, updatedAt }. A template says what to buy; it never holds a
     price or a purchase state, and loading one never creates an expense. */
  const savedGroceryLists = () => doc.groceryLists || (doc.groceryLists = []);

  /** The items of the working list, in list order, as template items. */
  const groceryTemplateItems = () => groceryItems()
    .slice()
    .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''))
    .map(g => ({ name: g.name, categoryId: g.categoryId || null }));

  /** grocery-list-YYYY-MM-DD-HH-MM - sortable, and the server uses the same default. */
  const defaultGroceryListName = (d = new Date()) => {
    const p = n => String(n).padStart(2, '0');
    return `grocery-list-${iso(d)}-${p(d.getHours())}-${p(d.getMinutes())}`;
  };

  /**
   * Saves the working list as a new template, or overwrites an existing one
   * when `listId` is given. Awaited (not optimistic) so the table only shows
   * what the server really stored.
   */
  const saveGroceryList = async ({ name, listId } = {}) => {
    const items = groceryTemplateItems();
    if (!items.length) return { ok: false, errors: { name: 'Add at least one item before saving this list.' } };
    await chain;                                         // never rejects (see persist)
    const clean = String(name || '').trim().slice(0, 80) || defaultGroceryListName();
    const saved = listId
      ? await Api.groceryLists.update(listId, { name: clean, items })
      : await Api.groceryLists.create({ name: clean, items });
    const i = savedGroceryLists().findIndex(l => l.id === saved.id);
    if (i < 0) savedGroceryLists().unshift(saved); else doc.groceryLists[i] = saved;
    commit();
    return { ok: true, value: saved, errors: {} };
  };

  const removeGroceryList = id => {
    const list = savedGroceryLists().find(l => l.id === id);
    if (!list) return;
    doc.groceryLists = savedGroceryLists().filter(l => l.id !== id);
    commit();
    // Templates and expenses are separate: deleting one never touches transactions.
    persist('groceryList.delete', () => Api.groceryLists.remove(id), () => { savedGroceryLists().push(list); });
  };

  /**
   * Replaces the working list with a copy of a saved template. Items come back
   * unpurchased and without a price, so the shopper starts a fresh trip.
   */
  const loadGroceryList = async (id, { replace = true } = {}) => {
    await chain;
    const res = await Api.groceryLists.load(id, replace);
    doc.grocery = (res && res.grocery) || [];
    commit();
    return res;
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
      value: {
        id: id || uid('acc'), name: String(input.name || '').trim().slice(0, 60), type,
        openingBalance: Number.isFinite(ob) ? ob : 0, color: input.color || acctType(type).color,
        note: String(input.note || '').trim().slice(0, 200), archived: !!input.archived, sample: !!input.sample,
        createdAt: input.createdAt || new Date().toISOString()
      }
    };
  };
  const acctPayload = v => ({ name: v.name, type: v.type, openingBalance: v.openingBalance, color: v.color, note: v.note });

  const addAccount = i => {
    const r = normalizeAccount(i);
    if (!r.ok) return r;
    const tempId = r.value.id;
    doc.accounts.push(r.value); commit();
    persist('account.create',
      () => Api.accounts.create(acctPayload(r.value)).then(row => reconcile('accounts', tempId, row)),
      () => { doc.accounts = doc.accounts.filter(a => a.id !== tempId); });
    return r;
  };
  const updateAccount = (id, i) => {
    const idx = doc.accounts.findIndex(a => a.id === id);
    if (idx < 0) return { ok: false, errors: {} };
    const before = doc.accounts[idx];
    const r = normalizeAccount({ ...before, ...i }, id);
    if (!r.ok) return r;
    doc.accounts[idx] = r.value; commit();
    persist('account.update',
      () => Api.accounts.update(id, { ...acctPayload(r.value), archived: r.value.archived })
        .then(row => reconcile('accounts', id, row)),
      () => { doc.accounts[idx] = before; });
    return r;
  };
  const removeAccount = (id, mode = 'delete') => {
    const before = { accounts: [...doc.accounts], transactions: [...doc.transactions] };
    if (mode === 'delete') doc.transactions = doc.transactions.filter(t => t.accountId !== id && t.toAccountId !== id);
    doc.accounts = doc.accounts.filter(a => a.id !== id);
    doc.bills.forEach(b => { if (b.accountId === id) b.accountId = null; });
    doc.recurring.forEach(r => { if (r.accountId === id) r.accountId = null; });
    commit();
    persist('account.delete',
      () => Api.accounts.remove(id, mode),
      () => { doc.accounts = before.accounts; doc.transactions = before.transactions; });
  };

  /* ---------- categories ---------- */
  const addCategory = i => {
    const errors = {};
    const e = V.required(i.name, 'Category name'); if (e) errors.name = e;
    if (doc.categories.some(c => c.name.toLowerCase() === String(i.name || '').trim().toLowerCase() && c.kind === i.kind))
      errors.name = 'That category already exists.';
    if (Object.keys(errors).length) return { ok: false, errors };
    const v = {
      id: uid('cat'), name: String(i.name).trim().slice(0, 40), kind: i.kind === 'income' ? 'income' : 'expense',
      color: i.color || '#4c6ef5', emoji: i.emoji || '🏷️', system: false, archived: false
    };
    doc.categories.push(v); commit();
    persist('category.create',
      () => Api.categories.create({ name: v.name, kind: v.kind, color: v.color, emoji: v.emoji })
        .then(row => reconcile('categories', v.id, row)),
      () => { doc.categories = doc.categories.filter(c => c.id !== v.id); });
    return { ok: true, value: v };
  };
  const updateCategory = (id, patch) => {
    const c = catById(id); if (!c) return { ok: false };
    const before = { ...c };
    Object.assign(c, patch); commit();
    persist('category.update',
      () => Api.categories.update(id, {
        name: c.name, kind: c.kind, color: c.color, emoji: c.emoji, archived: !!c.archived
      }).then(row => reconcile('categories', id, row)),
      () => Object.assign(c, before));
    return { ok: true, value: c };
  };
  const removeCategory = id => {
    const used = doc.transactions.some(t => t.categoryId === id);
    const before = { categories: [...doc.categories], budgets: JSON.parse(JSON.stringify(doc.budgets)) };
    if (used) { const c = catById(id); if (c) c.archived = true; }
    else doc.categories = doc.categories.filter(c => c.id !== id);
    doc.budgets.forEach(b => { b.lines = (b.lines || []).filter(l => l.categoryId !== id); });
    commit();
    persist('category.delete',
      () => Api.categories.remove(id),
      () => { doc.categories = before.categories; doc.budgets = before.budgets; });
    return { archived: used };
  };

  /* ---------- budgets ---------- */
  const budgetFor = ym => doc.budgets.find(b => b.month === ym) || null;
  const ensureBudget = ym => {
    let b = budgetFor(ym);
    if (!b) {
      b = { id: uid('bgt'), month: ym, lines: [], incomePlan: [], savingsPlan: [], createdAt: new Date().toISOString() };
      doc.budgets.push(b);
    }
    return b;
  };
  const applyBudget = server => {
    if (!server) return;
    const i = doc.budgets.findIndex(b => b.month === server.month);
    if (i < 0) doc.budgets.push(server); else doc.budgets[i] = server;
    commit();
  };
  const setBudgetLine = (ym, categoryId, amountMinor) => {
    const b = ensureBudget(ym);
    const snapshot = JSON.parse(JSON.stringify(b));
    const line = b.lines.find(l => l.categoryId === categoryId);
    if (amountMinor <= 0) b.lines = b.lines.filter(l => l.categoryId !== categoryId);
    else if (line) line.amount = amountMinor;
    else b.lines.push({ id: uid('bl'), categoryId, amount: amountMinor });
    commit();
    persist('budget.line',
      () => Api.budgets.setLine(ym, categoryId, amountMinor).then(applyBudget),
      () => { Object.assign(b, snapshot); });
  };
  const setPlan = (ym, key, rows) => {
    const b = ensureBudget(ym);
    const before = b[key] ? JSON.parse(JSON.stringify(b[key])) : [];
    b[key] = rows; commit();
    const kind = key === 'incomePlan' ? 'income' : 'savings';
    persist('budget.plan',
      () => Api.budgets.setPlan(ym, kind, (rows || []).map(r => ({ label: r.label, amount: r.amount }))).then(applyBudget),
      () => { b[key] = before; });
  };
  const copyBudget = (fromYm, toYm) => {
    const src = budgetFor(fromYm); if (!src) return false;
    const dst = ensureBudget(toYm);
    const before = JSON.parse(JSON.stringify(dst));
    dst.lines = src.lines.map(l => ({ ...l, id: uid('bl') }));
    dst.incomePlan = (src.incomePlan || []).map(r => ({ ...r, id: uid('ip') }));
    dst.savingsPlan = (src.savingsPlan || []).map(r => ({ ...r, id: uid('sp') }));
    commit();
    persist('budget.copy',
      () => Api.budgets.copy(fromYm, toYm).then(applyBudget),
      () => { Object.assign(dst, before); });
    return true;
  };

  /* ---------- saved budgets (reusable templates) ----------
     A saved budget is a plan snapshot: category allocations plus the income
     and savings plan rows. It never holds money that was actually spent, and
     loading one only rewrites the plan of the selected month. */

  const savedBudgets = () => doc.savedBudgets || (doc.savedBudgets = []);

  /** The working budget of a month in the payload shape the API expects. */
  const budgetSnapshot = ym => {
    const b = budgetFor(ym);
    return {
      lines: ((b && b.lines) || []).filter(l => l.categoryId && l.amount > 0)
        .map(l => ({ categoryId: l.categoryId, amount: l.amount })),
      incomePlan: ((b && b.incomePlan) || []).map(r => ({ label: r.label, amount: r.amount })),
      savingsPlan: ((b && b.savingsPlan) || []).map(r => ({ label: r.label, amount: r.amount }))
    };
  };

  /** budget-YYYY-MM-DD-HH-MM - sortable, and the server uses the same default. */
  const defaultBudgetName = (d = new Date()) => {
    const p = n => String(n).padStart(2, '0');
    return `budget-${iso(d)}-${p(d.getHours())}-${p(d.getMinutes())}`;
  };

  /**
   * Saves the month's budget as a new template, or overwrites an existing one
   * when `budgetId` is given. Awaited (not optimistic) so the Saved Budgets
   * table only ever shows what the server really stored.
   */
  const saveBudget = async ({ name, budgetId, month } = {}) => {
    const ym = month || monthKey(today());
    const snap = budgetSnapshot(ym);
    if (!snap.lines.length) return { ok: false, errors: { name: 'Add at least one budget category before saving.' } };
    await chain;                                         // never rejects (see persist)
    const clean = String(name || '').trim().slice(0, 80) || defaultBudgetName();
    const payload = { name: clean, sourceMonth: ym, ...snap };
    const saved = budgetId
      ? await Api.savedBudgets.update(budgetId, payload)
      : await Api.savedBudgets.create(payload);
    const i = savedBudgets().findIndex(b => b.id === saved.id);
    if (i < 0) savedBudgets().unshift(saved); else doc.savedBudgets[i] = saved;
    commit();
    return { ok: true, value: saved, errors: {} };
  };

  const removeSavedBudget = id => {
    const saved = savedBudgets().find(b => b.id === id);
    if (!saved) return;
    doc.savedBudgets = savedBudgets().filter(b => b.id !== id);
    commit();
    // Templates and month budgets are separate: deleting one changes no plan.
    persist('savedBudget.delete', () => Api.savedBudgets.remove(id), () => { savedBudgets().push(saved); });
  };

  /** Replaces a month's plan with a copy of a saved template. Creates no transaction. */
  const loadSavedBudget = async (id, month) => {
    const ym = month || monthKey(today());
    await chain;
    const res = await Api.savedBudgets.load(id, ym);
    applyBudget(res && res.budget);
    commit();
    return res;
  };

  /**
   * Clears the working budget of a month: its category lines and its income
   * and savings plan rows. Saved budget templates, expenses, bills and
   * recurring rules are untouched (BudgetRepo::delete only removes the
   * month's own rows).
   */
  const clearBudget = async ym => {
    await chain;
    await Api.budgets.remove(ym);
    doc.budgets = doc.budgets.filter(b => b.month !== ym);
    commit();
  };

  /* ---------- goals ---------- */
  const normalizeGoal = (i, id) => {
    const errors = {};
    let e = V.required(i.name, 'Goal name'); if (e) errors.name = e;
    e = V.amount(i.target, { label: 'Target amount' }); if (e) errors.target = e;
    const cur = toMinor(i.current || 0);
    if (!Number.isFinite(cur) || cur < 0) errors.current = 'Saved amount cannot be negative.';
    if (i.targetDate) { e = V.date(i.targetDate, 'Target date'); if (e) errors.targetDate = e; }
    return {
      errors, ok: !Object.keys(errors).length,
      value: {
        id: id || uid('goal'), name: String(i.name || '').trim().slice(0, 60), target: toMinor(i.target) || 0,
        current: Number.isFinite(cur) ? cur : 0, targetDate: i.targetDate || null, accountId: i.accountId || null,
        description: String(i.description || '').trim().slice(0, 300), emoji: i.emoji || '🎯', color: i.color || '#0ca678',
        archived: !!i.archived, sample: !!i.sample, createdAt: i.createdAt || new Date().toISOString()
      }
    };
  };
  const goalPayload = v => ({
    name: v.name, target: v.target, targetDate: v.targetDate, accountId: v.accountId,
    description: v.description, emoji: v.emoji, color: v.color
  });

  const addGoal = i => {
    const r = normalizeGoal(i);
    if (!r.ok) return r;
    const tempId = r.value.id;
    doc.goals.push(r.value); commit();
    persist('goal.create',
      () => Api.goals.create({ ...goalPayload(r.value), current: r.value.current })
        .then(row => reconcile('goals', tempId, row)),
      () => { doc.goals = doc.goals.filter(g => g.id !== tempId); });
    return r;
  };
  const updateGoal = (id, i) => {
    const idx = doc.goals.findIndex(g => g.id === id);
    if (idx < 0) return { ok: false, errors: {} };
    const before = doc.goals[idx];
    const r = normalizeGoal({ ...before, ...i }, id);
    if (!r.ok) return r;
    r.value.current = before.current;   // derived server-side from contributions
    doc.goals[idx] = r.value; commit();
    persist('goal.update',
      () => Api.goals.update(id, { ...goalPayload(r.value), archived: !!r.value.archived })
        .then(row => reconcile('goals', id, row)),
      () => { doc.goals[idx] = before; });
    return r;
  };
  const removeGoal = id => {
    const before = { goals: [...doc.goals], transactions: JSON.parse(JSON.stringify(doc.transactions)) };
    doc.goals = doc.goals.filter(g => g.id !== id);
    doc.transactions.forEach(t => { if (t.goalId === id) t.goalId = null; });
    commit();
    persist('goal.delete',
      () => Api.goals.remove(id),
      () => { doc.goals = before.goals; doc.transactions = before.transactions; });
  };
  /**
   * The server records one contribution and recalculates the goal from the
   * contribution ledger, so the legacy double count cannot happen. The local
   * document is refreshed from the server's answer.
   */
  const contributeGoal = (id, amountMinor, accountId, date, categoryId) => {
    const g = doc.goals.find(x => x.id === id);
    if (!g) return { ok: false };
    const before = { ...g };
    g.current = Math.max(0, g.current + amountMinor);
    commit();
    persist('goal.contribute',
      () => Api.goals.contribute({ goalId: id, amount: amountMinor, accountId: accountId || null, date: date || today(), categoryId: categoryId || null })
        .then(result => {
          if (result && result.goal) reconcile('goals', id, result.goal);
          if (result && result.transaction) { doc.transactions.push(result.transaction); commit(); }
        }),
      () => Object.assign(g, before));
    return { ok: true };
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
    return {
      errors, ok: !Object.keys(errors).length,
      value: {
        id: id || uid('rec'), name: String(i.name || '').trim().slice(0, 80), type, amount: toMinor(i.amount) || 0,
        categoryId: i.categoryId || null, accountId: i.accountId || null, method: i.method || 'Auto-Debit',
        frequency: i.frequency || 'monthly', nextDate: i.nextDate || today(), endDate: i.endDate || null,
        autoPost: i.autoPost !== false, paused: !!i.paused, notes: String(i.notes || '').slice(0, 300),
        lastPosted: i.lastPosted || null, sample: !!i.sample, createdAt: i.createdAt || new Date().toISOString()
      }
    };
  };
  const recPayload = v => ({
    name: v.name, type: v.type, amount: v.amount, categoryId: v.categoryId, accountId: v.accountId,
    method: v.method, frequency: v.frequency, nextDate: v.nextDate, endDate: v.endDate,
    autoPost: v.autoPost, paused: v.paused, notes: v.notes
  });

  const addRecurring = i => {
    const r = normalizeRecurring(i);
    if (!r.ok) return r;
    const tempId = r.value.id;
    doc.recurring.push(r.value); commit();
    persist('recurring.create',
      () => Api.recurring.create(recPayload(r.value)).then(row => reconcile('recurring', tempId, row)),
      () => { doc.recurring = doc.recurring.filter(x => x.id !== tempId); });
    return r;
  };
  const updateRecurring = (id, i) => {
    const idx = doc.recurring.findIndex(x => x.id === id);
    if (idx < 0) return { ok: false, errors: {} };
    const before = doc.recurring[idx];
    const r = normalizeRecurring({ ...before, ...i }, id);
    if (!r.ok) return r;
    doc.recurring[idx] = r.value; commit();
    persist('recurring.update',
      () => Api.recurring.update(id, recPayload(r.value)).then(row => reconcile('recurring', id, row)),
      () => { doc.recurring[idx] = before; });
    return r;
  };
  const removeRecurring = id => {
    const before = [...doc.recurring];
    doc.recurring = doc.recurring.filter(x => x.id !== id); commit();
    persist('recurring.delete', () => Api.recurring.remove(id), () => { doc.recurring = before; });
  };
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

  /**
   * Posting is a server operation: it is transactional and idempotent there,
   * which the browser cannot guarantee. Returns the number posted.
   */
  const runRecurring = async () => {
    try {
      const result = await Api.recurring.run({});
      if (result && result.posted > 0) await hydrate({ silent: true });
      if (result && result.posted > 0) commit();
      return (result && result.posted) || 0;
    } catch (e) {
      console.error('[store] recurring.run failed', e);
      return 0;
    }
  };

  /* ---------- bills ---------- */
  const normalizeBill = (i, id) => {
    const errors = {};
    let e = V.required(i.name, 'Bill name'); if (e) errors.name = e;
    e = V.amount(i.amount); if (e) errors.amount = e;
    e = V.date(i.dueDate, 'Due date'); if (e) errors.dueDate = e;
    if (!i.categoryId) errors.categoryId = 'Choose a category.';
    return {
      errors, ok: !Object.keys(errors).length,
      value: {
        id: id || uid('bill'), name: String(i.name || '').trim().slice(0, 80), amount: toMinor(i.amount) || 0,
        dueDate: i.dueDate || today(), categoryId: i.categoryId || null, accountId: i.accountId || null,
        method: i.method || 'Auto-Debit', repeat: i.repeat || 'monthly', notes: String(i.notes || '').slice(0, 300),
        paidOn: i.paidOn || null, paidTxId: i.paidTxId || null, sample: !!i.sample,
        createdAt: i.createdAt || new Date().toISOString()
      }
    };
  };
  const billPayload = v => ({
    name: v.name, amount: v.amount, dueDate: v.dueDate, categoryId: v.categoryId,
    accountId: v.accountId, method: v.method, repeat: v.repeat, notes: v.notes
  });

  const addBill = i => {
    const r = normalizeBill(i);
    if (!r.ok) return r;
    const tempId = r.value.id;
    doc.bills.push(r.value); commit();
    persist('bill.create',
      () => Api.bills.create(billPayload(r.value)).then(row => reconcile('bills', tempId, row)),
      () => { doc.bills = doc.bills.filter(b => b.id !== tempId); });
    return r;
  };
  const updateBill = (id, i) => {
    const idx = doc.bills.findIndex(b => b.id === id);
    if (idx < 0) return { ok: false, errors: {} };
    const before = doc.bills[idx];
    const r = normalizeBill({ ...before, ...i }, id);
    if (!r.ok) return r;
    doc.bills[idx] = r.value; commit();
    persist('bill.update',
      () => Api.bills.update(id, billPayload(r.value)).then(row => reconcile('bills', id, row)),
      () => { doc.bills[idx] = before; });
    return r;
  };
  const removeBill = id => {
    const before = [...doc.bills];
    doc.bills = doc.bills.filter(b => b.id !== id); commit();
    persist('bill.delete', () => Api.bills.remove(id), () => { doc.bills = before; });
  };
  /**
   * The server writes the payment occurrence, advances a repeating bill and
   * refuses a second payment for the same due date (409). The local document
   * is replaced by the server's version of the bill.
   */
  const payBill = (id, opts = {}) => {
    const b = doc.bills.find(x => x.id === id);
    if (!b) return { ok: false };
    const accountId = opts.accountId || b.accountId || (accounts()[0] || {}).id;
    if (!accountId) return { ok: false, errors: { accountId: 'Create an account first.' } };
    const r = normalizeTx({
      type: 'expense', amount: b.amount / 100, description: b.name, categoryId: b.categoryId,
      date: opts.date || today(), accountId, method: b.method, notes: b.notes, billId: b.id
    });
    if (!r.ok) return r;
    const before = { ...b };
    const tempId = r.value.id;
    doc.transactions.push(r.value);
    b.paidOn = r.value.date; b.paidTxId = r.value.id;
    commit();
    persist('bill.pay',
      () => Api.bills.pay(id, { accountId, date: opts.date || today() }).then(result => {
        if (result && result.transaction) reconcile('transactions', tempId, result.transaction);
        if (result && result.bill) reconcile('bills', id, result.bill);
      }),
      () => {
        doc.transactions = doc.transactions.filter(t => t.id !== tempId);
        Object.assign(b, before);
      });
    return { ok: true, value: r.value };
  };
  const unpayBill = id => {
    const b = doc.bills.find(x => x.id === id); if (!b) return;
    const before = { ...b };
    const removed = b.paidTxId ? doc.transactions.find(t => t.id === b.paidTxId) : null;
    if (b.paidTxId) doc.transactions = doc.transactions.filter(t => t.id !== b.paidTxId);
    b.paidOn = null; b.paidTxId = null;
    commit();
    persist('bill.unpay',
      () => Api.bills.unpay(id).then(row => reconcile('bills', id, row)),
      () => { Object.assign(b, before); if (removed) doc.transactions.push(removed); });
  };

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
  const counts = () => ({
    transactions: doc.transactions.length, accounts: doc.accounts.length,
    budgets: doc.budgets.length, goals: doc.goals.length, recurring: doc.recurring.length, bills: doc.bills.length,
    grocery: groceryItems().length, groceryLists: savedGroceryLists().length,
    savedBudgets: savedBudgets().length
  });

  const resetAll = () => {
    persist('data.reset', () => Api.data.reset().then(() => hydrate()), null);
  };
  const clearSample = () => {
    persist('data.clearSample', () => Api.data.clearSample().then(() => hydrate()), null);
  };

  /**
   * Import and sample seeding are not part of the server build yet: both would
   * need a bulk write endpoint with its own validation and row caps. They fail
   * loudly rather than pretending to work. See docs/API.md.
   */
  const importJSON = () => ({
    ok: false,
    error: 'Importing a backup is not available in the server-backed version yet.'
  });
  const seedSample = () => {
    onError('Sample data is not available in the server-backed version yet.');
    return { ok: false };
  };

  return {
    KEY, CACHE_KEY, VERSION,
    hydrate, load, get, user: currentUser, subscribe, commit, batch, busy,
    settings, setSettings, markOnboarded,
    setErrorHandler: fn => { if (typeof fn === 'function') onError = fn; },
    ACCOUNT_TYPES, PAYMENT_METHODS, FREQUENCIES, DEFAULT_CATEGORIES,
    categories, catById, catName, catColor, catEmoji, accounts, acctById, acctName, acctType,
    V, normalizeTx, addTx, updateTx, removeTx, isDuplicate,
    addAccount, updateAccount, removeAccount,
    addCategory, updateCategory, removeCategory,
    budgetFor, ensureBudget, setBudgetLine, setPlan, copyBudget,
    savedBudgets, budgetSnapshot, defaultBudgetName, saveBudget, removeSavedBudget, loadSavedBudget, clearBudget,
    addGoal, updateGoal, removeGoal, contributeGoal,
    addRecurring, updateRecurring, removeRecurring, runRecurring, advance,
    addBill, updateBill, removeBill, payBill, unpayBill,
    groceryItems, normalizeGrocery, addGrocery, setGroceryChecked, purchaseGrocery, unpurchaseGrocery,
    removeGrocery, clearGrocery, submitGrocery,
    savedGroceryLists, groceryTemplateItems, defaultGroceryListName, saveGroceryList, removeGroceryList, loadGroceryList,
    exportJSON, exportCSV, importJSON, resetAll, clearSample, seedSample, counts
  };
})();
