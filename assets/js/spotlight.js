/* ============================================================
   11 · SPOTLIGHT - reusable "click here" highlight + callout
   Spotlight.show({ target, title, text, status, buttons, onTick, onMissing, label })
     target   CSS selector of an EXISTING element (first visible match)
     buttons  [{ label, cls, onClick }] rendered in the callout
     onTick   called ~5×/s while active (e.g. to detect completion)
   The page is dimmed by a ring whose huge box-shadow leaves a bright
   "hole" over the target. Ring and dim are pointer-events:none, so
   the highlighted control (and everything else) works normally -
   the user is guided, never trapped. Dialogs opened by the target
   simply cover the spotlight, which hides itself while a .modal is
   open. The target is scrolled into the safe area (below the sticky
   top bar, above the mobile bottom nav); the callout sits below /
   above / beside it, or docks as a panel on small screens, and is
   always clamped inside the viewport.
   ============================================================ */
const Spotlight = (() => {
  const { el, esc, icon } = Core;
  let ring = null, box = null, opts = null, loop = null, lastTarget = null, nudged = false;

  const visible = n => { if (!n) return false; const r = n.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(n).visibility !== 'hidden'; };
  const find = sel => [...document.querySelectorAll(sel)].find(visible) || null;

  const safeArea = () => {
    const vh = window.innerHeight;
    let top = 0, bottom = vh;
    const tb = document.querySelector('.topbar');
    if (tb && getComputedStyle(tb).position !== 'static') top = Math.max(0, tb.getBoundingClientRect().bottom);
    const nav = document.querySelector('.bottomnav');
    if (nav && getComputedStyle(nav).display !== 'none') { const r = nav.getBoundingClientRect(); if (r.height && r.top < vh) bottom = r.top; }
    return { top, bottom };
  };

  /** Scrolls the target into the middle of the safe area if it isn't comfortably visible. */
  const reveal = n => {
    const s = safeArea(), r = n.getBoundingClientRect(), pad = 24;
    if (r.top >= s.top + pad && r.bottom <= s.bottom - pad) return;
    n.scrollIntoView({ block: 'center', inline: 'nearest' });
    const r2 = n.getBoundingClientRect();
    const want = s.top + (s.bottom - s.top) / 2 - r2.height / 2;
    if (r2.top < s.top + pad || r2.bottom > s.bottom - pad) window.scrollBy(0, r2.top - want);
  };

  const ensure = () => {
    if (!ring) { ring = el('div', { class: 'spot-ring', 'aria-hidden': 'true' }); document.body.appendChild(ring); }
    if (!box) { box = el('div', { class: 'spot-callout', role: 'region', 'aria-label': 'Setup guide hint', 'aria-live': 'polite' }); document.body.appendChild(box); }
  };

  const paint = () => {
    if (!box || !opts) return;
    box.innerHTML = `
      <div class="spot-head">${opts.kicker ? `<span class="spot-kicker">${esc(opts.kicker)}</span>` : ''}
        <button type="button" class="icon-btn spot-x" aria-label="Exit setup guide">${icon('close', 15)}</button></div>
      <p class="spot-title">${esc(opts.title || '')}</p>
      ${opts.text ? `<p class="spot-text">${esc(opts.text)}</p>` : ''}
      ${opts.status ? `<p class="spot-status ${esc(opts.statusTone || '')}">${opts.statusTone === 'ok' ? icon('checkCircle', 15) : ''}<span>${esc(opts.status)}</span></p>` : ''}
      <div class="spot-actions"></div>`;
    const acts = box.querySelector('.spot-actions');
    (opts.buttons || []).forEach(b => acts.appendChild(el('button', { type: 'button', class: `btn btn-sm ${b.cls || ''}`, onclick: b.onClick }, esc(b.label))));
    box.querySelector('.spot-x').addEventListener('click', () => opts && opts.onExit && opts.onExit());
  };

  const placeBox = r => {
    const vw = document.documentElement.clientWidth, vh = window.innerHeight, m = 8, gap = 14;
    const s = safeArea();
    box.classList.remove('pos-below', 'pos-above', 'pos-left', 'pos-right', 'pos-dock');
    box.style.left = box.style.top = ''; box.style.width = '';
    const docked = vw <= 560 || !r;
    if (docked) {
      box.classList.add('pos-dock');
      box.style.width = (vw - m * 2) + 'px';
      const bh = box.offsetHeight;
      const topY = Math.max(m, s.top + m), botY = Math.max(m, s.bottom - bh - m);
      const hits = y => r && !(y + bh <= r.top - 4 || y >= r.bottom + 4);
      let y = !r ? botY : !hits(botY) ? botY : !hits(topY) ? topY : null;
      if (y == null) {
        // neither dock position is free: scroll the target just above the bottom panel (once)
        y = botY;
        if (!nudged) { nudged = true; window.scrollBy(0, r.bottom - (botY - 16)); }
      }
      box.style.left = m + 'px'; box.style.top = y + 'px';
      return;
    }
    const bw = box.offsetWidth, bh = box.offsetHeight;
    const cx = r.left + r.width / 2;
    const clampX = x => Math.max(m, Math.min(x, vw - m - bw));
    const tries = [
      ['pos-below', clampX(cx - bw / 2), r.bottom + gap],
      ['pos-above', clampX(cx - bw / 2), r.top - gap - bh],
      ['pos-left', r.left - gap - bw, Math.max(s.top + m, Math.min(r.top + r.height / 2 - bh / 2, s.bottom - m - bh))],
      ['pos-right', r.right + gap, Math.max(s.top + m, Math.min(r.top + r.height / 2 - bh / 2, s.bottom - m - bh))]
    ];
    const fits = ([, x, y]) => x >= m && y >= Math.max(m, s.top) && x + bw <= vw - m && y + bh <= Math.min(vh, s.bottom) - m;
    const pick = tries.find(fits) || ['pos-dock', m, Math.max(m, s.bottom - bh - m)];
    box.classList.add(pick[0]);
    box.style.left = Math.round(pick[1]) + 'px'; box.style.top = Math.round(pick[2]) + 'px';
    if (pick[0] === 'pos-below' || pick[0] === 'pos-above') box.style.setProperty('--ax', Math.round(Math.max(18, Math.min(bw - 18, cx - pick[1]))) + 'px');
  };

  const layout = () => {
    if (!opts || !ring) return;
    const modalOpen = !!document.querySelector('.modal');
    document.documentElement.classList.toggle('spot-paused', modalOpen);
    if (modalOpen) return;
    const n = find(opts.target);
    if (n !== lastTarget) {
      if (lastTarget) lastTarget.classList.remove('spot-target');
      if (n) n.classList.add('spot-target');
      lastTarget = n;
    }
    if (!n) { ring.classList.add('off'); placeBox(null); if (opts.onMissing) opts.onMissing(); return; }
    ring.classList.remove('off');
    const r = n.getBoundingClientRect(), vw = document.documentElement.clientWidth, vh = window.innerHeight, p = 6;
    const L = Math.max(2, r.left - p), T = Math.max(2, r.top - p), R = Math.min(vw - 2, r.right + p), B = Math.min(vh - 2, r.bottom + p);
    Object.assign(ring.style, { left: L + 'px', top: T + 'px', width: Math.max(0, R - L) + 'px', height: Math.max(0, B - T) + 'px' });
    placeBox(r);
  };

  const onScroll = () => layout();

  const show = o => {
    hide();
    nudged = false;
    opts = { ...o };
    ensure(); paint();
    document.documentElement.classList.add('spot-on');
    const n = find(opts.target);
    if (n) reveal(n);
    layout();
    loop = setInterval(() => { layout(); if (opts && opts.onTick) opts.onTick(); }, 200);
    window.addEventListener('scroll', onScroll, { passive: true, capture: true });
    window.addEventListener('resize', onScroll);
    const f = box.querySelector('.spot-actions .btn-primary') || box.querySelector('.spot-actions .btn');
    if (f && !(n && n.matches(':focus-within'))) f.focus({ preventScroll: true });
  };
  const update = patch => { if (!opts) return; Object.assign(opts, patch); paint(); layout(); };
  const hide = () => {
    clearInterval(loop); loop = null;
    window.removeEventListener('scroll', onScroll, { capture: true });
    window.removeEventListener('resize', onScroll);
    if (lastTarget) lastTarget.classList.remove('spot-target');
    lastTarget = null; opts = null;
    if (ring) { ring.remove(); ring = null; }
    if (box) { box.remove(); box = null; }
    document.documentElement.classList.remove('spot-on', 'spot-paused');
  };
  /** Waits (up to ms) until the selector matches a visible element. */
  const waitFor = (sel, ms = 3000) => new Promise(res => {
    const t0 = Date.now();
    const tick = () => { const n = find(sel); if (n || Date.now() - t0 > ms) return res(n); setTimeout(tick, 60); };
    tick();
  });

  return { show, update, hide, waitFor, find, active: () => !!opts, reveal, safeArea };
})();
