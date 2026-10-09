/* ============================================================
   Saved Grocery Lists (Phase 2) · end-to-end tests
   Registered for tests.js, which calls it after the Phase 1 suite.
   ============================================================ */
window.GroceryPhase2Tests = async ({ t, log, tick, $, $$, txt, click, submit, add, buy, btn, rowFor, activeNames, doneNames, sections, S }) => {
  // Saved Grocery Lists live in a dialog (Round 6): open it before querying.
  const openSaved = () => { if (!$('.modal .gro-saved')) click($('[data-action="grocery-lists"]')); };
  const peekSaved = fn => { const was = !!$('.modal .gro-saved'); openSaved(); const r = fn(); if (!was) UI.closeTop(); return r; };
  const savedRows = () => { openSaved(); return $$('.gro-saved .gro-saved-card'); };
  const savedNames = () => peekSaved(() => $$('.gro-saved .gro-saved-card').map(r => txt(r.querySelector('.gro-saved-name'))));
  const savedCount = () => peekSaved(() => $$('.gro-saved .gro-saved-card').length);
  const loadBtnFor = name => savedRows().find(r => txt(r.querySelector('.gro-saved-name')).startsWith(name))?.querySelector('[data-action="grocery-list-load"]');
  const delBtnFor = name => savedRows().find(r => txt(r.querySelector('.gro-saved-name')).startsWith(name))?.querySelector('[data-action="grocery-list-del"]');
  const openSave = async () => { click($('[data-action="grocery-save"]')); await tick(120); };

  log('SAVED LISTS · EMPTY STATE');
  t('saved lists are not on the page', !$('#main-content .gro-saved') && !!$('#main-content [data-action="grocery-lists"]'));
  openSaved(); await tick(40);
  t('saved lists dialog opens', txt($$('.modal h2').pop()) === 'Saved Grocery Lists' && !!$('.modal .gro-saved'));
  t('empty state shown', /no saved grocery lists yet/i.test(txt($('.gro-saved'))));
  t('empty state offers a way to save when the list has items', !!$('.gro-saved [data-action="grocery-save"]') === Store.groceryItems().length > 0);
  UI.closeTop(); await tick(60);

  log('SAVED LISTS · SAVING');
  // The list currently holds one leftover item; build a proper one.
  while (Store.groceryItems().length) { Store.removeGrocery(Store.groceryItems()[0].id); await tick(60); }
  App.render(); await tick(80);
  click($('.gro-submit [data-action="grocery-save"]')); await tick(120);
  t('empty list cannot be saved', !$('.modal') && $$('.toast.error').some(x => txt(x).includes('Nothing to save')));

  await add('Rice', 'c_food'); await add('Chicken', 'c_food'); await add('Milk', 'c_food'); await add('Eggs', 'c_food');
  await openSave();
  t('save dialogue opens', txt($$('.modal h2').pop()) === 'Save Grocery List');
  t('default name is offered', /^grocery-list-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}$/.test($('#grs_name').value), $('#grs_name').value);
  click(btn('Cancel')); await tick(100);
  t('cancel saves nothing', !$('.modal') && S.groceryLists.length === 0);

  await openSave();
  $('#grs_name').value = 'Weekly Grocery'; submit($('#gro-save-form')); await tick(250);
  t('custom name saved', S.groceryLists.length === 1 && S.groceryLists[0].name === 'Weekly Grocery', S.groceryLists.map(l => l.name));
  t('items saved with categories', S.groceryLists[0].items.length === 4 && S.groceryLists[0].items.every(i => i.categoryId === 'c_food'), S.groceryLists[0].items);
  t('no price or purchase state stored', S.groceryLists[0].items.every(i => !('price' in i) && !('checked' in i)));
  t('saved list appears in the table', savedNames().some(n => n.startsWith('Weekly Grocery')), savedNames());
  t('item count shown', peekSaved(() => txt($('.gro-saved-card .lr-sub')).includes('4 items')), peekSaved(() => txt($('.gro-saved-card .lr-sub'))));
  t('created + updated shown', peekSaved(() => /created (?!-)\S.* · updated (?!-)\S/.test(txt($('.gro-saved-card .lr-sub')))));
  t('load + delete actions', !!loadBtnFor('Weekly Grocery') && !!delBtnFor('Weekly Grocery'));
  t('Load is primary, Delete separate + labelled', !!$('.gro-saved-card [data-action="grocery-list-load"].btn-primary') && !!$('.gro-saved-card .gro-saved-sep + [data-action="grocery-list-del"][aria-label^="Delete "]'));
  t('one card per saved list', $$('.gro-saved-card').length === 1);
  UI.closeTop(); await tick(60);
  t('success toast', $$('.toast.success').some(x => txt(x).includes('Grocery list saved')));

  log('SAVED LISTS · DEFAULT NAME + MULTIPLE LISTS');
  while (Store.groceryItems().length) { Store.removeGrocery(Store.groceryItems()[0].id); await tick(50); }
  App.render(); await tick(80);
  await add('Charcoal', 'c_house'); await add('Pork', 'c_food');
  await openSave();
  $('#grs_name').value = ''; click(btn('Save as New')); await tick(300);
  t('empty name falls back to the default', S.groceryLists.length === 2 && /^grocery-list-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}$/.test(S.groceryLists[1].name), S.groceryLists.map(l => l.name));
  t('multiple saved lists kept', S.groceryLists.length === 2 && savedCount() === 2);
  t('each list keeps its own items', S.groceryLists[0].items.length === 4 && S.groceryLists[1].items.length === 2);

  log('SAVED LISTS · SAVE OVER A LOADED LIST');
  click(loadBtnFor('Weekly Grocery')); await tick(120);
  t('loading over a non-empty list asks first', txt($$('.modal h2').pop()) === 'Replace current grocery list?');
  click(btn('Load list')); await tick(300);
  t('items restored', activeNames().sort().join() === 'Chicken,Eggs,Milk,Rice', activeNames());
  t('categories restored', txt(sections()[0]).includes('Food'));
  t('nothing is purchased after a load', Store.groceryItems().every(g => !g.checked && g.price == null));
  t('no expenses created by loading', S.transactions.length === 2, S.transactions.length);
  t('dialog closes after a successful load', !$('.modal .gro-saved'));
  t('row marked as loaded', peekSaved(() => txt($('.gro-saved')).includes('Loaded')));
  await add('Butter', 'c_food');
  await openSave();
  t('loaded list offers Save and Save as New', !!btn('Save') && !!btn('Save as New'));
  t('name prefilled with the loaded list', $('#grs_name').value === 'Weekly Grocery');
  click(btn('Save')); await tick(300);
  t('overwrite keeps one list', S.groceryLists.length === 2);
  t('overwritten list has the new item', S.groceryLists.find(l => l.name === 'Weekly Grocery').items.length === 5);
  await openSave();
  $('#grs_name').value = 'Weekend BBQ'; click(btn('Save as New')); await tick(300);
  t('save as new adds a third list', S.groceryLists.length === 3 && savedCount() === 3, S.groceryLists.map(l => l.name));

  log('SAVED LISTS · REUSABILITY');
  await buy('Rice', '70'); await buy('Milk', '95');
  t('shopping works after loading', doneNames().sort().join() === 'Milk,Rice', doneNames());
  t('purchases do not change the template', S.groceryLists.find(l => l.name === 'Weekly Grocery').items.length === 5
    && S.groceryLists.find(l => l.name === 'Weekly Grocery').items.every(i => i.price === undefined));
  click(loadBtnFor('Weekly Grocery')); await tick(120); click(btn('Load list')); await tick(300);
  t('same list can be loaded again', activeNames().length === 5 && !doneNames().length, [activeNames(), doneNames()]);
  t('reload resets purchase state and prices', Store.groceryItems().every(g => !g.checked && g.price == null));
  t('other saved lists untouched', S.groceryLists.find(l => l.name === 'Weekend BBQ').items.length === 5
    && S.groceryLists.find(l => l.name.startsWith('grocery-list-')).items.length === 2);

  log('SAVED LISTS · PERSISTENCE');
  await Store.hydrate(); App.render(); await tick(150);
  t('saved lists survive a reload', savedCount() === 3, savedNames());
  const counts = () => peekSaved(() => $$('.gro-saved-card .lr-sub').map(e => (/(\d+) items?/.exec(txt(e)) || [])[1]).sort().join());
  t('item counts survive a reload', counts() === '2,5,5', counts());

  log('SAVED LISTS · DELETE');
  const txBefore = S.transactions.length;
  click(delBtnFor('Weekend BBQ')); await tick(120);
  t('delete asks for confirmation', txt($$('.modal h2').pop()) === 'Delete Saved Grocery List?');
  t('confirmation names the list', txt($$('.modal-body').pop()).includes('Weekend BBQ'));
  t('confirm stacks above the saved lists dialog', $$('.modal').length === 2 && !!$('.modal .gro-saved'));
  click(btn('Cancel')); await tick(120);
  t('cancel keeps the list', S.groceryLists.length === 3);
  click(delBtnFor('Weekend BBQ')); await tick(120);
  click(btn('Delete')); await tick(300);
  t('saved lists dialog stays open and refreshes after delete', !!$('.modal .gro-saved') && $$('.gro-saved-card').length === 2);
  UI.closeTop(); await tick(80);
  t('list deleted', S.groceryLists.length === 2 && !savedNames().some(n => n.startsWith('Weekend BBQ')), savedNames());
  t('expenses untouched by the delete', S.transactions.length === txBefore && Store.get().transactions.length === txBefore);
  t('working grocery list untouched', Store.groceryItems().length === 5);

  log('SAVED LISTS · REGRESSION AFTER PHASE 2');
  await buy('Chicken', '200');
  t('price dialogue still works', Store.groceryItems().find(g => g.name === 'Chicken').price === 20000);
  t('purchased item still moves section', doneNames().includes('Chicken'));
  click($('[data-action="grocery-submit"]')); await tick(150);
  t('confirm dialog still opens', txt($$('.modal h2').pop()) === 'Confirm Grocery List');
  submit($('#gro-confirm-form')); await tick(400);
  t('submission still creates expenses from stored prices', S.transactions.length === txBefore + 1
    && S.transactions[S.transactions.length - 1].amount === 20000, S.transactions[S.transactions.length - 1]);
  t('unpurchased items stay after submit', Store.groceryItems().length === 4);
  for (const r of ['dashboard', 'transactions', 'accounts', 'settings', 'grocery']) {
    App.go(r); await tick(70);
    t('route still renders: ' + r, !/went wrong/.test(txt($('#main-content .empty h3')) || ''));
  }
};
