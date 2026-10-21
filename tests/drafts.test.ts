import { test } from 'node:test';
import assert from 'node:assert/strict';
import { draftSchema, loadQuizzes, uid } from '../apps/web/src/lib.js';
import { quizSchema } from '../packages/shared/src/protocol.js';
import { samples } from '../packages/shared/src/samples.js';
test('unfinished drafts round-trip without being mistaken for playable quizzes', () => {
  const draft = { ...samples[0], title: '', questions: [{ ...samples[0].questions[0], text: '', options: ['', ''], correct: [] }] };
  assert.deepEqual(draftSchema.parse(JSON.parse(JSON.stringify(draft))), draft);
  assert.equal(quizSchema.safeParse(draft).success, false);
  assert.equal(draftSchema.safeParse({ ...draft, questions: [] }).success, true);
});
test('draft import still rejects malformed indexes, repeated IDs, and unsafe images', () => {
  const q = samples[0].questions[0];
  assert.equal(draftSchema.safeParse({ ...samples[0], questions: [{ ...q, correct: [99] }] }).success, false);
  assert.equal(draftSchema.safeParse({ ...samples[0], questions: [q, q] }).success, false);
  assert.equal(draftSchema.safeParse({ ...samples[0], questions: [{ ...q, image: 'https://tracking.example/image' }] }).success, false);
});
test('browser library preserves empty libraries and surfaces corruption for recovery', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  let stored: string | null = null;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => stored } });
  try {
    assert.equal(loadQuizzes().length, 3);
    stored = '[]'; assert.deepEqual(loadQuizzes(), []);
    stored = JSON.stringify(samples); assert.deepEqual(loadQuizzes(), samples);
    stored = '{broken'; assert.throws(() => loadQuizzes()); assert.equal(stored, '{broken');
  } finally { if (original) Object.defineProperty(globalThis, 'localStorage', original); else Reflect.deleteProperty(globalThis, 'localStorage'); }
});
test('browser request identifiers are valid UUIDs without requiring a secure-context randomUUID API', () => {
  const ids = new Set(Array.from({ length: 100 }, uid)); assert.equal(ids.size, 100);
  for (const id of ids) assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});
