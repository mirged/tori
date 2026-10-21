import { z } from 'zod';
import type { Quiz } from '../../../packages/shared/src/protocol';
import { draftSchema, loadQuizzes } from './lib';

// Quizzes live in IndexedDB (hundreds of MB) instead of localStorage (~5 MB),
// so image-heavy quizzes keep saving. Each quiz is its own record, so typing
// in the editor rewrites one quiz rather than the whole library.
const LEGACY_KEY = 'tori.quizzes.v1';
interface Row { id: string; position: number; quiz: Quiz }
let database: Promise<IDBDatabase> | null = null;
function open(): Promise<IDBDatabase> {
  database ||= new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB is unavailable.'));
    const request = indexedDB.open('tori', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('quizzes', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB could not open.'));
    request.onblocked = () => reject(new Error('Close other Tori tabs and reload.'));
  });
  return database;
}
const done = (tx: IDBTransaction) => new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(tx.error || new Error('Saving failed.')); });

export async function loadLibrary(): Promise<{ quizzes: Quiz[]; persistent: boolean }> {
  let db: IDBDatabase;
  try { db = await open(); } catch { return { quizzes: loadQuizzes(), persistent: false }; }
  const rows = await new Promise<Row[]>((resolve, reject) => { const request = db.transaction('quizzes').objectStore('quizzes').getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  const migrated = localStorage.getItem('tori.migrated.v2') === 'true';
  if (!rows.length && !migrated) {
    // First run on IndexedDB: bring over the old localStorage library (or the samples).
    const quizzes = loadQuizzes();
    await saveLibrary(quizzes, []);
    try { localStorage.setItem('tori.migrated.v2', 'true'); localStorage.removeItem(LEGACY_KEY); } catch { /* optional cleanup */ }
    return { quizzes, persistent: true };
  }
  const quizzes = z.array(draftSchema).parse(rows.sort((a, b) => a.position - b.position).map(row => row.quiz));
  return { quizzes, persistent: true };
}
export async function saveLibrary(next: Quiz[], previous: Quiz[]) {
  const db = await open();
  const tx = db.transaction('quizzes', 'readwrite'); const store = tx.objectStore('quizzes');
  next.forEach((quiz, position) => { if (previous[position] !== quiz) store.put({ id: quiz.id, position, quiz } satisfies Row); });
  const kept = new Set(next.map(q => q.id));
  for (const quiz of previous) if (!kept.has(quiz.id)) store.delete(quiz.id);
  await done(tx);
  try { localStorage.setItem('tori.migrated.v2', 'true'); } catch { /* optional */ }
}
export function saveLegacy(next: Quiz[]) { localStorage.setItem(LEGACY_KEY, JSON.stringify(next)); }
