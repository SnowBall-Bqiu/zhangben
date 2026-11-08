const proxyaddr = require('proxy-addr');

function readSecurityConfig(env = process.env) {
  // Only explicit local development/test modes may relax the public boundary.
  const isProduction = !['development', 'test'].includes(env.NODE_ENV);
  const sessionSecret = env.SESSION_SECRET || (isProduction ? '' : 'zhangben-local-development-secret');
  const secureCookie = env.SESSION_COOKIE_SECURE === undefined
    ? isProduction : parseBoolean(env.SESSION_COOKIE_SECURE);
  const trustedProxies = env.TRUSTED_PROXIES || '';
  const proxyAddresses = trustedProxies.split(',').map(value => value.trim()).filter(Boolean);
  let publicOrigin = null;

  if (isProduction) {
    if (Buffer.byteLength(sessionSecret, 'utf8') < 32
        || sessionSecret.trim() !== sessionSecret
        || /^(change-this|replace-with|zhangben-dev-secret)/i.test(sessionSecret)
        || new Set(sessionSecret).size < 8) {
      throw new Error('生产环境 SESSION_SECRET 必须是至少 32 字节的随机密钥，不能使用示例值');
    }
    if (!secureCookie) throw new Error('生产环境必须设置 SESSION_COOKIE_SECURE=true 并使用 HTTPS');
    if (!proxyAddresses.length || proxyAddresses.some(address => /^(true|[0-9]+)$/i.test(address) || /\/0+$/.test(address))) {
      throw new Error('生产环境 TRUSTED_PROXIES 必须明确指定实际 HTTPS 反向代理的地址或网段');
    }
    try {
      proxyaddr.compile(proxyAddresses);
    } catch {
      throw new Error('TRUSTED_PROXIES 包含无效的代理地址或网段');
    }
    try {
      const url = new URL(env.PUBLIC_ORIGIN);
      if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
        throw new Error('invalid origin');
      }
      publicOrigin = url.origin;
    } catch {
      throw new Error('生产环境 PUBLIC_ORIGIN 必须是站点的 HTTPS 来源，例如 https://ledger.example.com');
    }
  }

  return { isProduction, sessionSecret, secureCookie, trustedProxies, publicOrigin };
}

function parseBoolean(value) {
  if (['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase())) return true;
  if (['0', 'false', 'no', 'off'].includes(String(value).toLowerCase())) return false;
  throw new Error('SESSION_COOKIE_SECURE 必须是 true 或 false');
}

module.exports = { readSecurityConfig };
