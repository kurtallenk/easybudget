/* ============================================================
   13 · SUPER ADMIN - Messages and News & Updates
   Route `admin`, listed in the sidebar only when the server flags the
   account as Super Admin (Auth::user().isSuperAdmin). That flag is a
   presentation hint: every call below goes to api/admin/*.php, which
   re-checks users.role in the database and answers 403 otherwise.
   Created items are stored in admin_posts and delivered through the
   existing Notifications inbox (no second notification system).
   ============================================================ */
const Admin = (() => {
  const { esc, icon, $, $$, fdate } = Core;
  const F = UI.fieldHTML;
  const TABS = [['dashboard', 'Dashboard', 'dashboard'], ['users', 'Users', 'users'], ['messages', 'Messages', 'send'], ['news', 'News & Updates', 'megaphone']];
  const MSG_TYPES = [['message', 'Message'], ['important', 'Important'], ['announcement', 'Announcement']];
  const NEWS_TYPES = [['feature', 'New feature'], ['update', 'System update'], ['announcement', 'Announcement']];

  let tab = 'dashboard', data = null, loading = false, denied = false, loadError = '';
  let users = null, usersQ = '', usersLoading = false;
  let audience = 'all';
  const picked = new Map();                        // user id -> label (survives searches)
  const drafts = { m: { type: 'message', title: '', body: '' }, n: { type: 'feature', title: '', body: '', details: '', link: '' } };

  const isAdmin = () => !!(Store.user() && Store.user().isSuperAdmin);
  const userLabel = u => u.displayName ? `${u.displayName} (${u.email})` : u.email;
  const dateOf = iso => (iso ? fdate(String(iso).slice(0, 10)) : '-');
  const typeLabel = (kind, t) => ((kind === 'news' ? NEWS_TYPES : MSG_TYPES).find(x => x[0] === t) || [t, t])[1];
  const typeTone = t => (Notifications.TYPES[t] || Notifications.TYPES.announcement).tone;
  const rerender = () => { if (App.state.route === 'admin') App.render(); };

  const refresh = async () => {
    loading = true;
    try { data = await Api.admin.overview(); denied = false; loadError = ''; }
    catch (e) { if (e && e.status === 403) denied = true; else loadError = (e && e.message) || 'Could not load the admin data.'; }
    loading = false; rerender();
  };
  const loadUsers = async q => {
    usersLoading = true;
    try { users = await Api.admin.users(q || ''); usersQ = q || ''; } catch (e) { if (e && e.status === 403) denied = true; users = users || []; }
    usersLoading = false;
  };

  /* ---------- pieces ---------- */
  const deniedHTML = () => `<section class="card card-pad">${UI.emptyState({ icon: 'shield', title: 'Super Admin access required',
    desc: 'This area is only available to Super Admin accounts.' })}<div class="row" style="justify-content:center;padding-bottom:18px"><button class="btn" data-action="go" data-arg="dashboard">Back to dashboard</button></div></section>`;

  const audienceText = p => p.audience === 'all' ? `All users (${p.recipientCount})` : `${p.recipientCount} user${p.recipientCount === 1 ? '' : 's'}`;
  const postRow = p => `
    <li class="adm-post" data-post="${esc(p.id)}">
      <div class="adm-post-main">
        <div class="adm-post-meta"><span class="badge ${typeTone(p.type)}">${esc(typeLabel(p.kind, p.type))}</span>
          <span>${p.kind === 'news' ? 'Published' : 'Sent'}: ${esc(dateOf(p.createdAt))}</span></div>
        <div class="adm-post-title">${esc(p.title)}</div>
        <div class="adm-post-sub">Recipients: ${esc(audienceText(p))} · Read by ${p.readCount}</div>
      </div>
      <div class="adm-post-actions">
        <button type="button" class="btn btn-sm" data-adm="view" data-id="${esc(p.id)}">View</button>
        <button type="button" class="btn btn-sm" data-adm="edit" data-id="${esc(p.id)}">${icon('edit', 14)}Edit</button>
        <button type="button" class="btn btn-sm btn-danger-ghost" data-adm="delete" data-id="${esc(p.id)}">${icon('trash', 14)}Delete</button>
      </div>
    </li>`;
  const postList = (kind, emptyTitle) => {
    const rows = (data.posts || []).filter(p => p.kind === kind);
    return rows.length ? `<ul class="adm-posts">${rows.map(postRow).join('')}</ul>`
      : UI.emptyState({ icon: kind === 'news' ? 'megaphone' : 'send', title: emptyTitle, desc: 'Items you create appear here.', compact: true });
  };

  const dashboardHTML = () => {
    const s = data.stats;
    const recent = (data.posts || []).slice(0, 5);
    return `
      <div class="grid g-stats">
        ${UI.statCard({ label: 'Users', value: String(s.users), iconName: 'users', tone: 'blue', sub: `${s.active} active` })}
        ${UI.statCard({ label: 'Super Admins', value: String(s.admins), iconName: 'shield', tone: 'red' })}
        ${UI.statCard({ label: 'Messages sent', value: String(s.messages), iconName: 'send', tone: 'amber' })}
        ${UI.statCard({ label: 'News & Updates', value: String(s.news), iconName: 'megaphone', tone: 'green' })}
      </div>
      <section class="card" aria-labelledby="adm-recent-h">
        <div class="card-head"><h2 id="adm-recent-h">Recent activity</h2><span class="spacer"></span>
          <button type="button" class="btn btn-sm" data-adm="tab" data-id="messages">${icon('send', 14)}New message</button>
          <button type="button" class="btn btn-sm btn-primary" data-adm="tab" data-id="news">${icon('megaphone', 14)}Publish update</button></div>
        ${recent.length ? `<ul class="adm-posts">${recent.map(postRow).join('')}</ul>`
          : UI.emptyState({ icon: 'inbox', title: 'Nothing sent yet', desc: 'Messages and News & Updates you create will be listed here.', compact: true })}
      </section>`;
  };

  const usersTable = () => {
    if (users === null || usersLoading) return '<div class="card-pad"><div class="sk" style="height:14px;width:60%"></div></div>';
    if (!users.length) return UI.emptyState({ icon: 'users', title: 'No users found', desc: usersQ ? 'Try a different search.' : 'No accounts yet.', compact: true });
    return `<div class="tbl-wrap"><table class="tbl adm-users"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Joined</th><th>Last sign-in</th></tr></thead><tbody>
      ${users.map(u => `<tr>
        <td data-label="Name">${esc(u.displayName || '-')}</td><td data-label="Email" class="adm-email">${esc(u.email)}</td>
        <td data-label="Role">${u.role === 'super_admin' ? '<span class="badge red">Super Admin</span>' : '<span class="badge gray">User</span>'}</td>
        <td data-label="Status"><span class="badge ${u.status === 'active' ? 'green' : 'amber'}">${esc(u.status)}</span></td>
        <td data-label="Joined">${esc(dateOf(u.createdAt))}</td><td data-label="Last sign-in">${esc(u.lastLoginAt ? dateOf(u.lastLoginAt) : 'Never')}</td></tr>`).join('')}
      </tbody></table></div>`;
  };
  const usersHTML = () => `
    <section class="card" aria-labelledby="adm-users-h">
      <div class="card-head"><h2 id="adm-users-h">Users</h2><span class="sub">${users ? `${users.length} shown` : ''}</span></div>
      <div class="card-pad adm-search"><label class="sr-only" for="adm-users-q">Search users</label>
        <input class="input" id="adm-users-q" type="search" placeholder="Search users by name or email…" value="${esc(usersQ)}" autocomplete="off"></div>
      <div id="adm-users-body">${usersTable()}</div>
    </section>`;

  const pickListHTML = () => {
    if (users === null || usersLoading) return '<div class="adm-pick-empty">Loading users…</div>';
    if (!users.length) return '<div class="adm-pick-empty">No users match your search.</div>';
    return users.map(u => `<label class="adm-pick-item"><input type="checkbox" data-pick="${u.id}" data-label="${esc(userLabel(u))}" ${picked.has(u.id) ? 'checked' : ''} ${u.status !== 'active' ? 'disabled' : ''}>
      <span class="adm-pick-name">${esc(u.displayName || u.email)}</span>${u.displayName ? `<span class="adm-pick-mail">${esc(u.email)}</span>` : ''}${u.status !== 'active' ? '<span class="badge amber">inactive</span>' : ''}</label>`).join('');
  };
  const pickedHTML = () => picked.size
    ? `<span class="adm-picked-n">${picked.size} selected</span>${[...picked].slice(0, 8).map(([id, l]) => `<button type="button" class="chip adm-chip" data-adm="unpick" data-id="${id}" aria-label="Remove ${esc(l)}">${esc(l)} ${icon('close', 12)}</button>`).join('')}${picked.size > 8 ? `<span class="adm-picked-n">+${picked.size - 8} more</span>` : ''}`
    : '<span class="adm-picked-n">No users selected</span>';

  const messagesHTML = () => `
    <div class="adm-cols">
      <section class="card" aria-labelledby="adm-msg-h">
        <div class="card-head"><h2 id="adm-msg-h">Create message</h2></div>
        <form class="card-pad adm-form" id="adm-msg-form" novalidate>
          <fieldset class="adm-fieldset field" data-field="audience"><legend>Send to</legend>
            <div class="adm-radios">
              <label class="adm-radio"><input type="radio" name="audience" value="all" ${audience === 'all' ? 'checked' : ''}><span>All users</span></label>
              <label class="adm-radio"><input type="radio" name="audience" value="selected" ${audience === 'selected' ? 'checked' : ''}><span>Specific users</span></label>
            </div></fieldset>
          ${audience === 'selected' ? `<div class="field adm-picker" data-field="userIds">
            <label for="adm-pick-q">Recipients<span class="req" aria-hidden="true">*</span></label>
            <input class="input" id="adm-pick-q" type="search" placeholder="Search users…" value="${esc(usersQ)}" autocomplete="off">
            <div class="adm-pick-list" id="adm-pick-list" role="group" aria-label="Users">${pickListHTML()}</div>
            <div class="adm-picked" id="adm-picked">${pickedHTML()}</div>
            <span class="err" role="alert"></span></div>` : ''}
          ${F({ name: 'type', label: 'Message type', type: 'select', value: drafts.m.type, options: MSG_TYPES.map(([v, l]) => ({ value: v, label: l })), idPrefix: 'adm_m', attrs: 'data-draft="m"' })}
          ${F({ name: 'title', label: 'Title', value: drafts.m.title, required: true, placeholder: 'e.g. Budget system maintenance', idPrefix: 'adm_m', attrs: 'maxlength="120" data-draft="m"' })}
          ${F({ name: 'body', label: 'Message', type: 'textarea', value: drafts.m.body, rows: 4, required: true, placeholder: 'What should users know?', idPrefix: 'adm_m', attrs: 'maxlength="500" data-draft="m"' })}
          <div class="adm-form-foot"><button type="submit" class="btn btn-primary" id="adm-msg-send">${icon('send', 15)}Send Message</button></div>
        </form>
      </section>
      <section class="card" aria-labelledby="adm-msgs-h">
        <div class="card-head"><h2 id="adm-msgs-h">Messages</h2></div>
        ${postList('message', 'No messages sent yet')}
      </section>
    </div>`;

  const newsHTML = () => `
    <div class="adm-cols">
      <section class="card" aria-labelledby="adm-news-h">
        <div class="card-head"><h2 id="adm-news-h">Create News / Update</h2><span class="sub">Delivered to all users</span></div>
        <form class="card-pad adm-form" id="adm-news-form" novalidate>
          ${F({ name: 'type', label: 'Type', type: 'select', value: drafts.n.type, options: NEWS_TYPES.map(([v, l]) => ({ value: v, label: l })), idPrefix: 'adm_n', attrs: 'data-draft="n"' })}
          ${F({ name: 'title', label: 'Title', value: drafts.n.title, required: true, placeholder: 'e.g. NEW FEATURE ADDED', idPrefix: 'adm_n', attrs: 'maxlength="120" data-draft="n"' })}
          ${F({ name: 'body', label: 'Short description', value: drafts.n.body, required: true, placeholder: 'e.g. Savings Goals have been improved.', idPrefix: 'adm_n', attrs: 'maxlength="500" data-draft="n"' })}
          ${F({ name: 'details', label: 'Optional details', type: 'textarea', value: drafts.n.details, rows: 3, idPrefix: 'adm_n', attrs: 'maxlength="2000" data-draft="n"' })}
          ${F({ name: 'link', label: 'Optional link', value: drafts.n.link, placeholder: 'goals  or  https://…', hint: 'A page name (e.g. goals, budget) or a full https:// link.', idPrefix: 'adm_n', attrs: 'maxlength="500" data-draft="n"' })}
          <div class="adm-form-foot"><button type="submit" class="btn btn-primary" id="adm-news-send">${icon('megaphone', 15)}Publish</button></div>
        </form>
      </section>
      <section class="card" aria-labelledby="adm-newss-h">
        <div class="card-head"><h2 id="adm-newss-h">News & Updates</h2></div>
        ${postList('news', 'Nothing published yet')}
      </section>
    </div>`;

  /* ---------- actions ---------- */
  const submitMessage = async form => {
    const errors = {};
    if (!drafts.m.title.trim()) errors.title = 'Please add a title.';
    if (!drafts.m.body.trim()) errors.body = 'Please write a message.';
    if (audience === 'selected' && !picked.size) errors.userIds = 'Choose at least one user.';
    if (UI.showErrors(form, errors)) return;
    const btn = $('#adm-msg-send'); btn.disabled = true;
    try {
      const p = await Api.admin.create({ kind: 'message', type: drafts.m.type, title: drafts.m.title.trim(), body: drafts.m.body.trim(),
        audience, userIds: audience === 'selected' ? [...picked.keys()] : [] });
      UI.toast('Message sent', `Delivered to ${audienceText(p)}.`);
      drafts.m = { type: 'message', title: '', body: '' }; picked.clear();
      await Promise.all([refresh(), Notifications.load(true)]); rerender();
    } catch (e) { btn.disabled = false; if (!UI.showErrors(form, e.fields)) UI.toast('Message not sent', e.message, 'error'); }
  };
  const submitNews = async form => {
    const errors = {};
    if (!drafts.n.title.trim()) errors.title = 'Please add a title.';
    if (!drafts.n.body.trim()) errors.body = 'Please add a short description.';
    if (UI.showErrors(form, errors)) return;
    const btn = $('#adm-news-send'); btn.disabled = true;
    try {
      await Api.admin.create({ kind: 'news', type: drafts.n.type, title: drafts.n.title.trim(), body: drafts.n.body.trim(),
        details: drafts.n.details.trim() || null, link: drafts.n.link.trim() || null });
      UI.toast('Published', 'All users will see it in their Notifications.');
      drafts.n = { type: 'feature', title: '', body: '', details: '', link: '' };
      await Promise.all([refresh(), Notifications.load(true)]); rerender();
    } catch (e) { btn.disabled = false; if (!UI.showErrors(form, e.fields)) UI.toast('Not published', e.message, 'error'); }
  };

  const findPost = id => (data && data.posts || []).find(p => p.id === id);
  const viewPost = p => UI.modal({ title: p.title, subtitle: `${typeLabel(p.kind, p.type)} · ${p.kind === 'news' ? 'Published' : 'Sent'} ${dateOf(p.createdAt)}`, size: 'sm',
    body: `<div class="adm-view">
      <p>${esc(p.body)}</p>${p.details ? `<p class="adm-view-details">${esc(p.details)}</p>` : ''}
      <dl><dt>Recipients</dt><dd>${esc(audienceText(p))}</dd><dt>Read by</dt><dd>${p.readCount}</dd>
      ${p.link ? `<dt>Link</dt><dd class="adm-email">${esc(p.link)}</dd>` : ''}${p.author ? `<dt>Created by</dt><dd class="adm-email">${esc(p.author)}</dd>` : ''}</dl>
      ${p.recipients && p.recipients.length ? `<div class="adm-view-rcpt">${p.recipients.map(r => `<span class="badge gray">${esc(r.displayName || r.email)}</span>`).join(' ')}</div>` : ''}
    </div>`,
    footer: (() => { const f = Core.el('div', { class: 'row', style: 'width:100%' }); f.innerHTML = '<span class="spacer"></span>';
      f.appendChild(Core.el('button', { class: 'btn', type: 'button', onclick: () => UI.closeTop() }, 'Close')); return f; })() });
  const editPost = p => {
    const types = p.kind === 'news' ? NEWS_TYPES : MSG_TYPES;
    const form = Core.el('form', { novalidate: 'true', id: 'adm-edit-form' });
    form.innerHTML = `<div class="form-grid">
      <div class="full">${F({ name: 'type', label: 'Type', type: 'select', value: p.type, options: types.map(([v, l]) => ({ value: v, label: l })), idPrefix: 'adm_e' })}</div>
      <div class="full">${F({ name: 'title', label: 'Title', value: p.title, required: true, idPrefix: 'adm_e', attrs: 'maxlength="120"' })}</div>
      <div class="full">${F({ name: 'body', label: p.kind === 'news' ? 'Short description' : 'Message', type: 'textarea', rows: 3, value: p.body, idPrefix: 'adm_e', attrs: 'maxlength="500"' })}</div>
      ${p.kind === 'news' ? `<div class="full">${F({ name: 'details', label: 'Optional details', type: 'textarea', rows: 3, value: p.details, idPrefix: 'adm_e', attrs: 'maxlength="2000"' })}</div>
      <div class="full">${F({ name: 'link', label: 'Optional link', value: p.link, idPrefix: 'adm_e', attrs: 'maxlength="500"' })}</div>` : ''}
      </div><p class="hint" style="margin-top:10px">Recipients cannot be changed after sending.</p>`;
    const foot = Core.el('div', { class: 'row wrap', style: 'width:100%;gap:9px' });
    foot.innerHTML = '<span class="spacer"></span>';
    foot.appendChild(Core.el('button', { class: 'btn', type: 'button', onclick: () => UI.closeTop() }, 'Cancel'));
    foot.appendChild(Core.el('button', { class: 'btn btn-primary', type: 'submit', form: 'adm-edit-form' }, 'Save changes'));
    UI.modal({ title: p.kind === 'news' ? 'Edit News / Update' : 'Edit message', body: form, footer: foot });
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const v = UI.readForm(form), errors = {};
      if (!v.title) errors.title = 'Please add a title.';
      if (!v.body) errors.body = 'This cannot be empty.';
      if (UI.showErrors(form, errors)) return;
      const patch = { type: v.type, title: v.title, body: v.body };
      if (p.kind === 'news') { patch.details = v.details || null; patch.link = v.link || null; }
      try { await Api.admin.update(p.id, patch); UI.closeTop(); UI.toast('Changes saved'); await Promise.all([refresh(), Notifications.load(true)]); rerender(); }
      catch (err) { if (!UI.showErrors(form, err.fields)) UI.toast('Not saved', err.message, 'error'); }
    });
  };
  const deletePost = p => UI.confirm({ title: `Delete “${p.title}”?`, confirmLabel: 'Delete',
    message: 'It will be removed from every user’s Notifications. This cannot be undone.',
    onConfirm: async () => {
      try { await Api.admin.remove(p.id); UI.toast('Deleted'); await Promise.all([refresh(), Notifications.load(true)]); rerender(); }
      catch (e) { UI.toast('Not deleted', e.message, 'error'); }
    } });

  const bind = host => {
    host.addEventListener('click', e => {
      const b = e.target.closest('[data-adm]'); if (!b) return;
      const act = b.dataset.adm, id = b.dataset.id;
      if (act === 'tab') { tab = id; if (usersQ) { users = null; usersQ = ''; } rerender(); window.scrollTo({ top: 0 }); return; }
      if (act === 'unpick') { picked.delete(Number(id)); const pl = $('#adm-pick-list'); if (pl) pl.innerHTML = pickListHTML(); $('#adm-picked').innerHTML = pickedHTML(); return; }
      const p = findPost(id); if (!p) return;
      if (act === 'view') viewPost(p); else if (act === 'edit') editPost(p); else if (act === 'delete') deletePost(p);
    });
    host.addEventListener('input', e => {
      const t = e.target;
      if (t.dataset && t.dataset.draft) drafts[t.dataset.draft][t.name] = t.value;
    });
    host.addEventListener('change', e => {
      const t = e.target;
      if (t.name === 'audience') { audience = t.value === 'selected' ? 'selected' : 'all'; if (audience === 'selected' && users === null) loadUsers('').then(rerender); rerender(); return; }
      if (t.dataset && t.dataset.pick) { const uid = Number(t.dataset.pick); if (t.checked) picked.set(uid, t.dataset.label); else picked.delete(uid); $('#adm-picked').innerHTML = pickedHTML(); }
      if (t.dataset && t.dataset.draft) drafts[t.dataset.draft][t.name] = t.value;
    });
    const search = (inputId, bodyId, html) => {
      const inp = $('#' + inputId, host); if (!inp) return;
      inp.addEventListener('input', Core.debounce(async () => {
        await loadUsers(inp.value.trim()); const b = $('#' + bodyId); if (b) b.innerHTML = html();
      }, 250));
    };
    search('adm-users-q', 'adm-users-body', usersTable);
    search('adm-pick-q', 'adm-pick-list', pickListHTML);
    const mf = $('#adm-msg-form', host); if (mf) mf.addEventListener('submit', e => { e.preventDefault(); submitMessage(mf); });
    const nf = $('#adm-news-form', host); if (nf) nf.addEventListener('submit', e => { e.preventDefault(); submitNews(nf); });
  };

  const view = {
    title: 'Super Admin',
    subtitle: 'Administration · not visible to regular users',
    render(host) {
      if (!isAdmin() || denied) { host.innerHTML = deniedHTML(); return; }
      if (!data) {
        host.innerHTML = loadError ? `<section class="card card-pad">${UI.emptyState({ icon: 'alert', title: 'Could not load the admin area', desc: loadError })}</section>` : UI.skeletonCards(4);
        if (!loading && !loadError) refresh();
        return;
      }
      if ((tab === 'users' || (tab === 'messages' && audience === 'selected')) && users === null && !usersLoading) loadUsers('').then(rerender);
      const me = Store.user() || {};
      host.innerHTML = `
        <div class="adm">
          <div class="adm-banner" role="note">
            <span class="adm-banner-ico" aria-hidden="true">${icon('shield', 20)}</span>
            <span class="adm-banner-text"><b>Super Admin</b><span>Restricted area · signed in as ${esc(me.email || '')}</span></span>
          </div>
          <nav class="adm-tabs" aria-label="Super Admin sections">
            ${TABS.map(([k, l, ic]) => `<button type="button" class="adm-tab" data-adm="tab" data-id="${k}" ${tab === k ? 'aria-current="page"' : ''}>${icon(ic, 15)}<span>${esc(l)}</span></button>`).join('')}
          </nav>
          ${tab === 'users' ? usersHTML() : tab === 'messages' ? messagesHTML() : tab === 'news' ? newsHTML() : dashboardHTML()}
        </div>`;
      bind(host);
    }
  };

  const setTab = t => { if (TABS.some(x => x[0] === t)) tab = t; };
  return { view, refresh, setTab, _state: () => ({ tab, audience, picked: [...picked.keys()], drafts }) };
})();
