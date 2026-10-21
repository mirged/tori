import type { Mode, Question } from './protocol.js';
export function creditFor(question: Question, selected: number[]): number {
  if (!selected.length) return 0;
  const correct = selected.filter(n => question.correct.includes(n)).length;
  if (question.type !== 'multiple') return selected.length === 1 && correct === 1 ? 1 : 0;
  const incorrectTotal = question.options.length - question.correct.length;
  return Math.max(0, correct / question.correct.length - (incorrectTotal ? (selected.length - correct) / incorrectTotal : 0));
}
export function pointsFor(question: Question, selected: number[], mode: Mode, elapsed: number): number {
  const multiplier = mode === 'accuracy' ? 1 : 1 - 0.5 * Math.min(1, Math.max(0, elapsed) / (question.seconds * 1000));
  return Math.round(1000 * creditFor(question, selected) * multiplier);
}
