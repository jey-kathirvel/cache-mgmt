import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';

function fakeCache() {
  const store = new Map();
  const stats = { hits: 0, misses: 0, writes: 0, deletes: 0 };
  const cache = {
    async health() { return true; },
    async set(key, value, ttl = 0) { store.set(key, { value, ttl }); stats.writes++; },
    async get(key) { const item = store.get(key); stats[item ? 'hits' : 'misses']++; return item ? { found: true, value: item.value, ttlSeconds: item.ttl || -1 } : null; },
    async remove(key) { const hit = store.delete(key); if (hit) stats.deletes++; return Number(hit); },
    async ttl(key) { return store.has(key) ? store.get(key).ttl || -1 : -2; },
    async invalidate(keys) { let n=0; for (const k of keys) n += await cache.remove(k); return n; },
    async scan(cursor) { return { cursor: '0', keys: [...store.keys()] }; },
    async stats() { return { ...stats }; }
  };
  return cache;
}

test('health reports healthy service', async () => {
  const res = await request(createApp(fakeCache())).get('/health');
  assert.equal(res.status, 200);
  assert.equal(res.body.redis, 'connected');
});
test('PUT and GET store a JSON cache object with TTL', async () => {
  const app = createApp(fakeCache());
  const set = await request(app).put('/api/cache/user_1').send({ value: { name: 'Ada' }, ttlSeconds: 60 });
  assert.equal(set.status, 200);
  const get = await request(app).get('/api/cache/user_1');
  assert.equal(get.status, 200);
  assert.deepEqual(get.body.value, { name: 'Ada' });
  assert.equal(get.body.ttlSeconds, 60);
});
test('invalid keys, missing value, and invalid TTL return 400', async () => {
  const app = createApp(fakeCache());
  assert.equal((await request(app).put('/api/cache/invalid.key').send({ value: 1 })).status, 400);
  assert.equal((await request(app).put('/api/cache/key').send({ ttlSeconds: 10 })).status, 400);
  assert.equal((await request(app).put('/api/cache/key').send({ value: 'hi', ttlSeconds: -1 })).status, 400);
});
test('DELETE invalidates and GET returns 404 afterwards', async () => {
  const app = createApp(fakeCache());
  await request(app).put('/api/cache/session').send({ value: 'token' });
  assert.equal((await request(app).delete('/api/cache/session')).status, 204);
  assert.equal((await request(app).get('/api/cache/session')).status, 404);
});
test('bulk invalidation is bounded and validates keys', async () => {
  const app = createApp(fakeCache());
  assert.equal((await request(app).post('/api/cache/invalidate').send({ keys: ['good','bad.key'] })).status, 400);
  assert.equal((await request(app).post('/api/cache/invalidate').send({ keys: [] })).status, 400);
  await request(app).put('/api/cache/a').send({ value: 1 });
  await request(app).put('/api/cache/b').send({ value: 2 });
  const res = await request(app).post('/api/cache/invalidate').send({ keys: ['a','b'] });
  assert.equal(res.body.removed, 2);
});
test('cache-aside product endpoint reports origin then cache', async () => {
  const app = createApp(fakeCache());
  const first = await request(app).post('/api/demo/products/1');
  const second = await request(app).post('/api/demo/products/1');
  assert.equal(first.body.source, 'origin');
  assert.equal(second.body.source, 'cache');
  assert.deepEqual(second.body.product, first.body.product);
});
test('cache metrics count hits, misses and writes', async () => {
  const app = createApp(fakeCache());
  await request(app).get('/api/cache/unknown');
  await request(app).put('/api/cache/demo').send({ value: 12 });
  await request(app).get('/api/cache/demo');
  const res = await request(app).get('/api/cache/stats');
  assert.equal(res.body.misses, 1);
  assert.equal(res.body.hits, 1);
  assert.equal(res.body.writes, 1);
});
