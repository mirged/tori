import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IncomingMessage, ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import { Duplex } from 'node:stream';
import type { Express } from 'express';
import { createTori } from '../apps/server/src/server.js';
import { samples } from '../packages/shared/src/samples.js';

// Exercise Express with real Node HTTP request/response objects over an in-memory
// stream. This checks HTTP handling even when the environment blocks TCP binding.
function dispatch(app: Express, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; headers: ReturnType<ServerResponse['getHeaders']>; body: string; json: () => any }>((resolve, reject) => {
    const bytes = body === undefined ? undefined : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
    const stream = new Duplex({ read() {}, write(_chunk, _encoding, callback) { callback(); } });
    Object.defineProperty(stream, 'remoteAddress', { value: '127.0.0.1' });
    const request = new IncomingMessage(stream as Socket);
    request.method = method; request.url = path;
    request.headers = { host: 'localhost', ...(bytes ? { 'content-type': 'application/json', 'content-length': String(bytes.length) } : {}), ...headers };
    let sent = false;
    request._read = () => { if (!sent) { sent = true; if (bytes) request.push(bytes); request.push(null); } };
    const response = new ServerResponse(request); response.assignSocket(stream as Socket);
    const chunks: Buffer[] = [];
    const write = response.write.bind(response), end = response.end.bind(response);
    response.write = ((chunk: any, ...args: any[]) => { if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)); return (write as any)(chunk, ...args); }) as typeof response.write;
    response.end = ((chunk?: any, ...args: any[]) => { if (chunk && typeof chunk !== 'function') chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)); return (end as any)(chunk, ...args); }) as typeof response.end;
    const timeout = setTimeout(() => { stream.destroy(); reject(new Error('In-memory HTTP request timed out.')); }, 3000);
    response.on('finish', () => { clearTimeout(timeout); const result = Buffer.concat(chunks).toString(); resolve({ status: response.statusCode, headers: response.getHeaders(), body: result, json: () => JSON.parse(result) }); stream.destroy(); });
    app(request, response);
  });
}
test('HTTP API validates JSON, origin, imports, credentials, and private response headers', async t => {
  const server = await createTori({ database: ':memory:', web: false, production: true }); t.after(() => server.close());
  const request = (method: string, path: string, body?: unknown, headers?: Record<string, string>) => dispatch(server.app, method, path, body, headers);
  const health = await request('GET', '/api/health'); assert.equal(health.status, 200); assert.equal(health.json().capacity.measured, false);
  assert.equal(health.headers['cache-control'], 'no-store'); assert.equal(health.headers['x-content-type-options'], 'nosniff'); assert.ok(health.headers['content-security-policy']);
  assert.equal((await request('POST', '/api/rooms', {})).status, 400);
  assert.equal((await request('POST', '/api/rooms', '{bad')).status, 400);
  assert.equal((await request('POST', '/api/join', { pin: '123456', name: 'Name' }, { origin: 'https://hostile.example' })).status, 403);
  assert.equal((await request('GET', '/api/missing')).status, 404);
  const created = await request('POST', '/api/rooms', { quiz: samples[0], mode: 'accuracy', approval: true, leaderboard: true });
  assert.equal(created.status, 201); const host = created.json(); assert.match(host.pin, /^\d{6}$/); assert.equal(host.token.length, 64);
  assert.equal((await request('POST', '/api/join', { pin: host.pin, name: 'bad\nname' })).status, 400);
  const joined = await request('POST', '/api/join', { pin: host.pin, name: 'Curious Mouse' }); assert.equal(joined.status, 201);
  assert.notEqual(joined.json().token, host.token);
  assert.equal((await request('GET', `/api/rooms/${host.pin}/results.csv`)).status, 400);
  assert.equal((await request('GET', `/api/rooms/${host.pin}/results.csv`, undefined, { authorization: `Bearer ${host.token}` })).status, 400);
  const oversized = await request('POST', '/api/rooms', JSON.stringify({ payload: 'x'.repeat(8 * 1024 * 1024) })); assert.equal(oversized.status, 413);
});
