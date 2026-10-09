/* ============================================================
   07b · LIVE GROCERY LIST - shopping checklist that turns into expenses
   Items live in Store (server-backed like every other collection).
   Shopping flow: [Get Item] -> price dialogue -> the item is purchased, its
   price is stored on the item and it moves to Checked Grocery Items. Money is
   still created solely by "Confirm & Add to Expenses" (Store.submitGrocery),
   which reuses those stored prices - nobody types a price twice.
   ============================================================ */
const ViewsGrocery = (() => {
  const { el, esc, icon, $, $$, money, today } = Core;

  /** View-only state: survives the full re-render that follows every Store change. */
  const ui = { categoryId: '', moved: new Set(), loadedListId: null, loadedListName: '' };
  /** The open Saved Grocery Lists dialog (or null); grocery.render() keeps it in sync. */
  let savedDlg = null;

  const catOptions = () => [{ value: '', label: 'Choose a category' }]
    .concat(Store.categories('expense').map(c => ({ value: c.id, label: `${c.emoji} ${c.name}` })));

  /** Active items keep the order they were written in; checked items show the newest first. */
  const split = () => {
    const all = Store.groceryItems();
    const byTime = (a, b) => (a.createdAt || '').localeCompare(b.createdAt || '');
    return {
      all,
      active: all.filter(g => !g.checked).sort(byTime),
      done: all.filter(g => g.checked).sort((a, b) => (b.checkedAt || '').localeCompare(a.checkedAt || ''))
    };
  };
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

  const catLine = g => {
    const c = Store.catById(g.categoryId);
    return c ? `${esc(c.emoji)} ${esc(c.name)}` : 'Uncategorized';
  };

  const priceLine = g => (g.price != null ? `<span class="gro-price num">${money(g.price)}</span>` : '');

  const row = (g, done) => `
    <div class="gro-row ${done ? 'done' : ''} ${ui.moved.has(g.id) ? 'gro-in' : ''}">
      ${done
        ? `<span class="gro-state on gro-done-mark" aria-hidden="true">${icon('check', 14)}</span>`
        : `<button type="button" class="btn btn-sm btn-primary gro-get" data-action="grocery-get" data-arg="${esc(g.id)}"
            aria-label="Get item: ${esc(g.name)}">${icon('cart', 15)}Get Item</button>`}
      <div class="lr-main gro-main">
        <div class="gro-name">${esc(g.name)}</div>
        <div class="lr-sub">${catLine(g)}</div>
      </div>
      ${done ? priceLine(g) : ''}
      ${done
        ? `<button type="button" class="btn btn-sm gro-undo" data-action="grocery-undo" data-arg="${esc(g.id)}"
            aria-label="Undo purchase of ${esc(g.name)}">Undo</button>`
        : ''}
      <button type="button" class="mini-btn danger gro-del" data-action="grocery-del" data-arg="${esc(g.id)}" aria-label="Remove ${esc(g.name)}">${icon('trash', 16)}</button>
    </div>`;

  /* ---------- saved grocery lists (reusable templates) ---------- */
  const savedLists = () => Store.savedGroceryLists()
    .slice()
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));

  const stamp = v => (v ? Core.fdate(String(v).slice(0, 10)) : '-');

  /** One saved list (same data and actions the old page table had). */
  const savedCard = l => `
    <div class="gro-saved-card">
      <div class="gro-saved-main">
        <div class="gro-saved-name">${esc(l.name)}${ui.loadedListId === l.id ? '<span class="gro-chip">Loaded</span>' : ''}</div>
        <div class="lr-sub">${plural((l.items || []).length, 'item')} · created ${stamp(l.createdAt)} · updated ${stamp(l.updatedAt)}</div>
      </div>
      <div class="gro-saved-actions">
        <button type="button" class="btn btn-sm" data-action="grocery-list-preview" data-arg="${esc(l.id)}">Preview</button>
        <button type="button" class="btn btn-sm btn-primary" data-action="grocery-list-load" data-arg="${esc(l.id)}" aria-label="Load ${esc(l.name)}">Load</button>
        <span class="gro-saved-sep" aria-hidden="true"></span>
        <button type="button" class="mini-btn danger" data-action="grocery-list-del" data-arg="${esc(l.id)}" aria-label="Delete ${esc(l.name)}">${icon('trash', 16)}</button>
      </div>
    </div>`;

  /* Saved Grocery Lists live in a dialog, not on the page. */
  const savedBodyHTML = () => {
    const lists = savedLists();
    return lists.length
      ? `<p class="lr-sub gro-saved-intro">${plural(lists.length, 'saved list')} · Load replaces the items on your current list (you are asked first).</p>
         <div class="gro-saved-cards">${lists.map(savedCard).join('')}</div>`
      : UI.emptyState({ icon: 'inbox', title: 'No saved grocery lists yet', compact: true,
          desc: 'Create and save a grocery list to access it here later.',
          action: Store.groceryItems().length ? { label: 'Save Grocery List', action: 'grocery-save' } : null });
  };
  const topModal = () => { const ms = $$('.modal'); return ms[ms.length - 1] || null; };
  const openLists = () => {
    const body = el('div', { class: 'gro-saved' }, savedBodyHTML());
    const foot = el('div', { class: 'row', style: 'width:100%;gap:9px' });
    foot.innerHTML = '<span class="spacer"></span>';
    foot.appendChild(el('button', { class: 'btn', type: 'button', onclick: () => UI.closeTop() }, 'Close'));
    const m = UI.modal({ title: 'Saved Grocery Lists', subtitle: 'Reusable lists you saved earlier', body, footer: foot,
      onClose: () => { savedDlg = null; } });
    savedDlg = { node: m.node, body };
  };
  const refreshLists = () => {
    if (!savedDlg) return;
    if (!document.body.contains(savedDlg.node)) { savedDlg = null; return; }
    const hadFocus = savedDlg.node.contains(document.activeElement);
    savedDlg.body.innerHTML = savedBodyHTML();
    if (hadFocus || document.activeElement === document.body) {
      const f = $('.gro-saved-card button, .empty button', savedDlg.body) || $('.icon-btn', savedDlg.node);
      if (f && topModal() === savedDlg.node) f.focus();
    }
  };
  const closeLists = () => { if (savedDlg && topModal() === savedDlg.node) UI.closeTop(); };

  /* Add Grocery Item dialog: the same #gro-form fields, validation
     (Store.addGrocery → UI.showErrors) and remembered category as before. */
  const countLine = () => {
    const { all, active } = split();
    return `${plural(all.length, 'item')} on your list · ${plural(active.length, 'item')} still to buy`;
  };
  const openAdd = () => {
    const noCats = !Store.categories('expense').length;
    const form = el('form', { id: 'gro-form', class: 'gro-add', novalidate: 'true', autocomplete: 'off' }, `
      <p class="gro-add-count lr-sub" aria-live="polite">${esc(countLine())}</p>
      <div class="gro-add-grid">
        ${UI.fieldHTML({ name: 'name', label: 'Item name', placeholder: 'e.g. Rice, Chicken, Milk', required: true, idPrefix: 'gro', attrs: 'maxlength="120" enterkeyhint="done"' })}
        ${UI.fieldHTML({ name: 'categoryId', label: 'Category', type: 'select', value: ui.categoryId, required: true, idPrefix: 'gro', options: catOptions(), hint: noCats ? 'Add an expense category in Settings first.' : '' })}
      </div>
      <p class="hint gro-add-note">You enter the price when you tap Get Item while shopping.</p>`);
    const foot = el('div', { class: 'row gro-add-foot', style: 'width:100%;gap:9px' });
    foot.appendChild(el('button', { class: 'btn', type: 'button', onclick: () => UI.closeTop() }, 'Cancel'));
    foot.appendChild(el('span', { class: 'spacer' }));
    const another = el('button', { class: 'btn gro-add-another', type: 'button' }, 'Add another');
    foot.appendChild(another);
    const addBtn = el('button', { class: 'btn btn-primary gro-add-btn', type: 'submit', form: 'gro-form' }, `${icon('plus', 16)}Add Item`);
    foot.appendChild(addBtn);
    const m = UI.modal({ title: 'Add Grocery Item', size: 'sm', body: form, footer: foot });
    const nameInput = $('#gro_name', form);
    const submitAdd = keepOpen => {
      const d = UI.readForm(form);
      const r = Store.addGrocery(d);
      if (!r.ok) return void UI.showErrors(form, r.errors);
      ui.categoryId = d.categoryId;
      if (!keepOpen) return void m.close();
      UI.showErrors(form, {});
      nameInput.value = '';
      $('.gro-add-count', form).textContent = `Added "${r.value.name}". ${countLine()}`;
      nameInput.focus();
    };
    form.addEventListener('submit', e => { e.preventDefault(); submitAdd(false); });
    another.addEventListener('click', () => submitAdd(true));
  };

  const grocery = {
    title: 'Live Grocery List',
    subtitle: () => 'Tap Get Item as you buy, enter the price, then add everything to your expenses',
    render(host) {
      const { all, active, done } = split();
      const pct = all.length ? Math.round(done.length / all.length * 100) : 0;
      const noCats = !Store.categories('expense').length;

      const nSaved = Store.savedGroceryLists().length;
      host.innerHTML = `
        <section class="card card-pad gro-toolbar" aria-label="Grocery list overview">
          <div class="gro-progress" aria-live="polite">
            <div class="row" style="gap:10px;flex-wrap:wrap">
              <b>${done.length} / ${all.length} items purchased</b>
              ${ui.loadedListId && ui.loadedListName ? `<span class="gro-chip" title="Loaded from a saved list">${esc(ui.loadedListName)}</span>` : ''}
              <span class="spacer"></span>
              <span class="lr-sub">${plural(active.length, 'item')} remaining</span>
            </div>
            ${UI.progressBar(pct, 'ok')}
          </div>
          <div class="gro-actions">
            <button type="button" class="btn btn-primary gro-add-open" data-action="grocery-add" aria-haspopup="dialog">${icon('plus', 16)}Add Item</button>
            <button type="button" class="btn gro-lists-open" data-action="grocery-lists" aria-haspopup="dialog">${icon('inbox', 16)}Load Grocery List${nSaved ? ` <span class="badge gray" aria-label="${plural(nSaved, 'saved list')}">${nSaved}</span>` : ''}</button>
          </div>
        </section>

        <section class="card gro-section" aria-labelledby="gro-h-active">
          <div class="card-head"><h2 id="gro-h-active">Grocery List</h2><span class="sub spacer">${plural(active.length, 'item')} remaining</span></div>
          ${active.length ? `<div class="list">${active.map(g => row(g, false)).join('')}</div>`
            : all.length
              ? UI.emptyState({ icon: 'checkCircle', title: 'All items purchased', desc: 'Review the purchased items below, then submit your list.' })
              : UI.emptyState({ icon: 'cart', title: 'Your grocery list is empty', desc: 'Tap Add Item to start building your list, or load a list you saved earlier.' })}
        </section>

        <section class="card gro-section" aria-labelledby="gro-h-done">
          <div class="card-head"><h2 id="gro-h-done">Checked Grocery Items</h2><span class="sub spacer">${plural(done.length, 'item')} purchased${done.length ? ` · ${money(Core.sum(done, g => g.price || 0))}` : ''}</span></div>
          ${done.length ? `<div class="list">${done.map(g => row(g, true)).join('')}</div>`
            : '<div class="gro-none">No items purchased yet</div>'}
        </section>

        <div class="card card-pad gro-submit">
          <div class="lr-sub">Only purchased items become expenses, using the prices you entered while shopping.</div>
          <div class="row gro-submit-actions">
            <button type="button" class="btn btn-ghost gro-clear-btn" data-action="grocery-clear" ${all.length ? '' : 'disabled'}>${icon('trash', 16)}Clear List</button>
            <button type="button" class="btn gro-save-btn" data-action="grocery-save" ${all.length ? '' : 'disabled'}>${icon('download', 17)}Save Grocery List</button>
            <button type="button" class="btn btn-primary gro-submit-btn" data-action="grocery-submit">${icon('check', 18)}Submit Grocery List</button>
          </div>
        </div>`;

      refreshLists();
    }
  };

  /* ---------- actions ---------- */
  const flash = id => { ui.moved.add(id); setTimeout(() => ui.moved.delete(id), 700); };

  /**
   * "Get Item": the shopper found the product, so ask what it cost before the
   * item counts as purchased. Reuses the app's modal + money field + Store.V
   * validation; nothing changes until Confirm succeeds.
   */
  const getItem = id => {
    const g = Store.groceryItems().find(x => x.id === id); if (!g) return;

    const form = el('form', { novalidate: 'true', id: 'gro-price-form' }, `
      <div class="gro-price-item">
        <div class="gro-price-name">${esc(g.name)}</div>
        <div class="lr-sub">${catLine(g)}</div>
      </div>
      <p class="gro-intro">Enter the price you paid for this item.</p>
      ${UI.fieldHTML({ name: 'price', label: 'Price', type: 'money', required: true, idPrefix: 'grp', attrs: 'enterkeyhint="done"' })}`);

    const foot = el('div', { class: 'row', style: 'width:100%;gap:9px' });
    foot.innerHTML = '<span class="spacer"></span>';
    foot.appendChild(el('button', { class: 'btn', type: 'button', onclick: () => UI.closeTop() }, 'Cancel'));
    foot.appendChild(el('button', { class: 'btn btn-primary', type: 'submit', form: 'gro-price-form' }, 'Confirm'));

    const m = UI.modal({ title: 'Item Purchased', size: 'sm', body: form, footer: foot });

    form.addEventListener('submit', e => {
      e.preventDefault();
      const d = UI.readForm(form);
      const err = Store.V.amount(d.price, { label: 'Price' });
      if (err) return void UI.showErrors(form, { price: err });
      const r = Store.purchaseGrocery(id, d.price);
      if (!r.ok) return void UI.showErrors(form, r.errors);
      flash(id);
      m.close();
      UI.toast('Item purchased', `${g.name} · ${money(r.value.price)}`, 'success', 2200);
    });
  };

  /** Undo a purchase: back to the active list with the price cleared. */
  const undo = id => {
    const g = Store.groceryItems().find(x => x.id === id); if (!g) return;
    flash(id);
    Store.unpurchaseGrocery(id);
    UI.toast('Moved back to your list', `${g.name} is no longer marked as purchased and its price was cleared.`, 'warn', 2600);
  };

  /** Kept for the old checkbox action: no price means it can only un-purchase. */
  const toggle = id => {
    const g = Store.groceryItems().find(x => x.id === id); if (!g) return;
    if (g.checked) undo(id); else getItem(id);
  };

  const remove = id => {
    const g = Store.groceryItems().find(x => x.id === id); if (!g) return;
    UI.confirm({ title: 'Remove item?', message: `"${g.name}" will be removed from your grocery list.`, confirmLabel: 'Remove',
      onConfirm: () => { Store.removeGrocery(id); UI.toast('Item removed', null, 'warn', 1800); } });
  };

  /** Server field keys (items.2.amount) -> the form's data-field names (amt_2). */
  const mapServerFields = fields => {
    const out = {};
    Object.entries(fields || {}).forEach(([k, msg]) => {
      const m = /^items\.(\d+)\.(\w+)$/.exec(k);
      if (!m) out[k] = msg;
      else if (m[2] === 'categoryId') out['cat_' + m[1]] = msg;
      else out['amt_' + m[1]] = msg;
    });
    return out;
  };

  /**
   * "Clear List": empties the current shopping session only. Uses the app's
   * shared confirmation dialog. Saved grocery lists and the expenses already
   * created from previous submissions are deliberately untouched.
   */
  const clearList = () => {
    const { all, active, done } = split();
    if (!all.length) return UI.toast('Your grocery list is already empty', null, 'info', 2000);

    UI.confirm({
      title: 'Clear Grocery List?',
      message: `Are you sure you want to clear the current grocery list? This removes all ${all.length} item${all.length === 1 ? '' : 's'} (${active.length} remaining, ${done.length} purchased) from the current shopping session. Your saved grocery lists and existing expenses are kept.`,
      confirmLabel: 'Clear Grocery List',
      onConfirm: async () => {
        try {
          await Store.clearGrocery();
          ui.loadedListId = null; ui.loadedListName = '';   // the session no longer mirrors a template
          UI.toast('Grocery list cleared', 'Saved grocery lists and your expenses were not affected.', 'warn', 3000);
          App.render();
        } catch (err) {
          if (err && err.isAuth) return;
          UI.toast('Could not clear the list', (err && err.message) || 'Please try again.', 'error', 6000);
        }
      }
    });
  };

  /* ---------- saved list actions ---------- */

  /**
   * "Save Grocery List": name dialogue following the app's form conventions.
   * Saving a list that was loaded from a template offers both Save (overwrite)
   * and Save as New; otherwise it is always a new template.
   * An empty name falls back to grocery-list-YYYY-MM-DD-HH-MM.
   */
  const save = () => {
    const items = Store.groceryItems();
    if (!items.length) return UI.toast('Nothing to save', 'Add at least one item before saving this list.', 'error');

    const loaded = ui.loadedListId ? Store.savedGroceryLists().find(l => l.id === ui.loadedListId) : null;
    const suggested = loaded ? loaded.name : Store.defaultGroceryListName();

    const form = el('form', { novalidate: 'true', id: 'gro-save-form' }, `
      ${UI.fieldHTML({ name: 'name', label: 'List name', value: suggested, required: false, idPrefix: 'grs',
        attrs: 'maxlength="80" enterkeyhint="done"', hint: `Leave it empty to use ${Store.defaultGroceryListName()}` })}
      <p class="lr-sub">${plural(items.length, 'item')} will be saved. Only the item names and categories are stored. Prices and purchases stay with your current shopping list.</p>`);

    const foot = el('div', { class: 'row', style: 'width:100%;gap:9px' });
    foot.innerHTML = '<span class="spacer"></span>';
    const cancel = el('button', { class: 'btn', type: 'button', onclick: () => UI.closeTop() }, 'Cancel');
    const saveNew = el('button', { class: `btn ${loaded ? '' : 'btn-primary'}`, type: loaded ? 'button' : 'submit', form: 'gro-save-form' }, loaded ? 'Save as New' : 'Save');
    foot.appendChild(cancel); foot.appendChild(saveNew);
    let overwrite = null;
    if (loaded) {
      overwrite = el('button', { class: 'btn btn-primary', type: 'submit', form: 'gro-save-form' }, 'Save');
      foot.appendChild(overwrite);
    }

    const m = UI.modal({ title: 'Save Grocery List', size: 'sm', body: form, footer: foot });

    let busy = false;
    const run = async listId => {
      if (busy) return;
      busy = true; [cancel, saveNew, overwrite].forEach(b => b && (b.disabled = true));
      try {
        // Overwriting with an empty name keeps the template's current name.
        const typed = UI.readForm(form).name;
        const name = typed || (listId && loaded ? loaded.name : '');
        const r = await Store.saveGroceryList({ name, listId });
        if (!r.ok) { busy = false; [cancel, saveNew, overwrite].forEach(b => b && (b.disabled = false)); return void UI.showErrors(form, r.errors); }
        ui.loadedListId = r.value.id; ui.loadedListName = r.value.name;
        m.close();
        UI.toast(listId ? 'Saved grocery list updated' : 'Grocery list saved', `${r.value.name} · ${plural((r.value.items || []).length, 'item')}`);
        App.render();
      } catch (err) {
        busy = false; [cancel, saveNew, overwrite].forEach(b => b && (b.disabled = false));
        if (err && err.isAuth) return;
        if (err && err.fields && Object.keys(err.fields).length) UI.showErrors(form, err.fields);
        UI.toast('Could not save the list', (err && err.message) || 'Please try again.', 'error', 6000);
      }
    };

    if (loaded) saveNew.addEventListener('click', () => run(null));
    form.addEventListener('submit', e => { e.preventDefault(); run(loaded ? loaded.id : null); });
  };

  /** Loads a template into the working list. Never creates expenses. */
  const loadList = id => {
    const list = Store.savedGroceryLists().find(l => l.id === id); if (!list) return;
    const current = Store.groceryItems();

    const run = async () => {
      try {
        await Store.loadGroceryList(id);
        ui.loadedListId = list.id; ui.loadedListName = list.name;
        closeLists();
        UI.toast('Grocery list loaded', `${list.name} · ${plural((list.items || []).length, 'item')} ready to shop. No expenses were created.`);
        App.render();
      } catch (err) {
        if (err && err.isAuth) return;
        UI.toast('Could not load the list', (err && err.message) || 'Please try again.', 'error', 6000);
      }
    };

    if (!current.length) return void run();
    UI.confirm({
      title: 'Replace current grocery list?',
      message: `Your current list (${plural(current.length, 'item')}) will be replaced by "${list.name}". Expenses you already submitted are not affected.`,
      confirmLabel: 'Load list', danger: false, onConfirm: run
    });
  };

  /**
   * Saved Grocery List Quick Preview: read-only, same pattern as the Saved
   * Budget preview. Nothing here can change data - the only ways out are
   * Close and Load List, which runs the normal load flow (confirmation
   * included). Clicking a saved list itself never loads it.
   */
  const previewList = id => {
    const list = Store.savedGroceryLists().find(l => l.id === id); if (!list) return;
    const items = list.items || [];
    const catName = it => {
      const c = Store.catById(it.categoryId);
      return c ? `${c.emoji} ${c.name}` : 'Uncategorized';
    };
    const cats = [...new Set(items.map(catName))];

    const body = el('div', { class: 'gro-preview' }, `
      <div class="prev-meta">
        <span><span class="k">Items</span> <span class="v">${items.length}</span></span>
        <span><span class="k">Categories</span> <span class="v">${cats.length}</span></span>
        <span><span class="k">Created</span> <span class="v">${esc(stamp(list.createdAt))}</span></span>
        <span><span class="k">Updated</span> <span class="v">${esc(stamp(list.updatedAt))}</span></span>
      </div>
      <div class="prev-h">Items (${items.length})</div>
      ${items.length ? `<div class="prev-list">${items.map(it => `
        <div class="prev-row">
          <span class="nm">${esc(it.name)}</span>
          <span class="am lr-sub">${esc(catName(it))}</span>
        </div>`).join('')}</div>`
        : '<p class="hint">This saved list has no items.</p>'}
      <p class="lr-sub" style="margin-top:12px">This is a preview only. Your current grocery list is not changed until you choose Load List.</p>`);

    const foot = el('div', { class: 'row', style: 'width:100%;gap:9px' });
    foot.innerHTML = '<span class="spacer"></span>';
    foot.appendChild(el('button', { class: 'btn', type: 'button', onclick: () => UI.closeTop() }, 'Close'));
    const loadBtn = el('button', { class: 'btn btn-primary', type: 'button' }, 'Load List');
    foot.appendChild(loadBtn);

    const m = UI.modal({ title: list.name, subtitle: `Saved grocery list · ${plural(items.length, 'item')}`, body, footer: foot });
    loadBtn.addEventListener('click', () => { m.close(); loadList(id); });
  };

  const removeList = id => {
    const list = Store.savedGroceryLists().find(l => l.id === id); if (!list) return;
    UI.confirm({
      title: 'Delete Saved Grocery List?',
      message: `Are you sure you want to delete "${list.name}"? Expenses created from it earlier are kept.`,
      confirmLabel: 'Delete',
      onConfirm: () => {
        if (ui.loadedListId === id) { ui.loadedListId = null; ui.loadedListName = ''; }
        Store.removeGroceryList(id);
        UI.toast('Saved grocery list deleted', list.name, 'warn', 2400);
      }
    });
  };

  /* ---------- confirmation dialog ----------
     Prices are no longer asked for here: every purchased item already carries
     the price entered in the Get Item dialogue. Unpurchased items have no
     amount paid, so they cannot become expenses and simply stay on the list. */
  const openConfirm = () => {
    const { all, active, done } = split();
    if (!all.length) return UI.toast('Your grocery list is empty', 'Add at least one item before submitting.', 'error');
    if (!done.length) return UI.toast('Nothing purchased yet', 'Use Get Item and enter a price before adding your list to expenses.', 'error', 5000);

    const items = [...done, ...active];                    // purchased first: those are the expenses
    const accts = Store.accounts();
    const expenseCats = Store.categories('expense');
    const needsCat = items.map(g => g.checked && !Store.catById(g.categoryId));
    const accOptions = accts.map(a => ({ value: a.id, label: a.name }));
    const methodOptions = Store.PAYMENT_METHODS.map(m => ({ value: m, label: m }));
    const total = Core.sum(done, g => g.price || 0);

    const line = (g, i) => `
      <div class="gro-sum-row ${g.checked ? '' : 'pending'}">
        <span class="gro-state ${g.checked ? 'on' : ''}" title="${g.checked ? 'Purchased' : 'Not purchased'}">${g.checked ? icon('check', 13) : ''}<span class="sr-only">${g.checked ? 'Purchased' : 'Not purchased'}</span></span>
        <div class="gro-sum-main">
          <div class="gro-sum-name">${esc(g.name)}</div>
          ${needsCat[i]
            ? `<div class="field" data-field="cat_${i}"><select class="select" name="cat_${i}" aria-label="Category for ${esc(g.name)}">${[{ value: '', label: 'Choose a category' }].concat(expenseCats.map(c => ({ value: c.id, label: `${c.emoji} ${c.name}` }))).map(o => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('')}</select><span class="err" role="alert"></span></div>`
            : `<div class="lr-sub">${catLine(g)}</div>`}
        </div>
        <div class="gro-amt field" data-field="amt_${i}">
          ${g.checked
            ? `<b class="num gro-sum-price">${money(g.price)}</b>`
            : '<span class="lr-sub gro-sum-skip">Not purchased</span>'}
          <span class="err" role="alert"></span>
        </div>
      </div>`;

    const form = el('form', { novalidate: 'true', id: 'gro-confirm-form' }, `
      <p class="gro-intro">Please review your grocery items before adding them to your expenses.</p>
      ${accts.length ? '' : `<div class="gro-warn">${icon('alert', 16)}<span>Add an account first. Every expense is recorded against one.</span>
        <button type="button" class="btn btn-sm" data-gro-add-account>Add account</button></div>`}
      <div class="form-grid">
        ${UI.fieldHTML({ name: 'date', label: 'Date', type: 'date', value: today(), required: true, idPrefix: 'grc' })}
        ${UI.fieldHTML({ name: 'accountId', label: 'Account', type: 'select', value: accts[0]?.id || '', required: true, idPrefix: 'grc', options: accOptions.length ? accOptions : [{ value: '', label: 'No accounts yet' }] })}
        ${UI.fieldHTML({ name: 'method', label: 'Payment method', type: 'select', value: 'Cash', idPrefix: 'grc', options: methodOptions })}
      </div>
      <h3 class="gro-sum-head">Grocery Items</h3>
      <div class="lr-sub" style="margin-bottom:8px">Purchased items use the price you entered while shopping.${active.length ? ` ${plural(active.length, 'item')} you have not bought yet will stay on your list.` : ''}</div>
      <div class="gro-sum-list">${items.map(line).join('')}</div>
      <div class="gro-totals">
        <div><b>Total Items:</b> ${all.length}</div>
        <div>${done.length} Purchased · ${active.length} Not purchased</div>
        <div class="gro-total-amt"><span>Total</span> <b class="num" id="gro-total">${money(total)}</b></div>
      </div>`);

    let busy = false, closed = false;
    const foot = el('div', { class: 'row', style: 'width:100%;gap:9px' });
    foot.innerHTML = '<span class="spacer"></span>';
    const cancel = el('button', { class: 'btn', type: 'button', onclick: () => UI.closeTop() }, 'Cancel');
    const confirmBtn = el('button', { class: 'btn btn-primary', type: 'submit', form: 'gro-confirm-form' }, 'Confirm &amp; Add to Expenses');
    if (!accts.length) confirmBtn.disabled = true;
    foot.appendChild(cancel); foot.appendChild(confirmBtn);

    UI.modal({ title: 'Confirm Grocery List', body: form, footer: foot, onClose: () => { closed = true; } });

    const addAcct = $('[data-gro-add-account]', form);
    if (addAcct) addAcct.addEventListener('click', () => { UI.closeTop(); Forms.account(); });

    form.addEventListener('submit', async e => {
      e.preventDefault();
      if (busy) return;                                    // double click / Enter while saving
      const d = UI.readForm(form);
      const errors = {};
      const dErr = Store.V.date(d.date); if (dErr) errors.date = dErr;
      if (!d.accountId) errors.accountId = 'Choose an account.';
      const lines = [];
      items.forEach((g, i) => {
        if (!g.checked) return;                            // no price paid -> no expense
        const out = { id: g.id };
        if (needsCat[i]) { if (!d['cat_' + i]) errors['cat_' + i] = 'Choose a category.'; else out.categoryId = d['cat_' + i]; }
        lines.push(out);
      });
      if (!lines.length) errors.date = 'Buy at least one item before submitting.';
      if (Object.keys(errors).length) return void UI.showErrors(form, errors);
      UI.showErrors(form, {});

      busy = true; confirmBtn.disabled = true; cancel.disabled = true; confirmBtn.textContent = 'Adding to Expenses...';
      try {
        const res = await Store.submitGrocery({ accountId: d.accountId, date: d.date, method: d.method || null, items: lines });
        const n = (res && res.submitted) || lines.length;
        if (!closed) UI.closeTop();
        UI.toast(`${plural(n, 'expense')} added`, `Your purchased items were added to Transactions (${money(total)}).`);
      } catch (err) {
        busy = false; confirmBtn.disabled = false; cancel.disabled = false; confirmBtn.textContent = 'Confirm & Add to Expenses';
        if (err && err.isAuth) return;
        if (err && err.code === 'grocery_changed') {
          try { await Store.hydrate(); } catch (e2) { /* offline: keep the current view */ }
          if (!closed) UI.closeTop();
          return void UI.toast('Your list changed', err.message, 'error', 7000);
        }
        if (err && err.fields && Object.keys(err.fields).length) UI.showErrors(form, mapServerFields(err.fields));
        UI.toast('Could not add to expenses', (err && err.message) || 'Please try again. Your grocery list is still here.', 'error', 7000);
      }
    });
  };

  return { grocery, getItem, undo, toggle, remove, clearList, openConfirm, save, loadList, previewList, removeList, openAdd, openLists };
})();
