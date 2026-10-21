import { performance } from 'node:perf_hooks';
import { cpus, totalmem, tmpdir } from 'node:os';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { io, type Socket } from 'socket.io-client';
import { createTori } from '../apps/server/src/server.js';
import { samples } from '../packages/shared/src/samples.js';
import type { Credentials, Snapshot } from '../packages/shared/src/protocol.js';

const dir = mkdtempSync(join(tmpdir(), 'tori-load-')); const sockets: Socket[] = [];
const server = await createTori({ database: join(dir, 'load.sqlite'), web: false });
async function waitFor(predicate: () => boolean) {
  const deadline = Date.now() + 10_000;
  while (!predicate()) { if (Date.now() > deadline) throw new Error('State convergence timed out.'); await new Promise(resolve => setTimeout(resolve, 10)); }
}
try {
  await new Promise<void>((resolve, reject) => { server.http.once('error', reject); server.http.listen(0, '127.0.0.1', () => resolve()); });
  const address = server.http.address(); if (!address || typeof address === 'string') throw new Error('No listen address.');
  const base = `http://127.0.0.1:${address.port}`;
  async function post(path: string, data: unknown) {
    const response = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    const result = await response.json(); if (!response.ok) throw new Error(result.error); return result;
  }
  async function connect(credentials: Credentials) {
    const socket = io(base, { autoConnect: false, reconnection: false, auth: credentials }); sockets.push(socket);
    let state: Snapshot; socket.on('snapshot', next => { state = next; });
    const ready = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Connection timed out.')), 10_000);
      socket.once('snapshot', () => { clearTimeout(timeout); resolve(); });
      socket.once('connect_error', error => { clearTimeout(timeout); reject(error); });
    }); socket.connect(); await ready;
    return { socket, state: () => state };
  }
  async function room(count: number) {
    const host = await post('/api/rooms', { quiz: samples[0], mode: 'accuracy', approval: false, leaderboard: true });
    const h = await connect({ ...host, role: 'host' });
    const players = await Promise.all(Array.from({ length: count }, async (_, i) => connect({ ...await post('/api/join', { pin: host.pin, name: `Curious ${i}` }), role: 'player' })));
    const projector = await connect({ pin: host.pin, role: 'projector' });
    await waitFor(() => h.state().playerCount === count);
    return { host, h, players, projector };
  }
  async function benchmark(roomCount: number, playersPerRoom: number) {
    const rooms = await Promise.all(Array.from({ length: roomCount }, () => room(playersPerRoom)));
    for (const room of rooms) {
      const reply = await room.h.socket.timeout(10_000).emitWithAck('action', { type: 'start', requestId: randomUUID(), seq: room.h.state().seq });
      if (!reply.ok) throw new Error(reply.error);
    }
    await waitFor(() => rooms.every(r => r.players.every(p => p.state().phase === 'question')));
    const latencies = await Promise.all(rooms.flatMap(r => r.players.map(async p => {
      const start = performance.now(); const reply = await p.socket.timeout(10_000).emitWithAck('answer', { requestId: randomUUID(), questionId: 'octopus', selected: [2] });
      if (!reply.ok) throw new Error(reply.error); return performance.now() - start;
    })));
    await waitFor(() => rooms.every(r => r.h.state().answered === playersPerRoom));
    for (const r of rooms) {
      const reply = await r.h.socket.timeout(10_000).emitWithAck('action', { type: 'close', requestId: randomUUID(), seq: r.h.state().seq });
      if (!reply.ok) throw new Error(reply.error);
    }
    await waitFor(() => rooms.every(r => r.players.every(p => p.state().me?.points === 1000)));
    latencies.sort((a, b) => a - b);
    const p95 = latencies[Math.ceil(latencies.length * .95) - 1];
    for (const r of rooms) { r.h.socket.disconnect(); r.projector.socket.disconnect(); r.players.forEach(p => p.socket.disconnect()); }
    return { rooms: roomCount, playersPerRoom, acknowledgements: latencies.length, lostOrInconsistent: 0, p95Ms: Math.round(p95 * 100) / 100, targetUnder300ms: p95 < 300 };
  }
  const results = [await benchmark(1, 100), await benchmark(10, 30)];
  console.log(JSON.stringify({ date: new Date().toISOString(), machine: { cpu: cpus()[0]?.model, logicalCpus: cpus().length, memoryGiB: Math.round(totalmem() / 2 ** 30), node: process.version }, network: 'Loopback, same process and machine; tiny bundled quiz; no images', results }, null, 2));
  if (results.some(result => !result.targetUnder300ms)) process.exitCode = 1;
} catch (error) {
  console.error('Load test could not complete:', error instanceof Error ? error.message : error); process.exitCode = 1;
} finally { sockets.forEach(socket => socket.disconnect()); await server.close(); rmSync(dir, { recursive: true, force: true }); }
