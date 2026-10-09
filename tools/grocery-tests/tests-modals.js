/* ============================================================
   Shared modal/dialog geometry · responsive tests
   Every dialog in the app comes from UI.modal (assets/js/ui.js) + the .modal
   rules in app.css, so this pass opens one dialog of each kind and checks that
   the shared implementation places it correctly at the current viewport size.
   run.sh loads this at desktop, tablet, mobile and small-mobile widths.
   ============================================================ */
window.GroceryModalTests = async ({ t, log, tick, $, $$, txt, click, submit, add, buy, btn, rowFor, S }) => {
  const W = () => window.innerWidth, H = () => window.innerHeight;
  const label = `${W()}x${H()}`;

  /** Checks the shared dialog geometry: inside the viewport, centred, usable. */
  const checkModal = (name, { expectScroll = false } = {}) => {
    const modal = $$('.modal').pop();      // the top dialog (Round 6 stacks preview/delete on Saved Lists)
    if (!modal) { t(`${name}: dialog is open`, false); return; }
    const r = modal.getBoundingClientRect();
    const scrim = $$('.scrim').pop().getBoundingClientRect();
    const foot = modal.querySelector('.modal-foot');
    const body = modal.querySelector('.modal-body');

    t(`${name}: inside viewport horizontally`, r.left >= 0 && r.right <= W() + 0.5, [r.left, r.right, W()]);
    t(`${name}: inside viewport vertically`, r.top >= -0.5 && r.bottom <= H() + 0.5, [r.top, r.bottom, H()]);
    t(`${name}: horizontally centred`, Math.abs((r.left + r.right) / 2 - W() / 2) <= 1.5, [(r.left + r.right) / 2, W() / 2]);
    t(`${name}: vertically centred`, Math.abs((r.top + r.bottom) / 2 - H() / 2) <= 1.5, [(r.top + r.bottom) / 2, H() / 2]);
    t(`${name}: margin from the edges`, r.left >= (W() <= 380 ? 6 : 10), r.left);
    t(`${name}: no horizontal page overflow`, document.documentElement.scrollWidth <= W() + 1, document.documentElement.scrollWidth);
    t(`${name}: backdrop covers the viewport`, scrim.width >= W() - 0.5 && scrim.height >= H() - 0.5);
    t(`${name}: above the backdrop`, Number(getComputedStyle(modal).zIndex) > Number(getComputedStyle($$('.scrim').pop()).zIndex));
    t(`${name}: background scroll locked`, getComputedStyle(document.body).overflow === 'hidden');
    if (foot) {
      const fr = foot.getBoundingClientRect();
      t(`${name}: action buttons reachable`, fr.bottom <= H() + 0.5 && fr.top >= 0, [fr.top, fr.bottom, H()]);
      const buttons = [...foot.querySelectorAll('button')];
      t(`${name}: buttons inside the dialog`, buttons.every(b => {
        const br = b.getBoundingClientRect();
        return br.left >= r.left - 0.5 && br.right <= r.right + 0.5 && br.width > 0;
      }));
    }
    if (body) {
      t(`${name}: body scrolls instead of clipping`, getComputedStyle(body).overflowY === 'auto');
      if (expectScroll) t(`${name}: tall content is scrollable`, body.scrollHeight > body.clientHeight + 1, [body.scrollHeight, body.clientHeight]);
    }
    t(`${name}: has an accessible name`, modal.getAttribute('role') === 'dialog' && modal.getAttribute('aria-modal') === 'true'
      && !!(modal.getAttribute('aria-label') || '').trim(), modal.getAttribute('aria-label'));
    t(`${name}: close control present`, !!modal.querySelector('.modal-head .icon-btn'));
  };

  const closeAny = async () => { if ($('.modal')) { UI.closeAll(); await tick(80); } };
  // 320ms: longer than the .2s open animation, so geometry is measured at rest.
  const openAndCheck = async (name, open, opts) => { await closeAny(); await open(); await tick(320); checkModal(name, opts); await closeAny(); };

  // Headless Chromium runs with a virtual clock, which freezes CSS animations
  // on their first keyframe; geometry is therefore measured with the open
  // animation disabled, exactly like prefers-reduced-motion does at runtime.
  const noAnim = document.createElement('style');
  noAnim.textContent = '.modal,.scrim{animation:none!important}.scrim{opacity:1!important}';
  document.head.appendChild(noAnim);

  log(`MODALS @ ${label}`);

  // Seed a session: items, a purchase, a saved list, an expense.
  await add('Rice', 'c_food'); await add('Chicken', 'c_food'); await add('Milk', 'c_food');
  await buy('Rice', '65');
  await Store.saveGroceryList({ name: 'Weekly Grocery' }); App.render(); await tick(120);

  await openAndCheck('price dialogue', async () => click(rowFor('Milk').querySelector('[data-action="grocery-get"]')));
  await openAndCheck('clear list confirmation', async () => click($('[data-action="grocery-clear"]')));
  await openAndCheck('save list dialogue', async () => click($('.gro-submit [data-action="grocery-save"]')));
  const openSaved = () => click($('[data-action="grocery-lists"]'));
  await openAndCheck('add grocery item dialog', async () => click($('[data-action="grocery-add"]')));
  await openAndCheck('saved grocery lists dialog', async () => openSaved());
  await openAndCheck('saved grocery list quick preview', async () => { openSaved(); click($('.gro-saved [data-action="grocery-list-preview"]')); });
  await openAndCheck('delete saved list confirmation', async () => { openSaved(); click($('.gro-saved [data-action="grocery-list-del"]')); });
  await openAndCheck('remove item confirmation', async () => click(rowFor('Milk').querySelector('[data-action="grocery-del"]')));
  await openAndCheck('submit grocery list dialogue', async () => click($('[data-action="grocery-submit"]')));

  // Dialogs from the rest of the app, all through the same UI.modal.
  await openAndCheck('transaction form', async () => Forms.transaction({ type: 'expense' }), { expectScroll: W() <= 640 });
  await openAndCheck('quick add', async () => Forms.quickAdd());
  await openAndCheck('account form', async () => Forms.account());
  await openAndCheck('category form', async () => Forms.category());
  await openAndCheck('savings goal form', async () => Forms.goal());
  await openAndCheck('bill form', async () => Forms.bill());
  await openAndCheck('recurring form', async () => Forms.recurring());
  await openAndCheck('budget line form', async () => Forms.budgetLine(Core.monthKey(Core.today())));

  // Budget save / clear / preview dialogs (same UI.modal).
  const ym = Core.monthKey(Core.today());
  Store.setBudgetLine(ym, 'c_food', 500000); Store.setBudgetLine(ym, 'c_house', 250000);
  await tick(150);
  await Store.saveBudget({ name: 'Monthly Household Budget', month: ym });
  App.go('budget'); await tick(200);
  await openAndCheck('save budget dialogue', async () => click($('[data-action="budget-save"]')));
  await openAndCheck('clear budget confirmation', async () => click($('[data-action="budget-clear"]')));
  const openSavedB = () => click($('[data-action="budget-saved"]'));
  await openAndCheck('saved budgets dialog', async () => openSavedB());
  await openAndCheck('saved budget quick preview', async () => { openSavedB(); click($('.bud-saved [data-action="budget-preview"]')); });
  await openAndCheck('delete saved budget confirmation', async () => { openSavedB(); click($('.bud-saved [data-action="budget-saved-del"]')); });
  App.go('grocery'); await tick(150);
  // UI.confirm resolves only when the user answers, so it is fired, not awaited.
  await openAndCheck('generic confirm', async () => { UI.confirm({ title: 'Delete transaction?', message: 'A short confirmation message.', confirmLabel: 'Delete' }); });
  await openAndCheck('long-content dialogue', async () => { UI.modal({
    title: 'Very long dialogue',
    body: Array.from({ length: 60 }, (_, i) => `<p>Line ${i + 1} of a deliberately very long dialogue body used to test scrolling.</p>`).join(''),
    footer: '<button class="btn btn-primary">Done</button>'
  }); }, { expectScroll: true });

  // Keyboard + focus behaviour must survive the CSS change.
  await closeAny();
  Forms.account(); await tick(180);
  t('focus moves into the dialog', $('.modal').contains(document.activeElement), document.activeElement && document.activeElement.className);
  $('.modal').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await tick(120);
  t('escape closes the dialog', !$('.modal'));
  t('scroll lock released after close', getComputedStyle(document.body).overflow !== 'hidden');
  Forms.account(); await tick(150);
  click($('.scrim')); await tick(120);
  t('backdrop click closes the dialog', !$('.modal'));
  await closeAny();
};
