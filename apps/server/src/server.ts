import express from 'express';
import { createServer as createHttpServer } from 'node:http';
import { resolve } from 'node:path';
import { networkInterfaces } from 'node:os';
import { Server } from 'socket.io';
import { Games, GameError } from './game.js';
import { Store } from './store.js';
import { actionSchema, answerSchema, credentialsSchema, createSchema, joinSchema, type Ack, type Credentials } from '../../../packages/shared/src/protocol.js';

export interface ServerOptions { database?: string; production?: boolean; web?: boolean; retentionMs?: number; maxRooms?: number; maxPlayers?: number }
export async function createTori(options: ServerOptions = {}) {
  const store = new Store(options.database || process.env.DATABASE_PATH || 'data/tori.sqlite');
  const games = new Games(store, {
    rooms: options.maxRooms || positiveInteger(process.env.MAX_ROOMS, 100),
    players: options.maxPlayers || positiveInteger(process.env.MAX_PLAYERS, 300),
    retentionMs: options.retentionMs || positiveInteger(process.env.RETENTION_HOURS, 24) * 3_600_000,
  });
  const app = express();
  app.disable('x-powered-by');
  if (process.env.TRUST_PROXY_HOPS) app.set('trust proxy', positiveInteger(process.env.TRUST_PROXY_HOPS, 1));
  const http = createHttpServer(app);
  // Per-process counters are bounded and expire. No personal metrics are retained.
  const buckets = new Map<string, { count: number; reset: number }>();
  const allow = (key: string, limit: number, window = 60_000) => {
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || now >= bucket.reset) {
      if (buckets.size > 20_000) return false;
      bucket = { count: 0, reset: now + window }; buckets.set(key, bucket);
    }
    return ++bucket.count <= limit;
  };
  function sameOrigin(origin: string | undefined, host: string | undefined) {
    if (!origin) return true;
    try { const url = new URL(origin); return ['http:', 'https:'].includes(url.protocol) && url.host === host; }
    catch { return false; }
  }
  const io = new Server(http, {
    maxHttpBufferSize: 16_384,
    allowRequest: (req, callback) => callback(null, sameOrigin(req.headers.origin, req.headers.host) && allow(`connect:${req.socket.remoteAddress}`, 1200)),
  });
  app.use((req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=()' });
    if (options.production) res.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ws: wss:; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    if (req.path.startsWith('/api/')) {
      res.set('Cache-Control', 'no-store');
      if (!sameOrigin(req.headers.origin, req.headers.host)) return res.status(403).json({ error: 'Requests must come from this instance.' });
      if (!allow(`api:${req.ip}`, 1200)) return res.status(429).json({ error: 'Too many requests. Wait a minute and try again.' });
    }
    next();
  });
  app.use(express.json({ limit: '8mb', type: 'application/json' }));
  app.get('/api/health', (_req, res) => res.json({ status: 'ok', version: '0.1.0', capacity: { maxRooms: games.limits.rooms, maxPlayersPerRoom: games.limits.players, retentionHours: games.limits.retentionMs / 3_600_000, measured: false } }));
  app.post('/api/rooms', (req, res, next) => {
    try {
      if (!allow(`create:${req.ip}`, 15)) return res.status(429).json({ error: 'Room creation limit reached. Try again in a minute.' });
      const input = createSchema.parse(req.body);
      const { quiz, mode, approval, leaderboard, ...options } = input;
      res.status(201).json(games.create(quiz, mode, approval, leaderboard, options));
    } catch (error) { next(error); }
  });
  app.post('/api/join', (req, res, next) => {
    try {
      if (!allow(`join:${req.ip}`, 600)) return res.status(429).json({ error: 'Too many join attempts. Wait a minute and try again.' });
      const parsed = joinSchema.safeParse(req.body);
      // Nickname and PIN messages are written for players, so pass them through.
      if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
      const input = parsed.data;
      res.status(201).json(games.join(input.pin, input.name));
    } catch (error) { next(error); }
  });
  app.get('/api/rooms/:pin/results.csv', (req, res, next) => {
    try {
      const csv = games.csv({ pin: String(req.params.pin), role: 'host', token: req.headers.authorization?.replace(/^Bearer /, '') });
      res.set('Content-Disposition', `attachment; filename="tori-results.csv"`).type('text/csv').send(csv);
    } catch (error) { next(error); }
  });
  app.get('/api/rooms/:pin/media/:question/:kind', (req, res, next) => {
    try {
      const kind = req.params.kind === 'reveal' ? 'reveal' : 'image';
      const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,(.+)$/.exec(games.media(String(req.params.pin), String(req.params.question), kind));
      if (!match) return res.status(404).json({ error: 'Image not available.' });
      // Each room's images never change, so phones download them once.
      res.set('Cache-Control', 'private, max-age=86400, immutable').type(match[1]).send(Buffer.from(match[2], 'base64'));
    } catch (error) { if (error instanceof GameError) res.status(404).json({ error: error.message }); else next(error); }
  });
  app.get('/api/info', (req, res) => {
    // Lets a host who opened Tori on localhost share an address phones can reach.
    const port = (req.headers.host || '').split(':')[1] || '';
    const lan = Object.values(networkInterfaces()).flat()
      .filter(net => net && net.family === 'IPv4' && !net.internal && !/^(172\.(1[7-9]|2\d|3[01])|169\.254)\./.test(net.address))
      .map(net => `http://${net!.address}${port ? ':' + port : ''}`);
    res.json({ publicUrl: process.env.PUBLIC_URL?.replace(/\/$/, '') || null, lan });
  });
  app.use('/api', (_req, res) => res.status(404).json({ error: 'API route not found.' }));
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (error && typeof error === 'object' && 'issues' in error) return res.status(400).json({ error: 'Invalid quiz or request. Check all fields and image sizes.' });
    if (error instanceof GameError) return res.status(400).json({ error: error.message });
    if (error && typeof error === 'object' && 'type' in error && error.type === 'entity.too.large') return res.status(413).json({ error: 'This quiz is too large. Keep the JSON file under 8 MB.' });
    if (error instanceof SyntaxError) return res.status(400).json({ error: 'The request must contain valid JSON.' });
    console.error('Tori request failed:', error instanceof Error ? error.message : 'unknown error');
    res.status(500).json({ error: 'The server could not save this change. Please try again.' });
  });
  const broadcast = (pin: string) => {
    for (const socket of io.sockets.sockets.values()) {
      const credentials = socket.data.credentials as Credentials | undefined;
      if (credentials?.pin !== pin) continue;
      try { socket.emit('snapshot', games.snapshot(credentials)); }
      catch (error) { socket.emit('unavailable', error instanceof Error ? error.message : 'Game unavailable.'); socket.disconnect(true); }
    }
  };
  games.onChange = pin => {
    // Let a successful delete acknowledge its durable change before disconnecting
    // the controlling socket. Other snapshots precede their acknowledgements.
    if (!games.rooms.has(pin)) queueMicrotask(() => broadcast(pin));
    else broadcast(pin);
  };
  io.use((socket, next) => {
    try {
      if (!allow(`auth:${socket.handshake.address}`, 1200)) throw new GameError('Too many connection attempts. Please wait a minute.');
      const credentials = credentialsSchema.parse(socket.handshake.auth);
      games.authorize(credentials); socket.data.credentials = credentials; next();
    } catch (error) { next(new Error(error instanceof GameError ? error.message : 'Invalid game credential.')); }
  });
  io.on('connection', socket => {
    const credentials = socket.data.credentials as Credentials;
    socket.emit('snapshot', games.snapshot(credentials));
    const handle = <T>(type: string, schema: { parse(value: unknown): T }, execute: (input: T) => unknown) => {
      socket.on(type, (value: unknown, ack: (reply: Ack<unknown>) => void) => {
        if (typeof ack !== 'function') return;
        try {
          if (!allow(`socket:${socket.id}`, 120)) throw new GameError('Too many actions. Please wait a minute.');
          const data = execute(schema.parse(value)); ack({ ok: true, data });
        } catch (error) {
          ack({ ok: false, error: error instanceof GameError ? error.message : 'The action could not be saved. Check your input and try again.' });
          try { socket.emit('snapshot', games.snapshot(credentials)); } catch { /* Deleted/removed room. */ }
        }
      });
    };
    handle('action', actionSchema, input => games.action(credentials, input));
    handle('answer', answerSchema, input => games.answer(credentials, input));
  });
  app.use('/audio', express.static(resolve('audio'), { index: false, maxAge: '1d' }));
  let vite: { close(): Promise<void> } | undefined;
  if (options.web !== false) {
    if (options.production) {
      app.use(express.static(resolve('dist'), { index: false, maxAge: '1h' }));
      app.get('/{*splat}', (_req, res) => res.sendFile(resolve('dist/index.html')));
    } else {
      const { createServer } = await import('vite');
      const dev = await createServer({ configLoader: 'runner', server: { middlewareMode: true, ws: { server: http } }, appType: 'spa' });
      vite = dev; app.use(dev.middlewares);
    }
  }
  const timer = setInterval(() => {
    try { games.tick(); } catch (error) { console.error('Room maintenance failed:', error instanceof Error ? error.message : 'unknown error'); }
    for (const [key, bucket] of buckets) if (bucket.reset <= Date.now()) buckets.delete(key);
  }, 250);
  timer.unref();
  return {
    app, http, io, games, store,
    async close() { clearInterval(timer); await vite?.close(); await new Promise<void>(resolve => io.close(() => resolve())); store.close(); },
  };
}
function positiveInteger(value: string | undefined, fallback: number) {
  const n = Number(value); return Number.isSafeInteger(n) && n > 0 ? n : fallback;
}
