import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Games } from '../apps/server/src/game.js';
import { Store } from '../apps/server/src/store.js';
import { samples } from '../packages/shared/src/samples.js';
import { isOffensiveName } from '../packages/shared/src/names.js';
import { joinSchema, questionSchema, type Credentials, type Quiz } from '../packages/shared/src/protocol.js';

test('nickname filter catches disguised profanity without Scunthorpe false positives', () => {
  for (const name of ['FuUuck', 'sh1t head', 'f u c k', 's.h.i.t', 'B!TCH', 'dick', 'Mr Cunt', 'блять', 'blyat 99'])
    assert.equal(isOffensiveName(name), true, name);
  for (const name of ['Curious Owl', 'Push It', 'Scunthorpe', 'Peacock', 'Grape Ape', 'Dickens', 'Classy Bass', 'Analyst', 'Otter 42', 'Cocktail', 'Hitchcock', 'Sussex'])
    assert.equal(isOffensiveName(name), false, name);
});
test('join names are limited to 15 characters and filtered', () => {
  assert.equal(joinSchema.safeParse({ pin: '123456', name: 'a'.repeat(15) }).success, true);
  assert.equal(joinSchema.safeParse({ pin: '123456', name: 'a'.repeat(16) }).success, false);
  const bad = joinSchema.safeParse({ pin: '123456', name: 'sh1t' });
  assert.equal(bad.success, false); assert.match(bad.error!.issues[0].message, /different nickname/);
});
test('GIF images are accepted only with a real GIF header', () => {
  const q = samples[0].questions[0];
  assert.equal(questionSchema.safeParse({ ...q, revealImage: 'data:image/gif;base64,' + btoa('GIF89a\x01\x00\x01\x00') }).success, true);
  assert.equal(questionSchema.safeParse({ ...q, revealImage: 'data:image/gif;base64,' + btoa('<svg onload=1>') }).success, false);
});
test('reveal images stay hidden until the answer is revealed', t => {
  const store = new Store(':memory:'); t.after(() => store.close());
  const games = new Games(store);
  const quiz: Quiz = structuredClone(samples[0]);
  quiz.questions[0].revealImage = 'data:image/gif;base64,' + btoa('GIF89a\x01\x00\x01\x00');
  const host: Credentials = { ...games.create(quiz, 'accuracy', false, true), role: 'host' };
  const player: Credentials = { ...games.join(host.pin, 'Owl'), role: 'player' };
  const act = (type: 'start' | 'close') => games.action(host, { type, requestId: randomUUID(), seq: games.get(host.pin).seq });
  assert.throws(() => games.media(host.pin, quiz.questions[0].id, 'reveal'), /not available/);
  act('start');
  assert.equal(games.snapshot(player).question?.revealImage, undefined);
  assert.equal(games.snapshot(host).question?.revealImage, undefined);
  assert.throws(() => games.media(host.pin, quiz.questions[0].id, 'reveal'), /not available/);
  act('close');
  assert.match(games.snapshot(player).question?.revealImage || '', /^\/api\/rooms\/\d{6}\/media\/octopus\/reveal\?v=/);
  assert.equal(games.media(host.pin, quiz.questions[0].id, 'reveal'), quiz.questions[0].revealImage);
});
