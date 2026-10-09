/* ============================================================
   Clear Grocery List · end-to-end tests
   Runs after the Phase 2 suite, so saved lists and expenses already exist and
   the test can prove the clear action leaves them alone.
   ============================================================ */
window.GroceryClearTests = async ({ t, log, tick, $, $$, txt, click, submit, add, buy, btn, activeNames, doneNames, sections, S }) => {
  const clearBtn = () => $('[data-action="grocery-clear"]');
  // Round 6: saved lists live in a dialog.
  const openSaved = () => { if (!$('.modal .gro-saved')) click($('[data-action="grocery-lists"]')); };
  const peekSaved = fn => { const was = !!$('.modal .gro-saved'); openSaved(); const r = fn(); if (!was) UI.closeTop(); return r; };
  const savedNames = () => peekSaved(() => $$('.gro-saved .gro-saved-card').map(r => txt(r.querySelector('.gro-saved-name'))));

  log('CLEAR GROCERY LIST');
  t('clear button on the page', !!clearBtn() && txt(clearBtn()).includes('Clear List'), txt(clearBtn()));

  await add('Bread', 'c_food'); await add('Coffee', 'c_food');
  await buy('Bread', '55');
  const itemsBefore = Store.groceryItems().length;
  const txBefore = S.transactions.length;
  const listsBefore = S.groceryLists.length;
  t('list has active and purchased items', activeNames().length > 0 && doneNames().length > 0, [activeNames(), doneNames()]);

  click(clearBtn()); await tick(150);
  t('confirmation opens', !!$('.modal') && txt($$('.modal h2').pop()) === 'Clear Grocery List?', txt($$('.modal h2').pop()));
  t('confirmation explains the scope', /clear the current grocery list/i.test(txt($('.modal-body'))) && /saved grocery lists and existing expenses are kept/i.test(txt($('.modal-body'))), txt($('.modal-body')));
  t('confirm button labelled', !!btn('Clear Grocery List'));
  click(btn('Cancel')); await tick(150);
  t('cancel closes the dialog', !$('.modal'));
  t('cancel changes nothing', Store.groceryItems().length === itemsBefore && S.grocery.length === itemsBefore);

  click(clearBtn()); await tick(150);
  click(btn('Clear Grocery List')); await tick(400);
  t('active items cleared', activeNames().length === 0, activeNames());
  t('purchased items cleared', doneNames().length === 0, doneNames());
  t('cleared server-side', S.grocery.length === 0 && Store.groceryItems().length === 0);
  t('empty state shown', txt(sections()[0]).includes('Your grocery list is empty') && txt(sections()[1]).includes('No items purchased yet'));
  t('progress reset', txt($('.gro-progress')).includes('0 / 0 items purchased'), txt($('.gro-progress')));
  t('clear/save disabled on an empty list', clearBtn().disabled && $('[data-action="grocery-save"]').disabled);
  t('toast shown', $$('.toast').some(x => txt(x).includes('Grocery list cleared')));

  log('CLEAR · WHAT MUST SURVIVE');
  t('saved grocery lists untouched', S.groceryLists.length === listsBefore && savedNames().length === listsBefore, savedNames());
  t('saved list items untouched', S.groceryLists.every(l => l.items.length > 0));
  t('expenses untouched', S.transactions.length === txBefore && Store.get().transactions.length === txBefore);
  App.go('transactions'); await tick(120);
  t('expense history still visible', txt($('#main-content')).includes('Rice') || txt($('#main-content')).includes('Chicken'));
  App.go('grocery'); await tick(120);

  log('CLEAR · LOAD A SAVED LIST AFTERWARDS');
  openSaved();
  const load = $$('.gro-saved .gro-saved-card')[0].querySelector('[data-action="grocery-list-load"]');
  click(load); await tick(200);
  t('empty list loads without a confirmation prompt', !$$('.modal').some(m => txt(m.querySelector('h2')) === 'Replace current grocery list?') || txt($$('.modal h2').pop()) !== 'Replace current grocery list?');
  await tick(300);
  t('saved list loaded after clearing', Store.groceryItems().length > 0 && activeNames().length > 0, activeNames());
  t('loaded items are unpurchased', Store.groceryItems().every(g => !g.checked && g.price == null));
  t('no expenses created by loading', S.transactions.length === txBefore);

  // Leave a clean session for anything that runs later.
  click(clearBtn()); await tick(150); click(btn('Clear Grocery List')); await tick(300);
};
