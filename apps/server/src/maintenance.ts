import { DatabaseSync, backup } from 'node:sqlite';
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';

export async function backupDatabase(source: string, destination: string) {
  if (!existsSync(source)) throw new Error('The source database does not exist.');
  if (existsSync(destination)) throw new Error('The destination already exists; choose a new backup filename.');
  mkdirSync(dirname(destination), { recursive: true });
  const db = new DatabaseSync(source, { readOnly: true });
  try {
    const result = db.prepare('PRAGMA quick_check').get() as { quick_check: string };
    if (result.quick_check !== 'ok') throw new Error('SQLite integrity verification failed.');
    db.prepare('SELECT pin, expires, snapshot FROM rooms LIMIT 1').get();
    await backup(db, destination);
  } catch (error) { rmSync(destination, { force: true }); throw error; }
  finally { db.close(); }
}
export async function restoreDatabase(source: string, destination: string) {
  if (resolve(source) === resolve(destination)) throw new Error('Restore requires a different source and destination.');
  if (existsSync(destination + '-wal') || existsSync(destination + '-shm')) throw new Error('The destination appears open or was not cleanly closed. Stop Tori gracefully before restoring; do not delete active WAL files.');
  const temporary = destination + '.restore-' + randomUUID();
  try { await backupDatabase(source, temporary); renameSync(temporary, destination); }
  finally { rmSync(temporary, { force: true }); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [command, file] = process.argv.slice(2);
  const database = process.env.DATABASE_PATH || 'data/tori.sqlite';
  try {
    if (!file || !['backup', 'restore'].includes(command)) throw new Error('Usage: npm run backup -- backups/game.sqlite OR npm run restore -- backups/game.sqlite');
    if (command === 'backup') await backupDatabase(database, file);
    else await restoreDatabase(file, database);
    console.log(`${command === 'backup' ? 'Backup saved to' : 'Database restored from'} ${file}`);
  } catch (error) { console.error(error instanceof Error ? error.message : 'Database operation failed.'); process.exitCode = 1; }
}
