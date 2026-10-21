import { z } from 'zod';
import { questionSchema, questionTypes, type Question, type Quiz } from '../../../packages/shared/src/protocol';
import { samples } from '../../../packages/shared/src/samples';
import { t } from './i18n';

export function uid() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = bytes[6] & 15 | 64; bytes[8] = bytes[8] & 63 | 128;
  const hex = [...bytes].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export const draftSchema = z.object({
  version: z.literal(1), id: z.string().max(80), title: z.string().max(100), description: z.string().max(300),
  category: z.string().max(40), cover: z.enum(['green', 'peach', 'lilac', 'blue']),
  questions: z.array(z.object({ id: z.string().max(80), type: z.enum(questionTypes), text: z.string().max(300),
    options: z.array(z.string().max(160)).min(1).max(6), correct: z.array(z.number().int().min(0).max(5)).max(6),
    points: z.enum(['standard', 'double', 'none']).optional(),
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

/** Shrink photos in the browser so big phone pictures fit the 1 MB limit. GIFs keep their animation. */
export async function prepareImage(file: File): Promise<string> {
  const read = (blob: Blob) => new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('The image could not be read.')); reader.readAsDataURL(blob); });
  if (file.type === 'image/gif') {
    if (file.size > 1_000_000) throw new Error('GIFs must be under 1 MB. Try a shorter or smaller GIF.');
    return read(file);
  }
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('Choose a PNG, JPEG, WebP, or GIF image.');
  if (file.size > 25_000_000) throw new Error('That image is too large to process. Try one under 25 MB.');
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error('The image could not be opened.')); img.src = url; });
    for (const [edge, quality] of [[1280, .82], [1024, .75], [800, .7], [640, .6]] as const) {
      const scale = Math.min(1, edge / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height);
      let blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/webp', quality));
      if (!blob || blob.type !== 'image/webp') blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
      if (blob && blob.size <= 950_000) return read(blob);
    }
    throw new Error('That image could not be made small enough. Try a simpler picture.');
  } finally { URL.revokeObjectURL(url); }
}

/* ---------- Spreadsheet (CSV) import ---------- */
export const csvTemplate = [
  'Question,Type,Answer 1,Answer 2,Answer 3,Answer 4,Answer 5,Answer 6,Correct,Time (seconds),Points,Explanation',
  'How many hearts does an octopus have?,quiz,One,Two,Three,Eight,,,3,20,standard,Two pump blood to the gills and one to the body.',
  'A day on Venus is longer than its year.,true/false,True,False,,,,,1,20,standard,',
  'Which of these are mammals?,multi,Dolphin,Penguin,Bat,Octopus,,,"1,3",30,double,',
  'What is the capital of France? (type it),type answer,Paris,,,,,,,30,standard,Any accepted spelling counts.',
  'Put these planets in order from the Sun.,order,Mercury,Venus,Earth,Mars,,,,45,standard,Write answers in the correct order; players see them shuffled.',
  'Best pizza topping?,poll,Pineapple,Pepperoni,Mushroom,Olives,,,,15,none,Polls have no right answer.',
].join('\r\n');
export function parseCsv(text: string): string[][] {
  const firstLine = text.split(/\r?\n/, 1)[0];
  const delimiter = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : firstLine.includes('\t') && !firstLine.includes(',') ? '\t' : ',';
  const rows: string[][] = []; let row: string[] = []; let field = ''; let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === delimiter) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(cell => cell.trim()));
}
const typeAliases: Record<string, Question['type']> = {
  '': 'single', quiz: 'single', single: 'single', 'single choice': 'single', 'true/false': 'boolean', 'true or false': 'boolean', truefalse: 'boolean', boolean: 'boolean', tf: 'boolean',
  multi: 'multiple', multiple: 'multiple', 'multi-select': 'multiple', 'multiple answers': 'multiple', poll: 'poll', survey: 'poll',
  text: 'text', 'type answer': 'text', 'type the answer': 'text', typed: 'text', order: 'order', puzzle: 'order', sequence: 'order',
};
export function quizFromCsv(text: string, title: string): Quiz {
  const rows = parseCsv(text.replace(/^\ufeff/, ''));
  if (rows.length < 2) throw new Error('The spreadsheet needs a header row and at least one question.');
  const header = rows[0].map(h => h.trim().toLowerCase());
  const col = (...names: string[]) => header.findIndex(h => names.some(n => h.startsWith(n)));
  const qCol = col('question'), typeCol = col('type'), correctCol = col('correct'), timeCol = col('time'), pointsCol = col('points'), explanationCol = col('explanation');
  const answerCols = header.map((h, i) => /^(answer|option)/.test(h) ? i : -1).filter(i => i >= 0).slice(0, 6);
  if (qCol < 0 || !answerCols.length) throw new Error('Missing "Question" or "Answer 1" columns. Download the template to see the layout.');
  const questions = rows.slice(1).slice(0, 50).map((row, n): Question => {
    const where = t('Row {n}', { n: n + 2 });
    const kind = typeAliases[(row[typeCol] || '').trim().toLowerCase()];
    if (!kind) throw new Error(`${where}: ${t('unknown type “{type}”. Use quiz, true/false, multi, poll, type answer, or order.', { type: row[typeCol] })}`);
    let options = answerCols.map(i => (row[i] || '').trim()).filter(Boolean);
    if (kind === 'boolean') options = ['True', 'False'];
    const marked = (row[correctCol] || '').split(/[,;\s]+/).filter(Boolean).map(v => Number(v) - 1);
    let correct = kind === 'single' || kind === 'boolean' || kind === 'multiple' ? marked.filter(i => Number.isInteger(i) && i >= 0 && i < options.length) : [];
    if (kind === 'boolean' && !correct.length) { const v = (row[correctCol] || '').trim().toLowerCase(); correct = v.startsWith('f') ? [1] : v.startsWith('t') ? [0] : []; }
    const seconds = Math.min(240, Math.max(5, Math.round(Number(row[timeCol]) || 20)));
    const pointsValue = (row[pointsCol] || '').trim().toLowerCase();
    const points = pointsValue.startsWith('d') || pointsValue === '2' ? 'double' : pointsValue.startsWith('n') || pointsValue === '0' ? 'none' : undefined;
    return { id: uid(), type: kind, text: (row[qCol] || '').trim().slice(0, 300), options: options.map(o => o.slice(0, 160)).slice(0, 6), correct: kind === 'single' || kind === 'boolean' ? correct.slice(0, 1) : correct, seconds, explanation: (row[explanationCol] || '').trim().slice(0, 1000), ...(points ? { points } : {}) };
  });
  return { version: 1, id: uid(), title: title.slice(0, 100), description: '', category: 'General knowledge', cover: 'blue', questions };
}
