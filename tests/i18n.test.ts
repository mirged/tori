import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { lt } from '../apps/web/src/lt.js';
import { place, plural, setLang, t } from '../apps/web/src/i18n.js';
import { samples } from '../packages/shared/src/samples.js';
import { teamNames } from '../packages/shared/src/protocol.js';

const read = (path: string) => readFileSync(path, 'utf8');
const literals = (source: string, pattern: RegExp) => [...source.matchAll(pattern)].map(match => match[1]);
/** Every English string the interface can show, so none appear untranslated in Lithuanian. */
export function translatableKeys() {
  const web = readdirSync('apps/web/src').filter(f => /\.tsx?$/.test(f) && !['lt.ts', 'i18n.ts'].includes(f)).map(f => read(join('apps/web/src', f))).join('\n');
  const keys = new Set(literals(web, /\bt\(\s*'((?:[^'\\]|\\.)*)'/g));
  // Messages produced by the server, validation and storage, translated where they are shown.
  for (const match of literals(read('apps/server/src/game.ts'), /fail\('((?:[^'\\]|\\.)*)'\)/g)) keys.add(match);
  for (const match of literals(read('apps/server/src/server.ts'), /error: '((?:[^'\\]|\\.)*)'/g)) keys.add(match);
  for (const match of literals(read('packages/shared/src/protocol.ts'), /(?:message: |, )'([A-Z][^']*[.!])'/g)) keys.add(match);
  for (const match of literals(web, /new Error\('((?:[^'\\]|\\.)*)'\)/g)) keys.add(match);
  for (const match of literals(web, /set(?:Error|Fatal)\('((?:[^'\\]|\\.)*)'\)/g)) keys.add(match);
  // Lookup tables passed to t() at runtime.
  const tables = [
    ['Quiz', 'True or false', 'Multi-select', 'Poll', 'Type answer', 'Puzzle', 'Select all that apply'],
    ['One correct answer.', 'Is it true or false?', 'Mark every correct answer.', 'No right answer — everyone votes and sees the results. No points.',
      'Players type their answer. Capitals, accents and punctuation are ignored. Add other accepted spellings.',
      'Write the items in the correct order. Players see them shuffled and put them back in order.'],
    ['Triangle', 'Diamond', 'Circle', 'Square', 'Pentagon', 'Star', 'True', 'False', 'All', 'Next', 'Skip', 'Podium'],
    ['Leaderboard & podium', 'Scoreboard between questions and a podium at the end.', 'Team mode', 'Players are split into 2–4 colour teams when you start.',
      'Get ready screen', 'Show each question for 4 seconds before answers open.', 'Reveal when everyone answers', 'Skip the wait once all players are in.',
      'Shuffle answer order', 'So the right answer isn’t always the same colour.', 'Show question on phones', 'Turn off to show only shapes — eyes on the big screen.',
      'Approve nicknames', 'Check each name before the player enters.'],
    ['Create', 'Build a quiz or start from a sample. Add images, timers and explanations. Export JSON backups anytime.', 'Host',
      'Open a lobby and share the six-digit PIN or QR code. On Wi-Fi, use the host computer’s LAN address.', 'Play',
      'Players answer on their own devices. Reveal answers together, see the scoreboard, and crown the podium.'],
    ['General knowledge', 'Nature', 'Science & space', 'Arts & culture', 'History', 'Just for fun', 'green', 'peach', 'lilac', 'blue'],
    teamNames.map(name => `Team ${name}`),
    ['This browser doesn’t have the private host credential for this game.', 'This browser doesn’t have the private player credential for this game.',
      'This game session is no longer available.', 'Your answer could not be confirmed.', 'The action could not be completed.'],
    [read('apps/web/src/lib.ts').match(/export const rules = '([^']*)'/)![1]],
    [...new Set(samples.map(quiz => quiz.category))],
  ];
  for (const table of tables) for (const key of table) keys.add(key);
  return [...keys].filter(Boolean).map(key => key.replace(/\\'/g, "'"));
}

test('every interface string has a Lithuanian translation', () => {
  const missing = translatableKeys().filter(key => !(key in lt));
  assert.deepEqual(missing, [], `Missing Lithuanian translations:\n${missing.join('\n')}`);
});
test('Lithuanian translations keep every {placeholder}', () => {
  for (const [english, lithuanian] of Object.entries(lt)) {
    const names = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();
    assert.deepEqual(names(lithuanian), names(english), `Placeholders differ for: ${english}`);
  }
});
test('Lithuanian plurals and places follow the grammar', () => {
  setLang('lt');
  try {
    assert.equal(plural(1, 'player'), '1 žaidėjas'); assert.equal(plural(21, 'player'), '21 žaidėjas');
    assert.equal(plural(3, 'question'), '3 klausimai'); assert.equal(plural(11, 'question'), '11 klausimų');
    assert.equal(plural(10, 'point'), '10 taškų'); assert.equal(plural(0, 'answer'), '0 atsakymų');
    assert.equal(t('You’re in {place} place', { place: place(2) }), 'Esi 2-oje vietoje');
    assert.equal(t('Not translated'), 'Not translated');
  } finally { setLang('en'); }
  assert.equal(plural(1, 'player'), '1 player'); assert.equal(place(22), '22nd');
});
