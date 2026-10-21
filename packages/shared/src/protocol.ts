import { z } from 'zod';
import { isOffensiveName } from './names.js';

export const image = z.string().max(1_400_000).refine(value => {
  if (!value) return true;
  const match = /^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) return false;
  try {
    const bytes = atob(match[2]);
    if (bytes.length > 1_000_000) return false;
    return match[1] === 'png' ? bytes.startsWith('\x89PNG\r\n\x1a\n')
      : match[1] === 'jpeg' ? bytes.startsWith('\xff\xd8\xff')
      : match[1] === 'gif' ? bytes.startsWith('GIF87a') || bytes.startsWith('GIF89a')
      : bytes.startsWith('RIFF') && bytes.slice(8, 12) === 'WEBP';
  } catch { return false; }
}, 'Use a PNG, JPEG, WebP, or GIF image under 1 MB.');

/** single/boolean/multiple: pick options · poll: no right answer · text: type an accepted answer · order: arrange options in the written order. */
export const questionTypes = ['single', 'boolean', 'multiple', 'poll', 'text', 'order'] as const;
export type QuestionType = typeof questionTypes[number];
export const gradedByChoice = (type: QuestionType) => type === 'single' || type === 'boolean' || type === 'multiple';
/** How long the "get ready" screen shows a question before answers open. */
export const READY_MS = 4000;
export const pointsMultiplier = { standard: 1, double: 2, none: 0 } as const;
export const questionSchema = z.object({
  id: z.string().min(1).max(80),
  type: z.enum(questionTypes),
  text: z.string().trim().min(1, 'Write a question.').max(300),
  options: z.array(z.string().trim().min(1, 'Fill in each answer.').max(160)).min(1).max(6),
  correct: z.array(z.number().int().min(0).max(5)).max(6),
  points: z.enum(['standard', 'double', 'none']).optional(),
  seconds: z.number().int().min(5).max(240),
  explanation: z.string().max(1000).default(''),
  image: image.optional(),
  revealImage: image.optional(),
}).superRefine((q, ctx) => {
  if (new Set(q.correct).size !== q.correct.length || q.correct.some(n => n >= q.options.length))
    ctx.addIssue({ code: 'custom', message: 'Choose valid, distinct correct answers.', path: ['correct'] });
  if ((q.type === 'single' || q.type === 'boolean') && q.correct.length !== 1)
    ctx.addIssue({ code: 'custom', message: 'Choose one correct answer.', path: ['correct'] });
  if (q.type === 'multiple' && q.correct.length < 1)
    ctx.addIssue({ code: 'custom', message: 'Choose at least one correct answer.', path: ['correct'] });
  if (!gradedByChoice(q.type) && q.correct.length)
    ctx.addIssue({ code: 'custom', message: 'This question type does not use marked answers.', path: ['correct'] });
  if (q.type !== 'text' && q.options.length < 2)
    ctx.addIssue({ code: 'custom', message: 'Add at least two answers.', path: ['options'] });
  if (q.type === 'boolean' && (q.options.length !== 2 || q.options[0] !== 'True' || q.options[1] !== 'False'))
    ctx.addIssue({ code: 'custom', message: 'True/false options must be True and False.', path: ['options'] });
});
export const quizSchema = z.object({
  version: z.literal(1), id: z.string().min(1).max(80),
  title: z.string().trim().min(1, 'Give your quiz a title.').max(100),
  description: z.string().max(300).default(''),
  category: z.string().max(40).default('General knowledge'),
  cover: z.enum(['green', 'peach', 'lilac', 'blue']).default('green'),
  questions: z.array(questionSchema).min(1, 'Add at least one question.').max(50),
}).superRefine((q, ctx) => {
  if (new Set(q.questions.map(x => x.id)).size !== q.questions.length)
    ctx.addIssue({ code: 'custom', message: 'Every question needs a unique ID.', path: ['questions'] });
});
export type Question = z.infer<typeof questionSchema>;
export type Quiz = z.infer<typeof quizSchema>;
export type Mode = 'accuracy' | 'speed';
export type Phase = 'lobby' | 'question' | 'reveal' | 'standings' | 'finished';
export type Role = 'host' | 'player' | 'projector';
export interface Credentials { pin: string; role: Role; token?: string }
export interface PublicPlayer { id: string; name: string; score: number; rank: number; approved: boolean; team?: number }
export interface TeamStanding { id: number; name: string; score: number; rank: number; members: number }
export interface RoomOptions { teams: boolean; shuffle: boolean; autoReveal: boolean; phoneText: boolean; getReady: boolean }
export const teamNames = ['Red', 'Blue', 'Yellow', 'Green'];
export interface Review { question: Question; selected: number[]; text?: string; points: number; credit: number }
export interface Snapshot {
  pin: string; seq: number; phase: Phase; title: string; mode: Mode;
  locked: boolean; approval: boolean; leaderboard: boolean;
  index: number; total: number; players: PublicPlayer[]; playerCount: number;
  question?: Omit<Question, 'correct' | 'explanation' | 'revealImage'> & { correct?: number[]; explanation?: string; revealImage?: string };
  deadline: number | null; remaining: number | null; paused: boolean;
  answered: number; distribution?: number[]; classScore: number;
  /** Server time when answers open; before it the "get ready" screen shows. */
  opensAt: number | null; options: RoomOptions; teams?: TeamStanding[];
  me?: PublicPlayer & {
    selected?: number[]; text?: string; points?: number; credit?: number; streak?: number;
    /** The nearest rival: who is just ahead (or, for the leader, just behind) and by how much. */
    gap?: { name: string; points: number; ahead: boolean };
  };
  review?: Review[]; hostQuiz?: Quiz; serverTime: number;
}
export interface Action { requestId: string; seq: number; type: 'start' | 'close' | 'next' | 'pause' | 'resume' | 'lock' | 'leaderboard' | 'approve' | 'remove' | 'delete'; playerId?: string }
export interface AnswerRequest { requestId: string; questionId: string; selected: number[]; text?: string }
export type Ack<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };
export const createSchema = z.object({
  quiz: quizSchema, mode: z.enum(['accuracy', 'speed']), approval: z.boolean(), leaderboard: z.boolean(),
  teams: z.boolean().optional(), shuffle: z.boolean().optional(), autoReveal: z.boolean().optional(),
  phoneText: z.boolean().optional(), getReady: z.boolean().optional(),
});
export const actionSchema = z.object({
  requestId: z.string().uuid(), seq: z.number().int().nonnegative(),
  type: z.enum(['start', 'close', 'next', 'pause', 'resume', 'lock', 'leaderboard', 'approve', 'remove', 'delete']),
  playerId: z.string().max(80).optional(),
});
export const answerSchema = z.object({
  requestId: z.string().uuid(), questionId: z.string().min(1).max(80),
  selected: z.array(z.number().int().min(0).max(5)).max(6),
  text: z.string().trim().max(80).optional(),
}).refine(a => a.selected.length > 0 || !!a.text, 'Choose an answer.');
export const credentialsSchema = z.object({ pin: z.string().regex(/^\d{6}$/), role: z.enum(['host', 'player', 'projector']), token: z.string().min(32).max(128).optional() });
export const joinSchema = z.object({ pin: z.string().regex(/^\d{6}$/, 'Enter a six-digit game PIN.'), name: z.string().trim().max(15, 'Keep your nickname to 15 characters.').regex(/^[^\p{Cc}\p{Cf}]*$/u, 'Use a plain-text nickname.').refine(name => !isOffensiveName(name), 'Please choose a different nickname.') });
