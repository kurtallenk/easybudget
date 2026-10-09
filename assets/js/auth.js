/* ============================================================
   Easy Budget Planner: authentication screens
   ------------------------------------------------------------
   One script for login, register, verify-email, forgot-password
   and reset-password (selected by <body data-page>). The auth
   pages load before the app bundle, so this talks to the API
   directly with the same envelope, CSRF and same-origin rules.
   Tokens from email links are read once and removed from the
   address bar so they do not linger in history or referrers.
   ============================================================ */
(() => {
  'use strict';
  const API = '../api/';
  const REMEMBER_KEY = 'bp_remember_me';
  const PW_MIN = 10;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  let csrf = null;

  /* ---------- API ---------- */
  const call = async (path, body) => {
    let res;
    try {
      res = await fetch(API + path, {
        method: body ? 'POST' : 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: body ? { 'Content-Type': 'application/json', Accept: 'application/json', 'X-CSRF-Token': csrf || '' }
                      : { Accept: 'application/json' },
        body: body ? JSON.stringify(body) : undefined
      });
    } catch {
      const e = new Error('We could not reach the server. Please check your connection and try again.');
      e.code = 'network'; e.fields = {}; throw e;
    }
    const payload = await res.json().catch(() => null);
    if (!res.ok || !payload || payload.ok !== true) {
      const err = (payload && payload.error) || {};
      const e = new Error(err.message || 'Something went wrong. Please try again.');
      e.code = err.code || 'error';
      e.status = res.status;
      e.details = err.details || {};
      e.fields = (err.details && err.details.fields) || {};
      throw e;
    }
    return payload.data;
  };
  // Mints the CSRF token; a fresh one is needed after a CSRF failure.
  const session = async () => { const d = await call('auth/session.php'); csrf = d.csrfToken; return d; };
  const post = async (path, body) => {
    if (!csrf) await session();
    try { return await call(path, body); }
    catch (e) {
      if (e.code === 'csrf_failed') { await session(); return call(path, body); }
      throw e;
    }
  };

  /* ---------- UI helpers ---------- */
  const isEmail = v => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) && v.length <= 190;

  const alertBox = (el, kind, message, action) => {
    if (!el) return;
    el.className = 'auth-alert is-' + kind;
    el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    el.innerHTML = '';
    const body = document.createElement('div');
    body.className = 'auth-alert-body';
    const p = document.createElement('p');
    p.textContent = message;
    body.appendChild(p);
    if (action) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'btn-link'; b.textContent = action.label;
      b.addEventListener('click', () => action.onClick(b));
      body.appendChild(b);
    }
    el.appendChild(body);
    el.hidden = false;
  };
  const hideAlert = el => { if (el) { el.hidden = true; el.innerHTML = ''; } };

  const fieldErrors = (form, fields = {}) => {
    $$('.field-error', form).forEach(el => {
      const msg = fields[el.dataset.for];
      el.textContent = msg || '';
      el.hidden = !msg;
      const input = form.elements[el.dataset.for];
      if (input) input.setAttribute('aria-invalid', msg ? 'true' : 'false');
    });
    const first = Object.keys(fields)[0];
    if (first && form.elements[first]) form.elements[first].focus();
  };

  const busy = (btn, on, label) => {
    if (!btn) return;
    if (on) {
      btn.dataset.label = btn.dataset.label || btn.textContent;
      btn.disabled = true;
      btn.innerHTML = '<span class="spin" aria-hidden="true"></span><span></span>';
      btn.lastChild.textContent = label || 'Please wait';
      btn.setAttribute('aria-busy', 'true');
    } else {
      btn.disabled = false;
      btn.textContent = btn.dataset.label || btn.textContent;
      btn.removeAttribute('aria-busy');
    }
  };

  // A resend button that counts down between requests.
  const cooldown = (btn, seconds, idleLabel) => {
    let left = seconds;
    btn.disabled = true;
    const tick = () => {
      if (left <= 0) { btn.disabled = false; btn.textContent = idleLabel; return; }
      btn.textContent = `${idleLabel} (${left}s)`;
      left -= 1;
      setTimeout(tick, 1000);
    };
    tick();
  };

  const show = id => {
    $$('[data-view]').forEach(v => { v.hidden = v.dataset.view !== id; });
    const view = $(`[data-view="${id}"]`);
    const h = view && view.querySelector('h1');
    if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
    window.scrollTo(0, 0);
  };

  const params = new URLSearchParams(location.search);
  // Read the email-link token once, then drop it from the address bar.
  const takeToken = () => {
    const t = (params.get('token') || '').trim().toLowerCase();
    if (params.has('token')) history.replaceState(null, '', location.pathname);
    return /^[a-f0-9]{96}$/.test(t) ? t : '';
  };

  /* ---------- password fields ---------- */
  const pwClasses = v => ({
    lower: /[a-z]/.test(v), upper: /[A-Z]/.test(v), number: /\d/.test(v), symbol: /[^A-Za-z0-9]/.test(v)
  });
  const pwValid = v => {
    const c = pwClasses(v);
    return v.length >= PW_MIN && v.length <= 200 && (c.lower + c.upper + c.number + c.symbol) >= 3;
  };
  const wirePasswordToggles = () => {
    $$('.auth-pw').forEach(wrap => {
      const input = $('input', wrap);
      const btn = $('.auth-pw-toggle', wrap);
      if (!input || !btn) return;
      btn.addEventListener('click', () => {
        const showing = input.type === 'text';
        input.type = showing ? 'password' : 'text';
        btn.textContent = showing ? 'Show' : 'Hide';
        btn.setAttribute('aria-pressed', String(!showing));
        btn.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
      });
    });
  };
  const wireRules = (input, list, meter) => {
    if (!input || !list) return;
    const update = () => {
      const v = input.value;
      const c = pwClasses(v);
      const kinds = c.lower + c.upper + c.number + c.symbol;
      const set = (k, ok) => { const li = $(`[data-rule="${k}"]`, list); if (li) li.classList.toggle('ok', ok); };
      set('length', v.length >= PW_MIN);
      set('lower', c.lower); set('upper', c.upper); set('number', c.number); set('symbol', c.symbol);
      if (meter) {
        const score = Math.min(4, (v.length >= PW_MIN ? 1 : 0) + Math.max(0, kinds - 1) + (v.length >= 16 ? 1 : 0));
        const bar = meter.firstElementChild;
        bar.style.width = (v ? Math.max(10, score * 25) : 0) + '%';
        bar.style.background = score >= 4 ? 'var(--pos)' : score >= 3 ? 'var(--brand)' : score >= 2 ? 'var(--warn)' : 'var(--neg)';
      }
    };
    input.addEventListener('input', update);
    update();
  };
  const passwordProblems = (form) => {
    const pw = form.elements.password.value;
    const confirm = form.elements.passwordConfirm.value;
    const f = {};
    if (!pw) f.password = 'Please enter a password.';
    else if (pw.length < PW_MIN) f.password = `Please use at least ${PW_MIN} characters.`;
    else if (!pwValid(pw)) f.password = 'Please use at least 3 of these: lower case, upper case, numbers, symbols.';
    if (!confirm) f.passwordConfirm = 'Please type the password again.';
    else if (pw && confirm !== pw) f.passwordConfirm = 'The passwords do not match.';
    return f;
  };

  /* ---------- resend verification ---------- */
  const resendVerification = async (email, btn, statusEl, idleLabel) => {
    if (!isEmail(email)) { alertBox(statusEl, 'error', 'Please enter a valid email address.'); return false; }
    const label = idleLabel || (btn && btn.dataset.idle) || 'Resend email';
    if (btn) { btn.disabled = true; btn.textContent = 'Sending...'; }
    try {
      const d = await post('auth/resend-verification.php', { email });
      alertBox(statusEl, 'success', d.message || 'We sent another verification email.');
      if (btn) cooldown(btn, 60, label);
      return true;
    } catch (e) {
      alertBox(statusEl, e.status === 429 ? 'warn' : 'error', e.message);
      const wait = e.details && Number(e.details.retryAfter);
      if (btn) { if (wait && wait <= 120) cooldown(btn, wait, label); else { btn.disabled = false; btn.textContent = label; } }
      return false;
    }
  };

  /* ================= pages ================= */
  const pages = {};

  pages.login = () => {
    const form = $('#form');
    const box = $('#alert');
    const submit = $('#submit');
    const remember = $('#remember');
    try { remember.checked = localStorage.getItem(REMEMBER_KEY) === '1'; } catch {}

    const notices = {
      verified: ['success', 'Your email is confirmed. Sign in to get started.'],
      reset: ['success', 'Your password was changed. Sign in with your new password.'],
      signedout: ['info', 'You have been signed out.'],
      expired: ['info', 'Your session ended. Please sign in again.']
    };
    const n = notices[params.get('notice')];
    if (n) { alertBox(box, n[0], n[1]); history.replaceState(null, '', location.pathname); }
    const pre = params.get('email');
    if (pre && isEmail(pre)) form.elements.email.value = pre;

    session().then(d => { if (d.authenticated) location.replace('../index.html'); })
      .catch(() => alertBox(box, 'error', 'We could not reach the server. Please try again.'));

    form.addEventListener('submit', async e => {
      e.preventDefault();
      hideAlert(box);
      const email = form.elements.email.value.trim();
      const password = form.elements.password.value;
      const f = {};
      if (!email) f.email = 'Please enter your email address.';
      else if (!isEmail(email)) f.email = 'Please enter a valid email address.';
      if (!password) f.password = 'Please enter your password.';
      fieldErrors(form, f);
      if (Object.keys(f).length) return;

      busy(submit, true, 'Signing in');
      try {
        await post('auth/login.php', { email, password, remember: remember.checked });
        try { if (remember.checked) localStorage.setItem(REMEMBER_KEY, '1'); else localStorage.removeItem(REMEMBER_KEY); } catch {}
        location.replace('../index.html');
      } catch (err) {
        busy(submit, false);
        if (err.code === 'email_unverified') {
          alertBox(box, 'warn', err.message, {
            label: 'Send a new verification link',
            onClick: b => resendVerification(email, b, box, 'Send a new verification link')
          });
        } else {
          alertBox(box, 'error', err.message);
          fieldErrors(form, err.fields);
        }
      }
    });
  };

  pages.register = () => {
    const form = $('#form');
    const box = $('#alert');
    const submit = $('#submit');
    wireRules(form.elements.password, $('#pw-rules'), $('#pw-meter'));
    let sentTo = '';

    session().then(d => { if (d.authenticated) location.replace('../index.html'); })
      .catch(() => alertBox(box, 'error', 'We could not reach the server. Please try again.'));

    const confirm = form.elements.passwordConfirm;
    confirm.addEventListener('input', () => {
      const err = $('[data-for="passwordConfirm"]', form);
      if (confirm.value && confirm.value === form.elements.password.value) { err.hidden = true; confirm.setAttribute('aria-invalid', 'false'); }
    });

    form.addEventListener('submit', async e => {
      e.preventDefault();
      hideAlert(box);
      const email = form.elements.email.value.trim();
      const f = passwordProblems(form);
      if (!email) f.email = 'Please enter your email address.';
      else if (!isEmail(email)) f.email = 'Please enter a valid email address.';
      const ordered = {};
      ['email', 'password', 'passwordConfirm'].forEach(k => { if (f[k]) ordered[k] = f[k]; });
      fieldErrors(form, ordered);
      if (Object.keys(ordered).length) { alertBox(box, 'error', 'Please fix the highlighted fields.'); return; }

      busy(submit, true, 'Creating your account');
      try {
        const d = await post('auth/register.php', {
          email,
          password: form.elements.password.value,
          passwordConfirm: form.elements.passwordConfirm.value,
          displayName: form.elements.displayName.value.trim() || null
        });
        if (d.verificationRequired === false) { location.replace('../index.html'); return; }
        sentTo = d.email || email;
        $('#sent-email').textContent = sentTo;
        form.reset();
        busy(submit, false);
        show('sent');
        cooldown($('#resend'), 60, 'Resend email');
      } catch (err) {
        busy(submit, false);
        alertBox(box, 'error', err.message);
        fieldErrors(form, err.fields);
      }
    });

    $('#resend').addEventListener('click', e => resendVerification(sentTo, e.currentTarget, $('#sent-alert'), 'Resend email'));
    $('#change-email').addEventListener('click', () => { hideAlert($('#sent-alert')); show('form'); form.elements.email.focus(); });
  };

  pages.verify = () => {
    const token = takeToken();
    const resendForm = $('#resend-form');
    const resendBox = $('#resend-alert');

    const states = {
      verified: { icon: 'success', title: 'Email confirmed', resend: false, primary: ['Sign in', 'login.html?notice=verified'] },
      already_verified: { icon: 'success', title: 'Already confirmed', resend: false, primary: ['Sign in', 'login.html'] },
      expired: { icon: 'warn', title: 'This link has expired', resend: true },
      invalid: { icon: 'error', title: 'This link is not valid', resend: true }
    };
    const render = (status, message) => {
      const s = states[status] || states.invalid;
      const icon = $('#status-icon');
      icon.className = 'auth-status-icon is-' + s.icon;
      icon.innerHTML = ICONS[s.icon];
      $('#status-title').textContent = s.title;
      $('#status-text').textContent = message;
      const primary = $('#status-primary');
      primary.hidden = !s.primary;
      if (s.primary) { primary.textContent = s.primary[0]; primary.href = s.primary[1]; }
      resendForm.hidden = !s.resend;
      show('result');
    };

    if (!token) {
      render('invalid', 'This verification link is incomplete. Please use the full link from the email, or request a new one below.');
    } else {
      session()
        .then(() => post('auth/verify-email.php', { token }))
        .then(d => render(d.status, d.message))
        .catch(e => render('invalid', e.code === 'network' ? e.message : 'We could not check this link. Please request a new one below.'));
    }

    resendForm.addEventListener('submit', e => {
      e.preventDefault();
      const email = resendForm.elements.email.value.trim();
      fieldErrors(resendForm, isEmail(email) ? {} : { email: 'Please enter a valid email address.' });
      if (!isEmail(email)) return;
      resendVerification(email, $('#resend-submit'), resendBox, 'Send a new link');
    });
  };

  pages.forgot = () => {
    const form = $('#form');
    const box = $('#alert');
    const submit = $('#submit');
    let lastEmail = '';
    const pre = params.get('email');
    if (pre && isEmail(pre)) form.elements.email.value = pre;
    session().catch(() => alertBox(box, 'error', 'We could not reach the server. Please try again.'));

    const request = async (email, btn, statusEl, idle) => {
      const d = await post('auth/forgot-password.php', { email });
      return d;
    };

    form.addEventListener('submit', async e => {
      e.preventDefault();
      hideAlert(box);
      const email = form.elements.email.value.trim();
      const f = !email ? { email: 'Please enter your email address.' } : !isEmail(email) ? { email: 'Please enter a valid email address.' } : {};
      fieldErrors(form, f);
      if (Object.keys(f).length) return;
      busy(submit, true, 'Sending reset link');
      try {
        const d = await request(email);
        lastEmail = email;
        $('#sent-email').textContent = email;
        $('#sent-text').textContent = d.message;
        busy(submit, false);
        show('sent');
        cooldown($('#resend'), 60, 'Send again');
      } catch (err) {
        busy(submit, false);
        alertBox(box, err.status === 429 ? 'warn' : 'error', err.message);
        fieldErrors(form, err.fields);
      }
    });

    $('#resend').addEventListener('click', async e => {
      const btn = e.currentTarget;
      const out = $('#sent-alert');
      btn.disabled = true; btn.textContent = 'Sending...';
      try {
        await request(lastEmail);
        alertBox(out, 'success', 'We sent another reset email. Only the newest link will work.');
        cooldown(btn, 60, 'Send again');
      } catch (err) {
        alertBox(out, err.status === 429 ? 'warn' : 'error', err.message);
        btn.disabled = false; btn.textContent = 'Send again';
      }
    });
    $('#change-email').addEventListener('click', () => { hideAlert($('#sent-alert')); show('form'); form.elements.email.focus(); });
  };

  pages.reset = () => {
    const token = takeToken();
    const form = $('#form');
    const box = $('#alert');
    const submit = $('#submit');
    wireRules(form.elements.password, $('#pw-rules'), $('#pw-meter'));

    const problem = {
      expired: ['warn', 'This reset link has expired', 'For your security, reset links only work for a limited time. Request a new one and use it soon after it arrives.'],
      used: ['warn', 'This reset link was already used', 'Each reset link works only once. If you still need to change your password, request a new link.'],
      invalid: ['error', 'This reset link is not valid', 'The link may be incomplete or replaced by a newer email. Request a new link to continue.']
    };
    const fail = status => {
      const p = problem[status] || problem.invalid;
      const icon = $('#problem-icon');
      icon.className = 'auth-status-icon is-' + p[0];
      icon.innerHTML = ICONS[p[0]];
      $('#problem-title').textContent = p[1];
      $('#problem-text').textContent = p[2];
      show('problem');
    };

    if (!token) { fail('invalid'); return; }
    session()
      .then(() => post('auth/reset-check.php', { token }))
      .then(d => { if (d.status === 'valid') { show('form'); form.elements.password.focus(); } else fail(d.status); })
      .catch(e => { if (e.code === 'network') { show('form'); alertBox(box, 'error', e.message); } else fail('invalid'); });

    form.addEventListener('submit', async e => {
      e.preventDefault();
      hideAlert(box);
      const f = passwordProblems(form);
      fieldErrors(form, f);
      if (Object.keys(f).length) { alertBox(box, 'error', 'Please fix the highlighted fields.'); return; }
      busy(submit, true, 'Updating password');
      try {
        await post('auth/reset-password.php', {
          token, password: form.elements.password.value, passwordConfirm: form.elements.passwordConfirm.value
        });
        form.reset();
        csrf = null; // the server started a fresh session
        show('done');
      } catch (err) {
        busy(submit, false);
        if (['token_expired', 'token_used', 'token_invalid'].includes(err.code)) {
          fail(err.code.replace('token_', ''));
          return;
        }
        alertBox(box, 'error', err.message);
        fieldErrors(form, err.fields);
      }
    });
  };

  const ICONS = {
    success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17"/></svg>',
    warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5.5l3 2"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3.5 7l8.5 6 8.5-6"/></svg>'
  };

  document.addEventListener('DOMContentLoaded', () => {
    wirePasswordToggles();
    const page = document.body.dataset.page;
    if (pages[page]) pages[page]();
  });
})();
