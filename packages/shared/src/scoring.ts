import { pointsMultiplier, type Mode, type Question } from './protocol.js';
/** Lowercase, strip accents, punctuation and extra spaces so "  Paris! " matches "paris". */
export const normalizeText = (value: string) => value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
export function creditFor(question: Question, selected: number[], text?: string): number {
  if (question.type === 'poll') return 0;
  if (question.type === 'text') return text && question.options.some(option => normalizeText(option) === normalizeText(text)) ? 1 : 0;
  if (!selected.length) return 0;
  // Ordering earns credit for each item in its correct position.
  if (question.type === 'order') return selected.length === question.options.length ? selected.filter((n, i) => n === i).length / selected.length : 0;
  const correct = selected.filter(n => question.correct.includes(n)).length;
  if (question.type !== 'multiple') return selected.length === 1 && correct === 1 ? 1 : 0;
  const incorrectTotal = question.options.length - question.correct.length;
  return Math.max(0, correct / question.correct.length - (incorrectTotal ? (selected.length - correct) / incorrectTotal : 0));
}
export function pointsFor(question: Question, selected: number[], mode: Mode, elapsed: number, text?: string): number {
  const multiplier = mode === 'accuracy' ? 1 : 1 - 0.5 * Math.min(1, Math.max(0, elapsed) / (question.seconds * 1000));
  return Math.round(1000 * pointsMultiplier[question.points || 'standard'] * creditFor(question, selected, text) * multiplier);
}
