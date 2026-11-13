import express from 'express';
import { validKey, MAX_TTL } from './cache-service.js';

export function createApp(cache) {
  const app = express();
  app.use(express.json({ limit: '16kb' }));
  const asyncRoute = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
  const validateKey = (req, res, next) => validKey(req.params.key) ? next() : res.status(400).json({ error: 'Invalid key: use 1-100 letters, digits, underscore or hyphen' });
  const mockProducts = Object.freeze({
    '1': { id: 1, name: 'Wireless Mouse', price: 799 },
    '2': { id: 2, name: 'USB Keyboard', price: 1199 }
  });

  app.get('/health', asyncRoute(async (_req, res) => {
    const connected = await cache.health();
    res.status(connected ? 200 : 503).json({ status: connected ? 'ok' : 'unavailable', redis: connected ? 'connected' : 'disconnected' });
  }));

  // Static routes before :key routes.
  app.get('/api/cache/stats', asyncRoute(async (_req, res) => res.json(await cache.stats())));
  app.post('/api/cache/invalidate', asyncRoute(async (req, res) => {
    const keys = req.body?.keys;
    if (!Array.isArray(keys) || !keys.length || keys.length > 100 || keys.some(k => !validKey(k)) || new Set(keys).size !== keys.length)
      return res.status(400).json({ error: 'Provide 1-100 unique valid keys' });
    res.json({ removed: await cache.invalidate(keys) });
  }));
  app.get('/api/cache', asyncRoute(async (req, res) => {
    const cursor = String(req.query.cursor ?? '0');
    const limit = Number(req.query.limit ?? 20);
    if (!/^\d+$/.test(cursor) || !Number.isSafeInteger(limit) || limit < 1 || limit > 100)
      return res.status(400).json({ error: 'cursor must be numeric; limit 1-100' });
    res.json(await cache.scan(cursor, limit));
  }));
  app.put('/api/cache/:key', validateKey, asyncRoute(async (req, res) => {
    const body = req.body;
    const ttl = body?.ttlSeconds ?? 0;
    if (!body || !Object.hasOwn(body, 'value') || Object.keys(body).some(k => !['value','ttlSeconds'].includes(k)) ||
        !Number.isInteger(ttl) || ttl < 0 || ttl > MAX_TTL)
      return res.status(400).json({ error: 'Provide value and optional ttlSeconds integer (0 to 2592000)' });
    await cache.set(req.params.key, body.value, ttl);
    res.json({ key: req.params.key, ttlSeconds: ttl, stored: true });
  }));
  app.get('/api/cache/:key/ttl', validateKey, asyncRoute(async (req, res) => {
    const ttlSeconds = await cache.ttl(req.params.key);
    if (ttlSeconds === -2) return res.status(404).json({ error: 'Key not found' });
    res.json({ key: req.params.key, ttlSeconds });
  }));
  app.get('/api/cache/:key', validateKey, asyncRoute(async (req, res) => {
    const result = await cache.get(req.params.key);
    if (!result) return res.status(404).json({ error: 'Key not found' });
    res.json({ key: req.params.key, ...result });
  }));
  app.delete('/api/cache/:key', validateKey, asyncRoute(async (req, res) => {
    const removed = await cache.remove(req.params.key);
    if (!removed) return res.status(404).json({ error: 'Key not found' });
    res.status(204).end();
  }));

  app.post('/api/demo/products/:id', asyncRoute(async (req, res) => {
    const id = req.params.id;
    if (!/^[0-9]{1,3}$/.test(id)) return res.status(400).json({ error: 'Invalid product ID' });
    const key = 'product_' + id;
    const cached = await cache.get(key);
    if (cached) return res.json({ source: 'cache', product: cached.value });
    const product = mockProducts[id];
    if (!product) return res.status(404).json({ error: 'Product not found' });
    await cache.set(key, product, 30);
    res.json({ source: 'origin', product });
  }));

  app.use((error, _req, res, _next) => {
    if (error instanceof SyntaxError && 'body' in error) return res.status(400).json({ error: 'Malformed JSON' });
    console.error('Cache API error:', error.message);
    res.status(503).json({ error: 'Cache service unavailable' });
  });
  return app;
}
