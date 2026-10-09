/* ============================================================
   Live Grocery List · end-to-end tests (headless Chromium)
   Drives the real SPA through the DOM against tools/grocery-tests/mock-api.js.
   Results are written into <pre id="test-results"> for tools/grocery-tests/run.sh.
   ============================================================ */
(async () => {
  const S = window.MockServer;
  const out = [];
  let pass = 0, fail = 0;
  const log = line => out.push(line);
  const t = (name, cond, extra) => {
    if (cond) { pass++; log('  ok   ' + name); }
    else { fail++; log('  FAIL ' + name + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')); }
  };
  const finish = () => {
    log('');
    log(pass + ' passed, ' + fail + ' failed');
    const pre = document.createElement('pre');
    pre.id = 'test-results';
    pre.textContent = '__RESULTS_START__\n' + out.join('\n') + '\n__RESULTS_END__';
    document.body.appendChild(pre);
    document.title = fail ? 'TESTS FAILED' : 'TESTS PASSED';
  };

  const tick = (ms = 120) => new Promise(r => setTimeout(r, ms));
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const txt = n => (n ? n.textContent.replace(/\s+/g, ' ').trim() : null);
  const click = e => e && e.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  const submit = f => f.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  const sections = () => $$('.gro-section');
  const activeNames = () => [...sections()[0].querySelectorAll('.gro-name')].map(n => n.textContent);
  const doneNames = () => [...sections()[1].querySelectorAll('.gro-name')].map(n => n.textContent);
  const rowFor = name => $$('.gro-row').find(r => txt(r.querySelector('.gro-name')) === name);
  const btn = label => $$('.modal-foot button').find(b => txt(b) === label);
  // Item entry lives in the Add Grocery Item dialog (Round 6): open it unless it is still open.
  const add = async (name, cat) => {
    if (!$('.modal #gro-form')) { click($('[data-action="grocery-add"]')); await tick(40); }
    $('#gro_name').value = name; $('#gro_categoryId').value = cat; submit($('#gro-form')); await tick();
  };
  const buy = async (name, price) => {
    click(rowFor(name).querySelector('[data-action="grocery-get"]')); await tick(80);
    $('#grp_price').value = String(price); submit($('#gro-price-form')); await tick(150);
  };

  const only = new URLSearchParams(location.search).get('only');

  try {
    while (!document.querySelector('.app')) await tick(100);
    App.go('grocery'); await tick(150);

    if (only === 'budget') {
      await window.BudgetTests({ t, log, tick, $, $$, txt, click, submit, btn, S });
      return finish();
    }

    if (only === 'onboarding') {
      await window.OnboardingTests({ t, log, tick, $, $$, txt, click, submit, S });
      return finish();
    }

    if (only === 'inbox') {
      await window.InboxTests({ t, log, tick, $, $$, txt, click, S });
      return finish();
    }

    if (only === 'admin') {
      await window.AdminTests({ t, log, tick, $, $$, txt, click, submit, S });
      return finish();
    }

    if (only === 'rows') {
      // Bills/Recurring action-button pass: run.sh loads this at several sizes.
      await window.RowActionTests({ t, log, tick, $, $$, txt, click, submit, btn, S });
      return finish();
    }

    if (only === 'template') {
      await window.TemplateTests({ t, log, tick, $, $$, txt, click, submit, btn, S });
      return finish();
    }

    if (only === 'modals') {
      // Responsive modal pass: run.sh loads this at several viewport sizes.
      await window.GroceryModalTests({ t, log, tick, $, $$, txt, click, submit, add, buy, btn, rowFor, S });
      return finish();
    }

    log('PAGE');
    t('page title', txt($('#page-title')) === 'Live Grocery List', txt($('#page-title')));
    t('nav item present', $$('.nav-item').some(b => txt(b).includes('Live Grocery List')));
    t('empty state', txt(sections()[0]).includes('Your grocery list is empty'));
    t('no purchases yet', txt(sections()[1]).includes('No items purchased yet'));
    click($('[data-action="grocery-add"]')); await tick(40);
    t('expense categories only', $$('#gro_categoryId option').length > 1 && !$$('#gro_categoryId option').some(o => o.textContent.includes('Salary')));
    UI.closeTop(); await tick(40);

    log('ADD');
    await add('', 'c_food');
    t('empty name rejected', txt($('[data-field="name"] .err')).includes('Enter an item name'));
    await add('Rice', '');
    t('missing category rejected', txt($('[data-field="categoryId"] .err')).includes('Choose a category'));
    await add('Rice', 'c_food'); await add('Chicken', 'c_food'); await add('Milk', 'c_food'); await add('Soap', 'c_house');
    t('4 active items', activeNames().length === 4, activeNames());
    t('order preserved', activeNames().join(',') === 'Rice,Chicken,Milk,Soap', activeNames());
    t('persisted server-side', S.grocery.length === 4);
    t('progress 0/4', txt($('.gro-progress')).includes('0 / 4 items purchased'), txt($('.gro-progress')));

    log('ACTIVE ITEM · GET ITEM BUTTON');
    t('no checkbox control left', !$$('.gro-check').length);
    t('every active row has a Get Item button', sections()[0].querySelectorAll('[data-action="grocery-get"]').length === 4);
    t('button label', txt(rowFor('Rice').querySelector('[data-action="grocery-get"]')).includes('Get Item'));

    log('PRICE DIALOGUE');
    click(rowFor('Rice').querySelector('[data-action="grocery-get"]')); await tick(80);
    t('dialogue opens', !!$('.modal') && txt($('.modal h2')) === 'Item Purchased', txt($('.modal h2')));
    t('item name shown', txt($('.gro-price-name')) === 'Rice');
    t('category shown', txt($('.gro-price-item')).includes('Food'));
    t('money input uses the app currency', txt($('.modal .amount-wrap .cur')) === Core.currency().symbol);
    submit($('#gro-price-form')); await tick();
    t('empty price rejected', txt($('#gro-price-form [data-field="price"] .err')).length > 0, txt($('#gro-price-form [data-field="price"] .err')));
    t('nothing saved yet', S.grocery.every(g => !g.checked));
    $('#grp_price').value = 'abc'; submit($('#gro-price-form')); await tick();
    t('non-numeric price rejected', txt($('[data-field="price"] .err')).includes('number'), txt($('[data-field="price"] .err')));
    $('#grp_price').value = '0'; submit($('#gro-price-form')); await tick();
    t('zero price rejected', txt($('[data-field="price"] .err')).includes('greater than zero'), txt($('[data-field="price"] .err')));
    $('#grp_price').value = '-5'; submit($('#gro-price-form')); await tick();
    t('negative price rejected', !!txt($('[data-field="price"] .err')));
    click(btn('Cancel')); await tick(80);
    t('cancel closes without changing the item', !$('.modal') && S.grocery.every(g => !g.checked) && activeNames().includes('Rice'));

    log('PURCHASE');
    await buy('Rice', '65');
    t('dialogue closed', !$('.modal'));
    t('item moved to Checked Grocery Items', doneNames().includes('Rice') && !activeNames().includes('Rice'), [activeNames(), doneNames()]);
    t('price stored server-side (minor units)', S.grocery.find(g => g.name === 'Rice').price === 6500, S.grocery.find(g => g.name === 'Rice'));
    t('purchased flag stored', S.grocery.find(g => g.name === 'Rice').checked === true);
    t('price visible in the completed row', txt(rowFor('Rice')).includes('65.00'), txt(rowFor('Rice')));
    t('progress counts the purchase', txt($('.gro-progress')).includes('1 / 4 items purchased'));
    t('purchased total in the section header', txt(sections()[1]).includes('65.00'), txt(sections()[1]));
    await buy('Chicken', '180.50');
    t('decimal price accepted', S.grocery.find(g => g.name === 'Chicken').price === 18050, S.grocery.find(g => g.name === 'Chicken'));
    t('two purchased, two active', doneNames().length === 2 && activeNames().length === 2, [doneNames(), activeNames()]);

    log('UNDO');
    click(rowFor('Chicken').querySelector('[data-action="grocery-undo"]')); await tick(150);
    t('item back in the active list', activeNames().includes('Chicken') && !doneNames().includes('Chicken'));
    t('purchase state reset', S.grocery.find(g => g.name === 'Chicken').checked === false);
    t('price cleared', S.grocery.find(g => g.name === 'Chicken').price === null, S.grocery.find(g => g.name === 'Chicken'));
    t('row shows Get Item again', !!rowFor('Chicken').querySelector('[data-action="grocery-get"]'));
    await buy('Chicken', '180');
    t('can be purchased again', S.grocery.find(g => g.name === 'Chicken').price === 18000);

    log('PERSISTENCE');
    await Store.hydrate(); App.render(); await tick(120);
    t('purchases survive a reload', doneNames().sort().join() === 'Chicken,Rice', doneNames());
    t('prices survive a reload', txt(sections()[1]).includes('65.00') && txt(sections()[1]).includes('180.00'));

    log('SUBMIT · DIALOG');
    click($('[data-action="grocery-submit"]')); await tick(120);
    t('dialog opens', txt($('.modal h2')) === 'Confirm Grocery List');
    t('all items listed', $$('.gro-sum-row').length === 4, $$('.gro-sum-row').length);
    t('no price inputs any more', !$$('#gro-confirm-form .gro-amt input').length);
    t('stored prices shown', txt($('.gro-sum-list')).includes('65.00') && txt($('.gro-sum-list')).includes('180.00'));
    t('unpurchased items marked', $$('.gro-sum-row.pending').length === 2 && txt($('.gro-sum-list')).includes('Not purchased'));
    t('total uses stored prices', txt($('#gro-total')).includes('245.00'), txt($('#gro-total')));
    t('counts', txt($('.gro-totals')).includes('2 Purchased') && txt($('.gro-totals')).includes('2 Not purchased'), txt($('.gro-totals')));
    click(btn('Cancel')); await tick(100);
    t('cancel submits nothing', !$('.modal') && S.transactions.length === 0);

    log('SUBMIT · FAILURE KEEPS THE LIST');
    click($('[data-action="grocery-submit"]')); await tick(120);
    S.failSubmit = 'Database is down';
    submit($('#gro-confirm-form')); await tick(250);
    t('modal stays open', !!$('.modal'));
    t('error toast', $$('.toast.error').some(x => txt(x).includes('Could not add to expenses')));
    t('list intact, no expenses', S.grocery.length === 4 && S.transactions.length === 0);
    S.failSubmit = null;

    log('SUBMIT · SUCCESS');
    S.latency = 120;
    const before = S.calls.filter(c => c === 'grocery/submit.php').length;
    submit($('#gro-confirm-form')); await tick(40);
    t('busy label', txt($('.modal-foot .btn-primary')) === 'Adding to Expenses...', txt($('.modal-foot .btn-primary')));
    submit($('#gro-confirm-form')); submit($('#gro-confirm-form'));
    await tick(600); S.latency = 0;
    t('exactly one request', S.calls.filter(c => c === 'grocery/submit.php').length - before === 1);
    t('only purchased items became expenses', S.transactions.length === 2, S.transactions.map(x => [x.description, x.amount]));
    t('expenses use the stored prices', S.transactions.map(x => x.amount).sort((a, b) => a - b).join() === '6500,18000', S.transactions.map(x => x.amount));
    t('created through the existing expense system', S.transactions.every(x => x.type === 'expense' && x.notes === 'Live Grocery List' && x.accountId === 'a_cash'));
    t('purchased items left the list', !S.grocery.some(g => g.checked));
    t('unpurchased items stay on the list', S.grocery.length === 2 && activeNames().sort().join() === 'Milk,Soap', activeNames());
    t('success toast', $$('.toast.success').some(x => txt(x).includes('expenses added')));
    t('expenses visible in the Store', Store.get().transactions.length === 2);

    log('SUBMIT · NOTHING PURCHASED');
    click($('[data-action="grocery-submit"]')); await tick(120);
    t('cannot submit without a purchase', !$('.modal') && $$('.toast.error').some(x => txt(x).includes('Nothing purchased yet')));

    log('REGRESSION · ROUTES RENDER');
    for (const r of ['dashboard', 'transactions', 'budget', 'accounts', 'goals', 'bills', 'recurring', 'analytics', 'summary', 'settings', 'grocery']) {
      App.go(r); await tick(70);
      const broke = /went wrong/.test(txt($('#main-content .empty h3')) || '');
      t('route renders: ' + r, !broke);
    }
    App.go('transactions'); await tick(100);
    t('grocery expenses appear in Transactions', txt($('#main-content')).includes('Rice') && txt($('#main-content')).includes('Chicken'));
    App.go('grocery'); await tick(100);

    log('REMOVE');
    click(rowFor('Soap').querySelector('[data-action="grocery-del"]')); await tick(100);
    t('remove asks for confirmation', txt($('.modal h2')) === 'Remove item?');
    click(btn('Remove')); await tick(200);
    t('item removed', !rowFor('Soap') && S.grocery.length === 1);

    const ctx = { t, log, tick, $, $$, txt, click, submit, add, buy, btn, rowFor, activeNames, doneNames, sections, S };
    if (window.GroceryPhase2Tests) await window.GroceryPhase2Tests(ctx);
    if (window.GroceryClearTests) await window.GroceryClearTests(ctx);
    if (window.GroceryPreviewTests) await window.GroceryPreviewTests(ctx);
  } catch (e) {
    fail++; log('  FAIL harness error: ' + (e && e.stack ? e.stack : e));
  }
  finish();
})();
