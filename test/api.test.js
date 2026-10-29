const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { start } = require('../src/server');

let server;
const baseUrl = 'http://localhost:3000';

function get(path) {
  return new Promise((resolve, reject) => {
    http.get(`${baseUrl}${path}`, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(body) });
        } catch {
          resolve({ status: res.statusCode, data: body });
        }
      });
    }).on('error', reject);
  });
}

test.before(async () => {
  server = await start();
});

test.after(() => {
  if (server) server.close();
});

test('GET /api/v1/health returns healthy status', async () => {
  const res = await get('/api/v1/health');
  assert.equal(res.status, 200);
  assert.equal(res.data.status, 'healthy');
  assert.equal(res.data.counts.meters > 0, true);
  assert.equal(res.data.counts.transformers > 0, true);
});

test('GET /api/v1/meters returns paginated meters', async () => {
  const res = await get('/api/v1/meters?page=1&limit=10');
  assert.equal(res.status, 200);
  assert.equal(res.data.data.length, 10);
  assert.equal(res.data.pagination.page, 1);
  assert.equal(res.data.pagination.limit, 10);
  assert.equal(res.data.pagination.total > 0, true);
});

test('GET /api/v1/meters filters by phase and make', async () => {
  const res = await get('/api/v1/meters?make=HPL&phase=single');
  assert.equal(res.status, 200);
  for (const meter of res.data.data) {
    assert.equal(meter.make.toLowerCase(), 'hpl');
    assert.equal(meter.phaseType.toLowerCase(), 'single');
  }
});

test('GET /api/v1/meters/:id returns meter nameplate and location', async () => {
  const res = await get('/api/v1/meters/J100000');
  assert.equal(res.status, 200);
  assert.equal(res.data.data.meterId, 'J100000');
  assert.ok(res.data.data.serialNo);
  assert.ok(res.data.data.hierarchy);
  assert.ok(res.data.data.location.latitude);
});

test('GET /api/v1/meters/:id returns 404 for nonexistent meter', async () => {
  const res = await get('/api/v1/meters/NON_EXISTENT_9999');
  assert.equal(res.status, 404);
});

test('GET /api/v1/transformers returns all transformers with meter counts', async () => {
  const res = await get('/api/v1/transformers');
  assert.equal(res.status, 200);
  assert.equal(res.data.total, 40);
  assert.equal(res.data.data[0].meterCount > 0, true);
});

test('GET /api/v1/transformers/:code returns transformer and attached meters', async () => {
  const res = await get('/api/v1/transformers/DT-001');
  assert.equal(res.status, 200);
  assert.equal(res.data.data.code, 'DT-001');
  assert.ok(Array.isArray(res.data.data.meters));
  assert.equal(res.data.data.meters.length, res.data.data.meterCount);
});

test('GET /api/v1/network/hierarchy returns nested tree structure', async () => {
  const res = await get('/api/v1/network/hierarchy');
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.data.data));
  assert.equal(res.data.data[0].type, 'zone');
  assert.ok(res.data.data[0].children.length > 0);
});

test('GET /api/v1/meters/nearby calculates spatial proximity', async () => {
  const res = await get('/api/v1/meters/nearby?lat=26.9389&lng=75.8309&radiusKm=5');
  assert.equal(res.status, 200);
  assert.ok(res.data.totalFound > 0);
  assert.ok(res.data.data[0].distanceKm <= 5);
  // Verify sorting by distance ascending
  for (let i = 1; i < res.data.data.length; i++) {
    assert.ok(res.data.data[i].distanceKm >= res.data.data[i - 1].distanceKm);
  }
});

test('GET /openapi.json serves valid OpenAPI specification', async () => {
  const res = await get('/openapi.json');
  assert.equal(res.status, 200);
  assert.equal(res.data.openapi, '3.0.3');
  assert.ok(res.data.paths['/api/v1/meters']);
});
