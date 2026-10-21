import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Games } from '../apps/server/src/game.js';
import { Store } from '../apps/server/src/store.js';
import { samples } from '../packages/shared/src/samples.js';
import type { Action, Credentials, Quiz } from '../packages/shared/src/protocol.js';

function setup(options: { mode?: 'accuracy' | 'speed'; approval?: boolean; quiz?: Quiz } = {}) {
  const store = new Store(':memory:'); const games = new Games(store);
  const host: Credentials = { ...games.create(options.quiz || samples[0], options.mode || 'accuracy', !!options.approval, true), role: 'host' };
  const player: Credentials = { ...games.join(host.pin, 'Curious Owl'), role: 'player' };
  const projector: Credentials = { pin: host.pin, role: 'projector' };
  const act = (type: Action['type'], now = Date.now(), playerId?: string) => games.action(host, { type, requestId: randomUUID(), seq: games.get(host.pin).seq, playerId }, now);
  return { store, games, host, player, projector, act };
}
test('a complete multiplayer game has durable scores, tied ranks, reviews, and CSV', t => {
  const { store, games, host, player, projector, act } = setup(); t.after(() => store.close());
  const other: Credentials = { ...games.join(host.pin, '=HYPERLINK("bad")'), role: 'player' };
  let now = Date.now(); act('start', now);
  for (const q of samples[0].questions) {
    for (const credentials of [player, other]) games.answer(credentials, { requestId: randomUUID(), questionId: q.id, selected: q.correct }, now + 10);
    act('close', now + 20); act('next', now + 30); now += 40; act('next', now);
  }
  const result = games.snapshot(player);
  assert.equal(result.phase, 'finished'); assert.equal(result.me?.score, 5000); assert.equal(result.classScore, 100);
  assert.equal(result.review?.length, 5); assert.deepEqual(result.players.map(p => p.rank), [1, 1]);
  const csv = games.csv(host); assert.ok(csv.includes('"Curious Owl","5000"')); assert.ok(csv.includes('"\'=HYPERLINK(""bad"")"'));
  assert.throws(() => games.csv(projector), /Only the host/);
});
test('player and projector snapshots never disclose answers or current correctness before reveal', t => {
  const { store, games, host, player, projector, act } = setup(); t.after(() => store.close()); act('start');
  games.answer(player, { requestId: randomUUID(), questionId: 'octopus', selected: [2] });
  for (const credentials of [host, player, projector]) {
    const snapshot = games.snapshot(credentials);
    assert.equal(snapshot.question?.correct, undefined); assert.equal(snapshot.question?.explanation, undefined);
    assert.equal(snapshot.distribution, undefined); assert.equal(snapshot.hostQuiz, undefined);
    assert.equal(snapshot.me?.points, undefined); assert.equal(snapshot.me?.credit, undefined);
    assert.ok(!JSON.stringify(snapshot).includes('tokenHash')); assert.equal(snapshot.classScore, 0);
    assert.ok(snapshot.players.every(p => p.score === 0));
  }
  assert.equal(games.snapshot(projector).me, undefined); act('close');
  assert.deepEqual(games.snapshot(projector).question?.correct, [2]);
});
test('host authorization, stale actions, and request deduplication are enforced', t => {
  const { store, games, host, player, projector, act } = setup(); t.after(() => store.close());
  const action: Action = { requestId: randomUUID(), seq: games.get(host.pin).seq, type: 'start' };
  assert.throws(() => games.action(player, action), /Only the host/);
  assert.throws(() => games.action(projector, action), /Only the host/);
  assert.throws(() => games.action({ ...host, token: 'a'.repeat(64) }, action), /not valid/);
  games.action(host, action); games.action(host, action); assert.equal(games.get(host.pin).index, 0);
  assert.throws(() => games.action(host, { ...action, requestId: randomUUID(), type: 'close' }), /game changed/);
  assert.throws(() => act('next'), /Close the question/);
});
test('answers reject early, forged, duplicate, empty, invalid, and stale submissions', t => {
  const { store, games, host, player, projector, act } = setup(); t.after(() => store.close());
  const answer = { requestId: randomUUID(), questionId: 'octopus', selected: [2] };
  assert.throws(() => games.answer(player, answer), /closed or paused/); act('start');
  assert.throws(() => games.answer(host, answer), /Only approved players/);
  assert.throws(() => games.answer(projector, answer), /Only approved players/);
  for (const selected of [[], [0, 1], [0, 0], [99], [-1]]) assert.throws(() => games.answer(player, { ...answer, selected }), /valid answer/);
  assert.throws(() => games.answer(player, { ...answer, questionId: 'venus' }), /no longer open/);
  games.answer(player, answer); games.answer(player, answer);
  assert.throws(() => games.answer(player, { ...answer, requestId: randomUUID() }), /already been recorded/);
  act('close'); assert.equal(games.snapshot(player).me?.points, 1000);
  assert.throws(() => games.csv(host), /Finish the game/);
});
test('deadline is strict and timers close without a client action', t => {
  const { store, games, host, player, act } = setup(); t.after(() => store.close());
  const start = Date.now(); act('start', start);
  assert.throws(() => games.answer(player, { requestId: randomUUID(), questionId: 'octopus', selected: [2] }, start + 20_000), /closed or paused/);
  assert.equal(games.get(host.pin).phase, 'reveal'); assert.equal(games.snapshot(player).me?.points, undefined);
});
test('pause preserves remaining time and speed scores exclude paused duration', t => {
  const { store, games, host, player, act } = setup({ mode: 'speed' }); t.after(() => store.close());
  const start = Date.now(); act('start', start); act('pause', start + 5000);
  const answer = { requestId: randomUUID(), questionId: 'octopus', selected: [2] };
  assert.throws(() => games.answer(player, answer, start + 6000), /closed or paused/);
  games.tick(start + 200_000); assert.equal(games.get(host.pin).phase, 'question');
  act('resume', start + 205_000); assert.equal(games.get(host.pin).deadline, start + 220_000);
  games.answer(player, answer, start + 210_000); act('close', start + 211_000);
  assert.equal(games.snapshot(player).me?.points, 750);
});
test('nickname approval, locking, removal, and start gates work', t => {
  const { store, games, host, player, projector, act } = setup({ approval: true }); t.after(() => store.close());
  const me = games.snapshot(player).me!;
  assert.equal(me.approved, false); assert.throws(() => act('start'), /at least one approved/);
  assert.equal(games.snapshot(projector).playerCount, 0);
  act('approve', Date.now(), me.id); assert.equal(games.snapshot(player).me?.approved, true);
  act('lock'); assert.throws(() => games.join(host.pin, 'Another Owl'), /lobby is closed/);
  assert.ok(games.snapshot(player)); act('lock'); const other = games.join(host.pin, 'Another Owl');
  act('remove', Date.now(), me.id); assert.throws(() => games.snapshot(player), /no longer available/);
  act('approve', Date.now(), other.playerId); act('start'); assert.throws(() => games.join(host.pin, 'Late Owl'), /lobby is closed/);
});
test('nicknames are case-insensitively unique and generated names require no account', t => {
  const { store, games, host } = setup(); t.after(() => store.close());
  assert.throws(() => games.join(host.pin, 'curious owl'), /nickname is taken/);
  const generated = games.join(host.pin, ''); const snapshot = games.snapshot({ ...generated, role: 'player' });
  assert.ok(snapshot.me?.name.match(/\w+ \w+ \d+/));
});
test('reconnect, database restart, and persisted request IDs retain accepted answers', t => {
  const dir = mkdtempSync(join(tmpdir(), 'tori-restart-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'game.sqlite'); let store = new Store(path); let games = new Games(store);
  const host: Credentials = { ...games.create(samples[0], 'accuracy', false, true), role: 'host' };
  const player: Credentials = { ...games.join(host.pin, 'Persistent Otter'), role: 'player' };
  const start = { requestId: randomUUID(), seq: games.get(host.pin).seq, type: 'start' as const };
  games.action(host, start); const answer = { requestId: randomUUID(), questionId: 'octopus', selected: [2] };
  games.answer(player, answer); const seq = games.get(host.pin).seq; store.close();
  store = new Store(path); games = new Games(store); t.after(() => store.close());
  assert.equal(games.get(host.pin).seq, seq); assert.deepEqual(games.snapshot(player).me?.selected, [2]);
  games.answer(player, answer); games.action(host, start); assert.equal(games.get(host.pin).seq, seq);
  games.action(host, { requestId: randomUUID(), seq, type: 'close' }); assert.equal(games.snapshot(player).me?.points, 1000);
});
test('a restart closes overdue questions and preserves paused ones', t => {
  const dir = mkdtempSync(join(tmpdir(), 'tori-deadline-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'game.sqlite'); let store = new Store(path); let games = new Games(store);
  const host: Credentials = { ...games.create(samples[0], 'accuracy', false, true), role: 'host' };
  games.join(host.pin, 'Otter'); games.action(host, { requestId: randomUUID(), seq: 1, type: 'start' }, Date.now() - 30_000); store.close();
  store = new Store(path); games = new Games(store); assert.equal(games.get(host.pin).phase, 'reveal');
  games.action(host, { requestId: randomUUID(), seq: games.get(host.pin).seq, type: 'next' });
  games.action(host, { requestId: randomUUID(), seq: games.get(host.pin).seq, type: 'next' });
  games.action(host, { requestId: randomUUID(), seq: games.get(host.pin).seq, type: 'pause' }); store.close();
  store = new Store(path); games = new Games(store); t.after(() => store.close());
  assert.equal(games.snapshot(host).paused, true); assert.equal(games.get(host.pin).phase, 'question');
});
test('failed persistence rolls back memory and cannot appear acknowledged', t => {
  const { store, games, host, player, act } = setup(); t.after(() => store.close()); act('start');
  const save = store.save; store.save = () => { throw new Error('Disk full'); };
  assert.throws(() => games.answer(player, { requestId: randomUUID(), questionId: 'octopus', selected: [2] }), /Disk full/);
  assert.equal(games.snapshot(player).me?.selected, undefined); assert.equal(games.snapshot(host).answered, 0);
  store.save = save;
});
test('deletion and automatic expiry remove persisted personal results', t => {
  const { store, games, host, act } = setup(); t.after(() => store.close()); act('delete');
  assert.equal(store.get(host.pin), undefined); assert.throws(() => games.snapshot(host), /expired or was deleted/);
  const other = games.create(samples[0], 'accuracy', false, false);
  games.tick(games.get(other.pin).expires); assert.equal(store.get(other.pin), undefined); assert.equal(games.rooms.size, 0);
});
test('room/player capacity is enforced and leaderboard hiding protects other scores', t => {
  const store = new Store(':memory:'); t.after(() => store.close()); const games = new Games(store, { rooms: 1, players: 2, retentionMs: 60_000 });
  const host: Credentials = { ...games.create(samples[0], 'accuracy', false, false), role: 'host' };
  assert.throws(() => games.create(samples[0], 'accuracy', false, false), /room capacity/);
  const player: Credentials = { ...games.join(host.pin, 'First'), role: 'player' }; games.join(host.pin, 'Second');
  assert.throws(() => games.join(host.pin, 'Third'), /player capacity/);
  games.action(host, { requestId: randomUUID(), seq: 2, type: 'start' }); games.answer(player, { requestId: randomUUID(), questionId: 'octopus', selected: [2] });
  games.action(host, { requestId: randomUUID(), seq: games.get(host.pin).seq, type: 'close' });
  assert.equal(games.snapshot(player).me?.score, 1000); assert.equal(games.snapshot(player).players.length, 0);
});
