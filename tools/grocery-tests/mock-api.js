/* ============================================================
   Live Grocery List tests · in-browser mock of the PHP API
   Mirrors GroceryRepo / GroceryListRepo / TransactionRepo rules so the SPA
   can be driven end to end without PHP or MySQL. Loaded BEFORE the app
   scripts so window.fetch is already replaced when App.boot() runs.
   ============================================================ */
(() => {
  const S = {
    categories: [
      { id: 'c_food', name: 'Food', kind: 'expense', color: '#e8590c', emoji: '🍽️', archived: false },
      { id: 'c_health', name: 'Health', kind: 'expense', color: '#0ca678', emoji: '💊', archived: false },
      { id: 'c_house', name: 'Household', kind: 'expense', color: '#4c6ef5', emoji: '🏠', archived: false },
      { id: 'c_salary', name: 'Salary', kind: 'income', color: '#2b8a3e', emoji: '💰', archived: false }
    ],
    accounts: [{ id: 'a_cash', name: 'Wallet', type: 'cash', openingBalance: 0, color: '#0f9d58', archived: false }],
    grocery: [], groceryLists: [], budgets: [], savedBudgets: [], transactions: [], goals: [], bills: [], recurring: [],
    settings: { currency: 'PHP', dateFormat: 'MMM D, YYYY', firstDayOfWeek: 0, theme: 'light', brandHue: 221, designTemplate: 'modern', onboarded: true, hideSampleBanner: true, hasSampleData: false },
    templateColumn: true,   // false simulates a server where migration 006 is not applied yet
    calls: [], failSubmit: null, failUpdate: false, latency: 0, seq: 0,
    // Round 10: inbox + Super Admin (mirrors NotificationRepo / AdminRepo / api_admin_guard)
    isAdmin: false, feed: [], feedReady: null, posts: [], receipts: {}, deliveries: {}, failNotif: false,
    users: [
      { id: 1, email: 't@t.co', displayName: 'Tess Tester', status: 'active', role: 'user', createdAt: '2026-01-01T00:00:00Z', lastLoginAt: null },
      { id: 2, email: 'john@example.com', displayName: 'John Doe', status: 'active', role: 'user', createdAt: '2026-02-01T00:00:00Z', lastLoginAt: null },
      { id: 3, email: 'jane@example.com', displayName: 'Jane Smith', status: 'active', role: 'user', createdAt: '2026-03-01T00:00:00Z', lastLoginAt: null },
      { id: 4, email: 'michael@example.com', displayName: 'Michael Santos', status: 'suspended', role: 'user', createdAt: '2026-04-01T00:00:00Z', lastLoginAt: null }
    ]
  };
  const clone = v => JSON.parse(JSON.stringify(v));
  const ok = (data, status = 200) => ({ status, body: { ok: true, data } });
  const err = (status, code, message, details = {}) => ({ status, body: { ok: false, error: { code, message, details } } });
  const now = () => new Date().toISOString();

  const settingsOut = () => { const o = clone(S.settings); if (!S.templateColumn) delete o.designTemplate; return o; };
  S.handle = (url, method, body) => {
    const u = new URL(url, location.origin);
    const p = u.pathname.replace(/^\/(api\/)?/, '');
    S.calls.push(p);
    const id = u.searchParams.get('id') || (body && body.id);

    if (p === 'bootstrap.php') return ok({
      user: { id: 1, email: 't@t.co', createdAt: '2026-01-01T00:00:00Z', isSuperAdmin: S.isAdmin }, csrfToken: 'tok',
      settings: settingsOut(),
      categories: S.categories, accounts: S.accounts, budgets: clone(S.budgets), goals: clone(S.goals), bills: clone(S.bills), recurring: clone(S.recurring),
      grocery: clone(S.grocery), groceryLists: clone(S.groceryLists), savedBudgets: clone(S.savedBudgets),
      transactions: clone(S.transactions), reference: {}
    });
    if (p === 'recurring/run.php') return ok({ posted: 0 });

    /* ---------- settings (mirrors api/settings/update.php whitelist) ---------- */
    if (p === 'settings/update.php') {
      const allow = { currency: null, dateFormat: null, firstDayOfWeek: null, theme: ['light', 'dark', 'system'], brandHue: null,
        designTemplate: ['modern', 'classic', 'minimal', 'futuristic'], hideSampleBanner: null, onboarded: null };
      Object.keys(body || {}).forEach(k => {
        if (!(k in allow)) return;
        if (allow[k] && !allow[k].includes(body[k])) return;
        if (k === 'designTemplate' && !S.templateColumn) return;
        S.settings[k] = body[k];
      });
      return ok(settingsOut());
    }

    /* ---------- month budgets ---------- */
    const ensureBudget = month => {
      let b = S.budgets.find(x => x.month === month);
      if (!b) { b = { id: 'bgt_' + (++S.seq), month, lines: [], incomePlan: [], savingsPlan: [], createdAt: now() }; S.budgets.push(b); }
      return b;
    };
    if (p === 'budgets/line.php') {
      const b = ensureBudget(body.month);
      b.lines = b.lines.filter(l => l.categoryId !== body.categoryId);
      if (Number(body.amount) > 0) b.lines.push({ id: 'bl_' + (++S.seq), categoryId: body.categoryId, amount: Number(body.amount) });
      return ok(clone(b));
    }
    if (p === 'budgets/plan.php') {
      const b = ensureBudget(body.month);
      const key = body.kind === 'income' ? 'incomePlan' : 'savingsPlan';
      b[key] = (body.rows || []).map(r => ({ id: 'pl_' + (++S.seq), label: r.label, amount: Number(r.amount) }));
      return ok(clone(b));
    }
    if (p === 'budgets/delete.php') {
      S.budgets = S.budgets.filter(x => x.month !== body.month);   // saved budgets and transactions untouched
      return { status: 200, body: { ok: true, data: null } };
    }

    /* ---------- saved budgets (templates) ---------- */
    const shapeSaved = row => ({ ...clone(row), total: row.lines.reduce((n, l) => n + l.amount, 0) });
    if (p === 'saved-budgets/list.php') return ok(S.savedBudgets.map(shapeSaved));
    if (p === 'saved-budgets/create.php') {
      const lines = (body.lines || []).filter(l => l.categoryId && Number(l.amount) > 0);
      if (!lines.length) return err(422, 'validation_failed', 'Please check the highlighted fields.', { fields: { lines: 'Add at least one budget category before saving.' } });
      const row = { id: body.id || 'sbg_' + (++S.seq), name: String(body.name || '').trim() || 'budget',
        sourceMonth: body.sourceMonth || null,
        lines: lines.map(l => ({ id: 'sbl_' + (++S.seq), categoryId: l.categoryId, amount: Number(l.amount) })),
        incomePlan: (body.incomePlan || []).map(r => ({ id: 'sbl_' + (++S.seq), label: r.label, amount: Number(r.amount) })),
        savingsPlan: (body.savingsPlan || []).map(r => ({ id: 'sbl_' + (++S.seq), label: r.label, amount: Number(r.amount) })),
        createdAt: now(), updatedAt: now() };
      S.savedBudgets.push(row); return ok(shapeSaved(row), 201);
    }
    if (p === 'saved-budgets/update.php') {
      const sb = S.savedBudgets.find(x => x.id === id); if (!sb) return err(404, 'not_found', 'That saved budget could not be found.');
      if ('name' in body && String(body.name || '').trim()) sb.name = String(body.name).trim();
      if (body.sourceMonth) sb.sourceMonth = body.sourceMonth;
      if (body.lines) {
        const lines = body.lines.filter(l => l.categoryId && Number(l.amount) > 0);
        if (!lines.length) return err(422, 'validation_failed', 'Please check the highlighted fields.', { fields: { lines: 'Add at least one budget category before saving.' } });
        sb.lines = lines.map(l => ({ id: 'sbl_' + (++S.seq), categoryId: l.categoryId, amount: Number(l.amount) }));
        sb.incomePlan = (body.incomePlan || []).map(r => ({ id: 'sbl_' + (++S.seq), label: r.label, amount: Number(r.amount) }));
        sb.savingsPlan = (body.savingsPlan || []).map(r => ({ id: 'sbl_' + (++S.seq), label: r.label, amount: Number(r.amount) }));
      }
      sb.updatedAt = now(); return ok(shapeSaved(sb));
    }
    if (p === 'saved-budgets/delete.php') { S.savedBudgets = S.savedBudgets.filter(x => x.id !== id); return { status: 200, body: { ok: true, data: null } }; }
    if (p === 'saved-budgets/load.php') {
      const sb = S.savedBudgets.find(x => x.id === id); if (!sb) return err(404, 'not_found', 'That saved budget could not be found.');
      const b = ensureBudget(body.month);
      b.lines = sb.lines.map(l => ({ id: 'bl_' + (++S.seq), categoryId: l.categoryId, amount: l.amount }));
      b.incomePlan = sb.incomePlan.map(r => ({ id: 'ip_' + (++S.seq), label: r.label, amount: r.amount }));
      b.savingsPlan = sb.savingsPlan.map(r => ({ id: 'sp_' + (++S.seq), label: r.label, amount: r.amount }));
      return ok({ budget: clone(b), savedBudgetId: sb.id, name: sb.name });
    }

    /* ---------- accounts (create only; used by the onboarding pass) ---------- */
    if (p === 'accounts/create.php') {
      if (!body.name || !String(body.name).trim()) return err(422, 'validation_failed', 'Please check the highlighted fields.', { fields: { name: 'Enter an account name.' } });
      const row = { id: body.id || 'a_' + (++S.seq), name: String(body.name).trim(), type: body.type || 'cash', openingBalance: body.openingBalance || 0,
        color: body.color || '#1a73e8', note: body.note || '', archived: false };
      S.accounts.push(row); return ok(row);
    }

    /* ---------- grocery items ---------- */
    if (p === 'grocery/create.php') {
      if (!body.name || !String(body.name).trim()) return err(422, 'validation_failed', 'Please check the highlighted fields.', { fields: { name: 'Enter an item name.' } });
      const row = { id: body.id || 'gro_' + (++S.seq), name: String(body.name).trim(), categoryId: body.categoryId || null,
        price: null, checked: false, checkedAt: null, createdAt: new Date(Date.now() + (S.seq++)).toISOString() };
      S.grocery.push(row); return ok(clone(row), 201);
    }
    if (p === 'grocery/update.php') {
      if (S.failUpdate) return err(500, 'server_error', 'Boom');
      const g = S.grocery.find(x => x.id === id); if (!g) return err(404, 'not_found', 'That grocery item could not be found.');
      if ('name' in body) g.name = body.name;
      if ('categoryId' in body) g.categoryId = body.categoryId;
      const checked = 'checked' in body ? !!body.checked : g.checked;
      let price = 'price' in body ? body.price : g.price;
      if (!checked) price = null;
      else if (price == null || Number(price) <= 0) return err(422, 'validation_failed', 'Please check the highlighted fields.', { fields: { price: 'Enter the price you paid for this item.' } });
      g.checked = checked; g.price = price == null ? null : Number(price);
      g.checkedAt = checked ? (g.checkedAt || now()) : null;
      return ok(clone(g));
    }
    if (p === 'grocery/delete.php') { S.grocery = S.grocery.filter(x => x.id !== id); return { status: 200, body: { ok: true, data: null } }; }
    if (p === 'grocery/clear.php') {
      const n = S.grocery.length; S.grocery = [];      // templates and transactions are untouched
      return ok({ cleared: n });
    }
    if (p === 'grocery/submit.php') {
      if (S.failSubmit) return err(500, 'server_error', S.failSubmit);
      const created = []; const backup = JSON.stringify(S.grocery);
      try {
        for (const [i, line] of body.items.entries()) {
          const g = S.grocery.find(x => x.id === line.id);
          if (!g) throw { s: 409, c: 'grocery_changed', m: 'Your grocery list changed (it may already have been submitted). Reload it and try again.' };
          const cid = line.categoryId || g.categoryId;
          if (!cid) throw { s: 422, c: 'validation_failed', m: 'Please check the highlighted fields.', d: { fields: { [`items.${i}.categoryId`]: 'Choose a category.' } } };
          if (!g.checked) throw { s: 422, c: 'validation_failed', m: 'Please check the highlighted fields.', d: { fields: { [`items.${i}.amount`]: 'Buy this item first so it has a price.' } } };
          const amount = line.amount != null ? Number(line.amount) : g.price;
          if (!(amount > 0)) throw { s: 422, c: 'validation_failed', m: 'Please check the highlighted fields.', d: { fields: { [`items.${i}.amount`]: 'This item has no purchase price. Buy it first, or remove it.' } } };
          created.push({ id: 'tx_' + (++S.seq), type: 'expense', amount, date: body.date, description: g.name, categoryId: cid,
            accountId: body.accountId, method: body.method || 'Cash', notes: 'Live Grocery List', createdAt: now() });
          S.grocery = S.grocery.filter(x => x.id !== line.id);
        }
      } catch (e) { S.grocery = JSON.parse(backup); return err(e.s, e.c, e.m, e.d); }
      S.transactions.push(...created);
      return ok({ transactions: created, submitted: created.length });
    }

    /* ---------- saved grocery lists ---------- */
    if (p === 'grocery-lists/list.php') return ok(clone(S.groceryLists));
    if (p === 'grocery-lists/create.php') {
      const items = body.items || [];
      if (!items.length) return err(422, 'validation_failed', 'Please check the highlighted fields.', { fields: { items: 'Add at least one item before saving.' } });
      const row = { id: body.id || 'grl_' + (++S.seq), name: String(body.name || '').trim() || 'grocery-list',
        items: items.map((it, i) => ({ id: it.id || 'gri_' + (++S.seq), name: it.name, categoryId: it.categoryId || null, position: i })),
        createdAt: now(), updatedAt: now() };
      S.groceryLists.push(row); return ok(clone(row), 201);
    }
    if (p === 'grocery-lists/update.php') {
      const l = S.groceryLists.find(x => x.id === id); if (!l) return err(404, 'not_found', 'That saved grocery list could not be found.');
      if ('name' in body && String(body.name || '').trim()) l.name = String(body.name).trim();
      if (body.items) {
        if (!body.items.length) return err(422, 'validation_failed', 'Please check the highlighted fields.', { fields: { items: 'Add at least one item before saving.' } });
        l.items = body.items.map((it, i) => ({ id: it.id || 'gri_' + (++S.seq), name: it.name, categoryId: it.categoryId || null, position: i }));
      }
      l.updatedAt = now(); return ok(clone(l));
    }
    if (p === 'grocery-lists/delete.php') { S.groceryLists = S.groceryLists.filter(x => x.id !== id); return { status: 200, body: { ok: true, data: null } }; }
    if (p === 'grocery-lists/load.php') {
      const l = S.groceryLists.find(x => x.id === id); if (!l) return err(404, 'not_found', 'That saved grocery list could not be found.');
      if (body.replace !== false) S.grocery = [];
      l.items.forEach((it, i) => S.grocery.push({ id: 'gro_' + (++S.seq), name: it.name, categoryId: it.categoryId,
        price: null, checked: false, checkedAt: null, createdAt: new Date(Date.now() + i).toISOString() }));
      return ok({ grocery: clone(S.grocery), listId: l.id, name: l.name });
    }

    /* ---------- notifications (current user = id 1) ---------- */
    const rk = uid => (S.receipts[uid] = S.receipts[uid] || {});
    const inbox = (uid = 1) => {
      const r = rk(uid);
      const feed = S.feed.map(a => ({ id: a.id, source: 'feed', kind: 'announcement', type: a.type, title: a.title, description: a.description || '',
        details: '', route: a.route || '', url: '', createdAt: a.created_at, read: !!r[a.id] }));
      const adm = S.posts.filter(x => x.audience === 'all' || (S.deliveries[x.id] || []).includes(uid)).map(x => ({ id: x.id, source: 'admin', kind: x.kind,
        type: x.type, title: x.title, description: x.body, details: x.details || '', route: /^[a-z-]{1,30}$/.test(x.link || '') ? x.link : '',
        url: /^https?:/.test(x.link || '') ? x.link : '', createdAt: x.createdAt, read: !!r[x.id] }));
      return adm.concat(feed).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    };
    if (p === 'notifications/list.php') { if (S.failNotif) return err(500, 'server_error', 'boom'); return ok(inbox()); }
    if (p === 'notifications/read.php') {
      if (S.failNotif) return err(500, 'server_error', 'boom');
      const visible = inbox().map(x => x.id);
      if (body.all === true) visible.forEach(x => { rk(1)[x] = true; });
      else { if (!Array.isArray(body.ids) || !body.ids.length) return err(422, 'validation_failed', 'Please check the highlighted fields.');
        body.ids.forEach(x => { if (visible.includes(x)) rk(1)[x] = true; }); }
      return ok(inbox());
    }

    /* ---------- Super Admin (api_admin_guard → 403 for normal users) ---------- */
    if (p.startsWith('admin/')) {
      if (!S.isAdmin) return err(403, 'forbidden', 'You do not have permission to do that.');
      const out = x => ({ ...clone(x), route: /^[a-z-]{1,30}$/.test(x.link || '') ? x.link : '', url: /^https?:/.test(x.link || '') ? x.link : '',
        readCount: Object.values(S.receipts).filter(r => r[x.id]).length,
        recipients: x.audience === 'selected' ? (S.deliveries[x.id] || []).map(id => { const u = S.users.find(v => v.id === id); return { id, email: u.email, displayName: u.displayName }; }) : undefined });
      if (p === 'admin/overview.php') return ok({ stats: { users: S.users.length, active: S.users.filter(u => u.status === 'active').length, admins: 1,
        messages: S.posts.filter(x => x.kind === 'message').length, news: S.posts.filter(x => x.kind === 'news').length },
        posts: S.posts.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(out) });
      if (p === 'admin/users.php') { const q = (u.searchParams.get('q') || '').toLowerCase();
        return ok(S.users.filter(x => !q || x.email.includes(q) || (x.displayName || '').toLowerCase().includes(q))); }
      if (p === 'admin/posts/create.php') {
        const types = body.kind === 'news' ? ['feature', 'update', 'announcement'] : ['message', 'important', 'announcement'];
        const fields = {};
        if (!types.includes(body.type)) fields.type = 'Please choose one of the available options.';
        if (!String(body.title || '').trim()) fields.title = 'This field is required.';
        if (!String(body.body || '').trim()) fields.body = 'This field is required.';
        const aud = body.kind === 'news' ? 'all' : body.audience;
        let ids = [];
        if (aud === 'selected') { ids = (body.userIds || []).filter(id => S.users.some(x => x.id === id && x.status === 'active')); if (!ids.length) fields.userIds = 'Choose at least one active user.'; }
        if (body.link && !/^[a-z-]{1,30}$/.test(body.link) && !/^https?:\/\/\S+$/.test(body.link)) fields.link = 'Use a page name such as "goals" or a full https:// link.';
        if (Object.keys(fields).length) return err(422, 'validation_failed', 'Please check the highlighted fields.', { fields });
        const x = { id: 'adm_' + (++S.seq), kind: body.kind, type: body.type, title: body.title.trim(), body: body.body.trim(), details: body.details || '',
          link: body.link || '', audience: aud, recipientCount: aud === 'all' ? S.users.filter(v => v.status === 'active').length : ids.length,
          author: 't@t.co', createdAt: new Date(Date.now() + S.seq).toISOString() };
        S.posts.push(x); if (aud === 'selected') S.deliveries[x.id] = ids;
        return ok(out(x), 201);
      }
      const x = S.posts.find(v => v.id === id);
      if (!x) return err(404, 'not_found', 'That item could not be found.');
      if (p === 'admin/posts/update.php') { ['type', 'title', 'body', 'details', 'link'].forEach(k => { if (k in body) x[k] = body[k] || ''; }); return ok(out(x)); }
      if (p === 'admin/posts/delete.php') { S.posts = S.posts.filter(v => v !== x); delete S.deliveries[x.id]; Object.values(S.receipts).forEach(r => delete r[x.id]); return ok(null); }
    }

    return err(404, 'not_found', 'No mock for ' + p);
  };

  window.MockServer = S;
  const realFetch = window.fetch.bind(window);
  // The real server reads assets/data/announcements.json; so does the mock.
  S.feedReady = realFetch('/assets/data/announcements.json', { cache: 'no-store' }).then(r => r.json())
    .then(j => { S.feed = (j.announcements || []).filter(a => a && a.id && a.title); }).catch(() => { S.feed = []; });
  window.fetch = async (url, opts = {}) => {
    // Static site files (e.g. assets/data/announcements.json) are served for real.
    if (/(^|\/)assets\//.test(String(url))) return realFetch(url, opts);
    if (/notifications\//.test(String(url))) await S.feedReady;
    if (S.latency) await new Promise(r => setTimeout(r, S.latency));
    const body = opts.body ? JSON.parse(opts.body) : null;
    const r = S.handle(String(url), opts.method || 'GET', body);
    return { ok: r.status < 400, status: r.status, text: async () => JSON.stringify(r.body) };
  };
  try { localStorage.clear(); localStorage.setItem('bp_onboarding_completed', '1'); } catch (e) {}
})();
