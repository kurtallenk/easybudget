/* ============================================================
   12 · NOTIFICATIONS - website-wide announcements inbox
   Sources (merged by the server, newest first):
     · assets/data/announcements.json - static feed shipped with the
       site. To publish, add an entry at the top: { id, type:
       feature|update|announcement|important, title, description,
       created_at, route? }
     · Super Admin messages and News & Updates (admin_posts table).
   Read state is stored in the database per user (existing
   `notifications` table) through api/notifications/*.php, so it is the
   same on every browser and device. If the API is unreachable the
   inbox falls back to the static feed + this browser's localStorage
   (bp_notif_read_<userId>, the Round 9 behaviour). No financial data
   is touched.
   ============================================================ */
const Notifications = (() => {
  const { esc, icon, fdate, relDate } = Core;
  const URL = 'assets/data/announcements.json';
  const TYPES = {
    feature: { label: 'New feature', tone: 'blue', icon: 'sparkle' },
    update: { label: 'Update', tone: 'green', icon: 'upload' },
    announcement: { label: 'Announcement', tone: 'gray', icon: 'info' },
    important: { label: 'Important', tone: 'red', icon: 'alert' },
    message: { label: 'Message', tone: 'amber', icon: 'inbox' }
  };
  let items = [], loaded = false, filter = 'all', mode = 'server';

  const key = () => { const u = Store.user && Store.user(); return 'bp_notif_read_' + ((u && u.id) || 'local'); };
  const readSet = () => { try { return new Set(JSON.parse(localStorage.getItem(key()) || '[]')); } catch { return new Set(); } };
  const saveRead = s => { try { localStorage.setItem(key(), JSON.stringify([...s])); } catch {} };

  const safeUrl = u => (typeof u === 'string' && /^https?:\/\//i.test(u) ? u : '');
  const valid = a => a && typeof a.id === 'string' && a.id && typeof a.title === 'string' && a.title.trim();
  const normalize = a => ({ id: a.id, type: TYPES[a.type] ? a.type : 'announcement', title: String(a.title).trim(),
    description: String(a.description || '').trim(), details: String(a.details || '').trim(),
    createdAt: String(a.createdAt || a.created_at || ''), route: a.route || '', url: safeUrl(a.url),
    source: a.source || 'feed', read: a.read === true });
  const stamp = a => { const t = Date.parse(a.createdAt); return isNaN(t) ? 0 : t; };
  const setItems = rows => { items = (Array.isArray(rows) ? rows : []).filter(valid).map(normalize).sort((a, b) => stamp(b) - stamp(a)); };

  /** Round 9 read state saved in this browser → copied to the account once, then removed. */
  const migrateLocal = async () => {
    let old; try { old = localStorage.getItem(key()); } catch { return; }
    if (!old) return;
    const ids = readSet(); const todo = items.filter(a => !a.read && ids.has(a.id)).map(a => a.id);
    try { if (todo.length) setItems(await Api.notifications.read(todo)); localStorage.removeItem(key()); } catch {}
  };

  /** Loads the inbox (call again with force to refresh). Never throws. */
  const load = async (force) => {
    if (loaded && !force) return items;
    try {
      setItems(await Api.notifications.list());
      mode = 'server';
      await migrateLocal();
    } catch (e) {
      // API unavailable (offline / not deployed yet): static feed + this browser's read state.
      try {
        const r = await fetch(URL, { cache: 'no-store', credentials: 'same-origin' });
        const j = r.ok ? await r.json() : {};
        const rs = readSet();
        setItems((Array.isArray(j) ? j : j.announcements || []).map(a => ({ ...a, read: rs.has(a.id) })));
      } catch { items = []; }
      mode = 'local';
    }
    loaded = true;
    return items;
  };
  const list = () => items.map(a => ({ ...a }));
  const unreadCount = () => items.filter(a => !a.read).length;

  /** Optimistic: the UI updates at once, the database is the source of truth. */
  const persist = async (call, ids) => {
    if (mode === 'local') { const r = readSet(); ids.forEach(id => r.add(id)); saveRead(r); return; }
    try {
      const before = unreadCount(); setItems(await call());
      if (unreadCount() !== before && typeof App !== 'undefined' && App.state.route !== 'admin') App.render();
    }
    catch (e) {
      items.forEach(a => { if (ids.includes(a.id)) a.read = false; });
      if (!(e && e.isAuth)) UI.toast('Could not update notifications', (e && e.message) || 'Please try again.', 'error');
      if (typeof App !== 'undefined') App.render();
    }
  };
  const markRead = id => {
    const a = items.find(x => x.id === id); if (!a || a.read) return Promise.resolve();
    a.read = true;
    return persist(() => Api.notifications.read([id]), [id]);
  };
  const markAll = () => {
    const ids = items.filter(a => !a.read).map(a => a.id); if (!ids.length) return Promise.resolve();
    items.forEach(a => { a.read = true; });
    return persist(() => Api.notifications.readAll(), ids);
  };

  const when = iso => {
    const d = iso.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return '';
    const t = iso.length > 10 ? new Date(iso) : null;
    const time = t && !isNaN(t) ? t.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
    const rel = typeof relDate === 'function' ? relDate(d) : fdate(d);
    return `${rel}${time ? ` · ${time}` : ''}`;
  };

  const card = a => {
    const t = TYPES[a.type];
    return `<li class="ntf-item${a.read ? '' : ' unread'}" data-ntf="${esc(a.id)}">
      <button type="button" class="ntf-open" data-action="ntf-open" data-arg="${esc(a.id)}" aria-label="${esc(`${a.read ? '' : 'Unread. '}${t.label}: ${a.title}`)}">
        <span class="ntf-dot" aria-hidden="true"></span>
        <span class="ntf-ico ${t.tone}" aria-hidden="true">${icon(t.icon, 16)}</span>
        <span class="ntf-main">
          <span class="ntf-meta"><span class="badge ${t.tone} ntf-type">${esc(t.label)}</span><time class="ntf-time" datetime="${esc(a.createdAt)}">${esc(when(a.createdAt))}</time></span>
          <span class="ntf-title">${esc(a.title)}</span>
          ${a.description ? `<span class="ntf-desc">${esc(a.description)}</span>` : ''}
          ${a.details ? `<span class="ntf-desc ntf-details">${esc(a.details)}</span>` : ''}
          ${a.route ? `<span class="ntf-link">Open ${esc(a.route)} ${icon('chevR', 13)}</span>` : a.url ? `<span class="ntf-link">Open link ${icon('chevR', 13)}</span>` : ''}
        </span>
      </button>
    </li>`;
  };

  const view = {
    title: 'Notifications',
    subtitle: () => { const n = unreadCount(); return n ? `${n} unread update${n === 1 ? '' : 's'}` : 'Updates from Easy Budget Planner'; },
    render(host) {
      if (!loaded) { host.innerHTML = UI.skeletonCards(2); load().then(() => App.render()); return; }
      const all = list(), unread = all.filter(a => !a.read).length;
      const shown = filter === 'unread' ? all.filter(a => !a.read) : all;
      host.innerHTML = `
        <section class="card ntf" aria-labelledby="ntf-h">
          <div class="card-head"><h2 id="ntf-h">Inbox</h2>${unread ? `<span class="badge blue">${unread} unread</span>` : ''}
            <span class="spacer"></span>
            <button type="button" class="btn btn-sm" data-action="ntf-all" ${unread ? '' : 'disabled'}>${icon('check', 14)}Mark all as read</button></div>
          <div class="ntf-filters chips" role="group" aria-label="Show">
            ${[['all', 'All'], ['unread', 'Unread']].map(([k, l]) => `<button class="chip" data-action="ntf-filter" data-arg="${k}" aria-pressed="${filter === k}">${l}${k === 'unread' && unread ? ` · ${unread}` : ''}</button>`).join('')}
          </div>
          ${shown.length ? `<ul class="ntf-list">${shown.map(card).join('')}</ul>`
            : UI.emptyState({ icon: 'inbox', title: filter === 'unread' ? 'You\u2019re all caught up' : 'No notifications yet',
                desc: filter === 'unread' ? 'There are no unread updates.' : 'Website updates and announcements will appear here.' })}
        </section>`;
    }
  };

  const open = id => {
    const a = items.find(x => x.id === id); if (!a) return;
    markRead(id);
    if (a.route && a.route !== 'inbox') App.go(a.route);
    else { if (a.url) window.open(a.url, '_blank', 'noopener,noreferrer'); App.render(); }
  };
  const setFilter = f => { filter = f === 'unread' ? 'unread' : 'all'; App.render(); };
  const readAll = () => { markAll(); UI.toast('All notifications marked as read'); App.render(); };

  return { TYPES, load, list, unreadCount, markRead, markAll, view, open, setFilter, readAll, mode: () => mode };
})();
