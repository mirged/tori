import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Games, READY_MS } from '../apps/server/src/game.js';
import { Store } from '../apps/server/src/store.js';
import { samples } from '../packages/shared/src/samples.js';
import { questionSchema, type Action, type Credentials, type Question, type Quiz, type RoomOptions } from '../packages/shared/src/protocol.js';
import { creditFor, pointsFor } from '../packages/shared/src/scoring.js';

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
const q = (question: Partial<Question> & Pick<Question, 'id' | 'type' | 'options' | 'correct'>): Question => ({ text: 'Question?', seconds: 20, explanation: '', ...question });
function setup(questions: Question[], options: Partial<RoomOptions> = {}, players = ['Owl']) {
  const store = new Store(':memory:'); const games = new Games(store);
  const quiz: Quiz = { ...samples[0], questions };
  const host: Credentials = { ...games.create(quiz, 'accuracy', false, true, options), role: 'host' };
  const people = players.map(name => ({ ...games.join(host.pin, name), role: 'player' as const }));
  const act = (type: Action['type'], now = Date.now()) => games.action(host, { type, requestId: randomUUID(), seq: games.get(host.pin).seq }, now);
  const answer = (player: Credentials, selected: number[], text?: string, now = Date.now()) =>
    games.answer(player, { requestId: randomUUID(), questionId: games.get(host.pin).quiz.questions[games.get(host.pin).index].id, selected, text }, now);
  return { store, games, host, people, act, answer };
}

test('new question types validate their own shapes', () => {
  assert.equal(questionSchema.safeParse(q({ id: 'p', type: 'poll', options: ['A', 'B'], correct: [] })).success, true);
  assert.equal(questionSchema.safeParse(q({ id: 'p', type: 'poll', options: ['A', 'B'], correct: [0] })).success, false);
  assert.equal(questionSchema.safeParse(q({ id: 't', type: 'text', options: ['Paris'], correct: [] })).success, true);
  assert.equal(questionSchema.safeParse(q({ id: 's', type: 'single', options: ['Only'], correct: [0] })).success, false);
  assert.equal(questionSchema.safeParse(q({ id: 'o', type: 'order', options: ['1', '2', '3'], correct: [] })).success, true);
});
test('scoring: typed answers are forgiving, order gives positional credit, polls and point multipliers', () => {
  const text = q({ id: 't', type: 'text', options: ['Paris', 'Paree'], correct: [] });
  assert.equal(creditFor(text, [], '  pARís! '), 1); assert.equal(creditFor(text, [], 'London'), 0);
  const order = q({ id: 'o', type: 'order', options: ['a', 'b', 'c', 'd'], correct: [] });
  assert.equal(creditFor(order, [0, 1, 2, 3]), 1); assert.equal(creditFor(order, [1, 0, 2, 3]), .5); assert.equal(creditFor(order, [0, 1]), 0);
  assert.equal(creditFor(q({ id: 'p', type: 'poll', options: ['A', 'B'], correct: [] }), [0]), 0);
  const single = samples[0].questions[0];
  assert.equal(pointsFor({ ...single, points: 'double' }, single.correct, 'accuracy', 0), 2000);
  assert.equal(pointsFor({ ...single, points: 'none' }, single.correct, 'accuracy', 0), 0);
});
test('typed answers and the correct order stay hidden until the reveal', t => {
  const { store, games, host, people: [player], act, answer } = setup([
    q({ id: 't', type: 'text', options: ['Paris'], correct: [] }),
    q({ id: 'o', type: 'order', options: ['first', 'second', 'third', 'fourth'], correct: [] }),
  ]); t.after(() => store.close());
  act('start');
  assert.deepEqual(games.snapshot(player).question?.options, []);
  assert.throws(() => answer(player, [0]), /valid answer/);
  answer(player, [], 'paris'); act('close');
  assert.deepEqual(games.snapshot(player).question?.options, ['Paris']); assert.equal(games.snapshot(player).me?.points, 1000);
  assert.deepEqual(games.snapshot(host).distribution, [1, 0]);
  act('next'); act('next');
  const shown = games.snapshot(player).question!.options;
  assert.notDeepEqual(shown, ['first', 'second', 'third', 'fourth']);
  // Submit displayed positions in the correct order; the server maps them back.
  answer(player, ['first', 'second', 'third', 'fourth'].map(item => shown.indexOf(item))); act('close');
  assert.equal(games.snapshot(player).me?.points, 1000);
  assert.deepEqual(games.snapshot(player).question?.options, ['first', 'second', 'third', 'fourth']);
});
test('get-ready delay blocks early answers, pausing, and keeps full answer time', t => {
  const { store, games, host, people: [player], act, answer } = setup(samples[0].questions.slice(0, 1), { getReady: true }); t.after(() => store.close());
  const start = Date.now(); act('start', start);
  assert.equal(games.snapshot(host).opensAt, start + READY_MS);
  assert.throws(() => answer(player, [2], undefined, start + 1000), /not open yet/);
  assert.throws(() => act('pause', start + 1000), /answers open/);
  assert.equal(games.get(host.pin).deadline, start + READY_MS + 20_000);
  answer(player, [2], undefined, start + READY_MS + 10);
});
test('auto-reveal closes the question once every player has answered', t => {
  const { store, games, host, people: [a, b], act, answer } = setup(samples[0].questions.slice(0, 2), { autoReveal: true }, ['A', 'B']); t.after(() => store.close());
  act('start'); answer(a, [2]); assert.equal(games.get(host.pin).phase, 'question');
  answer(b, [0]); assert.equal(games.get(host.pin).phase, 'reveal');
});
test('shuffle keeps the correct answer correct and leaves true/false alone', t => {
  const questions = Array.from({ length: 20 }, (_, i) => q({ id: `q${i}`, type: 'single', options: ['right', 'w1', 'w2', 'w3'], correct: [0] }));
  questions.push(q({ id: 'tf', type: 'boolean', options: ['True', 'False'], correct: [1] }));
  const { store, games, host } = setup(questions, { shuffle: true }); t.after(() => store.close());
  const room = games.get(host.pin).quiz.questions;
  for (const question of room.slice(0, 20)) assert.equal(question.options[question.correct[0]], 'right');
  assert.ok(room.slice(0, 20).some(question => question.correct[0] !== 0), 'some answers moved');
  assert.deepEqual(room[20].options, ['True', 'False']); assert.deepEqual(room[20].correct, [1]);
});
test('streaks, rival gap subtitle, polls excluded from class accuracy', t => {
  const { store, games, people: [a, b], act, answer } = setup([
    ...samples[0].questions.slice(0, 2), q({ id: 'poll', type: 'poll', options: ['Cats', 'Dogs'], correct: [] }),
  ], {}, ['Ana', 'Ben']); t.after(() => store.close());
  act('start'); answer(a, [2]); answer(b, [0]); act('close');
  assert.deepEqual(games.snapshot(b).me?.gap, { name: 'Ana', points: 1000, ahead: true });
  assert.deepEqual(games.snapshot(a).me?.gap, { name: 'Ben', points: 1000, ahead: false });
  act('next'); act('next'); answer(a, [0]); answer(b, [1]); act('close');
  assert.equal(games.snapshot(a).me?.streak, 2); assert.equal(games.snapshot(b).me?.streak, 0);
  act('next'); act('next'); answer(a, [1]); answer(b, [0]); act('close');
  const snapshot = games.snapshot(a);
  assert.equal(snapshot.me?.streak, 2, 'polls neither add to nor break streaks'); assert.equal(snapshot.classScore, 50);
  assert.equal(snapshot.me?.points, 0);
});
test('team mode draws balanced teams at the start and scores by average', t => {
  const names = ['A', 'B', 'C', 'D', 'E'];
  const { store, games, host, people, act, answer } = setup(samples[0].questions.slice(0, 1), { teams: true }, names); t.after(() => store.close());
  assert.equal(games.snapshot(host).teams, undefined);
  act('start');
  const teams = games.snapshot(host).teams!; assert.equal(teams.length, 2);
  assert.deepEqual(teams.map(t => t.members).sort(), [2, 3]);
  answer(people[0], [2]); act('close');
  const after = games.snapshot(host).teams!;
  assert.ok(after[0].score > 0 && after.every(team => team.rank >= 1));
  assert.ok(games.csv.length >= 0 && games.snapshot(people[0]).me?.team !== undefined);
});
test('images are served by URL and never embedded in live snapshots', t => {
  const { store, games, host, people: [player], act } = setup([{ ...samples[0].questions[0], image: png }, samples[0].questions[1]]); t.after(() => store.close());
  assert.throws(() => games.media(host.pin, 'octopus', 'image'), /not available/);
  act('start');
  const snapshot = JSON.stringify(games.snapshot(player));
  assert.ok(!snapshot.includes('base64')); assert.match(games.snapshot(player).question?.image || '', /\/media\/octopus\/image/);
  assert.equal(games.media(host.pin, 'octopus', 'image'), png);
  assert.throws(() => games.media(host.pin, 'venus', 'image'), /not available/);
});
test('kicked players get a clear message', t => {
  const { store, games, host, people: [player] } = setup(samples[0].questions.slice(0, 1)); t.after(() => store.close());
  const id = games.snapshot(player).me!.id;
  games.action(host, { type: 'remove', requestId: randomUUID(), seq: games.get(host.pin).seq, playerId: id });
  assert.throws(() => games.snapshot(player), /removed from this game by the host/);
});
test('live answers rewrite only the small room state, not the quiz', t => {
  const { store, games, host, people: [player], act, answer } = setup([{ ...samples[0].questions[0], image: png }]); t.after(() => store.close());
  const row = () => (store.db.prepare('SELECT snapshot FROM rooms WHERE pin=?').get(host.pin) as { snapshot: string }).snapshot;
  act('start'); answer(player, [2]);
  assert.ok(!row().includes('base64')); assert.equal(store.get(host.pin)?.quiz.questions[0].image, png);
});
