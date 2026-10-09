/* ============================================================
   00b · API - the only place that talks to the server
   fetch() wrapper: same-origin credentials, CSRF header,
   one error envelope, one place to handle 401/419.
   ============================================================ */
const Api = (() => {
  const BASE = 'api/';
  const CSRF_HEADER = 'X-CSRF-Token';

  let csrfToken = null;
  let onUnauthenticated = () => { location.href = 'pages/login.html'; };

  const setToken = t => { if (typeof t === 'string' && t) csrfToken = t; };
  const token = () => csrfToken;
  const setUnauthenticatedHandler = fn => { if (typeof fn === 'function') onUnauthenticated = fn; };

  /** Error carrying the server's code and per-field messages. */
  class ApiError extends Error {
    constructor(message, { status = 0, code = 'network_error', details = {} } = {}) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.code = code;
      this.details = details;
      this.fields = (details && details.fields) || {};
    }
    get isValidation() { return this.code === 'validation_failed'; }
    get isConflict() { return this.status === 409; }
    get isAuth() { return this.status === 401 || this.status === 419; }
  }

  const query = params => {
    if (!params) return '';
    const q = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') q.append(k, String(v));
    });
    const s = q.toString();
    return s ? `?${s}` : '';
  };

  /**
   * Every request goes through here.
   * Resolves with the envelope's `data`; the `meta` block is attached to the
   * returned value's non-enumerable `$meta` when present.
   */
  const request = async (path, { method = 'GET', body = null, params = null, signal = null } = {}) => {
    const headers = { Accept: 'application/json' };
    const isWrite = method !== 'GET' && method !== 'HEAD';

    if (isWrite) {
      headers['Content-Type'] = 'application/json';
      if (csrfToken) headers[CSRF_HEADER] = csrfToken;
    }

    let response;
    try {
      response = await fetch(BASE + path + query(params), {
        method,
        headers,
        signal,
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
        body: isWrite && body !== null ? JSON.stringify(body) : undefined
      });
    } catch (e) {
      if (e && e.name === 'AbortError') throw e;
      throw new ApiError('We could not reach the server. Check your connection and try again.',
        { code: 'network_error' });
    }

    let payload = null;
    const text = await response.text();
    if (text) {
      try { payload = JSON.parse(text); }
      catch (e) { payload = null; }
    }

    if (!response.ok || !payload || payload.ok !== true) {
      const error = (payload && payload.error) || {};
      const err = new ApiError(
        error.message || 'Something went wrong. Please try again.',
        { status: response.status, code: error.code || 'server_error', details: error.details || {} }
      );
      if (err.isAuth) onUnauthenticated(err);
      throw err;
    }

    const data = payload.data;
    if (payload.meta && data && typeof data === 'object') {
      try { Object.defineProperty(data, '$meta', { value: payload.meta, enumerable: false }); }
      catch (e) { /* frozen or primitive wrapper: meta is simply unavailable */ }
    }
    return data;
  };

  const get = (path, params, opts) => request(path, { ...opts, method: 'GET', params });
  const post = (path, body, params) => request(path, { method: 'POST', body, params });
  const del = (path, body, params) => request(path, { method: 'DELETE', body, params });

  /* ---------- endpoints ---------- */
  const endpoints = {
    session: () => get('auth/session.php'),
    login: (email, password, remember = false) => post('auth/login.php', { email, password, remember }),
    register: (email, password, displayName) => post('auth/register.php', { email, password, displayName }),
    logout: () => post('auth/logout.php', {}),
    changePassword: (currentPassword, newPassword) => post('auth/password.php', { currentPassword, newPassword }),

    bootstrap: () => get('bootstrap.php'),

    settings: { update: patch => post('settings/update.php', patch) },

    categories: {
      list: () => get('categories/list.php'),
      create: data => post('categories/create.php', data),
      update: (id, patch) => post('categories/update.php', patch, { id }),
      remove: id => post('categories/delete.php', { id })
    },
    accounts: {
      list: () => get('accounts/list.php'),
      create: data => post('accounts/create.php', data),
      update: (id, patch) => post('accounts/update.php', patch, { id }),
      remove: (id, mode) => post('accounts/delete.php', { id, mode: mode || 'delete' })
    },
    transactions: {
      list: filters => get('transactions/list.php', filters),
      recent: limit => get('transactions/recent.php', { limit }),
      create: data => post('transactions/create.php', data),
      update: (id, patch) => post('transactions/update.php', patch, { id }),
      remove: id => post('transactions/delete.php', { id })
    },
    budgets: {
      list: () => get('budgets/list.php'),
      get: month => get('budgets/get.php', { month }),
      setLine: (month, categoryId, amount) => post('budgets/line.php', { month, categoryId, amount }),
      setPlan: (month, kind, rows) => post('budgets/plan.php', { month, kind, rows }),
      copy: (from, to) => post('budgets/copy.php', { from, to }),
      remove: month => post('budgets/delete.php', { month })
    },
    savedBudgets: {
      list: () => get('saved-budgets/list.php'),
      create: payload => post('saved-budgets/create.php', payload),
      update: (id, patch) => post('saved-budgets/update.php', { id, ...patch }),
      remove: id => post('saved-budgets/delete.php', { id }),
      load: (id, month) => post('saved-budgets/load.php', { id, month })
    },
    goals: {
      list: () => get('goals/list.php'),
      create: data => post('goals/create.php', data),
      update: (id, patch) => post('goals/update.php', patch, { id }),
      remove: id => post('goals/delete.php', { id }),
      contribute: data => post('goals/contribute.php', data),
      contributions: goalId => get('goals/contributions.php', { goalId }),
      uncontribute: contributionId => post('goals/uncontribute.php', { contributionId })
    },
    bills: {
      list: days => get('bills/list.php', { days }),
      create: data => post('bills/create.php', data),
      update: (id, patch) => post('bills/update.php', patch, { id }),
      remove: id => post('bills/delete.php', { id }),
      pay: (id, opts) => post('bills/pay.php', opts || {}, { id }),
      unpay: id => post('bills/unpay.php', {}, { id }),
      payments: billId => get('bills/payments.php', { billId })
    },
    recurring: {
      list: () => get('recurring/list.php'),
      create: data => post('recurring/create.php', data),
      update: (id, patch) => post('recurring/update.php', patch, { id }),
      remove: id => post('recurring/delete.php', { id }),
      pause: (id, paused) => post('recurring/pause.php', { paused }, { id }),
      run: opts => post('recurring/run.php', opts || {}),
      preview: () => get('recurring/preview.php')
    },
    grocery: {
      list: () => get('grocery/list.php'),
      create: data => post('grocery/create.php', data),
      update: (id, patch) => post('grocery/update.php', patch, { id }),
      remove: id => post('grocery/delete.php', { id }),
      clear: () => post('grocery/clear.php', {}),
      submit: data => post('grocery/submit.php', data)
    },
    groceryLists: {
      list: () => get('grocery-lists/list.php'),
      create: data => post('grocery-lists/create.php', data),
      update: (id, patch) => post('grocery-lists/update.php', patch, { id }),
      remove: id => post('grocery-lists/delete.php', { id }),
      load: (id, replace) => post('grocery-lists/load.php', { replace: replace !== false }, { id })
    },
    reports: {
      dashboard: (month, months) => get('reports/dashboard.php', { month, months }),
      month: month => get('reports/month.php', { month }),
      series: (month, months) => get('reports/series.php', { month, months }),
      categories: (month, type, ids, months) => get('reports/categories.php', { month, type, ids: (ids || []).join(','), months }),
      budget: month => get('reports/budget.php', { month }),
      netWorth: includeArchived => get('reports/networth.php', { includeArchived }),
      bills: days => get('reports/bills.php', { days })
    },
    notifications: {
      list: () => get('notifications/list.php'),
      read: ids => post('notifications/read.php', { ids }),
      readAll: () => post('notifications/read.php', { all: true })
    },
    // Super Admin only. The server rejects every call from a normal user (403);
    // hiding the menu is presentation, not security.
    admin: {
      overview: () => get('admin/overview.php'),
      users: q => get('admin/users.php', { q }),
      create: payload => post('admin/posts/create.php', payload),
      update: (id, patch) => post('admin/posts/update.php', { id, ...patch }),
      remove: id => post('admin/posts/delete.php', { id })
    },
    data: {
      counts: () => get('data/counts.php'),
      reset: () => post('data/reset.php', { confirm: 'RESET' }),
      clearSample: () => post('data/clear-sample.php', {}),
      export: () => get('data/export.php')
    }
  };

  return { ...endpoints, request, get, post, del, setToken, token, setUnauthenticatedHandler, ApiError };
})();
