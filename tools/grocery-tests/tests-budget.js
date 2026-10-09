/* ============================================================
   Budget · save / load / delete, clear and quick preview
   Drives the real Budget page through the DOM against mock-api.js.
   Loaded by tests.js with ?only=budget, and also at the end of the
   functional suite.
   ============================================================ */
window.BudgetTests = async ({ t, log, tick, $, $$, txt, click, submit, btn, S }) => {
  const ym = Core.monthKey(Core.today());
  const goBudget = async () => { App.go('budget'); await tick(150); };
  // Round 6: Saved Budgets live in a dialog opened by "Load Saved Budgets".
  const openSB = async () => { if (!$('.bud-saved')) { click($('[data-action="budget-saved"]')); await tick(150); } };
  const savedRows = () => $$('.bud-saved .saved-tpl-card');
  const topH2 = () => txt($$('.modal h2').pop());
  const savedNames = () => savedRows().map(r => txt(r.querySelector('.saved-tpl-name')));
  const serverBudget = () => S.budgets.find(b => b.month === ym) || { lines: [], incomePlan: [], savingsPlan: [] };
  const topM = () => $$('.modal').pop() || document.createElement('div');
  const mq = sel => topM().querySelector(sel), mqa = sel => [...topM().querySelectorAll(sel)];
  const modalBtn = label => mqa('.modal-foot button').find(b => txt(b) === label);

  log('BUDGET · EMPTY STATE');
  await goBudget();
  t('page title', txt($('#page-title')) === 'Budget', txt($('#page-title')));
  t('Save Budget button present', !!$('[data-action="budget-save"]'));
  t('Clear Budget button present', !!$('[data-action="budget-clear"]'));
  t('Save disabled with no categories', $('[data-action="budget-save"]').disabled);
  t('Clear disabled with no categories', $('[data-action="budget-clear"]').disabled);
  t('no permanent Saved Budgets section on the page', !$('#main-content .bud-saved') && !txt($('#main-content')).includes('No saved budgets'));
  t('Load Saved Budgets button present', !!$('[data-action="budget-saved"]') && txt($('[data-action="budget-saved"]')).includes('Load Saved Budgets'));
  await openSB();
  t('Saved Budgets dialog opens', !!$('.modal .bud-saved') && topH2() === 'Saved Budgets', topH2());
  t('empty state shown', txt($('.bud-saved')).includes('No saved budgets yet'));
  t('empty state hides Save with nothing to save', !$('.bud-saved [data-action="budget-save"]'));
  UI.closeAll(); await tick(80);
  t('dialog closes', !$('.modal'));

  log('BUDGET · SAVE');
  Store.setBudgetLine(ym, 'c_food', 800000);
  Store.setBudgetLine(ym, 'c_house', 450000);
  Store.setBudgetLine(ym, 'c_health', 120000);
  Store.setPlan(ym, 'incomePlan', [{ id: 'x1', label: 'Salary', amount: 2000000 }]);
  Store.setPlan(ym, 'savingsPlan', [{ id: 'x2', label: 'Emergency fund', amount: 300000 }]);
  await tick(250);
  await goBudget();
  t('Save enabled once the budget has categories', !$('[data-action="budget-save"]').disabled);
  t('Clear enabled once the budget has categories', !$('[data-action="budget-clear"]').disabled);

  click($('[data-action="budget-save"]')); await tick(150);
  t('save dialogue opens', txt($('.modal h2')) === 'Save Budget', txt($('.modal h2')));
  const suggested = $('#bus_name').value;
  t('default name budget-YYYY-MM-DD-HH-MM', /^budget-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}$/.test(suggested), suggested);
  t('no Save as New for an unsaved budget', !modalBtn('Save as New'));
  $('#bus_name').value = 'Household Plan';
  submit($('#bud-save-form')); await tick(300);
  t('dialogue closed', !$('.modal'));
  t('saved server-side', S.savedBudgets.length === 1, S.savedBudgets.length);
  t('name stored', S.savedBudgets[0].name === 'Household Plan', S.savedBudgets[0].name);
  t('categories stored', S.savedBudgets[0].lines.length === 3, S.savedBudgets[0].lines);
  t('allocations stored (minor units)', S.savedBudgets[0].lines.map(l => l.amount).sort((a, b) => a - b).join() === '120000,450000,800000');
  t('source month stored', S.savedBudgets[0].sourceMonth === ym, S.savedBudgets[0].sourceMonth);
  t('planned income stored', S.savedBudgets[0].incomePlan.length === 1 && S.savedBudgets[0].incomePlan[0].label === 'Salary');
  t('savings target stored', S.savedBudgets[0].savingsPlan.length === 1);
  t('no transaction was created', S.transactions.length === 0);

  log('BUDGET · SAVED BUDGETS DIALOG');
  t('page shows the saved count on the button', txt($('[data-action="budget-saved"]')).includes('1'));
  await openSB();
  t('one card in the dialog', savedRows().length === 1, savedNames());
  const card = savedRows()[0];
  t('name shown', txt(card).includes('Household Plan'));
  t('categories and total shown', txt(card).includes('3 categories') && txt(card).includes('13,700.00'), txt(card));
  t('updated date shown', txt(card).includes('updated') && !txt(card).includes('updated -'));
  t('Preview, Load and Delete actions', !!card.querySelector('[data-action="budget-preview"]')
    && !!card.querySelector('[data-action="budget-load"]') && !!card.querySelector('[data-action="budget-saved-del"]'));
  t('Load is the primary action', card.querySelector('[data-action="budget-load"]').classList.contains('btn-primary'));
  t('Delete separated from Load', !!card.querySelector('.gro-saved-sep'));
  t('Loaded chip on the saved card', txt(card.querySelector('.saved-tpl-name')).includes('Loaded'));
  t('dialog body does not overflow horizontally', $('.modal .modal-body').scrollWidth <= $('.modal .modal-body').clientWidth + 1);

  log('BUDGET · QUICK PREVIEW');
  const sbId = S.savedBudgets[0].id;
  await openSB(); click($(`.bud-saved [data-action="budget-preview"][data-arg="${sbId}"]`)); await tick(200);
  t('preview opens', !!$('.modal'));
  t('shows the budget name', txt(mq('h2')) === 'Household Plan', txt(mq('h2')));
  t('shows the period', txt($('.prev-meta')).includes(Core.monthLabel(ym)), txt($('.prev-meta')));
  t('shows created and updated', txt($('.prev-meta')).includes('Created') && txt($('.prev-meta')).includes('Updated'));
  t('lists every category', $$('.modal .prev-list .prev-row').length >= 3, $$('.modal .prev-list .prev-row').length);
  t('shows category names', txt(mq('.modal-body')).includes('Food') && txt(mq('.modal-body')).includes('Household'));
  t('shows allocations', txt(mq('.modal-body')).includes('8,000.00') && txt(mq('.modal-body')).includes('4,500.00'));
  t('shows the total', txt($('#bud-prev-total')).includes('13,700.00'), txt($('#bud-prev-total')));
  t('shows the planned income rows', txt(mq('.modal-body')).includes('Salary'));
  t('read-only: no inputs, selects or textareas', !mqa('.modal-body input, .modal-body select, .modal-body textarea').length);
  t('read-only: no destructive actions inside', !mqa('.modal-body [data-action]').length);
  t('actions are Close and Load Budget', !!modalBtn('Close') && !!modalBtn('Load Budget')
    && mqa('.modal-foot button').length === 2, mqa('.modal-foot button').map(txt));
  const before = JSON.stringify(S);
  click(modalBtn('Close')); await tick(150);
  t('Close leaves everything unchanged', $$('.modal').length === 1 && JSON.stringify(S) === before);
  t('Saved Budgets dialog still open under the preview', !!$('.modal .bud-saved'));
  UI.closeAll(); await tick(80);

  log('BUDGET · CLEAR');
  click($('[data-action="budget-clear"]')); await tick(150);
  t('clear asks for confirmation', txt($('.modal h2')) === 'Clear Budget?', txt($('.modal h2')));
  t('confirmation names the month', txt($('.modal-body')).includes(Core.monthLabel(ym)));
  t('confirmation promises saved budgets are kept', txt($('.modal-body')).toLowerCase().includes('saved budgets'));
  click(btn('Cancel')); await tick(150);
  t('cancel keeps the budget', !$('.modal') && serverBudget().lines.length === 3);
  click($('[data-action="budget-clear"]')); await tick(150);
  click(modalBtn('Clear Budget')); await tick(350);
  t('working budget cleared server-side', !S.budgets.some(b => b.month === ym), S.budgets);
  t('working budget cleared in the Store', !Store.budgetFor(ym) || !Store.budgetFor(ym).lines.length);
  t('saved budget survives the clear', S.savedBudgets.length === 1);
  t('expenses survive the clear', S.transactions.length === 0 && Store.get().transactions.length === 0);
  await tick(50);
  t('Clear is disabled again', $('[data-action="budget-clear"]').disabled);
  t('Save is disabled again', $('[data-action="budget-save"]').disabled);
  await openSB();
  t('Loaded chip cleared', !txt($('.bud-saved')).includes('Loaded'));

  log('BUDGET · LOAD');
  await openSB(); click($(`.bud-saved [data-action="budget-load"][data-arg="${sbId}"]`)); await tick(350);
  t('loads without a confirmation when the month is empty', !$('.modal'));
  t('Saved Budgets dialog closed after a successful load', !$('.bud-saved'));
  t('categories restored server-side', serverBudget().lines.length === 3, serverBudget().lines);
  t('allocations restored', serverBudget().lines.map(l => l.amount).sort((a, b) => a - b).join() === '120000,450000,800000');
  t('plans restored', serverBudget().incomePlan.length === 1 && serverBudget().savingsPlan.length === 1);
  t('Store shows the loaded budget', (Store.budgetFor(ym) || { lines: [] }).lines.length === 3);
  t('budget page shows the categories', txt($('#main-content')).includes('Food') && txt($('#main-content')).includes('8,000.00'));
  t('no transaction created by loading', S.transactions.length === 0);
  t('template unchanged by loading', S.savedBudgets[0].lines.length === 3);
  await openSB();
  t('Loaded chip back on the card', txt($('.bud-saved')).includes('Loaded'));

  log('BUDGET · LOAD OVER AN EXISTING PLAN');
  Store.setBudgetLine(ym, 'c_food', 999900); await tick(200); await goBudget();
  await openSB(); click($(`.bud-saved [data-action="budget-load"][data-arg="${sbId}"]`)); await tick(200);
  t('asks before replacing a non-empty budget', !!$('.modal') && topH2().includes('Replace'), topH2());
  click(btn('Cancel')); await tick(150);
  t('cancel keeps the edited budget', serverBudget().lines.find(l => l.categoryId === 'c_food').amount === 999900);
  await openSB(); click($(`.bud-saved [data-action="budget-load"][data-arg="${sbId}"]`)); await tick(200);
  click(modalBtn('Load Budget')); await tick(350);
  t('Saved Budgets dialog closed after a confirmed load', !$('.modal'), $$('.modal h2').map(txt));
  t('confirm restores the saved allocation', serverBudget().lines.find(l => l.categoryId === 'c_food').amount === 800000);

  log('BUDGET · PREVIEW -> LOAD BUDGET');
  Store.setBudgetLine(ym, 'c_food', 111100); await tick(200); await goBudget();
  await openSB(); click($(`.bud-saved [data-action="budget-preview"][data-arg="${sbId}"]`)); await tick(200);
  click(modalBtn('Load Budget')); await tick(200);
  t('Load Budget from the preview runs the normal load flow', !!$('.modal') && topH2().includes('Replace'));
  click(modalBtn('Load Budget')); await tick(350);
  t('all dialogs closed after loading from the preview', !$('.modal'), $$('.modal h2').map(txt));
  t('budget loaded from the preview', serverBudget().lines.find(l => l.categoryId === 'c_food').amount === 800000);

  log('BUDGET · SAVE AS NEW / OVERWRITE');
  Store.setBudgetLine(ym, 'c_health', 0); await tick(200); await goBudget();
  click($('[data-action="budget-save"]')); await tick(150);
  t('a loaded budget offers Save and Save as New', !!modalBtn('Save') && !!modalBtn('Save as New'));
  t('name prefilled with the loaded template name', $('#bus_name').value === 'Household Plan', $('#bus_name').value);
  click(modalBtn('Save as New')); await tick(350);
  t('Save as New creates a second template', S.savedBudgets.length === 2, S.savedBudgets.map(b => b.name));
  t('the new template has the edited categories', S.savedBudgets[1].lines.length === 2, S.savedBudgets[1].lines);
  t('the original template is untouched', S.savedBudgets[0].lines.length === 3);
  await goBudget();
  await openSB();
  t('two rows in the dialog', savedRows().length === 2, savedNames());
  click($('[data-action="budget-save"]')); await tick(150);
  click(modalBtn('Save')); await tick(350);
  t('Save overwrites the loaded template', S.savedBudgets.length === 2);
  t('overwrite kept the name', S.savedBudgets[1].name === 'Household Plan');

  log('BUDGET · DELETE');
  const keepId = S.savedBudgets[0].id, dropId = S.savedBudgets[1].id;
  await openSB(); click($(`.bud-saved [data-action="budget-saved-del"][data-arg="${dropId}"]`)); await tick(200);
  t('delete asks for confirmation', topH2() === 'Delete Saved Budget?', topH2());
  click(btn('Cancel')); await tick(150);
  t('cancel keeps the template', S.savedBudgets.length === 2);
  await openSB(); click($(`.bud-saved [data-action="budget-saved-del"][data-arg="${dropId}"]`)); await tick(200);
  click(btn('Delete')); await tick(350);
  t('dialog refreshed after delete', savedRows().length === 1 && !!$('.bud-saved'), savedNames());
  t('template deleted', S.savedBudgets.length === 1 && S.savedBudgets[0].id === keepId, S.savedBudgets.map(b => b.id));
  t('the month budget survives the delete', serverBudget().lines.length === 2, serverBudget().lines);
  t('expenses survive the delete', S.transactions.length === 0);

  log('BUDGET · PERSISTENCE');
  await Store.hydrate(); App.render(); await tick(200); await goBudget();
  await openSB();
  t('saved budgets survive a reload', Store.savedBudgets().length === 1 && savedRows().length === 1);
  UI.closeAll(); await tick(60);
  t('the month budget survives a reload', (Store.budgetFor(ym) || { lines: [] }).lines.length === 2);
};
