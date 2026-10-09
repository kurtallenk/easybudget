/* ============================================================
   05 · FORMS - create/edit dialogs for every entity
   ============================================================ */
const Forms = (() => {
  const { el, esc, icon, $, $$, today, money } = Core;
  const F = UI.fieldHTML;

  const catOptions = kind => Store.categories(kind).map(c => ({ value: c.id, label: `${c.emoji} ${c.name}` }));
  const accOptions = (includeBlank) => (includeBlank ? [{ value: '', label: 'None' }] : []).concat(
    Store.accounts().map(a => ({ value: a.id, label: a.name })));
  const methodOptions = Store.PAYMENT_METHODS.map(m => ({ value: m, label: m }));
  const freqOptions = Store.FREQUENCIES.map(f => ({ value: f.id, label: f.name }));

  const needAccount = () => {
    if (Store.accounts().length) return false;
    UI.toast('Add an account first', 'Transactions need somewhere to live.', 'warn');
    account();
    return true;
  };

  /* ---------------- Transaction ---------------- */
  function transaction(opts = {}) {
    if (needAccount()) return;
    const tx = opts.tx || null;
    let type = tx?.type || opts.type || 'expense';
    const form = el('form', { novalidate: 'true', id: 'tx-form' });
    const render = () => {
      const isT = type === 'transfer';
      form.innerHTML = `
        <div class="segmented type" role="group" aria-label="Transaction type" style="margin-bottom:16px">
          ${['expense', 'income', 'transfer'].map(v => `<button type="button" data-v="${v}" aria-pressed="${type === v}">${v[0].toUpperCase() + v.slice(1)}</button>`).join('')}
        </div>
        <div class="form-grid">
          <div class="full">${F({ name: 'amount', label: 'Amount', type: 'money', value: tx ? (tx.amount / 100).toFixed(2) : '', required: true })}</div>
          ${isT ? '' : `<div class="full">${F({ name: 'description', label: 'Description', value: tx?.description || '', placeholder: type === 'income' ? 'e.g. Monthly salary' : 'e.g. Groceries at SM', required: true })}</div>`}
          ${isT ? '' : F({ name: 'categoryId', label: 'Category', type: 'select', value: tx?.categoryId || '', required: true, options: [{ value: '', label: 'Select category…' }].concat(catOptions(type)) })}
          ${F({ name: 'date', label: 'Date', type: 'date', value: tx?.date || today(), required: true })}
          ${F({ name: 'accountId', label: isT ? 'From account' : 'Account', type: 'select', value: tx?.accountId || Store.accounts()[0]?.id || '', required: true, options: accOptions() })}
          ${isT ? F({ name: 'toAccountId', label: 'To account', type: 'select', value: tx?.toAccountId || '', required: true, options: [{ value: '', label: 'Select account…' }].concat(accOptions()) })
                : F({ name: 'method', label: 'Payment method', type: 'select', value: tx?.method || 'Cash', options: methodOptions })}
          ${isT ? `<div class="full">${F({ name: 'description', label: 'Description', value: tx?.description || 'Transfer between accounts', required: true })}</div>` : ''}
          <div class="full">${F({ name: 'notes', label: 'Notes', type: 'textarea', value: tx?.notes || '', placeholder: 'Optional details', rows: 2 })}</div>
          ${tx || isT ? '' : `<div class="full"><label class="row" style="gap:10px;cursor:pointer">
            <span class="switch"><input type="checkbox" name="makeRecurring"><span></span></span>
            <span><span class="lbl">Make this recurring</span><br><span class="hint">Creates a recurring rule you can manage later.</span></span></label></div>`}
        </div>`;
      $$('.segmented.type button', form).forEach(b => b.addEventListener('click', () => { type = b.dataset.v; render(); setTimeout(() => $('#f_amount', form)?.focus(), 10); }));
    };
    render();

    const submit = el('button', { class: 'btn btn-primary', type: 'submit', form: 'tx-form' }, tx ? 'Save changes' : 'Add transaction');
    const foot = el('div', { class: 'row wrap', style: 'width:100%;gap:9px' });
    foot.innerHTML = '<span class="spacer"></span>';
    foot.appendChild(el('button', { class: 'btn', type: 'button', onclick: () => UI.closeTop() }, 'Cancel'));
    foot.appendChild(submit);

    const m = UI.modal({ title: tx ? 'Edit transaction' : 'Add transaction', subtitle: tx ? 'Update the details of this entry.' : 'Record income, an expense, or a transfer.', body: form, footer: foot });

    form.addEventListener('submit', e => {
      e.preventDefault();
      const data = UI.readForm(form); data.type = type;
      const res = tx ? Store.updateTx(tx.id, data) : Store.addTx(data);
      if (res.duplicate) {
        UI.confirm({ title: 'Possible duplicate', danger: false, confirmLabel: 'Add anyway',
          message: 'A transaction with the same amount, date, account and description already exists. Add it anyway?',
          onConfirm: () => { const r2 = Store.addTx(data, { allowDuplicate: true }); if (r2.ok) { m.close(); UI.toast('Transaction added'); postCreate(data, r2.value); } } });
        return;
      }
      if (!res.ok) { UI.showErrors(form, res.errors); return; }
      m.close();
      UI.toast(tx ? 'Transaction updated' : 'Transaction added', `${res.value.type === 'expense' ? '−' : res.value.type === 'income' ? '+' : ''}${money(res.value.amount)} · ${Core.fdate(res.value.date)}`);
      if (!tx) postCreate(data, res.value);
      opts.onDone && opts.onDone(res.value);
    });
  }
  const postCreate = (data, value) => {
    if (data.makeRecurring) {
      Store.addRecurring({ name: value.description, type: value.type, amount: value.amount / 100, categoryId: value.categoryId,
        accountId: value.accountId, method: value.method, frequency: 'monthly', nextDate: Store.advance(value.date, 'monthly'), autoPost: false });
      UI.toast('Recurring rule created', 'Manage it under Recurring.', 'info');
    }
  };

  /* ---------------- Account ---------------- */
  function account(opts = {}) {
    const a = opts.account || null;
    const form = el('form', { novalidate: 'true', id: 'acc-form' }, `
      <div class="form-grid">
        <div class="full">${F({ name: 'name', label: 'Account name', value: a?.name || '', placeholder: 'e.g. BPI Payroll', required: true })}</div>
        ${F({ name: 'type', label: 'Account type', type: 'select', value: a?.type || 'cash', options: Store.ACCOUNT_TYPES.map(t => ({ value: t.id, label: t.name })) })}
        ${F({ name: 'openingBalance', label: a ? 'Opening balance' : 'Starting balance', type: 'money', value: a ? (a.openingBalance / 100).toFixed(2) : '0.00', hint: 'Use a negative value for money owed.' })}
        <div class="full">${F({ name: 'note', label: 'Note', value: a?.note || '', placeholder: 'Optional' })}</div>
      </div>`);
    const foot = el('div', { class: 'row wrap', style: 'width:100%;gap:9px' });
    foot.innerHTML = '<span class="spacer"></span>';
    foot.appendChild(el('button', { class: 'btn', type: 'button', onclick: () => UI.closeTop() }, 'Cancel'));
    foot.appendChild(el('button', { class: 'btn btn-primary', type: 'submit', form: 'acc-form' }, a ? 'Save changes' : 'Add account'));
    const m = UI.modal({ title: a ? 'Edit account' : 'Add account', subtitle: 'Accounts track where your money actually sits.', body: form, footer: foot, size: 'sm' });
    form.addEventListener('submit', e => {
      e.preventDefault();
      const d = UI.readForm(form);
      const res = a ? Store.updateAccount(a.id, d) : Store.addAccount(d);
      if (!res.ok) return UI.showErrors(form, res.errors);
      m.close(); UI.toast(a ? 'Account updated' : 'Account added', res.value.name);
      opts.onDone && opts.onDone(res.value);
    });
  }

  /* ---------------- Goal ---------------- */
  function goal(opts = {}) {
    const g = opts.goal || null;
    const form = el('form', { novalidate: 'true', id: 'goal-form' }, `
      <div class="form-grid">
        <div class="full">${F({ name: 'name', label: 'Goal name', value: g?.name || '', placeholder: 'e.g. Emergency Fund', required: true })}</div>
        ${F({ name: 'target', label: 'Target amount', type: 'money', value: g ? (g.target / 100).toFixed(2) : '', required: true })}
        ${F({ name: 'current', label: 'Already saved', type: 'money', value: g ? (g.current / 100).toFixed(2) : '0.00' })}
        ${F({ name: 'targetDate', label: 'Target date', type: 'date', value: g?.targetDate || '', hint: 'Used to suggest a monthly amount.' })}
        ${F({ name: 'accountId', label: 'Linked account', type: 'select', value: g?.accountId || '', options: accOptions(true) })}
        ${F({ name: 'emoji', label: 'Icon', value: g?.emoji || '🎯', attrs: 'maxlength="4"' })}
        ${F({ name: 'color', label: 'Colour', type: 'color', value: g?.color || '#0ca678' })}
        <div class="full">${F({ name: 'description', label: 'Description', type: 'textarea', rows: 2, value: g?.description || '', placeholder: 'What is this goal for?' })}</div>
      </div>`);
    const foot = el('div', { class: 'row wrap', style: 'width:100%;gap:9px' });
    foot.innerHTML = '<span class="spacer"></span>';
    foot.appendChild(el('button', { class: 'btn', type: 'button', onclick: () => UI.closeTop() }, 'Cancel'));
    foot.appendChild(el('button', { class: 'btn btn-primary', type: 'submit', form: 'goal-form' }, g ? 'Save goal' : 'Create goal'));
    const m = UI.modal({ title: g ? 'Edit savings goal' : 'New savings goal', body: form, footer: foot });
    form.addEventListener('submit', e => {
      e.preventDefault();
      const res = g ? Store.updateGoal(g.id, UI.readForm(form)) : Store.addGoal(UI.readForm(form));
      if (!res.ok) return UI.showErrors(form, res.errors);
      m.close(); UI.toast(g ? 'Goal updated' : 'Goal created', res.value.name);
      opts.onDone && opts.onDone(res.value);
    });
  }

  function contribute(goalId) {
    const g = Store.get().goals.find(x => x.id === goalId); if (!g) return;
    const p = Compute.goalProgress(g);
    const form = el('form', { novalidate: 'true', id: 'contrib-form' }, `
      <p class="small muted" style="margin-bottom:14px">${esc(g.name)} · ${money(g.current)} of ${money(g.target)} saved${p.perMonth ? ` · suggested ${money(p.perMonth)}/month` : ''}</p>
      <div class="form-grid">
        <div class="full">${F({ name: 'amount', label: 'Contribution amount', type: 'money', value: p.perMonth ? (p.perMonth / 100).toFixed(2) : '', required: true })}</div>
        ${F({ name: 'accountId', label: 'From account', type: 'select', value: Store.accounts()[0]?.id || '', options: accOptions() })}
        ${F({ name: 'date', label: 'Date', type: 'date', value: today(), required: true })}
      </div>`);
    const foot = el('div', { class: 'row wrap', style: 'width:100%;gap:9px' });
    foot.innerHTML = '<span class="spacer"></span>';
    foot.appendChild(el('button', { class: 'btn', type: 'button', onclick: () => UI.closeTop() }, 'Cancel'));
    foot.appendChild(el('button', { class: 'btn btn-primary', type: 'submit', form: 'contrib-form' }, 'Add contribution'));
    const m = UI.modal({ title: 'Add contribution', size: 'sm', body: form, footer: foot });
    form.addEventListener('submit', e => {
      e.preventDefault();
      const d = UI.readForm(form);
      const err = Store.V.amount(d.amount, { label: 'Contribution' });
      if (err) return UI.showErrors(form, { amount: err });
      Store.contributeGoal(goalId, Core.toMinor(d.amount), d.accountId, d.date);
      m.close(); UI.toast('Contribution recorded', `${money(Core.toMinor(d.amount))} towards ${g.name}`);
    });
  }

  /* ---------------- Recurring ---------------- */
  function recurring(opts = {}) {
    if (needAccount()) return;
    const r = opts.rec || null;
    let type = r?.type || 'expense';
    const form = el('form', { novalidate: 'true', id: 'rec-form' });
    const render = () => {
      form.innerHTML = `
        <div class="segmented type" role="group" aria-label="Type" style="margin-bottom:16px">
          ${['expense', 'income'].map(v => `<button type="button" data-v="${v}" aria-pressed="${type === v}">${v[0].toUpperCase() + v.slice(1)}</button>`).join('')}
        </div>
        <div class="form-grid">
          <div class="full">${F({ name: 'name', label: 'Name', value: r?.name || '', placeholder: type === 'income' ? 'e.g. Monthly salary' : 'e.g. Netflix', required: true })}</div>
          ${F({ name: 'amount', label: 'Amount', type: 'money', value: r ? (r.amount / 100).toFixed(2) : '', required: true })}
          ${F({ name: 'frequency', label: 'Frequency', type: 'select', value: r?.frequency || 'monthly', options: freqOptions })}
          ${F({ name: 'categoryId', label: 'Category', type: 'select', value: r?.categoryId || '', required: true, options: [{ value: '', label: 'Select category…' }].concat(catOptions(type)) })}
          ${F({ name: 'accountId', label: 'Account', type: 'select', value: r?.accountId || Store.accounts()[0]?.id || '', required: true, options: accOptions() })}
          ${F({ name: 'nextDate', label: 'Next occurrence', type: 'date', value: r?.nextDate || today(), required: true })}
          ${F({ name: 'endDate', label: 'Ends on', type: 'date', value: r?.endDate || '', hint: 'Optional' })}
          ${F({ name: 'method', label: 'Payment method', type: 'select', value: r?.method || 'Auto-Debit', options: methodOptions })}
          <div class="full"><label class="row" style="gap:10px;cursor:pointer">
            <span class="switch"><input type="checkbox" name="autoPost" ${r ? (r.autoPost ? 'checked' : '') : ''}><span></span></span>
            <span><span class="lbl">Post automatically when due</span><br><span class="hint">Creates the transaction for you on the due date.</span></span></label></div>
          <div class="full">${F({ name: 'notes', label: 'Notes', type: 'textarea', rows: 2, value: r?.notes || '' })}</div>
        </div>`;
      $$('.segmented.type button', form).forEach(b => b.addEventListener('click', () => { type = b.dataset.v; render(); }));
    };
    render();
    const foot = el('div', { class: 'row wrap', style: 'width:100%;gap:9px' });
    foot.innerHTML = '<span class="spacer"></span>';
    foot.appendChild(el('button', { class: 'btn', type: 'button', onclick: () => UI.closeTop() }, 'Cancel'));
    foot.appendChild(el('button', { class: 'btn btn-primary', type: 'submit', form: 'rec-form' }, r ? 'Save' : 'Create rule'));
    const m = UI.modal({ title: r ? 'Edit recurring transaction' : 'New recurring transaction', body: form, footer: foot });
    form.addEventListener('submit', e => {
      e.preventDefault();
      const d = UI.readForm(form); d.type = type;
      const res = r ? Store.updateRecurring(r.id, d) : Store.addRecurring(d);
      if (!res.ok) return UI.showErrors(form, res.errors);
      m.close(); UI.toast(r ? 'Recurring rule updated' : 'Recurring rule created', res.value.name);
      opts.onDone && opts.onDone(res.value);
    });
  }

  /* ---------------- Bill ---------------- */
  function bill(opts = {}) {
    const b = opts.bill || null;
    const form = el('form', { novalidate: 'true', id: 'bill-form' }, `
      <div class="form-grid">
        <div class="full">${F({ name: 'name', label: 'Bill name', value: b?.name || '', placeholder: 'e.g. Meralco electricity', required: true })}</div>
        ${F({ name: 'amount', label: 'Amount', type: 'money', value: b ? (b.amount / 100).toFixed(2) : '', required: true })}
        ${F({ name: 'dueDate', label: 'Due date', type: 'date', value: b?.dueDate || today(), required: true })}
        ${F({ name: 'categoryId', label: 'Category', type: 'select', value: b?.categoryId || '', required: true, options: [{ value: '', label: 'Select category…' }].concat(catOptions('expense')) })}
        ${F({ name: 'accountId', label: 'Pay from', type: 'select', value: b?.accountId || '', options: accOptions(true) })}
        ${F({ name: 'repeat', label: 'Repeats', type: 'select', value: b?.repeat || 'monthly', options: [{ value: 'once', label: 'Does not repeat' }].concat(freqOptions) })}
        ${F({ name: 'method', label: 'Payment method', type: 'select', value: b?.method || 'Auto-Debit', options: methodOptions })}
        <div class="full">${F({ name: 'notes', label: 'Notes', type: 'textarea', rows: 2, value: b?.notes || '' })}</div>
      </div>`);
    const foot = el('div', { class: 'row wrap', style: 'width:100%;gap:9px' });
    foot.innerHTML = '<span class="spacer"></span>';
    foot.appendChild(el('button', { class: 'btn', type: 'button', onclick: () => UI.closeTop() }, 'Cancel'));
    foot.appendChild(el('button', { class: 'btn btn-primary', type: 'submit', form: 'bill-form' }, b ? 'Save bill' : 'Add bill'));
    const m = UI.modal({ title: b ? 'Edit bill' : 'Add bill', body: form, footer: foot });
    form.addEventListener('submit', e => {
      e.preventDefault();
      const res = b ? Store.updateBill(b.id, UI.readForm(form)) : Store.addBill(UI.readForm(form));
      if (!res.ok) return UI.showErrors(form, res.errors);
      m.close(); UI.toast(b ? 'Bill updated' : 'Bill added', res.value.name);
      opts.onDone && opts.onDone(res.value);
    });
  }

  /* ---------------- Category ---------------- */
  function category(opts = {}) {
    const c = opts.cat || null;
    const form = el('form', { novalidate: 'true', id: 'cat-form' }, `
      <div class="form-grid">
        <div class="full">${F({ name: 'name', label: 'Category name', value: c?.name || '', required: true, placeholder: 'e.g. Pets' })}</div>
        ${F({ name: 'kind', label: 'Applies to', type: 'select', value: c?.kind || 'expense', options: [{ value: 'expense', label: 'Expenses' }, { value: 'income', label: 'Income' }], attrs: c ? 'disabled' : '' })}
        ${F({ name: 'emoji', label: 'Icon', value: c?.emoji || '🏷️', attrs: 'maxlength="4"' })}
        ${F({ name: 'color', label: 'Colour', type: 'color', value: c?.color || '#4c6ef5' })}
      </div>`);
    const foot = el('div', { class: 'row wrap', style: 'width:100%;gap:9px' });
    foot.innerHTML = '<span class="spacer"></span>';
    foot.appendChild(el('button', { class: 'btn', type: 'button', onclick: () => UI.closeTop() }, 'Cancel'));
    foot.appendChild(el('button', { class: 'btn btn-primary', type: 'submit', form: 'cat-form' }, c ? 'Save' : 'Add category'));
    const m = UI.modal({ title: c ? 'Edit category' : 'New category', size: 'sm', body: form, footer: foot });
    form.addEventListener('submit', e => {
      e.preventDefault();
      const d = UI.readForm(form); if (c) d.kind = c.kind;
      const res = c ? Store.updateCategory(c.id, d) : Store.addCategory(d);
      if (!res.ok) return UI.showErrors(form, res.errors);
      m.close(); UI.toast(c ? 'Category updated' : 'Category added', res.value.name);
      opts.onDone && opts.onDone(res.value);
    });
  }

  /* ---------------- Budget line ---------------- */
  function budgetLine(ym, categoryId) {
    const bgt = Compute.budgetSummary(ym);
    const existing = bgt.lines.find(l => l.categoryId === categoryId);
    const used = new Set(bgt.lines.map(l => l.categoryId));
    const opts = Store.categories('expense').filter(c => categoryId === c.id || !used.has(c.id)).map(c => ({ value: c.id, label: `${c.emoji} ${c.name}` }));
    if (!opts.length) return UI.toast('Every category is budgeted', 'Edit an existing line instead.', 'info');
    const form = el('form', { novalidate: 'true', id: 'bl-form' }, `
      <div class="form-grid">
        ${F({ name: 'categoryId', label: 'Category', type: 'select', value: categoryId || opts[0].value, options: opts, attrs: existing ? 'disabled' : '' })}
        ${F({ name: 'amount', label: 'Monthly limit', type: 'money', value: existing ? (existing.amount / 100).toFixed(2) : '', required: true })}
      </div>
      <p class="hint" style="margin-top:10px">Applies to ${esc(Core.monthLabel(ym))}.</p>`);
    const foot = el('div', { class: 'row wrap', style: 'width:100%;gap:9px' });
    foot.innerHTML = '<span class="spacer"></span>';
    foot.appendChild(el('button', { class: 'btn', type: 'button', onclick: () => UI.closeTop() }, 'Cancel'));
    foot.appendChild(el('button', { class: 'btn btn-primary', type: 'submit', form: 'bl-form' }, existing ? 'Save limit' : 'Add to budget'));
    const m = UI.modal({ title: existing ? 'Edit budget limit' : 'Add budget category', size: 'sm', body: form, footer: foot });
    form.addEventListener('submit', e => {
      e.preventDefault();
      const d = UI.readForm(form);
      const cid = existing ? categoryId : d.categoryId;
      const err = Store.V.amount(d.amount, { label: 'Monthly limit' });
      if (err) return UI.showErrors(form, { amount: err });
      Store.setBudgetLine(ym, cid, Core.toMinor(d.amount));
      m.close(); UI.toast('Budget saved', `${Store.catName(cid)} · ${money(Core.toMinor(d.amount))}`);
    });
  }

  /* ---------------- Quick add sheet ---------------- */
  function quickAdd() {
    const items = [
      ['Add expense', 'minus', 'red', () => transaction({ type: 'expense' })],
      ['Add income', 'plus', 'green', () => transaction({ type: 'income' })],
      ['Transfer money', 'transfer', 'blue', () => transaction({ type: 'transfer' })],
      ['Add bill', 'bills', 'amber', () => bill()],
      ['Add savings goal', 'goals', 'green', () => goal()],
      ['Add recurring', 'recurring', 'blue', () => recurring()],
      ['Add budget category', 'budget', 'blue', () => budgetLine(App.state.month)],
      ['Add account', 'wallet', 'gray', () => account()]
    ];
    const wrap = el('div', { class: 'stack-sm', style: 'padding-bottom:8px' });
    items.forEach(([label, ic, tone, fn]) => {
      const bg = { green: 'var(--pos-soft)', red: 'var(--neg-soft)', blue: 'var(--info-soft)', amber: 'var(--warn-soft)', gray: 'var(--surface-3)' }[tone];
      const fg = { green: 'var(--pos-text)', red: 'var(--neg-text)', blue: 'var(--info)', amber: 'var(--warn-text)', gray: 'var(--muted)' }[tone];
      const b = el('button', { class: 'btn btn-block', type: 'button', style: 'justify-content:flex-start;gap:12px;padding:12px 14px;min-height:52px' },
        `<span class="cat-ico" style="background:${bg};color:${fg};width:32px;height:32px">${icon(ic, 16)}</span><span style="font-weight:600">${esc(label)}</span>`);
      b.addEventListener('click', () => { UI.closeTop(); setTimeout(fn, 60); });
      wrap.appendChild(b);
    });
    UI.modal({ title: 'Quick add', subtitle: 'What would you like to record?', size: 'sm', body: wrap });
  }

  return { transaction, account, goal, contribute, recurring, bill, category, budgetLine, quickAdd };
})();


