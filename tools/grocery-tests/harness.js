const { JSDOM } = require('jsdom');
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const ROOT = process.env.PROJECT_DIR || path.resolve(__dirname, '../..');

/** In-memory stand-in for the PHP API, mirroring GroceryRepo/TransactionRepo rules. */
function makeServer() {
  const S = {
    categories: [
      { id: 'c_food', name: 'Food', kind: 'expense', color: '#e8590c', emoji: '🍽️', archived: false },
      { id: 'c_health', name: 'Health', kind: 'expense', color: '#0ca678', emoji: '💊', archived: false },
      { id: 'c_house', name: 'Household', kind: 'expense', color: '#4c6ef5', emoji: '🏠', archived: false },
      { id: 'c_salary', name: 'Salary', kind: 'income', color: '#2b8a3e', emoji: '💰', archived: false }
    ],
    accounts: [{ id: 'a_cash', name: 'Wallet', type: 'cash', openingBalance: 0, color: '#0f9d58', archived: false }],
    grocery: [], transactions: [], calls: [], failSubmit: null, failUpdate: false, seq: 0
  };
  const ok = (data, status = 200) => ({ status, body: { ok: true, data } });
  const err = (status, code, message, details = {}) => ({ status, body: { ok: false, error: { code, message, details } } });
  S.handle = (url, method, body) => {
    const u = new URL(url, 'http://localhost/');
    const p = u.pathname.replace(/^\/(api\/)?/, '');
    S.calls.push(p);
    const id = u.searchParams.get('id') || (body && body.id);
    if (p === 'bootstrap.php') return ok({
      user: { id: 1, email: 't@t.co', createdAt: '2026-01-01T00:00:00Z' }, csrfToken: 'tok',
      settings: { currency: 'PHP', dateFormat: 'MMM D, YYYY', theme: 'light', onboarded: true, hideSampleBanner: true, hasSampleData: false },
      categories: S.categories, accounts: S.accounts, budgets: [], goals: [], bills: [], recurring: [],
      grocery: JSON.parse(JSON.stringify(S.grocery)), transactions: JSON.parse(JSON.stringify(S.transactions)), reference: {}
    });
    if (p === 'recurring/run.php') return ok({ posted: 0 });
    if (p === 'grocery/create.php') {
      if (!body.name || !String(body.name).trim()) return err(422, 'validation_failed', 'Please check the highlighted fields.', { fields: { name: 'Enter an item name.' } });
      const row = { id: body.id || 'gro_' + (++S.seq), name: String(body.name).trim(), categoryId: body.categoryId || null, checked: false, checkedAt: null, createdAt: new Date(Date.now() + S.seq++).toISOString() };
      S.grocery.push(row); return ok(row, 201);
    }
    if (p === 'grocery/update.php') {
      if (S.failUpdate) return err(500, 'server_error', 'Boom');
      const g = S.grocery.find(x => x.id === id); if (!g) return err(404, 'not_found', 'That grocery item could not be found.');
      if ('checked' in body) { g.checked = !!body.checked; g.checkedAt = g.checked ? new Date().toISOString() : null; }
      return ok(g);
    }
    if (p === 'grocery/delete.php') { S.grocery = S.grocery.filter(x => x.id !== id); return { status: 200, body: { ok: true, data: null } }; }
    if (p === 'grocery/submit.php') {
      if (S.failSubmit) return err(500, 'server_error', S.failSubmit);
      const created = []; const backup = JSON.stringify(S.grocery);
      try {
        for (const [i, line] of body.items.entries()) {
          const g = S.grocery.find(x => x.id === line.id);
          if (!g) throw { s: 409, c: 'grocery_changed', m: 'Your grocery list changed (it may already have been submitted). Reload it and try again.' };
          const cid = line.categoryId || g.categoryId;
          if (!cid) throw { s: 422, c: 'validation_failed', m: 'Please check the highlighted fields.', d: { fields: { [`items.${i}.categoryId`]: 'Choose a category.' } } };
          if (!(line.amount > 0)) throw { s: 422, c: 'validation_failed', m: 'bad amount', d: { fields: { [`items.${i}.amount`]: 'Please enter an amount greater than zero.' } } };
          created.push({ id: 'tx_' + (++S.seq), type: 'expense', amount: line.amount, date: body.date, description: g.name, categoryId: cid, accountId: body.accountId, method: body.method || 'Cash', notes: 'Live Grocery List', createdAt: new Date().toISOString() });
          S.grocery = S.grocery.filter(x => x.id !== line.id);
        }
      } catch (e) { S.grocery = JSON.parse(backup); return err(e.s, e.c, e.m, e.d); }
      S.transactions.push(...created);
      return ok({ transactions: created, submitted: created.length });
    }
    return err(404, 'not_found', 'No mock for ' + p);
  };
  return S;
}

async function boot(server, hash = '#/grocery') {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').replace(/<script[^>]*><\/script>/g, '');
  const dom = new JSDOM(html, { url: 'http://localhost/index.html' + hash, runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  w.scrollTo = () => {}; w.Element.prototype.scrollIntoView = () => {};
  w.fetch = async (url, opts = {}) => {
    await new Promise(r => setTimeout(r, server.latency || 0));
    const body = opts.body ? JSON.parse(opts.body) : null;
    const r = server.handle(url, opts.method || 'GET', body);
    return { ok: r.status < 400, status: r.status, text: async () => JSON.stringify(r.body) };
  };
  try { w.localStorage.setItem('bp_onboarding_completed', '1'); } catch (e) {}
  const ctx = dom.getInternalVMContext();
  const scripts = [...fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').matchAll(/<script src="([^"]+)"/g)].map(m => m[1]);
  for (const s of scripts) new vm.Script(fs.readFileSync(path.join(ROOT, s), 'utf8'), { filename: s }).runInContext(ctx);
  await new Promise(r => setTimeout(r, 400));
  if (!w.document.querySelector('.app')) { await w.eval('App.boot()'); await new Promise(r => setTimeout(r, 200)); }
  return { dom, w, doc: w.document, scripts };
}
const tick = (ms = 120) => new Promise(r => setTimeout(r, ms));
module.exports = { makeServer, boot, tick };
