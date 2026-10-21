import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Room } from './game.js';

// The quiz (which can hold megabytes of images) is written once per room. Every
// answer then rewrites only the small live state, keeping commits fast.
export class Store {
  readonly db: DatabaseSync;
  private readonly savedQuizzes = new Set<string>();
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS rooms(pin TEXT PRIMARY KEY, expires INTEGER NOT NULL, snapshot TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS rooms_expiry ON rooms(expires);
      CREATE TABLE IF NOT EXISTS quizzes(pin TEXT PRIMARY KEY, quiz TEXT NOT NULL);`);
  }
  private hydrate(row: { snapshot: string; quiz: string | null }): Room {
    const room = JSON.parse(row.snapshot);
    if (row.quiz) room.quiz = JSON.parse(row.quiz);
    return room;
  }
  load(): Room[] {
    const now = Date.now();
    this.db.prepare('DELETE FROM quizzes WHERE pin IN (SELECT pin FROM rooms WHERE expires <= ?)').run(now);
    this.db.prepare('DELETE FROM rooms WHERE expires <= ?').run(now);
    this.db.prepare('DELETE FROM quizzes WHERE pin NOT IN (SELECT pin FROM rooms)').run();
    return (this.db.prepare('SELECT r.snapshot, q.quiz FROM rooms r LEFT JOIN quizzes q ON q.pin = r.pin').all() as { snapshot: string; quiz: string | null }[]).map(row => this.hydrate(row));
  }
  save(room: Room) {
    const { quiz, ...live } = room;
    this.db.exec('BEGIN');
    try {
      if (!this.savedQuizzes.has(room.pin)) {
        this.db.prepare('INSERT INTO quizzes(pin,quiz) VALUES(?,?) ON CONFLICT(pin) DO UPDATE SET quiz=excluded.quiz').run(room.pin, JSON.stringify(quiz));
      }
      this.db.prepare('INSERT INTO rooms(pin,expires,snapshot) VALUES(?,?,?) ON CONFLICT(pin) DO UPDATE SET expires=excluded.expires,snapshot=excluded.snapshot')
        .run(room.pin, room.expires, JSON.stringify(live));
      this.db.exec('COMMIT');
      this.savedQuizzes.add(room.pin);
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  get(pin: string): Room | undefined {
    const row = this.db.prepare('SELECT r.snapshot, q.quiz FROM rooms r LEFT JOIN quizzes q ON q.pin = r.pin WHERE r.pin=?').get(pin) as { snapshot: string; quiz: string | null } | undefined;
    return row ? this.hydrate(row) : undefined;
  }
  delete(pin: string) {
    this.db.prepare('DELETE FROM rooms WHERE pin=?').run(pin);
    this.db.prepare('DELETE FROM quizzes WHERE pin=?').run(pin);
    this.savedQuizzes.delete(pin);
  }
  close() { this.db.close(); }
}
