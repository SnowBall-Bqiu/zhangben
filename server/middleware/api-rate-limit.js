function createApiRateLimit({ windowMs = 60000, maxRequests = 120, maxEntries = 10000, now = Date.now } = {}) {
  const clients = new Map();
  let nextCleanup = 0;
  return function apiRateLimit(req, res, next) {
    const time = now();
    if (time >= nextCleanup) {
      for (const [key, record] of clients) {
        if (record.expires <= time) clients.delete(key);
      }
      nextCleanup = time + windowMs;
    }

    let record = clients.get(req.ip);
    if (record && record.expires <= time) { clients.delete(req.ip); record = null; }
    if (!record) {
      if (clients.size >= maxEntries) return reject(res, Math.ceil(windowMs / 1000));
      record = { count: 0, expires: time + windowMs };
      clients.set(req.ip, record);
    }
    if (++record.count > maxRequests) return reject(res, Math.max(1, Math.ceil((record.expires - time) / 1000)));
    return next();
  };
}

function reject(res, retryAfter) {
  res.set('Retry-After', String(retryAfter));
  return res.status(429).json({ error: true, message: '请求过于频繁，请稍后再试' });
}

module.exports = { createApiRateLimit };
