/* ============================================================
   Bills & Recurring · responsive row-action tests
   Seeds many bills/recurring rules (including very long names) into the
   Store, renders the real views and checks that every action button stays
   inside the viewport and inside its row at desktop, tablet and mobile.
   run.sh loads this pass with ?only=rows at several viewport sizes.
   ============================================================ */
window.RowActionTests = async ({ t, log, tick, $, $$, txt }) => {
  const W = () => window.innerWidth, H = () => window.innerHeight;
  const label = `${W()}x${H()}`;
  const LONG = 'Metropolitan Waterworks and Sewerage System Consolidated Monthly Statement';

  const seed = () => {
    const d = Store.get();
    const iso = n => Core.addDays(Core.today(), n);
    d.bills.length = 0; d.recurring.length = 0;
    for (let i = 0; i < 12; i++) {
      d.bills.push({ id: 'b' + i, name: i % 3 === 0 ? LONG : 'Bill ' + i, amount: 123456 + i * 1000,
        dueDate: iso(i - 4), categoryId: 'c_house', accountId: 'a_cash',
        paidOn: i % 4 === 3 ? iso(-1) : null, notes: '' });
      d.recurring.push({ id: 'r' + i, name: i % 3 === 1 ? LONG : 'Rule ' + i, amount: 98765 + i * 500,
        type: i % 2 ? 'income' : 'expense', frequency: 'monthly', nextDate: iso(i),
        categoryId: i % 2 ? 'c_salary' : 'c_food', accountId: 'a_cash',
        paused: i % 5 === 0, autoPost: i % 2 === 0, notes: '' });
    }
  };

  const checkRows = page => {
    const rows = $$('#main-content .list-row.lr-act-row');
    t(`${page}: rows rendered`, rows.length === 12, rows.length);
    t(`${page}: no horizontal page overflow`,
      document.documentElement.scrollWidth <= W() + 1, document.documentElement.scrollWidth);

    let insideViewport = true, insideRow = true, clickable = true, tapSize = true, overlap = true, actionCount = 0;
    const minTap = W() <= 860 ? 34 : 26;
    for (const row of rows) {
      const rr = row.getBoundingClientRect();
      const actions = [...row.querySelectorAll('.lr-actions button')];
      actionCount += actions.length;
      const main = row.querySelector('.lr-main').getBoundingClientRect();
      for (const b of actions) {
        const br = b.getBoundingClientRect();
        if (br.left < -0.5 || br.right > W() + 0.5) insideViewport = false;
        if (br.left < rr.left - 0.5 || br.right > rr.right + 0.5) insideRow = false;
        if (br.width < 1 || br.height < 1 || getComputedStyle(b).visibility === 'hidden') clickable = false;
        if (br.width < minTap || br.height < minTap) tapSize = false;
        if (W() <= 860 && br.top < main.bottom - 0.5 && br.left < main.right - 0.5) overlap = false;
      }
    }
    t(`${page}: every row has its action buttons`, actionCount === (page === 'bills' ? 36 : 36), actionCount);
    t(`${page}: buttons inside the viewport`, insideViewport);
    t(`${page}: buttons inside their row`, insideRow);
    t(`${page}: buttons visible and hit-testable`, clickable);
    t(`${page}: tap targets big enough (>=${minTap}px)`, tapSize);
    t(`${page}: actions never overlap the row text`, overlap);

    // nothing is clipped away by an ancestor
    const card = $('#main-content .card');
    const cr = card.getBoundingClientRect();
    t(`${page}: card fits the viewport`, cr.right <= W() + 1 && cr.left >= -1, [cr.left, cr.right, W()]);
    t(`${page}: card does not scroll sideways`, card.scrollWidth <= card.clientWidth + 1, [card.scrollWidth, card.clientWidth]);
    const content = $('.content') || $('#main-content');
    t(`${page}: content column does not scroll sideways`,
      content.scrollWidth <= content.clientWidth + 1, [content.scrollWidth, content.clientWidth]);
    t(`${page}: long names wrap or ellipsize, never widen the row`,
      [...$$('#main-content .lr-title')].every(n => n.getBoundingClientRect().right <= W() + 1));
    // desktop keeps the compact single-line layout
    if (W() > 860) {
      const row = rows[0], right = row.querySelector('.lr-right').getBoundingClientRect();
      const main = row.querySelector('.lr-main').getBoundingClientRect();
      t(`${page}: desktop layout unchanged (actions beside the text)`, right.left >= main.right - 0.5, [main.right, right.left]);
    } else {
      const row = rows[0], right = row.querySelector('.lr-right').getBoundingClientRect();
      const main = row.querySelector('.lr-main').getBoundingClientRect();
      t(`${page}: mobile layout stacks actions under the text`, right.top >= main.bottom - 1, [main.bottom, right.top]);
    }
  };

  log(`BILLS/RECURRING ROWS @ ${label}`);
  seed();
  App.go('bills'); await tick(150);
  App.state.billFilter = 'all'; App.render(); await tick(150);
  checkRows('bills');
  t('bills: Mark paid button present', $$('#main-content [data-action="pay-bill"]').length > 0);
  t('bills: Undo button present for paid bills', $$('#main-content [data-action="unpay-bill"]').length > 0);
  t('bills: edit + delete present', $$('#main-content [data-action="edit-bill"]').length === 12
    && $$('#main-content [data-action="del-bill"]').length === 12);

  App.go('recurring'); await tick(200);
  checkRows('recurring');
  t('recurring: pause/resume, edit and delete present',
    $$('#main-content [data-action="toggle-recurring"]').length === 12
    && $$('#main-content [data-action="edit-recurring"]').length === 12
    && $$('#main-content [data-action="del-recurring"]').length === 12);
};
