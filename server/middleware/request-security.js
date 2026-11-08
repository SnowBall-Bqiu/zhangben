const express = require('express');

const mutatingMethods = new Set(['POST', 'PUT', 'PATCH']);

// Mount on /api so Express applies the same path matching rules as the routes.
function requireJsonBodyForApiWrites(req, res, next) {
  if (!mutatingMethods.has(req.method)) return next();

  if (req.is('application/json') || req.is('application/*+json')) return next();

  return res.status(415).json({ error: true, message: '写接口仅接受 JSON 请求' });
}

const jsonBodyParser = express.json({
  inflate: false,
  type: ['application/json', 'application/*+json'],
});

function configureProxyTrust(app, trustedProxies = process.env.TRUSTED_PROXIES || '') {
  const addresses = trustedProxies.split(',').map(value => value.trim()).filter(Boolean);
  // Direct deployments must ignore client-supplied forwarding headers.
  app.set('trust proxy', addresses.length ? addresses : false);
}

function apiNoStore(req, res, next) {
  res.set('Cache-Control', 'no-store');
  res.set('Pragma', 'no-cache');
  return next();
}

function enforcePublicAccess({ isProduction, publicOrigin }) {
  const publicHost = publicOrigin ? new URL(publicOrigin).host : null;
  return function publicAccess(req, res, next) {
    if (!isProduction) return next();
    if ((req.get('host') || '').toLowerCase() !== publicHost.toLowerCase()) {
      return res.status(421).json({ error: true, message: '请求的站点地址不正确' });
    }
    if (!req.secure) {
      return res.status(426).json({ error: true, message: '请通过 HTTPS 站点访问' });
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const origin = req.get('origin');
      if ((origin && origin !== publicOrigin) || req.get('sec-fetch-site') === 'cross-site') {
        return res.status(403).json({ error: true, message: '请求来源不正确' });
      }
    }
    return next();
  };
}

module.exports = { requireJsonBodyForApiWrites, jsonBodyParser, configureProxyTrust, apiNoStore, enforcePublicAccess };
