import { z } from 'zod';
import { questionSchema, type Quiz } from '../../../packages/shared/src/protocol';
import { samples } from '../../../packages/shared/src/samples';

export function uid() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = bytes[6] & 15 | 64; bytes[8] = bytes[8] & 63 | 128;
  const hex = [...bytes].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export const draftSchema = z.object({
  version: z.literal(1), id: z.string().max(80), title: z.string().max(100), description: z.string().max(300),
  category: z.string().max(40), cover: z.enum(['green', 'peach', 'lilac', 'blue']),
  questions: z.array(z.object({ id: z.string().max(80), type: z.enum(['single', 'boolean', 'multiple']), text: z.string().max(300),
    options: z.array(z.string().max(160)).min(2).max(6), correct: z.array(z.number().int().min(0).max(5)).max(6),
    seconds: z.number().int().min(5).max(240), explanation: z.string().max(1000), image: questionSchema.shape.image, revealImage: questionSchema.shape.image,
  })).max(50),
}).superRefine((quiz, ctx) => {
  if (new Set(quiz.questions.map(q => q.id)).size !== quiz.questions.length)
    ctx.addIssue({ code: 'custom', message: 'Question IDs must be unique.' });
  if (quiz.questions.some(q => q.correct.some(n => n >= q.options.length) || new Set(q.correct).size !== q.correct.length))
    ctx.addIssue({ code: 'custom', message: 'Answer indexes must be valid and distinct.' });
});
export function loadQuizzes(): Quiz[] {
  const saved = localStorage.getItem('tori.quizzes.v1');
  if (!saved) return structuredClone(samples);
  return z.array(draftSchema).max(100).parse(JSON.parse(saved));
}
export function download(content: string | Blob, filename: string, type = 'application/json') {
  const url = URL.createObjectURL(content instanceof Blob ? content : new Blob([content], { type }));
  const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function api<T>(path: string, body?: unknown, token?: string): Promise<T> {
  const response = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15_000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'The server could not complete your request.');
  return result;
}
export const errorText = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong. Please try again.';
export function saveCredential(pin: string, role: 'host' | 'player', token: string) {
  // A failed save must be visible before navigation: otherwise a refresh loses access.
  localStorage.setItem(`tori.${role}.${pin}`, token);
}
export const rules = 'Accuracy: up to 1,000 points, independent of speed. Multiple-answer credit = correct selected ÷ total correct − incorrect selected ÷ total incorrect, with a minimum of zero. Speed mode multiplies credit by 1,000 × (1 − 0.5 × elapsed ÷ duration). Server time applies; network latency affects speed mode. Ties share a rank.';
