import 'dotenv/config';
import { createClient } from 'redis';
import { createApp } from './app.js';
import { createCacheService } from './cache-service.js';

const redis = createClient({ url: process.env.REDIS_URL || 'redis://127.0.0.1:6379', socket: { reconnectStrategy: retries => retries < 3 ? 200 : new Error('Redis unavailable') } });
redis.on('error', error => console.error('Redis error:', error.message));
let server;
try {
  await redis.connect();
  const cache = createCacheService(redis, { cachePrefix: process.env.CACHE_PREFIX, metricsPrefix: process.env.METRICS_PREFIX });
  const port = Number(process.env.PORT || 3000);
  server = createApp(cache).listen(port, () => console.log('Redis Cache API listening on ' + port));
} catch (error) {
  console.error('Redis startup failure:', error.message);
  process.exitCode = 1;
  await redis.disconnect().catch(() => {});
}
if (server) {
  const shutdown = () => { server.close(async () => { await redis.quit().catch(() => {}); }); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
