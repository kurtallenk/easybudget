/* ============================================================
   04 · UI - toasts, modals (focus-trapped), confirm, primitives
   ============================================================ */
const UI = (() => {
  const { el, esc, icon, $, $$, money } = Core;

  /* ---------- toasts ---------- */
  const host = () => { let h = $('.toasts'); if (!h) { h = el('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' }); document.body.appendChild(h); } return h; };
  const toast = (title, desc, kind = 'success', ms = 3600) => {
    const t = el('div', { class: `toast ${kind}` }, `
      <span style="color:var(--${kind === 'success' ? 'pos' : kind === 'error' ? 'neg' : kind === 'warn' ? 'warn' : 'brand'});flex:0 0 auto;margin-top:1px">
        ${icon(kind === 'success' ? 'checkCircle' : kind === 'error' ? 'alert' : kind === 'warn' ? 'alert' : 'info', 17)}</span>
      <div style="min-width:0"><div class="tt">${esc(title)}</div>${desc ? `<div class="td">${esc(desc)}</div>` : ''}</div>`);
    host().appendChild(t);
    setTimeout(() => { t.style.transition = 'opacity .2s,transform .2s'; t.style.opacity = '0'; t.style.transform = 'translateY(6px)'; setTimeout(() => t.remove(), 220); }, ms);
  };

  /* ---------- modal ---------- */
  let openStack = [];
  const closeTop = () => { const m = openStack.pop(); if (!m) return; m.scrim.remove(); m.node.remove(); if (m.prevFocus && m.prevFocus.focus) m.prevFocus.focus(); if (!openStack.length) document.body.style.overflow = ''; if (m.onClose) m.onClose(); };
  const closeAll = () => { while (openStack.length) closeTop(); };

  /**
   * modal({title, subtitle, body(HTMLElement|string), footer, size, onMount})
   * Returns {node, close}
   */
  const modal = ({ title, subtitle, body, footer, size = '', onMount, onClose, labelledBy } = {}) => {
    const scrim = el('div', { class: 'scrim', onclick: () => closeTop() });
    const node = el('div', { class: `modal ${size}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title || 'Dialog' });
    const head = el('div', { class: 'modal-head' }, `<div style="min-width:0"><h2>${esc(title || '')}</h2>${subtitle ? `<div class="sub">${esc(subtitle)}</div>` : ''}</div>`);
    const x = el('button', { class: 'icon-btn', 'aria-label': 'Close dialog', style: 'margin-left:auto;flex:0 0 auto', onclick: () => closeTop() }, icon('close', 17));
    head.appendChild(x);
    const bodyEl = el('div', { class: 'modal-body' });
    if (typeof body === 'string') bodyEl.innerHTML = body; else if (body) bodyEl.appendChild(body);
    node.appendChild(head); node.appendChild(bodyEl);
    if (footer) { const f = el('div', { class: 'modal-foot' }); if (typeof footer === 'string') f.innerHTML = footer; else f.appendChild(footer); node.appendChild(f); }
    document.body.appendChild(scrim); document.body.appendChild(node);
    document.body.style.overflow = 'hidden';
    const entry = { node, scrim, prevFocus: document.activeElement, onClose };
    openStack.push(entry);
    // focus trap
    const focusables = () => $$('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])', node).filter(e => e.offsetParent !== null);
    node.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.stopPropagation(); closeTop(); }
      else if (e.key === 'Tab') {
        const f = focusables(); if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });
    setTimeout(() => { const f = focusables().find(x => !x.classList.contains('icon-btn')) || x; f && f.focus(); }, 30);
    if (onMount) onMount(bodyEl, node);
    return { node, body: bodyEl, close: closeTop };
  };

  const confirm = ({ title, message, confirmLabel = 'Confirm', danger = true, onConfirm }) => new Promise(resolve => {
    const foot = el('div');
    foot.innerHTML = '';
    const cancel = el('button', { class: 'btn', onclick: () => { closeTop(); resolve(false); } }, 'Cancel');
    const ok = el('button', { class: `btn ${danger ? 'btn-danger' : 'btn-primary'}` }, esc(confirmLabel));
    ok.addEventListener('click', async () => { closeTop(); if (onConfirm) await onConfirm(); resolve(true); });
    const wrap = el('div', { class: 'row', style: 'width:100%;gap:9px' });
    wrap.appendChild(el('span', { class: 'spacer' })); wrap.appendChild(cancel); wrap.appendChild(ok);
    modal({ title, size: 'sm', body: `<p style="color:var(--text-2);font-size:13.5px;padding-bottom:6px">${esc(message)}</p>`, footer: wrap });
  });

  /* ---------- form helpers ---------- */
  const fieldHTML = ({ name, label, type = 'text', value = '', placeholder = '', required, hint, options, rows, min, step, attrs = '', idPrefix = 'f' }) => {
    const id = `${idPrefix}_${name}`;
    attrs = `aria-describedby="${hint ? `${id}_hint ` : ''}${id}_err" ${attrs}`;
    let control;
    if (type === 'select') {
      control = `<select class="select" id="${id}" name="${name}" ${required ? 'required' : ''} ${attrs}>${(options || []).map(o =>
        `<option value="${esc(o.value)}" ${String(o.value) === String(value) ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`;
    } else if (type === 'textarea') {
      control = `<textarea class="textarea" id="${id}" name="${name}" rows="${rows || 3}" placeholder="${esc(placeholder)}" ${attrs}>${esc(value)}</textarea>`;
    } else if (type === 'money') {
      control = `<div class="amount-wrap"><span class="cur">${Core.currency().symbol}</span>
        <input class="input num" id="${id}" name="${name}" type="text" inputmode="decimal" autocomplete="off"
          placeholder="${esc(placeholder || '0.00')}" value="${esc(value)}" ${required ? 'required' : ''} ${attrs}></div>`;
    } else {
      control = `<input class="input" id="${id}" name="${name}" type="${type}" placeholder="${esc(placeholder)}" value="${esc(value)}"
        ${min != null ? `min="${min}"` : ''} ${step != null ? `step="${step}"` : ''} ${required ? 'required' : ''} ${attrs}>`;
    }
    return `<div class="field" data-field="${name}">
      <label for="${id}">${esc(label)}${required ? '<span class="req" aria-hidden="true">*</span>' : ''}</label>
      ${control}
      ${hint ? `<span class="hint" id="${id}_hint">${esc(hint)}</span>` : ''}
      <span class="err" id="${id}_err" role="alert"></span></div>`;
  };
  const readForm = form => {
    const o = {};
    new FormData(form).forEach((v, k) => { o[k] = typeof v === 'string' ? v.trim() : v; });
    $$('input[type=checkbox]', form).forEach(c => { o[c.name] = c.checked; });
    return o;
  };
  const showErrors = (form, errors) => {
    $$('.err', form).forEach(e => { e.textContent = ''; e.classList.remove('show'); });
    $$('[aria-invalid]', form).forEach(e => e.removeAttribute('aria-invalid'));
    let first = null;
    for (const [k, msg] of Object.entries(errors || {})) {
      const f = form.querySelector(`[data-field="${k}"]`); if (!f) continue;
      const e = f.querySelector('.err'); if (e) { e.textContent = msg; e.classList.add('show'); }
      const input = f.querySelector('.input,.select,.textarea'); if (input) { input.setAttribute('aria-invalid', 'true'); if (!first) first = input; }
    }
    if (first) { first.focus(); first.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
    return !!first;
  };

  /* ---------- shared view primitives ---------- */
  const emptyState = ({ icon: ic = 'inbox', title, desc, action, compact }) => `
    <div class="empty${compact ? ' compact' : ''}"><div class="ill" aria-hidden="true">${icon(ic, 24)}</div>
      <h3>${esc(title)}</h3><p>${esc(desc)}</p>
      ${action ? `<button class="btn btn-primary" data-action="${action.action}" ${action.arg ? `data-arg="${esc(action.arg)}"` : ''}>${icon('plus', 16)}${esc(action.label)}</button>` : ''}
    </div>`;

  const TONE_BG = { green: 'var(--pos-soft)', red: 'var(--neg-soft)', blue: 'var(--info-soft)', amber: 'var(--warn-soft)', gray: 'var(--surface-3)' };
  const TONE_FG = { green: 'var(--pos-text)', red: 'var(--neg-text)', blue: 'var(--info)', amber: 'var(--warn-text)', gray: 'var(--muted)' };
  const TONE_DOT = { green: 'var(--pos)', red: 'var(--neg)', blue: 'var(--brand)', amber: 'var(--warn)', gray: 'var(--border-strong)' };
  // arrow follows the numeric direction, colour follows whether the change is good
  const deltaHTML = delta => {
    if (!delta || delta.show === false) return '';
    const arrow = delta.move === 'up' ? 'up' : delta.move === 'down' ? 'down' : 'minus';
    const cls = delta.good == null ? 'flat' : delta.good ? 'up' : 'down';
    return `<span class="delta ${cls}">${icon(arrow, 12)}${esc(delta.text)}</span>`;
  };
  /** Primary KPI cell (dashboard summary strip). `extra` is trusted HTML. */
  const kpi = ({ label, value, tone = 'blue', delta, sub, sparkId, extra = '', valueClass = '', tip, tipExtra }) => `
    <div class="kpi"${tip ? Tips.host(tip, tipExtra) : ''}>
      <div class="kpi-label"><span class="dot" style="background:${TONE_DOT[tone] || TONE_DOT.blue}"></span>${esc(label)}</div>
      <div class="kpi-value num ${valueClass}">${value}</div>
      <div class="kpi-foot">${deltaHTML(delta)}${sub ? `<span>${esc(sub)}</span>` : ''}</div>
      ${extra}
      ${sparkId ? `<div class="spark" id="${sparkId}" aria-hidden="true"></div>` : ''}
    </div>`;

  const statCard = ({ label, value, iconName, tone = 'blue', delta, sub, sparkId, tip, tipExtra }) => {
    const bg = TONE_BG[tone], fg = TONE_FG[tone];
    const d = deltaHTML(delta);
    return `<div class="stat"${tip ? Tips.host(tip, tipExtra) : ''}>
      <div class="stat-top"><span class="stat-ico" aria-hidden="true" style="background:${bg};color:${fg}">${icon(iconName, 16)}</span><span class="stat-label">${esc(label)}</span></div>
      <div class="stat-value num">${value}</div>
      <div class="stat-foot">${d}${sub ? `<span>${esc(sub)}</span>` : ''}</div>
      ${sparkId ? `<div class="spark" id="${sparkId}"></div>` : ''}
    </div>`;
  };

  const skeletonCards = (n = 4) => `<div class="grid g-stats">${Array.from({ length: n }, () =>
    `<div class="stat"><div class="sk" style="height:14px;width:60%"></div><div class="sk" style="height:26px;width:75%;margin-top:12px"></div><div class="sk" style="height:12px;width:45%;margin-top:12px"></div></div>`).join('')}</div>`;

  const progressBar = (usedPct, state, large) =>
    `<div class="bar ${state} ${large ? 'bar-lg' : ''}"><i style="width:${Core.clamp(usedPct, 0, 100)}%"></i></div>`;

  const download = (filename, text, mime = 'application/json') => {
    const blob = new Blob([text], { type: mime + ';charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: filename }); document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 800);
  };

  return { toast, modal, closeTop, closeAll, confirm, fieldHTML, readForm, showErrors,
    emptyState, statCard, kpi, deltaHTML, skeletonCards, progressBar, download };
})();


