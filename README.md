# Redis Cache Management API

A standalone **Redis cache management** and **QA automation portfolio** project. Demonstrates Redis key-value storage, TTL expiry, cache-aside reads, invalidation, cache metrics and automated API testing with a practical REST API.

> Demo only: no authentication, user isolation, or rate limits. Run locally; do not expose this API to the public internet or use production data.

## Technology stack

- Node.js 20+ (ES modules) and Express
- Redis 7 with `redis` Node.js client
- Supertest and Node.js built-in test runner
- Docker Compose for a local Redis service

## Architecture

```text
Postman / cURL / Test runner
              |
              v
      Express REST API
              |
              v
   Cache service (validation)
              |
              v
 Redis (key/value + TTL + counters)
```

The example uses **strings serialized as JSON**, with a `demo:` namespace. It uses Redis `SET`, `GET`, `DEL`, `EXISTS`, `TTL`, `SCAN`, `MGET`, and atomic `INCR` counters for application-level metrics. It intentionally avoids `KEYS *` to demonstrate incremental scanning.

## Quick start

Requirements: Node.js 20+, npm, Docker with Compose.

```bash
git clone https://github.com/jey-kathirvel/cache-mgmt.git
cd cache-mgmt
docker compose up -d
cp .env.example .env
npm install
npm test
npm start
```

Check:

```bash
curl http://localhost:3000/health
```

Expected response contains `"status":"ok"` and `"redis":"connected"`.

> The container binds Redis to **127.0.0.1:6379** only. Never commit secrets. If the port is already used, update Compose and `REDIS_URL` consistently.

## API reference

| Method | Endpoint | Description | Response |
|---|---|---|---|
| GET | `/health` | Redis connectivity check | 200 / 503 |
| PUT | `/api/cache/:key` | Store JSON value; optional TTL | 200 / 400 |
| GET | `/api/cache/:key` | Read value and remaining TTL | 200 / 404 |
| DELETE | `/api/cache/:key` | Invalidate one key | 204 / 404 |
| GET | `/api/cache/:key/ttl` | Inspect remaining TTL | 200 / 404 |
| GET | `/api/cache?cursor=0&limit=20` | Scan keys in `demo:` namespace | 200 / 400 |
| POST | `/api/cache/invalidate` | Delete named keys in bulk | 200 / 400 |
| GET | `/api/cache/stats` | Application-level hit/miss/write/delete counters | 200 |
| POST | `/api/demo/products/:id` | Cache-aside demo using mock product data | 200 / 400 / 404 |

### Create an expiring cache entry

```bash
curl -X PUT http://localhost:3000/api/cache/session-101 \
  -H 'Content-Type: application/json' \
  -d '{"value":{"customerId":101,"status":"active"},"ttlSeconds":60}'
```

Get and inspect the entry:

```bash
curl http://localhost:3000/api/cache/session-101
curl http://localhost:3000/api/cache/session-101/ttl
```

Overwrite without expiry (`ttlSeconds:0`) or with another positive TTL:

```bash
curl -X PUT http://localhost:3000/api/cache/session-101 \
  -H 'Content-Type: application/json' \
  -d '{"value":{"customerId":101,"status":"updated"},"ttlSeconds":0}'
```

List keys via cursor-based `SCAN`:

```bash
curl 'http://localhost:3000/api/cache?cursor=0&limit=20'
```

Delete one key or several:

```bash
curl -X DELETE http://localhost:3000/api/cache/session-101
curl -X POST http://localhost:3000/api/cache/invalidate \
  -H 'Content-Type: application/json' \
  -d '{"keys":["session-101","session-102"]}'
```

Read demo product data using cache-aside:

```bash
curl -X POST http://localhost:3000/api/demo/products/1
curl -X POST http://localhost:3000/api/demo/products/1
curl http://localhost:3000/api/cache/stats
```

The first request should report `"source":"origin"`; the second `"source":"cache"` until expiry or invalidation. The product origin is an in-memory mock object, **not an external database**.

## Cache fundamentals demonstrated

1. **Write-through API**: `PUT` writes the supplied JSON value directly to Redis.
2. **TTL**: `SET EX` makes entries expire; Redis `TTL` returns remaining seconds (-1 means no expiry; -2 means absent).
3. **Cache hit / miss**: `GET` distinguishes a stored value from an absent key.
4. **Cache-aside**: product endpoint checks cache, loads from mock origin on a miss and populates Redis with a short TTL.
5. **Invalidation**: `DEL` removes named entries; bulk deletion is bounded.
6. **Key enumeration**: `SCAN` returns a cursor and batch of names without blocking a Redis instance like `KEYS`.
7. **Metrics**: simple hit/miss/write/delete counts in Redis using `INCR`. These are **app counters**, not global Redis `INFO` metrics.
8. **Namespaces**: application cache keys use `demo:cache:`; metrics use `demo:metrics:`.

## Testing

```bash
npm test
```

Unit/API-route tests use Supertest and an in-memory fake cache service so they **do not require Redis**. They check payload validation, status codes, TTL and cache-aside hit/miss behavior.

To test the **real Redis integration**:

```bash
docker compose up -d
npm start
```

Then run the cURL examples and verify expiry:

```bash
curl -X PUT http://localhost:3000/api/cache/short \
  -H 'Content-Type: application/json' -d '{"value":"hello","ttlSeconds":2}'
curl http://localhost:3000/api/cache/short
sleep 3
curl -i http://localhost:3000/api/cache/short
```

The final response should be HTTP 404. To view the stored data directly:

```bash
docker compose exec redis redis-cli GET demo:cache:short
docker compose exec redis redis-cli INFO memory
```

The first command returns nil after expiry; `INFO memory` provides actual Redis server memory statistics.

### QA test ideas

- Valid JSON values: strings, numbers, booleans, objects, arrays and null
- Invalid keys, unknown fields, missing value and malformed JSON
- `ttlSeconds` negative, non-integer and above supported bound
- Exact expiry behavior (allow time tolerance)
- Duplicate writes, updates and no-TTL entries
- Cache-aside miss then hit, then invalidation then miss
- Redis service unavailable: health check 503 and API error 503
- Cursor scanning and bounded bulk invalidation
- Atomic counter behavior under concurrent requests

## Operational notes

- Redis data is persisted in a Docker volume; use `docker compose down -v` only when you intend to **delete demo data**.
- Health checks use `PING`; startup fails if Redis is unavailable.
- This sample does not implement authentication, concurrency locks, multi-tenancy, encryption, eviction tuning, or production monitoring.
- Metrics and cache entries use separate namespaces.
- For production, configure TLS/authentication, access controls, observability and defensible key/TTL limits.

## Portfolio / resume description

After verifying it locally, you can say:

> Built a Redis Cache Management REST API using Node.js and Express, implementing JSON cache CRUD, TTL expiry, key invalidation, cursor scanning, cache-aside reads, metrics and automated API tests.
