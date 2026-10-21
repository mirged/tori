import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creditFor, pointsFor } from '../packages/shared/src/scoring.js';
import { samples } from '../packages/shared/src/samples.js';
const single = samples[0].questions[0];
const multiple = samples[0].questions[2];
test('accuracy awards equal points independent of elapsed time', () => {
  assert.equal(pointsFor(single, [2], 'accuracy', 0), 1000);
  assert.equal(pointsFor(single, [2], 'accuracy', 19_999), 1000);
  assert.equal(pointsFor(single, [0], 'accuracy', 0), 0);
  assert.equal(pointsFor(single, [], 'accuracy', 0), 0);
});
test('speed has documented bounds and server elapsed time', () => {
  assert.equal(pointsFor(single, [2], 'speed', 0), 1000);
  assert.equal(pointsFor(single, [2], 'speed', 10_000), 750);
  assert.equal(pointsFor(single, [2], 'speed', 20_000), 500);
  assert.equal(pointsFor(single, [0], 'speed', 0), 0);
});
test('multiple-answer partial credit penalizes guessing', () => {
  assert.equal(creditFor(multiple, [0]), .5);
  assert.equal(creditFor(multiple, [0, 2]), 1);
  assert.equal(creditFor(multiple, [0, 1]), 0);
  assert.equal(creditFor(multiple, [0, 1, 2, 3]), 0);
  assert.equal(creditFor(multiple, [1, 3]), 0);
});
test('all-correct multiple-answer questions avoid division by zero', () => {
  const q = { ...multiple, options: ['One', 'Two'], correct: [0, 1] };
  assert.equal(creditFor(q, [0]), .5); assert.equal(creditFor(q, [0, 1]), 1);
});
test('partial speed credit rounds exactly once', () => {
  const q = { ...multiple, options: ['a', 'b', 'c', 'd'], correct: [0, 1, 2], seconds: 20 };
  assert.equal(pointsFor(q, [0], 'speed', 10_001), 250);
});
