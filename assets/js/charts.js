/* ============================================================
   03 · CHARTS - dependency-free responsive SVG charts
   Every chart renders into a container, scales with its box via
   viewBox, and exposes keyboard-reachable tooltips.
   ============================================================ */
const Charts = (() => {
  const { esc, money, compactNum } = Core;
  const NS = 'http://www.w3.org/2000/svg';

  const mkTip = host => {
    let tip = host.querySelector('.tip');
    if (!tip) { tip = document.createElement('div'); tip.className = 'tip'; host.appendChild(tip); }
    return tip;
  };
  const bindTip = (host, node, html) => {
    const tip = mkTip(host);
    const show = e => {
      tip.innerHTML = html;
      const hb = host.getBoundingClientRect();
      const nb = node.getBoundingClientRect();
      const px = e && e.clientX ? e.clientX : nb.left + nb.width / 2;
      const py = e && e.clientY ? e.clientY : nb.top + Math.min(nb.height / 2, 24);
      tip.classList.add('on');
      // Measure, then keep the whole tooltip inside the (clipping) chart box:
      // prefer above the point, flip below when there is no room on top.
      const tw = tip.offsetWidth, th = tip.offsetHeight, gap = 10;
      const x = Core.clamp(px - hb.left, tw / 2 + 4, Math.max(tw / 2 + 4, hb.width - tw / 2 - 4));
      let top = py - hb.top - th - gap;
      if (top < 4) top = py - hb.top + gap;
      top = Core.clamp(top, 4, Math.max(4, hb.height - th - 4));
      tip.style.left = x + 'px';
      tip.style.top = top + 'px';
    };
    const hide = () => tip.classList.remove('on');
    node.addEventListener('mouseenter', show); node.addEventListener('mousemove', show);
    node.addEventListener('mouseleave', hide);
    node.addEventListener('focus', show); node.addEventListener('blur', hide);
    node.addEventListener('touchstart', e => { show(e.touches[0]); }, { passive: true });
  };

  const svg = (w, h, cls = '') => {
    const s = document.createElementNS(NS, 'svg');
    s.setAttribute('viewBox', `0 0 ${w} ${h}`);
    s.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    s.setAttribute('role', 'img');
    if (cls) s.setAttribute('class', cls);
    return s;
  };
  const n = (tag, attrs) => { const e = document.createElementNS(NS, tag); for (const k in attrs) if (attrs[k] != null) e.setAttribute(k, attrs[k]); return e; };
  const niceMax = v => {
    if (v <= 0) return 100;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    const r = v / p;
    const step = r <= 1 ? 1 : r <= 2 ? 2 : r <= 2.5 ? 2.5 : r <= 5 ? 5 : 10;
    return step * p;
  };
  const clear = host => { host.querySelectorAll('svg,.legend').forEach(x => x.remove()); };

  /* -------- grouped bars: income vs expenses -------- */
  function incomeExpense(host, data, opts = {}) {
    clear(host); if (!host) return;
    const W = 720, H = opts.height || 260, PL = 52, PR = 12, PT = 14, PB = 28;
    const iw = W - PL - PR, ih = H - PT - PB;
    const max = niceMax(Math.max(1, ...data.flatMap(d => [d.income, d.expenses])) / 100) * 100;
    const s = svg(W, H); s.setAttribute('aria-label', 'Income versus expenses by month');
    for (let i = 0; i <= 4; i++) {
      const y = PT + ih - (ih * i / 4);
      s.appendChild(n('line', { x1: PL, x2: W - PR, y1: y, y2: y, class: 'grid-line', 'stroke-dasharray': i ? '3 4' : '' }));
      const t = n('text', { x: PL - 8, y: y + 3.5, class: 'axis-txt', 'text-anchor': 'end' });
      t.textContent = Core.currency().symbol + compactNum(max * i / 4 / 100); s.appendChild(t);
    }
    const gw = iw / Math.max(1, data.length);
    const bw = Math.min(26, gw * 0.3);
    data.forEach((d, i) => {
      const cx = PL + gw * i + gw / 2;
      [['income', d.income, 'var(--pos)', -1], ['expenses', d.expenses, 'var(--neg)', 1]].forEach(([k, v, color, side]) => {
        const h = max ? (v / max) * ih : 0;
        const x = cx + (side < 0 ? -bw - 3 : 3);
        const r = n('rect', { x, y: PT + ih - h, width: bw, height: Math.max(v > 0 ? 2 : 0, h), rx: 4, fill: color, tabindex: 0, role: 'graphics-symbol',
          'aria-label': `${d.label} ${k}: ${money(v)}` });
        r.style.transition = 'opacity .15s'; r.addEventListener('mouseenter', () => r.style.opacity = .82); r.addEventListener('mouseleave', () => r.style.opacity = 1);
        bindTip(host, r, `<b>${esc(d.label)}</b> · ${k === 'income' ? 'Income' : 'Expenses'}<br>${money(v)}`);
        s.appendChild(r);
      });
      const t = n('text', { x: cx, y: H - 8, class: 'axis-txt', 'text-anchor': 'middle' }); t.textContent = d.label; s.appendChild(t);
    });
    host.appendChild(s);
    host.appendChild(legend([{ label: 'Income', color: 'var(--pos)' }, { label: 'Expenses', color: 'var(--neg)' }]));
  }

  /* -------- simple bars -------- */
  function bars(host, data, opts = {}) {
    clear(host);
    const W = 720, H = opts.height || 230, PL = 52, PR = 12, PT = 14, PB = 26;
    const iw = W - PL - PR, ih = H - PT - PB;
    const max = niceMax(Math.max(1, ...data.map(d => d.value)) / 100) * 100;
    const s = svg(W, H); s.setAttribute('aria-label', opts.label || 'Bar chart');
    for (let i = 0; i <= 4; i++) {
      const y = PT + ih - (ih * i / 4);
      s.appendChild(n('line', { x1: PL, x2: W - PR, y1: y, y2: y, class: 'grid-line', 'stroke-dasharray': i ? '3 4' : '' }));
      const t = n('text', { x: PL - 8, y: y + 3.5, class: 'axis-txt', 'text-anchor': 'end' });
      t.textContent = Core.currency().symbol + compactNum(max * i / 4 / 100); s.appendChild(t);
    }
    const gw = iw / Math.max(1, data.length), bw = Math.min(34, gw * 0.62);
    data.forEach((d, i) => {
      const x = PL + gw * i + (gw - bw) / 2;
      const h = max ? (d.value / max) * ih : 0;
      const r = n('rect', { x, y: PT + ih - h, width: bw, height: Math.max(d.value > 0 ? 2 : 0, h), rx: 4,
        fill: d.color || opts.color || 'var(--brand)', tabindex: 0, 'aria-label': `${d.label}: ${money(d.value)}` });
      bindTip(host, r, `<b>${esc(d.label)}</b><br>${money(d.value)}`);
      s.appendChild(r);
      if (data.length <= 16 || i % Math.ceil(data.length / 12) === 0) {
        const t = n('text', { x: x + bw / 2, y: H - 7, class: 'axis-txt', 'text-anchor': 'middle' }); t.textContent = d.label; s.appendChild(t);
      }
    });
    host.appendChild(s);
  }

  /* -------- donut -------- */
  function donut(host, data, opts = {}) {
    clear(host);
    const size = 260, R = 108, r = 70, C = size / 2;
    const total = data.reduce((a, b) => a + b.value, 0);
    const s = svg(size, size); s.setAttribute('aria-label', opts.label || 'Category breakdown');
    if (!total) {
      s.appendChild(n('circle', { cx: C, cy: C, r: (R + r) / 2, fill: 'none', stroke: 'var(--surface-3)', 'stroke-width': R - r }));
    } else {
      let a0 = -Math.PI / 2;
      data.forEach(d => {
        const frac = d.value / total, a1 = a0 + frac * Math.PI * 2;
        const large = frac > 0.5 ? 1 : 0;
        const p = [
          `M ${C + R * Math.cos(a0)} ${C + R * Math.sin(a0)}`,
          `A ${R} ${R} 0 ${large} 1 ${C + R * Math.cos(a1)} ${C + R * Math.sin(a1)}`,
          `L ${C + r * Math.cos(a1)} ${C + r * Math.sin(a1)}`,
          `A ${r} ${r} 0 ${large} 0 ${C + r * Math.cos(a0)} ${C + r * Math.sin(a0)}`, 'Z'].join(' ');
        const path = n('path', { d: p, fill: d.color, tabindex: 0, 'aria-label': `${d.name}: ${money(d.value)}, ${(frac * 100).toFixed(1)}%` });
        path.style.transition = 'opacity .15s';
        path.addEventListener('mouseenter', () => path.style.opacity = .82);
        path.addEventListener('mouseleave', () => path.style.opacity = 1);
        bindTip(host, path, `<b>${esc(d.name)}</b><br>${money(d.value)} · ${(frac * 100).toFixed(1)}%`);
        s.appendChild(path);
        a0 = a1;
      });
    }
    const t1 = n('text', { x: C, y: C - 8, class: 'donut-center', fill: 'var(--muted)', 'font-size': 11.5 }); t1.textContent = opts.centerLabel || 'Total';
    const t2 = n('text', { x: C, y: C + 13, class: 'donut-center', fill: 'var(--text)', 'font-size': 19, 'font-weight': 680 });
    t2.textContent = money(total, { decimals: false });
    s.appendChild(t1); s.appendChild(t2);
    host.appendChild(s);
    if (opts.legend !== false) host.appendChild(legend(data.map(d => ({ label: `${d.name} · ${money(d.value, { decimals: false })}`, color: d.color }))));
  }

  /* -------- line / area -------- */
  function line(host, seriesList, opts = {}) {
    clear(host);
    const W = 720, H = opts.height || 240, PL = 52, PR = 14, PT = 16, PB = 26;
    const iw = W - PL - PR, ih = H - PT - PB;
    const pts = seriesList.flatMap(s => s.points.map(p => p.value));
    const rawMax = Math.max(1, ...pts), rawMin = Math.min(0, ...pts);
    const max = niceMax(rawMax / 100) * 100, min = rawMin < 0 ? -niceMax(Math.abs(rawMin) / 100) * 100 : 0;
    const span = max - min || 1;
    const s = svg(W, H); s.setAttribute('aria-label', opts.label || 'Trend chart');
    for (let i = 0; i <= 4; i++) {
      const y = PT + ih - (ih * i / 4);
      s.appendChild(n('line', { x1: PL, x2: W - PR, y1: y, y2: y, class: 'grid-line', 'stroke-dasharray': i ? '3 4' : '' }));
      const t = n('text', { x: PL - 8, y: y + 3.5, class: 'axis-txt', 'text-anchor': 'end' });
      t.textContent = Core.currency().symbol + compactNum((min + span * i / 4) / 100); s.appendChild(t);
    }
    const len = Math.max(1, seriesList[0]?.points.length || 1);
    const X = i => PL + (len === 1 ? iw / 2 : (iw * i) / (len - 1));
    const Y = v => PT + ih - ((v - min) / span) * ih;
    seriesList.forEach((ser, si) => {
      const d = ser.points.map((p, i) => `${i ? 'L' : 'M'} ${X(i).toFixed(1)} ${Y(p.value).toFixed(1)}`).join(' ');
      if (opts.area && seriesList.length === 1) {
        const areaD = `${d} L ${X(len - 1)} ${Y(min)} L ${X(0)} ${Y(min)} Z`;
        const gid = 'g' + Math.random().toString(36).slice(2, 8);
        const defs = n('defs'); const lg = n('linearGradient', { id: gid, x1: 0, y1: 0, x2: 0, y2: 1 });
        lg.appendChild(n('stop', { offset: '0%', 'stop-color': ser.color, 'stop-opacity': .28 }));
        lg.appendChild(n('stop', { offset: '100%', 'stop-color': ser.color, 'stop-opacity': 0 }));
        defs.appendChild(lg); s.appendChild(defs);
        s.appendChild(n('path', { d: areaD, fill: `url(#${gid})` }));
      }
      s.appendChild(n('path', { d, fill: 'none', stroke: ser.color, 'stroke-width': 2.4, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
      ser.points.forEach((p, i) => {
        const c = n('circle', { cx: X(i), cy: Y(p.value), r: 4, fill: 'var(--surface)', stroke: ser.color, 'stroke-width': 2.2, tabindex: 0,
          'aria-label': `${ser.name}, ${p.label}: ${money(p.value)}` });
        bindTip(host, c, `<b>${esc(p.label)}</b>${seriesList.length > 1 ? ' · ' + esc(ser.name) : ''}<br>${money(p.value)}`);
        s.appendChild(c);
        if (si === 0) { const t = n('text', { x: X(i), y: H - 7, class: 'axis-txt', 'text-anchor': 'middle' }); t.textContent = p.label; s.appendChild(t); }
      });
    });
    host.appendChild(s);
    if (seriesList.length > 1) host.appendChild(legend(seriesList.map(x => ({ label: x.name, color: x.color }))));
  }

  /* -------- budget vs actual (horizontal paired bars) -------- */
  function budgetActual(host, rows, opts = {}) {
    clear(host);
    const rowH = 40, W = 720, H = Math.max(80, rows.length * rowH + 24), PL = 130, PR = 70;
    const iw = W - PL - PR;
    const max = Math.max(1, ...rows.flatMap(r => [r.planned, r.actual]));
    const s = svg(W, H); s.setAttribute('aria-label', 'Budget versus actual by category');
    rows.forEach((r, i) => {
      const y = 12 + i * rowH;
      const lab = n('text', { x: PL - 10, y: y + 16, class: 'axis-txt', 'text-anchor': 'end', 'font-size': 12, fill: 'var(--text-2)' });
      lab.textContent = r.name.length > 16 ? r.name.slice(0, 15) + '…' : r.name; s.appendChild(lab);
      const pw = (r.planned / max) * iw, aw = (r.actual / max) * iw;
      const b1 = n('rect', { x: PL, y: y + 3, width: Math.max(2, pw), height: 9, rx: 4.5, fill: 'var(--surface-3)', stroke: 'var(--border-strong)', 'stroke-width': 1, tabindex: 0, 'aria-label': `${r.name} planned ${money(r.planned)}` });
      bindTip(host, b1, `<b>${esc(r.name)}</b> · Planned<br>${money(r.planned)}`);
      const over = r.actual > r.planned;
      const b2 = n('rect', { x: PL, y: y + 16, width: Math.max(2, aw), height: 9, rx: 4.5, fill: over ? 'var(--neg)' : 'var(--brand)', tabindex: 0, 'aria-label': `${r.name} actual ${money(r.actual)}` });
      bindTip(host, b2, `<b>${esc(r.name)}</b> · Actual<br>${money(r.actual)} (${Core.percent(Core.pct(r.actual, r.planned))} of plan)`);
      s.appendChild(b1); s.appendChild(b2);
      const pctTxt = n('text', { x: W - PR + 8, y: y + 18, class: 'axis-txt', 'font-size': 11.5, fill: over ? 'var(--neg)' : 'var(--muted)', 'font-weight': 600 });
      pctTxt.textContent = Core.percent(Core.pct(r.actual, r.planned), 0); s.appendChild(pctTxt);
    });
    host.appendChild(s);
    host.appendChild(legend([{ label: 'Planned', color: 'var(--surface-3)' }, { label: 'Actual', color: 'var(--brand)' }, { label: 'Over budget', color: 'var(--neg)' }]));
  }

  /* -------- sparkline -------- */
  function spark(hostEl, values, color = 'var(--brand)') {
    const W = 120, H = 34;
    const max = Math.max(...values, 1), min = Math.min(...values, 0), span = (max - min) || 1;
    const s = svg(W, H); s.setAttribute('aria-hidden', 'true'); s.setAttribute('preserveAspectRatio', 'none');
    s.style.width = '100%'; s.style.height = H + 'px';
    const X = i => (values.length === 1 ? W / 2 : (W * i) / (values.length - 1));
    const Y = v => H - 3 - ((v - min) / span) * (H - 8);
    const d = values.map((v, i) => `${i ? 'L' : 'M'} ${X(i).toFixed(1)} ${Y(v).toFixed(1)}`).join(' ');
    const gid = 'sp' + Math.random().toString(36).slice(2, 8);
    const defs = n('defs'); const lg = n('linearGradient', { id: gid, x1: 0, y1: 0, x2: 0, y2: 1 });
    lg.appendChild(n('stop', { offset: '0%', 'stop-color': color, 'stop-opacity': .3 }));
    lg.appendChild(n('stop', { offset: '100%', 'stop-color': color, 'stop-opacity': 0 }));
    defs.appendChild(lg); s.appendChild(defs);
    s.appendChild(n('path', { d: `${d} L ${W} ${H} L 0 ${H} Z`, fill: `url(#${gid})` }));
    s.appendChild(n('path', { d, fill: 'none', stroke: color, 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'vector-effect': 'non-scaling-stroke' }));
    hostEl.innerHTML = ''; hostEl.appendChild(s);
  }

  /* -------- progress ring -------- */
  function ring(size, value, color, thickness = 7) {
    const R = (size - thickness) / 2, C = size / 2, circ = 2 * Math.PI * R;
    const off = circ * (1 - Core.clamp(value, 0, 100) / 100);
    return `<svg class="goal-ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">
      <circle cx="${C}" cy="${C}" r="${R}" fill="none" stroke="var(--surface-3)" stroke-width="${thickness}"/>
      <circle cx="${C}" cy="${C}" r="${R}" fill="none" stroke="${color}" stroke-width="${thickness}" stroke-linecap="round"
        stroke-dasharray="${circ.toFixed(2)}" stroke-dashoffset="${off.toFixed(2)}" transform="rotate(-90 ${C} ${C})"/>
      <text x="${C}" y="${C}" class="donut-center" font-size="${size * 0.24}" font-weight="670" fill="var(--text)">${Math.round(value)}%</text>
    </svg>`;
  }

  function legend(items) {
    const w = document.createElement('div'); w.className = 'legend';
    w.innerHTML = items.map(i => `<span class="li"><span class="dot" style="background:${i.color}"></span>${esc(i.label)}</span>`).join('');
    return w;
  }

  return { incomeExpense, bars, donut, line, budgetActual, spark, ring, legend };
})();


