/* ============================================================
   Saved Grocery List · read-only Quick Preview
   Same pattern (and the same shared modal) as the Saved Budget preview.
   Runs at the end of the functional suite and via ?only=preview.
   ============================================================ */
window.GroceryPreviewTests = async ({ t, log, tick, $, $$, txt, click, submit, add, btn, S }) => {
  // Round 6: saved lists live in a dialog, so the preview stacks on top of it.
  const top = () => $$('.modal').pop();
  const modalBtn = label => [...top().querySelectorAll('.modal-foot button')].find(b => txt(b) === label);
  const openSaved = () => { if (!$('.modal .gro-saved')) click($('[data-action="grocery-lists"]')); };
  const savedRow = () => { openSaved(); return $('.gro-saved .gro-saved-card'); };

  log('SAVED GROCERY LIST · QUICK PREVIEW');
  const txCount = S.transactions.length;   // the suite may already have submitted a list
  // Fresh session with a saved template.
  await Store.clearGrocery(); App.go('grocery'); await tick(150);
  await add('Rice', 'c_food'); await add('Soap', 'c_house'); await add('Vitamins', 'c_health');
  await Store.saveGroceryList({ name: 'Weekend Run' }); App.render(); await tick(150);
  const listId = S.groceryLists[S.groceryLists.length - 1].id;

  t('saved row has a Preview button', !!savedRow().querySelector('[data-action="grocery-list-preview"]'));
  t('Preview sits before Load', [...savedRow().querySelectorAll('.gro-saved-actions button')].slice(0, 2)
    .map(b => b.getAttribute('data-action')).join() === 'grocery-list-preview,grocery-list-load');
  t('saved lists dialog is the only open dialog', $$('.modal').length === 1);

  log('PREVIEW · CLICKING A SAVED LIST DOES NOT LOAD IT');
  const grocerySnapshot = JSON.stringify(S.grocery);
  click(savedRow()); await tick(150);
  t('clicking the row opens nothing', $$('.modal').length === 1);
  click(savedRow().querySelector('.gro-saved-name')); await tick(150);
  t('clicking the name loads nothing', $$('.modal').length === 1 && JSON.stringify(S.grocery) === grocerySnapshot);

  log('PREVIEW · CONTENT');
  click($(`.gro-saved [data-action="grocery-list-preview"][data-arg="${listId}"]`)); await tick(200);
  t('preview opens on top of the saved lists dialog', $$('.modal').length === 2);
  t('shows the list name', txt($$('.modal h2').pop()) === 'Weekend Run', txt($$('.modal h2').pop()));
  t('shows the item count', txt(top()).includes('3 items'), txt(top().querySelector('.sub')));
  t('shows the number of categories', txt($('.prev-meta')).includes('Categories'));
  t('shows created and updated', txt($('.prev-meta')).includes('Created') && txt($('.prev-meta')).includes('Updated'));
  t('lists every item name', $$('.modal .prev-row').length === 3
    && ['Rice', 'Soap', 'Vitamins'].every(n => txt(top().querySelector('.modal-body')).includes(n)), $$('.modal .prev-row').length);
  t('shows each item category', txt(top().querySelector('.modal-body')).includes('Food') && txt(top().querySelector('.modal-body')).includes('Household')
    && txt(top().querySelector('.modal-body')).includes('Health'));
  t('read-only: no inputs, selects or textareas', !top().querySelectorAll('.modal-body input, .modal-body select, .modal-body textarea').length);
  t('read-only: no action controls inside the body', !top().querySelectorAll('.modal-body [data-action]').length);
  t('actions are Close and Load List', !!modalBtn('Close') && !!modalBtn('Load List')
    && top().querySelectorAll('.modal-foot button').length === 2, [...top().querySelectorAll('.modal-foot button')].map(txt));

  log('PREVIEW · CLOSE CHANGES NOTHING');
  const before = JSON.stringify(S);
  click(modalBtn('Close')); await tick(150);
  t('Close leaves the data untouched', $$('.modal').length === 1 && JSON.stringify(S) === before);

  log('PREVIEW · LOAD LIST');
  await add('Leftover', 'c_food');                     // current list is not empty
  App.render(); await tick(150);
  click($(`.gro-saved [data-action="grocery-list-preview"][data-arg="${listId}"]`)); await tick(200);
  click(modalBtn('Load List')); await tick(200);
  t('Load List runs the normal load flow (confirmation)', !!top() && txt($$('.modal h2').pop()).includes('Replace'));
  click(btn('Cancel')); await tick(150);
  t('cancel keeps the working list', S.grocery.some(g => g.name === 'Leftover'));
  click($(`.gro-saved [data-action="grocery-list-preview"][data-arg="${listId}"]`)); await tick(200);
  click(modalBtn('Load List')); await tick(200);
  click(modalBtn('Load list')); await tick(300);
  t('saved lists dialog closed after the load', !$('.modal'));
  t('list loaded from the preview', S.grocery.map(g => g.name).sort().join() === 'Rice,Soap,Vitamins', S.grocery.map(g => g.name));
  t('loaded items are unpurchased and have no price', S.grocery.every(g => !g.checked && g.price == null));
  t('no expense was created by the preview flow', S.transactions.length === txCount, S.transactions.length);
  t('the template itself is unchanged', S.groceryLists.find(l => l.id === listId).items.length === 3);
};
