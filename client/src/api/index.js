const BASE = '/api';

async function request(url, options = {}) {
  const res = await fetch(`${BASE}${url}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || '请求失败');
  return data;
}

// 认证
export const fetchMe = () => request('/auth/me');
export const login = (username, password) => request('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
export const logout = () => request('/auth/logout', { method: 'POST' });
export const changePassword = (newPassword) => request('/auth/change-password', { method: 'POST', body: JSON.stringify({ newPassword }) });
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
export const fetchCategories = (type) => request(type ? `/categories?type=${type}` : '/categories');
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
export const fetchMonthlyData = (year, month) => request(`/dashboard/monthly?year=${year}&month=${month}`);
