const BASE = '/api';
let cachedCsrfToken = null;
let csrfPromise = null;
let sessionGeneration = 0;
let authenticated = false;
const sessionExpiredListeners = new Set();

export function subscribeToSessionExpired(listener) {
  sessionExpiredListeners.add(listener);
  return () => sessionExpiredListeners.delete(listener);
}

function advanceSession(isAuthenticated) {
  sessionGeneration += 1;
  authenticated = isAuthenticated;
  cachedCsrfToken = null;
  csrfPromise = null;
}

function ensureCurrentSession(generation) {
  if (generation !== sessionGeneration) {
    throw new Error('会话已变更，请重试');
  }
}

async function parseResponse(res) {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

async function fetchCsrfToken(force = false) {
  if (cachedCsrfToken && !force) return cachedCsrfToken;
  if (csrfPromise && !force) return csrfPromise;

  const generation = sessionGeneration;
  const pending = fetch(`${BASE}/auth/csrf`, { credentials: 'same-origin' })
    .then(async res => {
      const data = await parseResponse(res);
      ensureCurrentSession(generation);
      if (!res.ok) throw new Error(data.message || '获取安全令牌失败');
      cachedCsrfToken = data.csrfToken;
      return cachedCsrfToken;
    })
    .finally(() => {
      if (csrfPromise === pending) csrfPromise = null;
    });

  csrfPromise = pending;
  return pending;
}

async function request(url, options = {}, retrying = false) {
  const generation = sessionGeneration;
  const method = (options.method || 'GET').toUpperCase();
  const headers = { ...(options.headers || {}) };

  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    headers['Content-Type'] = headers['Content-Type'] || 'application/json';
    headers['X-CSRF-Token'] = await fetchCsrfToken();
  }
  ensureCurrentSession(generation);

  const res = await fetch(`${BASE}${url}`, {
    ...options,
    method,
    headers,
    credentials: 'same-origin'
  });

  const data = await parseResponse(res);
  // Responses started before logout, reauthentication, or password rotation must
  // not restore a previous user's profile or overwrite the current CSRF token.
  ensureCurrentSession(generation);

  if (res.status === 401 && authenticated && url !== '/auth/login') {
    advanceSession(false);
    sessionExpiredListeners.forEach(listener => listener());
    throw new Error(data.message || '会话已失效，请重新登录');
  }

  if (res.ok && ['/auth/login', '/auth/change-password', '/auth/logout'].includes(url)) {
    advanceSession(url !== '/auth/logout');
  } else if (res.ok && url === '/auth/me') {
    authenticated = true;
  }
  if (data.csrfToken) cachedCsrfToken = data.csrfToken;

  if (!res.ok && data.code === 'CSRF_INVALID' && !retrying) {
    cachedCsrfToken = null;
    await fetchCsrfToken(true);
    return request(url, options, true);
  }

  if (!res.ok) throw new Error(data.message || '请求失败');
  return data;
}

// 认证
export const fetchMe = () => request('/auth/me');
export const login = (username, password) => request('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
export const logout = () => request('/auth/logout', { method: 'POST' });
export const changePassword = (currentPassword, newPassword) => request('/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) });
export const updateProfile = (data) => request('/auth/profile', { method: 'PUT', body: JSON.stringify(data) });

// 账目
export const fetchTransactions = (params = {}) => {
  const qs = new URLSearchParams(params).toString();
  return request(`/transactions?${qs}`);
};
export const createTransaction = (data) => request('/transactions', { method: 'POST', body: JSON.stringify(data) });
export const updateTransaction = (id, data) => request(`/transactions/${id}`, { method: 'PUT', body: JSON.stringify(data) });
export const deleteTransaction = (id) => request(`/transactions/${id}`, { method: 'DELETE' });

// 分类
export const fetchCategories = (type) => request(type ? `/categories?${new URLSearchParams({ type }).toString()}` : '/categories');
export const createCategory = (data) => request('/categories', { method: 'POST', body: JSON.stringify(data) });
export const updateCategory = (id, data) => request(`/categories/${id}`, { method: 'PUT', body: JSON.stringify(data) });
export const deleteCategory = (id) => request(`/categories/${id}`, { method: 'DELETE' });
export const reorderCategories = (ids) => request('/categories/reorder', { method: 'PUT', body: JSON.stringify({ ids }) });

// 账户
export const fetchAccounts = () => request('/accounts');
export const createAccount = (data) => request('/accounts', { method: 'POST', body: JSON.stringify(data) });
export const updateAccount = (id, data) => request(`/accounts/${id}`, { method: 'PUT', body: JSON.stringify(data) });
export const deleteAccount = (id) => request(`/accounts/${id}`, { method: 'DELETE' });
export const reorderAccounts = (ids) => request('/accounts/reorder', { method: 'PUT', body: JSON.stringify({ ids }) });

// 仪表盘
export const fetchDashboardSummary = () => request('/dashboard/summary');
export const fetchDashboardTrend = () => request('/dashboard/trend');
export const fetchMonthlyData = (year, month) => request(`/dashboard/monthly?${new URLSearchParams({ year, month }).toString()}`);
export const fetchYearlyData = (year) => request(`/dashboard/yearly?${new URLSearchParams({ year }).toString()}`);
