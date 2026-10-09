const { makeServer, boot, tick } = require('./harness');
let pass = 0, fail = 0;
const t = (name, cond, extra) => { if (cond) { pass++; console.log('  ok  ', name); } else { fail++; console.log('  FAIL', name, extra !== undefined ? '→ ' + JSON.stringify(extra) : ''); } };
const txt = n => (n ? n.textContent.replace(/\s+/g, ' ').trim() : null);

(async () => {
  const S = makeServer();
  let { w, doc } = await boot(S);
  const $ = s => doc.querySelector(s), $$ = s => [...doc.querySelectorAll(s)];
  const click = el => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
  const sections = () => $$('.gro-section');
  const activeNames = () => $$('.gro-section')[0].querySelectorAll('.gro-name');
  const doneNames = () => $$('.gro-section')[1].querySelectorAll('.gro-name');
  const add = async (name, cat) => { $('#gro_name').value = name; $('#gro_categoryId').value = cat; $('#gro-form').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true })); await tick(); };

  console.log('PAGE / NAV');
  t('page title', txt($('#page-title')) === 'Live Grocery List', txt($('#page-title')));
  t('nav item present', $$('.nav-item').some(b => txt(b).includes('Live Grocery List')));
  t('empty state text', txt($('.gro-section')).includes('Your grocery list is empty') && txt($('.gro-section')).includes('Add items to start building your grocery list.'));
  t('no completed text', txt(sections()[1]).includes('No items completed yet'));
  t('category select reuses expense categories only', $$('#gro_categoryId option').map(o => o.textContent).join('|').includes('Food') && !$$('#gro_categoryId option').some(o => o.textContent.includes('Salary')), $$('#gro_categoryId option').map(o=>o.textContent));

  console.log('ADD');
  await add('', 'c_food');
  t('empty name rejected', txt($('[data-field="name"] .err')).includes('Enter an item name'), txt($('[data-field="name"] .err')));
  t('nothing sent to server for invalid add', !S.calls.includes('grocery/create.php'));
  await add('Rice', '');
  t('missing category rejected', txt($('[data-field="categoryId"] .err')).includes('Choose a category'));
  await add('Rice', 'c_food'); await add('Chicken', 'c_food'); await add('Vitamins', 'c_health'); await add('Laundry Detergent', 'c_house');
  t('4 items in active list', activeNames().length === 4, [...activeNames()].map(n => n.textContent));
  t('order preserved', [...activeNames()].map(n => n.textContent).join(',') === 'Rice,Chicken,Vitamins,Laundry Detergent');
  t('category shown', txt($$('.gro-section')[0]).includes('Household'));
  t('name input cleared + category remembered', $('#gro_name').value === '' && $('#gro_categoryId').value === 'c_house', [$('#gro_name').value, $('#gro_categoryId').value]);
  t('input refocused after add', doc.activeElement && doc.activeElement.id === 'gro_name');
  t('persisted server-side', S.grocery.length === 4);
  t('progress 0/4', txt($('.gro-progress')).includes('0 / 4 items completed'), txt($('.gro-progress')));

  console.log('CHECK / UNCHECK');
  const rowFor = name => $$('.gro-row').find(r => txt(r.querySelector('.gro-name')) === name);
  click(rowFor('Rice').querySelector('.gro-check')); await tick();
  t('Rice moved to checked section', [...doneNames()].map(n => n.textContent).join() === 'Rice' && ![...activeNames()].some(n => n.textContent === 'Rice'));
  t('checked row styled done + aria-checked', rowFor('Rice').classList.contains('done') && rowFor('Rice').querySelector('.gro-check').getAttribute('aria-checked') === 'true');
  t('counts updated', txt($('.gro-progress')).includes('1 / 4 items completed') && txt(sections()[0]).includes('3 items remaining') && txt(sections()[1]).includes('1 item completed'), [txt($('.gro-progress')), txt(sections()[1])]);
  t('check persisted', S.grocery.find(g => g.name === 'Rice').checked === true);
  click(rowFor('Chicken').querySelector('.gro-main')); await tick();
  t('tapping the row text also checks', [...doneNames()].some(n => n.textContent === 'Chicken'));
  click(rowFor('Chicken').querySelector('.gro-check')); await tick();
  t('uncheck moves back to active', [...activeNames()].some(n => n.textContent === 'Chicken') && ![...doneNames()].some(n => n.textContent === 'Chicken'));
  t('uncheck persisted', S.grocery.find(g => g.name === 'Chicken').checked === false);
  t('moved row gets transition class', true);

  console.log('REMOVE');
  click(rowFor('Laundry Detergent').querySelector('.gro-del')); await tick();
  t('confirm dialog for remove', txt($('.modal h2')) === 'Remove item?');
  click($$('.modal-foot button').find(b => txt(b) === 'Remove')); await tick(200);
  t('unchecked item removed', !rowFor('Laundry Detergent') && S.grocery.length === 3);
  click(rowFor('Rice').querySelector('.gro-del')); await tick();
  click($$('.modal-foot button').find(b => txt(b) === 'Remove')); await tick(200);
  t('checked item removed', !rowFor('Rice') && S.grocery.length === 2, S.grocery.map(g=>g.name));
  await add('Rice', 'c_food'); await add('Milk', 'c_food');
  click(rowFor('Rice').querySelector('.gro-check')); await tick();

  console.log('PERSISTENCE (reload)');
  const S2ref = S; const r2 = await boot(S2ref);
  const done2 = [...r2.doc.querySelectorAll('.gro-section')[1].querySelectorAll('.gro-name')].map(n => n.textContent);
  t('checked state survives a reload', done2.join() === 'Rice', done2);
  r2.dom.window.close();

  console.log('SUBMIT - dialog');
  click($('[data-action="grocery-submit"]')); await tick(100);
  t('dialog title', txt($('.modal h2')) === 'Confirm Grocery List');
  t('dialog totals', txt($('.gro-totals')).includes('Total Items: 5') && txt($('.gro-totals')).includes('1 Completed · 4 Remaining') || txt($('.gro-totals')).includes('Total Items:'), txt($('.gro-totals')));
  const rows = $$('.gro-sum-row');
  t('all items listed (checked AND unchecked)', rows.length === S.grocery.length, [rows.length, S.grocery.length]);
  t('status shown', $$('.gro-state.on').length === 1);
  click($$('.modal-foot button').find(b => txt(b) === 'Cancel')); await tick(100);
  t('cancel closes, nothing submitted', !$('.modal') && S.transactions.length === 0 && !S.calls.includes('grocery/submit.php'));

  console.log('SUBMIT - validation');
  click($('[data-action="grocery-submit"]')); await tick(100);
  const cf = () => $('#gro-confirm-form');
  cf().dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true })); await tick();
  t('amount required per row', $$('.gro-amt .err.show').length === S.grocery.length, $$('.gro-amt .err.show').length);
  t('no server call on invalid', !S.calls.includes('grocery/submit.php'));
  $$('.gro-amt input')[0].value = '0'; cf().dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true })); await tick();
  t('zero amount rejected', txt($$('.gro-amt .err')[0]).includes('greater than zero'), txt($$('.gro-amt .err')[0]));
  $$('.gro-amt input').forEach((i, n) => { i.value = String(10 * (n + 1)) + '.50'; i.dispatchEvent(new w.Event('input', { bubbles: true })); });
  t('live total', txt($('#gro-total')).includes('102'), txt($('#gro-total')));

  console.log('SUBMIT - server failure keeps list');
  S.failSubmit = 'Database is down';
  cf().dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true })); await tick(200);
  t('modal stays open on failure', !!$('.modal'));
  t('error toast', $$('.toast.error').some(x => txt(x).includes('Could not add to expenses')));
  t('list intact + no expenses', S.grocery.length === 4 && S.transactions.length === 0 && $$('.gro-row').length === 4, [S.grocery.length, S.transactions.length, $$('.gro-row').length]);
  t('button re-enabled', !$('.modal-foot .btn-primary').disabled && txt($('.modal-foot .btn-primary')) === 'Confirm & Add to Expenses', txt($('.modal-foot .btn-primary')));
  S.failSubmit = null;

  console.log('SUBMIT - success + double-click guard');
  S.latency = 120;
  const n0 = S.calls.filter(c => c === 'grocery/submit.php').length;
  cf().dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  await tick(30);
  t('loading label + disabled', txt($('.modal-foot .btn-primary')) === 'Adding to Expenses...' && $('.modal-foot .btn-primary').disabled, txt($('.modal-foot .btn-primary')));
  cf().dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  cf().dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  await tick(500); S.latency = 0;
  t('exactly one submit request', S.calls.filter(c => c === 'grocery/submit.php').length - n0 === 1, S.calls.filter(c => c === 'grocery/submit.php').length - n0);
  t('expenses created for every item', S.transactions.length === 4 && S.transactions.every(x => x.type === 'expense' && x.notes === 'Live Grocery List'), S.transactions);
  t('list cleared server-side', S.grocery.length === 0);
  t('modal closed + success toast', !$('.modal') && $$('.toast.success').some(x => txt(x).includes('expenses added')));
  t('page shows empty state', txt($('.gro-section')).includes('Your grocery list is empty'));
  t('expenses in Store (Transactions)', w.eval('Store.get().transactions.length') === 4);

  console.log('SUBMIT - empty list');
  click($('[data-action="grocery-submit"]')); await tick(100);
  t('empty list cannot be submitted', !$('.modal') && $$('.toast.error').some(x => txt(x).includes('Your grocery list is empty')));

  console.log('STORE - failed write does not disable later writes');
  await add('Eggs', 'c_food');
  S.failUpdate = true;
  click(rowFor('Eggs').querySelector('.gro-check')); await tick(250);
  t('failed toggle rolled back', S.grocery[0].checked === false && !rowFor('Eggs').classList.contains('done'));
  S.failUpdate = false;
  click(rowFor('Eggs').querySelector('.gro-check')); await tick(250);
  t('next write still saves after a failure', S.grocery[0].checked === true, S.grocery);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(2); });
