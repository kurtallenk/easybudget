/* Super Admin area · ?only=admin (run.sh: 1280 / 834 / 390 / 320). Mock mirrors api_admin_guard (403 for normal users). */
window.AdminTests = async ({ t, log, tick, $, $$, txt, click, submit, S }) => {
  const W = () => document.documentElement.clientWidth;
  const noOverflow = () => document.documentElement.scrollWidth <= W() + 1;
  const inView = el => { const r = el.getBoundingClientRect(); return r.left >= -0.5 && r.right <= W() + 0.5; };
  const setVal = (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
  const mobile = W() <= 640;
  log(`ADMIN @ ${W()}px`);
  S.posts = []; S.deliveries = {}; S.receipts = {}; S.isAdmin = false;

  /* ---------- normal user ---------- */
  await Store.hydrate(); App.render(); await tick(80);
  t('normal user: no Super Admin menu', !$('#nav [data-arg="admin"]') && !$('.nav-admin'));
  App.go('admin'); await tick(120);
  t('normal user: #/admin shows access denied, no admin controls', txt($('#main-content')).includes('Super Admin access required') && !$('#adm-msg-form') && !$('.adm-tabs'));
  let status = 0; try { await Api.admin.overview(); } catch (e) { status = e.status; }
  t('normal user: admin API answers 403 (server-side)', status === 403);
  status = 0; try { await Api.admin.create({ kind: 'news', type: 'feature', title: 'x', body: 'x' }); } catch (e) { status = e.status; }
  t('normal user: cannot publish', status === 403 && S.posts.length === 0);
  // forging the client flag does not grant access: the server still refuses
  Store.user().isSuperAdmin = true; App.go('admin'); await tick(200);
  t('forged client flag: server still denies → access denied screen', txt($('#main-content')).includes('Super Admin access required'));
  Store.user().isSuperAdmin = false;

  /* ---------- Super Admin ---------- */
  S.isAdmin = true; await Store.hydrate(); App.go('dashboard'); await tick(80);
  t('admin: Super Admin menu listed in its own group', !!$('.nav-admin #nav [data-arg="admin"], .nav-admin [data-arg="admin"]'));
  click($('.nav-admin [data-arg="admin"]')); await tick(250);
  // denied flag from the forged attempt is cleared by a fresh load
  if (txt($('#main-content')).includes('access required')) { await Admin.refresh(); await tick(120); }
  t('admin: dashboard renders', App.state.route === 'admin' && !!$('.adm-banner') && $$('.adm-tab').length === 4 && $$('.stat').length === 4);
  t('admin: clearly marked restricted area', txt($('.adm-banner')).includes('Super Admin') && txt($('.adm-banner')).includes('Restricted'));
  t('dashboard: no horizontal overflow', noOverflow());

  // Users tab
  click($('.adm-tab[data-id="users"]')); await tick(200);
  t('users tab lists users from the users API', $$('.adm-users tbody tr').length === S.users.length);
  setVal($('#adm-users-q'), 'jane'); await tick(400);
  t('user search filters', $$('.adm-users tbody tr').length === 1 && txt($('.adm-users tbody tr')).includes('jane@example.com'));
  t('users: no horizontal overflow', noOverflow() && $$('.adm-users tr').every(inView));
  if (mobile) t('users table becomes cards on mobile', getComputedStyle($('.adm-users thead')).display === 'none');

  // Messages → All users
  click($('.adm-tab[data-id="messages"]')); await tick(150);
  const beforeUnread = Notifications.unreadCount();
  submit($('#adm-msg-form')); await tick(100);
  t('message validation: empty title/body blocked', S.posts.length === 0 && $('[data-field="title"] .err').classList.contains('show'));
  setVal($('#adm_m_title'), 'Budget system maintenance'); setVal($('#adm_m_body'), 'Tonight at 10pm.'); setVal($('#adm_m_type'), 'important');
  submit($('#adm-msg-form')); await tick(300);
  t('message to all users stored', S.posts.length === 1 && S.posts[0].audience === 'all' && S.posts[0].type === 'important');
  t('sent message listed with recipients', $$('.adm-posts .adm-post').length === 1 && txt($('.adm-post')).includes('All users'));
  t('form cleared after send', $('#adm_m_title').value === '');
  t('admin inbox got it too (unread +1)', Notifications.unreadCount() === beforeUnread + 1);

  // Messages → Specific users
  click($('input[name="audience"][value="selected"]')); $('input[name="audience"][value="selected"]').checked = true;
  $('input[name="audience"][value="selected"]').dispatchEvent(new Event('change', { bubbles: true })); await tick(250);
  t('specific users: picker appears', !!$('#adm-pick-list') && $$('#adm-pick-list [data-pick]').length === S.users.length);
  t('inactive users cannot be picked', $('[data-pick="4"]').disabled);
  setVal($('#adm_m_title'), 'Hello John'); setVal($('#adm_m_body'), 'Just for you.');
  submit($('#adm-msg-form')); await tick(100);
  t('specific users: at least one required', S.posts.length === 1 && $('[data-field="userIds"] .err').classList.contains('show'));
  setVal($('#adm-pick-q'), 'john'); await tick(400);
  t('picker search', $$('#adm-pick-list [data-pick]').length === 1);
  const cb = $('[data-pick="2"]'); cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true })); await tick(40);
  t('selection counter', txt($('#adm-picked')).includes('1 selected'));
  t('picker rows are touch-friendly', $$('.adm-pick-item').every(r => r.getBoundingClientRect().height >= 44));
  submit($('#adm-msg-form')); await tick(300);
  t('message to specific user stored', S.posts.length === 2 && JSON.stringify(S.deliveries[S.posts[1].id]) === '[2]');
  await Notifications.load(true);
  t('not delivered to users who were not selected', !Notifications.list().some(a => a.title === 'Hello John'));
  t('messages: no horizontal overflow', noOverflow() && inView($('#adm-msg-form')));

  // News & Updates
  click($('.adm-tab[data-id="news"]')); await tick(150);
  setVal($('#adm_n_title'), 'NEW FEATURE ADDED'); setVal($('#adm_n_body'), 'Savings Goals have been improved.'); setVal($('#adm_n_link'), 'javascript:alert(1)');
  submit($('#adm-news-form')); await tick(250);
  t('bad link rejected by the server with a field error', S.posts.length === 2 && $('[data-field="link"] .err').classList.contains('show'));
  setVal($('#adm_n_link'), 'goals'); submit($('#adm-news-form')); await tick(300);
  t('news published for all users', S.posts.length === 3 && S.posts[2].kind === 'news' && S.posts[2].audience === 'all');
  t('news listed', txt($('.adm-posts')).includes('NEW FEATURE ADDED'));
  t('news: no horizontal overflow', noOverflow());
  if (mobile) t('post action buttons touch-friendly', $$('.adm-post-actions .btn').every(b => b.getBoundingClientRect().height >= 44 && inView(b)));

  // Delivered into the existing inbox UI
  App.go('inbox'); await tick(200);
  const card = $$('.ntf-item').find(i => txt(i).includes('NEW FEATURE ADDED'));
  t('users see News in Notifications (unread, New feature badge)', !!card && card.classList.contains('unread') && txt(card.querySelector('.ntf-type')) === 'New feature');
  t('bell/badge include admin items', $('#ntf-bell').classList.contains('has-unread') && Number(txt($('#nav [data-arg="inbox"] .nav-badge'))) === Notifications.unreadCount());
  const msgCard = $$('.ntf-item').find(i => txt(i).includes('Budget system maintenance'));
  t('important message uses existing Important type', !!msgCard && txt(msgCard.querySelector('.ntf-type')) === 'Important');
  click(card.querySelector('.ntf-open')); await tick(200);
  t('opening news with a link navigates + marks read on the server', App.state.route === 'goals' && !!(S.receipts[1] || {})[S.posts[2].id]);

  // View / Edit / Delete
  App.go('admin'); await tick(150); click($('.adm-tab[data-id="news"]')); await tick(150);
  click($(`[data-adm="view"][data-id="${S.posts[2].id}"]`)); await tick(120);
  t('View opens a read-only dialog inside the viewport', !!$('.modal .adm-view') && inView($('.modal')) && !$('.modal .adm-view input'));
  UI.closeTop(); await tick(60);
  click($(`[data-adm="edit"][data-id="${S.posts[2].id}"]`)); await tick(120);
  setVal($('#adm_e_title'), 'Savings Goals improved'); submit($('#adm-edit-form')); await tick(300);
  t('Edit saves and updates the list', S.posts[2].title === 'Savings Goals improved' && txt($('.adm-posts')).includes('Savings Goals improved') && !$('.modal'));
  t('inbox shows the edited title', Notifications.list().some(a => a.title === 'Savings Goals improved'));
  click($(`[data-adm="delete"][data-id="${S.posts[2].id}"]`)); await tick(120);
  t('Delete asks for confirmation', !!$('.modal') && txt($('.modal')).includes('removed from every user'));
  click($$('.modal .btn-danger')[0]); await tick(300);
  t('Delete removes it from admin list and inbox', S.posts.length === 2 && !Notifications.list().some(a => a.title === 'Savings Goals improved'));
  t('no horizontal overflow at the end', noOverflow());

  // back to a normal user for any later pass
  S.isAdmin = false; S.posts = []; S.deliveries = {}; S.receipts = {};
  await Store.hydrate(); await Notifications.load(true); App.go('grocery'); await tick(100);
  t('menu disappears again for a normal user', !$('.nav-admin'));
};
