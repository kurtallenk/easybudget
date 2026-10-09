/* ============================================================
   00 · CORE - money, dates, formatting, DOM helpers, icons
   All monetary values are stored as INTEGER CENTAVOS (minor units)
   to avoid floating point drift. Never store floats.
   ============================================================ */
const Core = (() => {
  /* ---------- money (integer minor units) ---------- */
  const toMinor = v => {
    if (typeof v === 'number') return Math.round(v * 100);
    const s = String(v ?? '').replace(/[^0-9.\-]/g, '');
    if (s === '' || s === '-' || s === '.') return NaN;
    const n = Number(s);
    return Number.isFinite(n) ? Math.round(n * 100) : NaN;
  };
  const toMajor = m => (m || 0) / 100;
  /** split a minor amount into n parts without losing centavos */
  const divide = (minor, n) => {
    if (!n) return [];
    const base = Math.trunc(minor / n); let rem = minor - base * n;
    return Array.from({ length: n }, () => { const extra = rem > 0 ? 1 : (rem < 0 ? -1 : 0); rem -= extra; return base + extra; });
  };
  const pct = (a, b) => (!b ? 0 : (a / b) * 100);

  /* ---------- currency ---------- */
  const CURRENCIES = {
    PHP: { code: 'PHP', symbol: '₱', locale: 'en-PH', name: 'Philippine Peso' },
    USD: { code: 'USD', symbol: '$', locale: 'en-US', name: 'US Dollar' },
    EUR: { code: 'EUR', symbol: '€', locale: 'de-DE', name: 'Euro' },
    GBP: { code: 'GBP', symbol: '£', locale: 'en-GB', name: 'British Pound' },
    JPY: { code: 'JPY', symbol: '¥', locale: 'ja-JP', name: 'Japanese Yen' },
    SGD: { code: 'SGD', symbol: 'S$', locale: 'en-SG', name: 'Singapore Dollar' },
    AUD: { code: 'AUD', symbol: 'A$', locale: 'en-AU', name: 'Australian Dollar' },
    CAD: { code: 'CAD', symbol: 'C$', locale: 'en-CA', name: 'Canadian Dollar' },
    INR: { code: 'INR', symbol: '₹', locale: 'en-IN', name: 'Indian Rupee' }
  };
  let _cur = CURRENCIES.PHP;
  const setCurrency = code => { _cur = CURRENCIES[code] || CURRENCIES.PHP; };
  const currency = () => _cur;

  const _nf = new Map();
  const nf = (min, max) => {
    const k = _cur.code + min + max;
    if (!_nf.has(k)) _nf.set(k, new Intl.NumberFormat(_cur.locale, { minimumFractionDigits: min, maximumFractionDigits: max }));
    return _nf.get(k);
  };
  /** Canonical money formatter - the ONLY place currency strings are produced. */
  const money = (minor, opt = {}) => {
    const { sign = false, decimals = true, compact = false, abs = false } = opt;
    const v = Number(minor) || 0;
    const negative = v < 0;
    const mag = Math.abs(v) / 100;               // format magnitude, apply the sign ourselves
    const body = compact ? compactNum(mag) : nf(decimals ? 2 : 0, decimals ? 2 : 0).format(mag);
    const out = _cur.symbol + body;
    if (sign) return (negative && !abs ? '−' : '+') + out;
    if (abs) return out;
    return negative ? '−' + out : out;
  };
  const compactNum = n => {
    const a = Math.abs(n);
    if (a >= 1e9) return (n / 1e9).toFixed(a >= 1e10 ? 0 : 1).replace(/\.0$/, '') + 'B';
    if (a >= 1e6) return (n / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M';
    if (a >= 1e4) return (n / 1e3).toFixed(0) + 'K';
    if (a >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
    return nf(0, 0).format(n);
  };
  const percent = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d).replace(/\.0$/, '') : '0') + '%';

  /* ---------- dates (all stored as YYYY-MM-DD, local-safe) ---------- */
  const pad = n => String(n).padStart(2, '0');
  const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parse = s => { if (!s) return null; const [y, m, d] = String(s).split('-').map(Number); if (!y || !m || !d) return null; const dt = new Date(y, m - 1, d); return isNaN(dt) ? null : dt; };
  const today = () => iso(new Date());
  const monthKey = s => String(s || '').slice(0, 7);
  const ymOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  const monthStart = ym => `${ym}-01`;
  const monthEnd = ym => { const [y, m] = ym.split('-').map(Number); return iso(new Date(y, m, 0)); };
  const addMonths = (ym, n) => { const [y, m] = ym.split('-').map(Number); const d = new Date(y, m - 1 + n, 1); return ymOf(d); };
  const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
  const diffDays = (a, b) => Math.round((parse(b) - parse(a)) / 86400000);
  const daysInMonth = ym => { const [y, m] = ym.split('-').map(Number); return new Date(y, m, 0).getDate(); };
  const monthsBetween = (a, b) => { const [y1, m1] = a.split('-').map(Number), [y2, m2] = b.split('-').map(Number); return (y2 - y1) * 12 + (m2 - m1); };

  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const monthLabel = (ym, short = false) => { const [y, m] = ym.split('-').map(Number); const n = MONTHS[m - 1] || ''; return `${short ? n.slice(0, 3) : n} ${y}`; };

  let _fmt = 'MMM D, YYYY';
  const setDateFormat = f => { _fmt = f || 'MMM D, YYYY'; };
  const dateFormat = () => _fmt;
  const fdate = (s, style) => {
    const d = parse(s); if (!d) return '-';
    const Y = d.getFullYear(), M = d.getMonth() + 1, D = d.getDate();
    const mn = MONTHS[d.getMonth()];
    if (style === 'short') return `${mn.slice(0, 3)} ${D}`;
    if (style === 'long') return `${mn} ${D}, ${Y}`;
    switch (_fmt) {
      case 'DD/MM/YYYY': return `${pad(D)}/${pad(M)}/${Y}`;
      case 'MM/DD/YYYY': return `${pad(M)}/${pad(D)}/${Y}`;
      case 'YYYY-MM-DD': return `${Y}-${pad(M)}-${pad(D)}`;
      default: return `${mn.slice(0, 3)} ${D}, ${Y}`;
    }
  };
  const relDate = s => {
    const n = diffDays(today(), s);
    if (n === 0) return 'Today'; if (n === 1) return 'Tomorrow'; if (n === -1) return 'Yesterday';
    if (n > 1 && n <= 14) return `in ${n} days`;
    if (n < -1 && n >= -14) return `${Math.abs(n)} days ago`;
    return fdate(s);
  };
  const dayHeading = s => {
    const n = diffDays(today(), s);
    const wd = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][parse(s).getDay()];
    if (n === 0) return `Today · ${fdate(s)}`;
    if (n === -1) return `Yesterday · ${fdate(s)}`;
    if (n === 1) return `Tomorrow · ${fdate(s)}`;
    return `${wd} · ${fdate(s)}`;
  };
  const weekdayShort = s => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][parse(s).getDay()];

  /* ---------- misc ---------- */
  const uid = p => `${p || 'id'}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
  const debounce = (fn, ms = 220) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  const sum = (arr, f = x => x) => arr.reduce((s, x) => s + (f(x) || 0), 0);
  const groupBy = (arr, f) => arr.reduce((m, x) => { const k = f(x); (m[k] ||= []).push(x); return m; }, {});
  const sortBy = (arr, f, dir = 1) => [...arr].sort((a, b) => { const A = f(a), B = f(b); return A < B ? -dir : A > B ? dir : 0; });

  /* ---------- DOM ---------- */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const el = (tag, attrs = {}, html) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'dataset') Object.assign(n.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2).toLowerCase(), v);
      else n.setAttribute(k, v === true ? '' : v);
    }
    if (html != null) n.innerHTML = html;
    return n;
  };

  /* ---------- icons (inline SVG, 1.75 stroke, 20px grid) ---------- */
  const P = {
    dashboard: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
    transactions: '<path d="M7 7h13M7 7 10 4M7 7l3 3"/><path d="M17 17H4M17 17l-3-3M17 17l-3 3"/>',
    budget: '<path d="M3 12a9 9 0 1 0 9-9v9z"/><path d="M12 3a9 9 0 0 1 9 9h-9z" opacity=".45"/>',
    accounts: '<rect x="2.5" y="5.5" width="19" height="13" rx="2.5"/><path d="M2.5 10h19"/><path d="M6 14.5h3"/>',
    goals: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1"/>',
    cart: '<circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/><path d="M2.5 3.5h3l2.3 11.2h10.4l2-8.2H6.1"/>',
    bills: '<path d="M6 2.5h12v19l-3-2-3 2-3-2-3 2z"/><path d="M9.5 8h5M9.5 12h5"/>',
    analytics: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .32 1.77l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.6 1.6 0 0 0-1.77-.32 1.6 1.6 0 0 0-1 1.47V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 9.1 19.4a1.6 1.6 0 0 0-1.77.32l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.6 1.6 0 0 0 4.82 15a1.6 1.6 0 0 0-1.47-1H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 8.9a1.6 1.6 0 0 0-.32-1.77l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.6 1.6 0 0 0 9 4.62 1.6 1.6 0 0 0 10 3.15V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.47 1.6 1.6 0 0 0 1.77-.32l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.6 1.6 0 0 0 19.4 9v.1a1.6 1.6 0 0 0 1.47 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/>',
    recurring: '<path d="M3 11a9 9 0 0 1 15.5-6.2L21 7"/><path d="M21 3v4h-4"/><path d="M21 13a9 9 0 0 1-15.5 6.2L3 17"/><path d="M3 21v-4h4"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    close: '<path d="M18 6 6 18M6 6l12 12"/>',
    menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>',
    palette: '<circle cx="12" cy="12" r="9"/><circle cx="8" cy="10" r="1.2"/><circle cx="12" cy="7.5" r="1.2"/><circle cx="16" cy="10" r="1.2"/><path d="M12 21a2.5 2.5 0 0 1 0-5h1.5a2.5 2.5 0 0 0 2.5-2.5"/>',
    chevL: '<path d="m15 18-6-6 6-6"/>', chevR: '<path d="m9 18 6-6-6-6"/>',
    chevD: '<path d="m6 9 6 6 6-6"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/>',
    up: '<path d="M12 19V5M5 12l7-7 7 7"/>', down: '<path d="M12 5v14M19 12l-7 7-7-7"/>',
    trendUp: '<path d="m3 17 6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
    trendDown: '<path d="m3 7 6 6 4-4 8 8"/><path d="M15 17h6v-6"/>',
    wallet: '<path d="M20 12V8.5A2.5 2.5 0 0 0 17.5 6H5a2 2 0 0 1 0-4h12"/><path d="M4 6v12a2 2 0 0 0 2 2h13a1 1 0 0 0 1-1v-3"/><path d="M21 11h-4a2 2 0 0 0 0 4h4z"/>',
    piggy: '<path d="M11 7h2M3 11a9 9 0 0 1 9-5c4.5 0 8 2.7 8 6 0 1.6-.8 3-2 4v3h-3l-.7-1.6a10 10 0 0 1-4.6 0L9 19H6v-3a6.6 6.6 0 0 1-2.4-3H2.5A1.5 1.5 0 0 1 1 11.5V11z"/>',
    sun: '<circle cx="12" cy="12" r="4.2"/><path d="M12 1.5v2.5M12 20v2.5M4.2 4.2 6 6M18 18l1.8 1.8M1.5 12H4M20 12h2.5M4.2 19.8 6 18M18 6l1.8-1.8"/>',
    moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
    check: '<path d="m4 12.5 5.5 5.5L20 6.5"/>',
    checkCircle: '<circle cx="12" cy="12" r="9"/><path d="m8.5 12.3 2.4 2.4 4.6-4.9"/>',
    alert: '<path d="M12 3 2.5 20h19z"/><path d="M12 9.5v4.5M12 17.2v.3"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8v.4"/>',
    filter: '<path d="M3 5h18l-7 8v6l-4 2v-8z"/>',
    transfer: '<path d="M4 8h13l-3-3M20 16H7l3 3"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2.5"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    download: '<path d="M12 3v12M7 11l5 5 5-5"/><path d="M4 20h16"/>',
    upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 20h16"/>',
    sparkle: '<path d="M12 3.5 13.8 9l5.7 1.8-5.7 1.8L12 18.5l-1.8-5.9L4.5 10.8 10.2 9z"/>',
    pause: '<path d="M9 5v14M15 5v14"/>', play: '<path d="M7 4.5v15l13-7.5z"/>',
    dots: '<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>',
    bell: '<path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M10.3 20a1.9 1.9 0 0 0 3.4 0"/>',
    inbox: '<path d="M4 13h4l2 3h4l2-3h4"/><path d="M5.5 4.5h13l3 8.5v5a2 2 0 0 1-2 2H4.5a2 2 0 0 1-2-2v-5z"/>',
    shield: '<path d="M12 3l7.5 3v5.5c0 4.6-3.2 8.3-7.5 9.5-4.3-1.2-7.5-4.9-7.5-9.5V6z"/><path d="M9 12l2.2 2.2L15.5 10"/>',
    send: '<path d="M21 3L10.5 13.5"/><path d="M21 3l-6.5 18-4-7.5L3 9.5z"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.6 3.3-5.5 6.5-5.5s5.9 1.9 6.5 5.5"/><path d="M16 4.8a3.5 3.5 0 0 1 0 6.4M18.5 14.8c1.7.8 2.8 2.6 3 5.2"/>',
    megaphone: '<path d="M3 10v4a1 1 0 0 0 1 1h2l5 4V5L6 9H4a1 1 0 0 0-1 1z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>',
    card: '<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M2.5 9.5h19"/>',
    bank: '<path d="M3 10h18L12 4z"/><path d="M5 10v8M10 10v8M14 10v8M19 10v8M3 20h18"/>',
    cash: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.6"/>',
    phone: '<rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M11 18.5h2"/>'
  };
  const icon = (name, size = 18, cls = 'ic') =>
    `<svg class="${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;

  return { toMinor, toMajor, divide, pct, money, percent, compactNum, CURRENCIES, setCurrency, currency,
    iso, parse, today, monthKey, ymOf, monthStart, monthEnd, addMonths, addDays, diffDays, daysInMonth,
    monthsBetween, MONTHS, monthLabel, fdate, relDate, dayHeading, weekdayShort, setDateFormat, dateFormat,
    uid, esc, clamp, debounce, sum, groupBy, sortBy, $, $$, el, icon, ICONS: P };
})();


