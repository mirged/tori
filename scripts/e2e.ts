// End-to-end browser test: one host screen and three phones play a full game
// covering every question type. Uses your installed Chrome (set CHROME_PATH if
// it is not found). Run with: npm run test:e2e
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { randomBytes } from 'node:crypto';
import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import { createTori } from '../apps/server/src/server.js';

const chrome = [process.env.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].find(path => path && existsSync(path));
if (!chrome) { console.error('Chrome was not found. Set CHROME_PATH to a Chrome or Chromium executable.'); process.exit(1); }
if (!existsSync('dist/index.html')) { console.error('Build first: npm run build'); process.exit(1); }

const dir = mkdtempSync(join(tmpdir(), 'tori-e2e-'));
const server = await createTori({ database: join(dir, 'e2e.sqlite'), production: true });
await new Promise<void>(resolve => server.http.listen(0, '127.0.0.1', resolve));
const address = server.http.address();
if (!address || typeof address === 'string') throw new Error('No listen address.');
const base = `http://127.0.0.1:${address.port}`;
const problems: string[] = [];
let step = 'starting';
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
function check(condition: unknown, message: string) { if (!condition) throw new Error(`${step}: ${message}`); }

// A quiz written as a spreadsheet, exercising every question type.
const csv = join(dir, 'Class test.csv');
writeFileSync(csv, [
  'Question,Type,Answer 1,Answer 2,Answer 3,Answer 4,Correct,Time (seconds),Points,Explanation',
  'How many hearts does an octopus have?,quiz,One,Two,Three,Eight,3,30,,Two pump blood to the gills.',
  'A day on Venus is longer than its year.,true/false,True,False,,,1,30,,',
  'Which of these are mammals?,multi,Dolphin,Penguin,Bat,Octopus,"1,3",30,double,',
  'Best pizza topping?,poll,Pineapple,Pepperoni,Mushroom,Olives,,30,,',
  'What is the capital of France?,type answer,Paris,,,,,30,,',
  'Put these planets in order from the Sun.,order,Mercury,Venus,Earth,Mars,,30,,',
].join('\n'));
// An 11 MB noise photo: far over the 1 MB limit, so the editor must shrink it.
const photo = join(dir, 'photo.png');
{
  const width = 2400, height = 1600, raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) randomBytes(width * 3).copy(raw, y * (width * 3 + 1) + 1);
  const crc = (buf: Buffer) => { let c = ~0; for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1; } return ~c >>> 0; };
  const chunk = (type: string, data: Buffer) => { const head = Buffer.from(type); const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(Buffer.concat([head, data]))); return Buffer.concat([len, head, data, sum]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr.set([8, 2, 0, 0, 0], 8);
  writeFileSync(photo, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 1 })), chunk('IEND', Buffer.alloc(0))]));
}

let browser: Browser | undefined;
try {
  browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const open = async (width: number, height: number, mobile: boolean, label: string) => {
    const page = await (await browser!.createBrowserContext()).newPage();
    await page.setViewport({ width, height, isMobile: mobile, hasTouch: mobile });
    page.on('pageerror', error => problems.push(`${label} page error: ${error.message}`));
    page.on('console', message => { if (message.type() === 'error' && !/Failed to load resource: the server responded with a status of 400/.test(message.text())) problems.push(`${label} console: ${message.text()}`); });
    return page;
  };
  const clickText = async (page: Page, selector: string, text: string | RegExp) => {
    const done = await page.evaluate((selector, source, flags) => {
      const pattern = new RegExp(source, flags);
      const element = [...document.querySelectorAll<HTMLElement>(selector)].find(el => pattern.test(el.textContent || '') && !(el as HTMLButtonElement).disabled);
      element?.click(); return !!element;
    }, selector, text instanceof RegExp ? text.source : text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), text instanceof RegExp ? text.flags : '');
    check(done, `could not click ${selector} “${text}”`);
  };
  const until = async (page: Page, fn: () => boolean, what: string, timeout = 10_000) => {
    try { await page.waitForFunction(fn, { timeout, polling: 100 }); } catch { throw new Error(`${step}: timed out waiting for ${what}`); }
  };
  const shot = async (page: Page, name: string) => { if (process.env.E2E_SHOTS) await page.screenshot({ path: join(process.env.E2E_SHOTS, `${name}.png`) }); };
  const noScroll = async (page: Page, label: string) => {
    const size = await page.evaluate(() => ({ height: document.documentElement.scrollHeight, view: innerHeight, width: document.documentElement.scrollWidth, viewWidth: innerWidth }));
    check(size.height <= size.view + 1 && size.width <= size.viewWidth + 1, `${label} page scrolls (${size.width}x${size.height} in ${size.viewWidth}x${size.view})`);
  };

  step = 'library and CSV import';
  const host = await open(1366, 800, false, 'host');
  await host.goto(`${base}/`); await host.waitForSelector('.join-screen');
  check(new URL(host.url()).pathname === '/join', 'root URL should redirect to /join');
  await host.goto(`${base}/home`); await host.waitForSelector('.quiz-grid');
  const importer = await host.$('input[type=file][accept*="csv"]'); check(importer, 'import input missing');
  await importer!.uploadFile(csv);
  await host.waitForSelector('.slide-rail li');
  check((await host.$$('.slide-rail li')).length === 6, 'all six CSV questions should import');
  check((await host.$$('.thumb-warning')).length === 0, 'imported questions should be valid');

  step = 'image upload shrinks a large photo';
  const imageInput = await host.$('.canvas-media input[type=file]'); await imageInput!.uploadFile(photo);
  await host.waitForSelector('.media-image img', { timeout: 15_000 });
  const imageSize = await host.$eval('.media-image img', img => (img as HTMLImageElement).src.length);
  await shot(host, '00-editor');
  check(imageSize < 1_400_000, `image should be shrunk under the limit (got ${imageSize} chars)`);

  step = 'host options';
  await clickText(host, '.editor-top-actions button', 'Host'); await host.waitForSelector('.modal .toggle-grid'); await shot(host, '01-host-options');
  await host.evaluate(() => { const row = [...document.querySelectorAll('.toggle-row')].find(r => r.textContent?.includes('Team mode')); const box = row?.querySelector('input') as HTMLInputElement; if (!box.checked) box.click(); });
  await clickText(host, '.modal button', /^Start/); await host.waitForSelector('.lobby-pin');
  const pin = new URL(host.url()).pathname.split('/').pop()!;

  step = 'players join from their phones';
  const names = ['Ana', 'Ben', 'Cy'];
  const phones: Page[] = [];
  for (const name of names) {
    const phone = await open(390, 780, true, name); phones.push(phone);
    await phone.goto(`${base}/`); await phone.waitForSelector('#game-pin');
    await phone.type('#game-pin', pin); await clickText(phone, 'button', 'Enter');
    await phone.waitForSelector('#nickname');
    if (name === 'Ana') {
      await phone.type('#nickname', 'sh1t'); await clickText(phone, 'button', 'OK, go!');
      await phone.waitForSelector('.join-error'); check((await phone.$eval('.join-error', e => e.textContent))?.includes('different nickname'), 'rude nicknames should be refused');
      await phone.$eval('#nickname', e => { (e as HTMLInputElement).select(); }); await phone.keyboard.press('Backspace');
    }
    await phone.type('#nickname', name); await clickText(phone, 'button', 'OK, go!');
    await phone.waitForSelector('.nick-pill'); await noScroll(phone, `${name} lobby`);
  }
  await until(host, () => document.querySelectorAll('.name-tile').length === 3, 'three names in the lobby');

  step = 'kick and lock';
  await fetch(`${base}/api/join`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin, name: 'Troll' }) });
  await until(host, () => document.querySelectorAll('.name-tile').length === 4, 'the troll to appear');
  await clickText(host, '.name-kick', 'Troll');
  await until(host, () => !!document.querySelector('.game-alert')?.textContent?.includes('Lock the lobby'), 'the lock prompt');
  await clickText(host, '.game-alert button', 'Lock'); await host.waitForSelector('.lobby-locked');
  const locked = await fetch(`${base}/api/join`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin, name: 'Troll2' }) });
  check(locked.status === 400, 'a locked lobby should refuse new players');
  await host.click('button[aria-label="Unlock lobby"]'); await until(host, () => !document.querySelector('.lobby-locked'), 'unlock');

  const [ana, ben, cy] = phones;
  const tile = (page: Page, text: string) => clickText(page, '.player-tile, .order-item', text);
  const reveal = async () => {
    if (await host.$('.stage.revealed')) return;
    await clickText(host, '.stage-controls button', 'Skip'); await host.waitForSelector('.stage.revealed');
  };
  const next = async () => { await clickText(host, 'button.game-next', /Next|Podium/); await wait(400); };
  const answerable = async (page: Page) => { await page.waitForSelector('.player-question', { timeout: 10_000 }); };

  step = 'question 1: get ready, single choice with image';
  await clickText(host, 'button.game-next', 'Start');
  await host.waitForSelector('.get-ready'); await ana.waitForSelector('.get-ready-phone'); await shot(host, '02-host-ready'); await shot(ana, '03-phone-ready');
  await noScroll(ana, 'Ana get-ready');
  await Promise.all(phones.map(answerable));
  await host.waitForSelector('.stage-image');
  check(await host.$eval('.stage-image', img => (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0 && (img as HTMLImageElement).src.includes('/media/')), 'question image should load from its URL');
  await noScroll(ana, 'Ana question'); await shot(host, '04-host-question');
  await tile(ana, 'Three'); await tile(ben, 'Two');
  await ana.waitForSelector('.player-message h1'); await reveal();
  await ana.waitForSelector('.result-screen.correct'); await ben.waitForSelector('.result-screen.incorrect');
  check((await ben.$eval('.gap-line', e => e.textContent))?.includes('behind Ana'), 'Ben should see how far behind Ana he is');
  check((await ana.$eval('.player-bar', e => e.textContent))?.includes('ahead of'), 'Ana’s bar should show her lead');
  await noScroll(ben, 'Ben result'); await shot(ben, '05-phone-wrong-gap'); await shot(ana, '06-phone-right');
  await next(); await host.waitForSelector('.team-board'); await ana.waitForSelector('.rank-badge');
  await noScroll(ana, 'Ana standings'); await shot(host, '07-host-teams'); await shot(ben, '08-phone-standings');

  step = 'question 2: true/false auto-reveals when all answer';
  await next(); await Promise.all(phones.map(answerable));
  await tile(ana, 'True'); await tile(ben, 'False'); await tile(cy, 'True');
  await host.waitForSelector('.stage.revealed', { timeout: 5000 });
  await ana.waitForSelector('.streak-pill'); await shot(ana, '09-phone-streak'); check((await ana.$eval('.streak-pill', e => e.textContent))?.includes('2'), 'Ana should have a 2 streak');
  await next(); await next();

  step = 'question 3: multi-select, double points';
  await Promise.all(phones.map(answerable));
  await tile(ana, 'Dolphin'); await tile(ana, 'Bat'); await clickText(ana, '.submit-answer', 'Submit');
  await tile(ben, 'Penguin'); await clickText(ben, '.submit-answer', 'Submit');
  await tile(cy, 'Dolphin'); await clickText(cy, '.submit-answer', 'Submit');
  await host.waitForSelector('.stage.revealed'); await ana.waitForSelector('.result-screen.correct');
  check((await ana.$eval('.points-pill', e => e.textContent))?.replace(/\D/g, '')! >= '1000', 'double points should apply');
  await next(); await next();

  step = 'question 4: poll';
  await Promise.all(phones.map(answerable));
  for (const phone of phones) await tile(phone, 'Pepperoni');
  await host.waitForSelector('.stage.revealed'); await ana.waitForSelector('.result-screen.poll'); await shot(host, '10-host-poll'); await shot(ana, '11-phone-poll');
  await next(); await next();

  step = 'question 5: type the answer';
  await Promise.all(phones.map(answerable));
  await host.waitForSelector('.type-tile'); await shot(ana, '12-phone-text');
  await ana.type('#typed-answer', '  pAris! '); await clickText(ana, '.submit-answer', 'Submit');
  await ben.type('#typed-answer', 'London'); await clickText(ben, '.submit-answer', 'Submit');
  await cy.type('#typed-answer', 'Paris'); await clickText(cy, '.submit-answer', 'Submit');
  await host.waitForSelector('.big-stat'); await shot(host, '13-host-text-reveal'); await ben.waitForSelector('.result-screen'); await shot(ben, '14-phone-text-wrong'); await ana.waitForSelector('.result-screen.correct'); await ben.waitForSelector('.result-screen.incorrect');
  check((await ben.$eval('.result-answer', e => e.textContent))?.includes('Paris'), 'Ben should see the accepted answer');
  await next(); await next();

  step = 'question 6: puzzle order';
  await Promise.all(phones.map(answerable));
  await noScroll(ana, 'Ana puzzle'); await shot(host, '15-host-puzzle');
  for (const planet of ['Mercury', 'Venus', 'Earth', 'Mars']) await tile(ana, planet);
  await shot(ana, '16-phone-puzzle'); await clickText(ana, '.submit-answer', 'Submit order');
  for (const planet of ['Venus', 'Mercury', 'Earth', 'Mars']) await tile(ben, planet);
  await clickText(ben, '.submit-answer', 'Submit order');
  for (const planet of ['Mars', 'Earth', 'Venus', 'Mercury']) await tile(cy, planet);
  await clickText(cy, '.submit-answer', 'Submit order');
  await host.waitForSelector('.stage.revealed'); await ana.waitForSelector('.result-screen.correct'); await ben.waitForSelector('.result-screen.partial'); await shot(host, '17-host-puzzle-reveal'); await shot(ben, '18-phone-partial');
  await next(); await next();

  step = 'podium and final screens';
  await host.waitForSelector('.podium'); await wait(1500); await shot(host, '19-host-podium');
  check((await host.$eval('.podium', e => e.textContent))?.includes('Team'), 'team podium expected');
  await ana.waitForSelector('.player-final');
  check((await ana.$$('.review details')).length === 6, 'review should list all six questions');
  await noScroll(ana, 'Ana final'); await shot(ana, '20-phone-final');

  step = 'results CSV';
  const token = await host.evaluate(p => localStorage.getItem(`tori.host.${p}`), pin);
  const results = await (await fetch(`${base}/api/rooms/${pin}/results.csv`, { headers: { Authorization: `Bearer ${token}` } })).text();
  check(results.includes('"Ana"') && results.includes('Team'), 'CSV should include players and teams');

  check(!problems.length, `browser errors:\n  ${problems.join('\n  ')}`);
  console.log(`✔ End-to-end game passed: 1 host + ${phones.length} phones, 6 question types (${base})`);
} catch (error) {
  console.error('✖ End-to-end test failed:', error instanceof Error ? error.message : error);
  if (problems.length) console.error('Browser problems:\n  ' + problems.join('\n  '));
  process.exitCode = 1;
} finally {
  await browser?.close(); await server.close(); rmSync(dir, { recursive: true, force: true });
}
