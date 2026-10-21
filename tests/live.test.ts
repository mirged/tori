import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { io, type Socket } from 'socket.io-client';
import { Fetch } from 'engine.io-client';
import { createTori } from '../apps/server/src/server.js';
import { samples } from '../packages/shared/src/samples.js';
import type { Ack, Credentials, Snapshot } from '../packages/shared/src/protocol.js';
import { memoryFetch } from './http-memory.js';

async function exerciseLive(t: TestContext, memory: boolean) {
  const dir = mkdtempSync(join(tmpdir(), 'tori-live-')); const database = join(dir, 'live.sqlite');
  let server = await createTori({ database, web: false }); const sockets: Socket[] = [];
  const tuneMemoryTransport = () => {
    if (!memory) return;
    // Memory streams have no TCP teardown; shorten only the test transport's
    // default 30-second graceful-close timer after a client has disconnected.
    server.io.engine.on('connection', socket => {
      const transport = socket.transport as typeof socket.transport & { closeTimeout?: number };
      if ('closeTimeout' in transport) transport.closeTimeout = 50;
    });
  };
  tuneMemoryTransport();
  const originalFetch = globalThis.fetch;
  if (memory) globalThis.fetch = memoryFetch(() => server.http);
  t.after(async () => {
    for (const socket of sockets) socket.disconnect();
    if (memory) await waitFor(() => server.io.engine.clientsCount === 0);
    await server.close(); globalThis.fetch = originalFetch; rmSync(dir, { recursive: true, force: true });
  });
  async function listen() {
    if (memory) return 'http://tori.test';
    await new Promise<void>((resolve, reject) => { server.http.once('error', reject); server.http.listen(0, '127.0.0.1', () => { server.http.off('error', reject); resolve(); }); });
    const address = server.http.address(); assert.ok(address && typeof address !== 'string'); return `http://127.0.0.1:${address.port}`;
  }
  let base: string;
  try { base = await listen(); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'EPERM') { t.skip('This sandbox blocks local socket binding; run npm test on a host with loopback access.'); return; } throw error; }
  async function waitFor(predicate: () => boolean) {
    const deadline = Date.now() + 3000;
    while (!predicate()) { if (Date.now() >= deadline) throw new Error('Client state did not converge.'); await new Promise(resolve => setTimeout(resolve, 10)); }
  }
  async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
    const response = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  }
  const health = await fetch(base + '/api/health'); assert.equal(health.status, 200);
  assert.equal((await post('/api/rooms', {})).status, 400);
  assert.equal((await post('/api/join', { pin: '123456', name: 'x' }, { Origin: 'https://hostile.example' })).status, 403);
  const quiz = { ...samples[0], questions: samples[0].questions.slice(0, 2) };
  const created = await post('/api/rooms', { quiz, mode: 'accuracy', approval: false, leaderboard: true }); assert.equal(created.status, 201);
  const host: Credentials = { ...created.data, role: 'host' };
  const joined = await post('/api/join', { pin: host.pin, name: 'Live Otter' }); assert.equal(joined.status, 201);
  const player: Credentials = { ...joined.data, role: 'player' };
  async function connect(credentials: Credentials): Promise<{ socket: Socket; get: () => Snapshot }> {
    const socket = io(base, { auth: credentials, autoConnect: false, reconnection: false, ...(memory ? { transports: [Fetch] } : {}) }); sockets.push(socket);
    let latest: Snapshot;
    socket.on('snapshot', snapshot => { latest = snapshot; });
    const first = new Promise<void>((resolve, reject) => { socket.once('snapshot', () => resolve()); socket.once('connect_error', reject); }); socket.connect(); await first;
    return { socket, get: () => latest };
  }
  const forged = io(base, { auth: { ...host, token: 'a'.repeat(64) }, reconnection: false, autoConnect: false, ...(memory ? { transports: [Fetch] } : {}) }); sockets.push(forged);
  const denied = new Promise<Error>(resolve => forged.once('connect_error', resolve)); forged.connect(); assert.match((await denied).message, /not valid/); forged.disconnect();
  let h = await connect(host); let p = await connect(player); const projector = await connect({ pin: host.pin, role: 'projector' });
  const act = async (type: string) => {
    const result = await h.socket.timeout(3000).emitWithAck('action', { type, requestId: randomUUID(), seq: h.get().seq }) as Ack;
    assert.equal(result.ok, true, JSON.stringify(result));
  };
  await act('start'); await waitFor(() => p.get().phase === 'question' && projector.get().phase === 'question');
  assert.equal(p.get().question?.correct, undefined); assert.equal(projector.get().question?.correct, undefined);
  const answer = { requestId: randomUUID(), questionId: 'octopus', selected: [2] };
  assert.equal((await p.socket.timeout(3000).emitWithAck('answer', answer)).ok, true);
  assert.equal((await p.socket.timeout(3000).emitWithAck('answer', answer)).ok, true);
  assert.equal((await p.socket.timeout(3000).emitWithAck('action', { type: 'close', requestId: randomUUID(), seq: p.get().seq })).ok, false);
  p.socket.disconnect(); p = await connect(player); assert.deepEqual(p.get().me?.selected, [2]);
  await waitFor(() => h.get().answered === 1);
  await act('pause'); const remaining = h.get().remaining; assert.ok(remaining! > 0);
  for (const socket of sockets) socket.disconnect();
  if (memory) await waitFor(() => server.io.engine.clientsCount === 0);
  await server.close();
  server = await createTori({ database, web: false }); tuneMemoryTransport(); base = await listen();
  h = await connect(host); p = await connect(player); assert.equal(h.get().paused, true); assert.equal(h.get().remaining, remaining);
  assert.deepEqual(p.get().me?.selected, [2]); await act('resume'); await act('close');
  await waitFor(() => p.get().me?.points === 1000); await act('next'); await act('next');
  await waitFor(() => p.get().question?.id === 'venus' && p.get().phase === 'question');
  assert.equal((await p.socket.timeout(3000).emitWithAck('answer', { requestId: randomUUID(), questionId: 'venus', selected: [0] })).ok, true);
  await waitFor(() => h.get().answered === 1); await act('close'); await act('next'); await act('next');
  await waitFor(() => p.get().phase === 'finished'); assert.equal(p.get().me?.score, 2000);
  const deniedCsv = await fetch(`${base}/api/rooms/${host.pin}/results.csv`); assert.equal(deniedCsv.status, 400);
  const csv = await fetch(`${base}/api/rooms/${host.pin}/results.csv`, { headers: { Authorization: `Bearer ${host.token}` } }); assert.ok((await csv.text()).includes('"Live Otter","2000"'));
  await act('delete'); assert.equal(server.store.get(host.pin), undefined);
}
test('real Socket.IO clients finish a game and recover over in-memory HTTP polling', { timeout: 30_000 }, t => exerciseLive(t, true));
test('real HTTP and Socket.IO clients finish a game and recover after server restart', { timeout: 30_000 }, t => exerciseLive(t, false));
