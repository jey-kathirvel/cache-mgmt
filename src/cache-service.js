const MAX_TTL = 86400 * 30;
const MAX_KEY_LENGTH = 100;
export function validKey(key) {
  return typeof key === 'string' && key.length > 0 && key.length <= MAX_KEY_LENGTH && /^[a-zA-Z0-9_-]+$/.test(key);
}
export function createCacheService(redis, opts = {}) {
  const prefix = opts.cachePrefix ?? 'demo:cache:';
  const metrics = opts.metricsPrefix ?? 'demo:metrics:';
  const counter = async (name, by = 1) => redis.incrBy(metrics + name, by);
  const full = key => prefix + key;
  async function read(key, count = true) {
    const raw = await redis.get(full(key));
    if (count) await counter(raw === null ? 'misses' : 'hits');
    return raw === null ? null : JSON.parse(raw);
  }
  return {
    async health() { return (await redis.ping()) === 'PONG'; },
    async set(key, value, ttlSeconds = 0) {
      const payload = JSON.stringify(value);
      if (ttlSeconds) await redis.set(full(key), payload, { EX: ttlSeconds });
      else await redis.set(full(key), payload);
      await counter('writes');
    },
    read,
    async get(key) {
      const value = await read(key);
      if (value === null) {
        // Redis supports stored JSON null; use EXISTS to distinguish it from a miss.
        if (!(await redis.exists(full(key)))) return null;
        return { found: true, value: null, ttlSeconds: await redis.ttl(full(key)) };
      }
      return { found: true, value, ttlSeconds: await redis.ttl(full(key)) };
    },
    async exists(key) { return Boolean(await redis.exists(full(key))); },
    async ttl(key) { return await redis.ttl(full(key)); },
    async remove(key) {
      const count = await redis.del(full(key));
      if (count) await counter('deletes', count);
      return count;
    },
    async invalidate(keys) {
      const removed = keys.length ? await redis.del(keys.map(full)) : 0;
      if (removed) await counter('deletes', removed);
      return removed;
    },
    async scan(cursor, count) {
      const result = await redis.scan(cursor, { MATCH: prefix + '*', COUNT: count });
      return { cursor: String(result.cursor), keys: result.keys.map(k => k.slice(prefix.length)) };
    },
    async stats() {
      const names = ['hits', 'misses', 'writes', 'deletes'];
      const vals = await redis.mGet(names.map(name => metrics + name));
      return Object.fromEntries(names.map((name, index) => [name, Number(vals[index] ?? 0)]));
    },
  };
}
export { MAX_TTL };
