import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../apps/server/src/store.js';
import { Games } from '../apps/server/src/game.js';
import { backupDatabase, restoreDatabase } from '../apps/server/src/maintenance.js';
import { samples } from '../packages/shared/src/samples.js';
test('a live SQLite backup restores a room and its private reconnect access', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'tori-backup-')); t.after(() => rmSync(dir, { force: true, recursive: true }));
  const path = join(dir, 'source.sqlite'), saved = join(dir, 'saved.sqlite'), restored = join(dir, 'restored.sqlite');
  const store = new Store(path); const games = new Games(store);
  const host = { ...games.create(samples[0], 'accuracy', false, true), role: 'host' as const };
  const player = { ...games.join(host.pin, 'Backup Badger'), role: 'player' as const };
  await backupDatabase(path, saved); store.close(); await restoreDatabase(saved, restored);
  const restoredStore = new Store(restored); t.after(() => restoredStore.close()); const restoredGames = new Games(restoredStore);
  assert.equal(restoredGames.snapshot(host).title, samples[0].title); assert.equal(restoredGames.snapshot(player).me?.name, 'Backup Badger');
  await assert.rejects(() => backupDatabase(path, saved), /already exists/);
});
test('restore refuses a destination with an active WAL and invalid backups', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'tori-backup-')); t.after(() => rmSync(dir, { force: true, recursive: true }));
  const target = join(dir, 'target.sqlite'); writeFileSync(target + '-wal', 'active');
  await assert.rejects(() => restoreDatabase('missing', target), /appears open/);
  await assert.rejects(() => backupDatabase(join(dir, 'missing'), target), /does not exist/);
  const invalid = join(dir, 'invalid'); writeFileSync(invalid, 'not a database');
  await assert.rejects(() => backupDatabase(invalid, target));
});
