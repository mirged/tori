import { test } from 'node:test';
import assert from 'node:assert/strict';
import { actionSchema, answerSchema, credentialsSchema, joinSchema, questionSchema, quizSchema } from '../packages/shared/src/protocol.js';
import { samples } from '../packages/shared/src/samples.js';
import { randomUUID } from 'node:crypto';
test('starter quizzes round-trip through the documented JSON schema', () => {
  for (const quiz of samples) assert.deepEqual(quizSchema.parse(JSON.parse(JSON.stringify(quiz))), quiz);
});
test('invalid correct indexes, duplicates, boolean options, and time limits are rejected', () => {
  const q = samples[0].questions[0];
  for (const patch of [{ correct: [4] }, { correct: [2, 2] }, { correct: [] }, { type: 'single', correct: [0, 1] }, { seconds: 0 }, { seconds: 241 }, { type: 'boolean', options: ['Yes', 'No'] }, { text: '' }, { options: ['ok', ''] }])
    assert.equal(questionSchema.safeParse({ ...q, ...patch }).success, false, JSON.stringify(patch));
});
test('quizzes reject repeated question IDs and excessive question counts', () => {
  assert.equal(quizSchema.safeParse({ ...samples[0], questions: [samples[0].questions[0], samples[0].questions[0]] }).success, false);
  assert.equal(quizSchema.safeParse({ ...samples[0], questions: [] }).success, false);
  assert.equal(quizSchema.safeParse({ ...samples[0], questions: Array(51).fill(samples[0].questions[0]) }).success, false);
});
test('image inputs exclude scripts, SVG, external tracking URLs, and forged formats', () => {
  const q = samples[0].questions[0];
  for (const image of ['https://example.org/tracker.png', 'data:image/svg+xml;base64,PHN2Zz4=', 'javascript:alert(1)', 'data:image/png;base64,YmFk', 'data:image/jpeg;base64,aW52YWxpZA=='])
    assert.equal(questionSchema.safeParse({ ...q, image }).success, false);
  assert.equal(questionSchema.safeParse({ ...q, image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==' }).success, true);
});
test('names and credentials have bounded, validated shapes', () => {
  assert.equal(joinSchema.safeParse({ pin: '123456', name: 'Curious Owl' }).success, true);
  assert.equal(joinSchema.safeParse({ pin: '123456', name: 'bad\nname' }).success, false);
  assert.equal(joinSchema.safeParse({ pin: '123456', name: 'a'.repeat(25) }).success, false);
  assert.equal(credentialsSchema.safeParse({ pin: '123', role: 'host', token: 'a' }).success, false);
  assert.equal(actionSchema.safeParse({ requestId: 'old', seq: 1, type: 'start' }).success, false);
  assert.equal(answerSchema.safeParse({ requestId: randomUUID(), questionId: 'q', selected: [0.5] }).success, false);
});
