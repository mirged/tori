import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Room } from './game.js';

export class Store {
  readonly db: DatabaseSync;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS rooms(pin TEXT PRIMARY KEY, expires INTEGER NOT NULL, snapshot TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS rooms_expiry ON rooms(expires);`);
  }
  load(): Room[] {
    this.db.prepare('DELETE FROM rooms WHERE expires <= ?').run(Date.now());
    return (this.db.prepare('SELECT snapshot FROM rooms').all() as { snapshot: string }[]).map(row => JSON.parse(row.snapshot));
  }
  save(room: Room) {
    this.db.prepare('INSERT INTO rooms(pin,expires,snapshot) VALUES(?,?,?) ON CONFLICT(pin) DO UPDATE SET expires=excluded.expires,snapshot=excluded.snapshot')
      .run(room.pin, room.expires, JSON.stringify(room));
  }
  get(pin: string): Room | undefined {
    const row = this.db.prepare('SELECT snapshot FROM rooms WHERE pin=?').get(pin) as { snapshot: string } | undefined;
    return row ? JSON.parse(row.snapshot) : undefined;
  }
  delete(pin: string) { this.db.prepare('DELETE FROM rooms WHERE pin=?').run(pin); }
  close() { this.db.close(); }
}
