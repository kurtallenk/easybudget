/* Notifications inbox · ?only=inbox (run.sh: 1280 / 390 / 320). */
window.InboxTests = async ({ t, log, tick, $, $$, txt, click, S }) => {
  const W = () => document.documentElement.clientWidth;
  log(`INBOX @ ${W()}px`);
  localStorage.removeItem('bp_notif_read_' + Store.user().id);
  S.receipts = {}; S.posts = []; S.deliveries = {};
  await Notifications.load(true); App.render(); await tick(120);
  const n = Notifications.list().length;
  t('inbox loaded from the notifications API (server-side feed)', n >= 2 && Notifications.mode() === 'server' && S.calls.includes('notifications/list.php'), n);
  t('all start unread', Notifications.unreadCount() === n);
  t('sidebar entry with unread badge', !!$('#nav [data-arg="inbox"]') && txt($('#nav [data-arg="inbox"] .nav-badge')) === String(n));
  t('top bar bell shows unread dot', $('#ntf-bell').classList.contains('has-unread') && $('#ntf-bell').getAttribute('aria-label').includes(`${n} unread`));
  click($('#ntf-bell')); await tick(150);
  t('bell opens the Notifications page', App.state.route === 'inbox' && txt($('#page-title')) === 'Notifications');
  const items = $$('.ntf-item');
  t('one card per notification, newest first', items.length === n && items[0].dataset.ntf === Notifications.list()[0].id);
  const first = items[0];
  t('card shows type, title, description and date', !!first.querySelector('.ntf-type') && !!txt(first.querySelector('.ntf-title')) && !!first.querySelector('.ntf-desc') && !!txt(first.querySelector('.ntf-time')));
  t('unread styling', first.classList.contains('unread') && getComputedStyle(first.querySelector('.ntf-dot')).backgroundColor !== 'rgba(0, 0, 0, 0)');
  t('touch target at least 44px', first.querySelector('.ntf-open').getBoundingClientRect().height >= 44);
  t('no horizontal overflow', document.documentElement.scrollWidth <= W() + 1 && $$('.ntf-item').every(i => i.getBoundingClientRect().right <= W() + 0.5));
  // open one without a route → stays on page, marked read
  const noRoute = Notifications.list().find(a => !a.route);
  click($(`.ntf-open[data-arg="${noRoute.id}"]`)); await tick(120);
  t('opening marks it as read', !$(`.ntf-item[data-ntf="${noRoute.id}"]`).classList.contains('unread') && Notifications.unreadCount() === n - 1);
  t('badge count drops', txt($('#nav [data-arg="inbox"] .nav-badge')) === String(n - 1));
  // open one with a route → navigates
  const withRoute = Notifications.list().find(a => a.route && !a.read);
  if (withRoute) { click($(`.ntf-open[data-arg="${withRoute.id}"]`)); await tick(150);
    t('notification with a page link opens that page', App.state.route === withRoute.route); App.go('inbox'); await tick(120); }
  click($('[data-action="ntf-filter"][data-arg="unread"]')); await tick(80);
  t('Unread filter', $$('.ntf-item').length === Notifications.unreadCount() && !$$('.ntf-item:not(.unread)').length);
  click($('[data-action="ntf-all"]')); await tick(120);
  t('Mark all as read', Notifications.unreadCount() === 0 && !$('#nav [data-arg="inbox"] .nav-badge') && !$('#ntf-bell').classList.contains('has-unread'));
  t('caught-up empty state', txt($('.ntf')).includes('all caught up'));
  t('Mark all disabled when nothing unread', $('[data-action="ntf-all"]').disabled);
  click($('[data-action="ntf-filter"][data-arg="all"]')); await tick(80);
  t('read state is stored on the server (per user)', Object.keys(S.receipts[1] || {}).length === n);
  t('nothing written to localStorage any more', localStorage.getItem('bp_notif_read_' + Store.user().id) === null);
  // "another device": drop all client state and reload from the server
  localStorage.clear(); await Notifications.load(true); App.render(); await tick(100);
  t('fresh browser sees the same read state', Notifications.unreadCount() === 0 && Notifications.list().length === n);
  // a new server-side item arrives → unread count follows the database
  S.posts.push({ id: 'adm_t1', kind: 'news', type: 'feature', title: 'NEW FEATURE ADDED', body: 'Savings Goals have been improved.', details: '', link: 'goals', audience: 'all', recipientCount: 1, createdAt: new Date().toISOString() });
  await Notifications.load(true); App.render(); await tick(100);
  t('unread count reflects database state', Notifications.unreadCount() === 1 && txt($('#nav [data-arg="inbox"] .nav-badge')) === '1');
  App.go('inbox'); await tick(100);
  t('admin News item shown with existing card UI', $$('.ntf-item.unread').length === 1 && txt($('.ntf-item.unread .ntf-title')) === 'NEW FEATURE ADDED' && txt($('.ntf-item.unread .ntf-type')) === 'New feature');
  // Round 9 → 10 upgrade: read ids saved in this browser are copied to the account once
  S.receipts = {}; localStorage.setItem('bp_notif_read_' + Store.user().id, JSON.stringify([noRoute.id]));
  await Notifications.load(true);
  t('legacy browser read state migrated to the server', !!(S.receipts[1] || {})[noRoute.id] && localStorage.getItem('bp_notif_read_' + Store.user().id) === null);
  // failed save → optimistic change rolled back
  S.failNotif = false; const target = Notifications.list().find(a => !a.read); S.failNotif = true;
  await Notifications.markRead(target.id); await tick(60);
  t('failed save is rolled back', Notifications.list().find(a => a.id === target.id).read === false);
  // API unreachable → static feed + per-browser fallback (Round 9 behaviour)
  await Notifications.load(true);
  t('offline fallback still shows the static feed', Notifications.mode() === 'local' && Notifications.list().length >= 2);
  S.failNotif = false; S.receipts = {}; S.posts = []; localStorage.removeItem('bp_notif_read_' + Store.user().id);
  await Notifications.load(true);
  App.go('grocery'); await tick(100);
};
