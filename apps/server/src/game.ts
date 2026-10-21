import { randomBytes, randomInt, createHash } from 'node:crypto';
import { READY_MS, teamNames, type Action, type AnswerRequest, type Credentials, type Mode, type Phase, type PublicPlayer, type Question, type Quiz, type Role, type RoomOptions, type Snapshot, type TeamStanding } from '../../../packages/shared/src/protocol.js';
import { creditFor, pointsFor } from '../../../packages/shared/src/scoring.js';
import type { Store } from './store.js';

interface Answer { selected: number[]; text?: string; points: number; credit: number; requestId: string; receivedAt: number }
interface Player { id: string; tokenHash: string; name: string; approved: boolean; removed: boolean; team?: number; answers: Record<string, Answer> }
export interface Room {
  pin: string; hostHash: string; quiz: Quiz; mode: Mode; phase: Phase;
  approval: boolean; leaderboard: boolean; locked: boolean; index: number; seq: number;
  players: Player[]; deadline: number | null; remaining: number | null;
  /** When answers open (may be in the future during "get ready"); null while paused. */
  elapsed: number; startedAt: number | null; expires: number; requests: string[];
  options?: RoomOptions; mediaKey?: string;
  /** Display order for "order" questions: shown position → original option index. */
  orders?: Record<string, number[]>;
}
export class GameError extends Error {}
const fail = (message: string): never => { throw new GameError(message); };
const secret = () => randomBytes(32).toString('hex');
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const adjective = ['Curious', 'Sunny', 'Cosmic', 'Brave', 'Happy', 'Clever', 'Gentle', 'Mighty'];
const animal = ['Otter', 'Panda', 'Fox', 'Owl', 'Koala', 'Robin', 'Badger', 'Gecko'];
export { READY_MS };
const defaults: RoomOptions = { teams: false, shuffle: false, autoReveal: false, phoneText: true, getReady: false };
const optionsOf = (room: Room): RoomOptions => ({ ...defaults, ...room.options });
function shuffled<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) { const j = randomInt(i + 1); [copy[i], copy[j]] = [copy[j], copy[i]]; }
  return copy;
}
/** Shuffle the answer order once per game so the right answer is not always the same colour. */
function shuffleAnswers(question: Question): Question {
  if (question.type === 'boolean' || question.type === 'text' || question.type === 'order') return question;
  const order = shuffled(question.options.map((_, i) => i));
  return { ...question, options: order.map(i => question.options[i]), correct: question.correct.map(c => order.indexOf(c)).sort((a, b) => a - b) };
}

export class Games {
  readonly rooms = new Map<string, Room>();
  onChange: (pin: string) => void = () => {};
  constructor(readonly store: Store, readonly limits = { rooms: 100, players: 300, retentionMs: 86_400_000 }) {
    for (const room of store.load()) this.rooms.set(room.pin, room);
    this.tick();
  }
  private commit(room: Room) {
    room.seq++;
    try { this.store.save(room); }
    catch (error) {
      const durable = this.store.get(room.pin);
      if (durable) this.rooms.set(room.pin, durable);
      throw error;
    }
    this.onChange(room.pin);
  }
  get(pin: string): Room {
    const room = this.rooms.get(pin);
    if (!room || room.expires <= Date.now()) return fail('This game has expired or was deleted. Ask your host for a new PIN.');
    return room;
  }
  create(quiz: Quiz, mode: Mode, approval: boolean, leaderboard: boolean, options: Partial<RoomOptions> = {}) {
    this.tick();
    if (this.rooms.size >= this.limits.rooms) return fail('This instance is at its room capacity. Please try again later.');
    let pin: string;
    do { pin = String(randomInt(100000, 1000000)); } while (this.rooms.has(pin));
    const token = secret();
    const settings: RoomOptions = { ...defaults, ...Object.fromEntries(Object.entries(options).filter(([, v]) => v !== undefined)) };
    const copy = structuredClone(quiz);
    if (settings.shuffle) copy.questions = copy.questions.map(shuffleAnswers);
    const room: Room = {
      pin, hostHash: hash(token), quiz: copy, mode, approval, leaderboard,
      phase: 'lobby', locked: false, index: -1, seq: 0, players: [], deadline: null,
      remaining: null, elapsed: 0, startedAt: null, requests: [],
      expires: Date.now() + this.limits.retentionMs, options: settings, mediaKey: randomBytes(6).toString('hex'), orders: {},
    };
    this.store.save(room);
    this.rooms.set(pin, room);
    return { pin, token };
  }
  join(pin: string, name: string) {
    const room = this.get(pin);
    if (room.locked || room.phase !== 'lobby') return fail('This lobby is closed. Ask your host to open a new game.');
    if (room.players.filter(p => !p.removed).length >= this.limits.players || room.players.length >= this.limits.players * 3)
      return fail('This room has reached its player capacity.');
    const chosen = name || `${adjective[randomInt(adjective.length)]} ${animal[randomInt(animal.length)]} ${randomInt(10, 100)}`;
    if (room.players.some(p => !p.removed && p.name.toLocaleLowerCase() === chosen.toLocaleLowerCase())) return fail('That nickname is taken. Try another.');
    const token = secret();
    const player: Player = { id: randomBytes(12).toString('hex'), tokenHash: hash(token), name: chosen, approved: !room.approval, removed: false, answers: {} };
    room.players.push(player);
    this.commit(room);
    return { pin, token, playerId: player.id };
  }
  authorize(credentials: Credentials): { room: Room; role: Role; player?: Player } {
    const room = this.get(credentials.pin);
    if (credentials.role === 'projector') return { room, role: 'projector' };
    if (!credentials.token) return fail('Your private game credential is missing.');
    if (credentials.role === 'host') {
      if (hash(credentials.token) !== room.hostHash) return fail('This host credential is not valid.');
      return { room, role: 'host' };
    }
    const player = room.players.find(p => p.tokenHash === hash(credentials.token!));
    if (!player) return fail('Your player session is no longer available.');
    if (player.removed) return fail('You were removed from this game by the host. This session is no longer available.');
    return { room, role: 'player', player };
  }
  private open(room: Room, now: number) {
    room.index++;
    room.phase = 'question';
    const question = room.quiz.questions[room.index];
    if (question.type === 'order') {
      // Never show the items in their correct order.
      const identity = question.options.map((_, i) => i); let order = identity;
      while (order.every((n, i) => n === i)) order = shuffled(identity);
      (room.orders ||= {})[question.id] = order;
    }
    room.elapsed = 0; room.remaining = null;
    room.startedAt = now + (optionsOf(room).getReady ? READY_MS : 0);
    room.deadline = room.startedAt + question.seconds * 1000;
  }
  private close(room: Room) {
    room.phase = 'reveal'; room.deadline = null; room.remaining = null; room.startedAt = null;
  }
  private drawTeams(room: Room) {
    const active = shuffled(room.players.filter(p => p.approved && !p.removed));
    const count = active.length <= 8 ? 2 : active.length <= 18 ? 3 : 4;
    active.forEach((p, i) => { p.team = i % count; });
  }
  action(credentials: Credentials, action: Action, now = Date.now()) {
    const { room, role } = this.authorize(credentials);
    if (role !== 'host') return fail('Only the host can control this game.');
    if (room.requests.includes(action.requestId)) return;
    this.expireQuestion(room, now);
    if (action.seq !== room.seq) return fail('The game changed. Your screen has refreshed; please try again.');
    const active = room.players.filter(p => p.approved && !p.removed);
    switch (action.type) {
      case 'start':
        if (room.phase !== 'lobby') return fail('The game has already started.');
        if (!active.length) return fail('Wait for at least one approved player.');
        if (optionsOf(room).teams) this.drawTeams(room);
        this.open(room, now); break;
      case 'close':
        if (room.phase !== 'question') return fail('There is no open question.');
        this.close(room); break;
      case 'next':
        if (room.phase === 'reveal') room.phase = 'standings';
        else if (room.phase === 'standings') {
          if (room.index + 1 === room.quiz.questions.length) room.phase = 'finished';
          else this.open(room, now);
        } else return fail('Close the question before moving on.');
        break;
      case 'pause':
        if (room.phase !== 'question' || room.deadline === null) return fail('This question cannot be paused now.');
        if (now < room.startedAt!) return fail('Wait until answers open before pausing.');
        room.remaining = Math.max(0, room.deadline - now);
        room.elapsed += now - room.startedAt!;
        room.deadline = null; room.startedAt = null; break;
      case 'resume':
        if (room.phase !== 'question' || room.remaining === null) return fail('This question is not paused.');
        room.deadline = now + room.remaining; room.startedAt = now; room.remaining = null; break;
      case 'lock': room.locked = !room.locked; break;
      case 'leaderboard': room.leaderboard = !room.leaderboard; break;
      case 'approve': {
        if (room.phase !== 'lobby') return fail('Approve nicknames before starting.');
        const player = room.players.find(p => p.id === action.playerId && !p.removed);
        if (!player) return fail('Player not found.');
        player.approved = true; break;
      }
      case 'remove': {
        const player = room.players.find(p => p.id === action.playerId && !p.removed);
        if (!player) return fail('Player not found.');
        player.removed = true; break;
      }
      case 'delete':
        this.store.delete(room.pin); this.rooms.delete(room.pin); this.onChange(room.pin); return;
    }
    room.requests.push(action.requestId);
    room.requests = room.requests.slice(-200);
    this.commit(room);
  }
  answer(credentials: Credentials, request: AnswerRequest, now = Date.now()) {
    const { room, player, role } = this.authorize(credentials);
    if (role !== 'player' || !player?.approved) return fail('Only approved players can answer.');
    const previous = player.answers[request.questionId];
    if (previous?.requestId === request.requestId) return { accepted: true as const };
    this.expireQuestion(room, now);
    if (room.phase !== 'question' || room.deadline === null) return fail('This question is closed or paused.');
    const question = room.quiz.questions[room.index];
    if (request.questionId !== question.id) return fail('That question is no longer open.');
    if (now < room.startedAt!) return fail('Answers are not open yet.');
    if (previous) return fail('Your answer has already been recorded.');
    let selected = request.selected; const text = question.type === 'text' ? request.text?.trim().slice(0, 80) : undefined;
    const inRange = selected.every(n => n >= 0 && n < question.options.length) && new Set(selected).size === selected.length;
    const valid = question.type === 'text' ? !!text && !selected.length
      : question.type === 'order' ? inRange && selected.length === question.options.length
      : question.type === 'multiple' ? inRange && selected.length > 0
      : inRange && selected.length === 1;
    if (!valid) return fail('Choose a valid answer.');
    // Order answers arrive as displayed positions; store them as original option indexes.
    if (question.type === 'order') { const order = room.orders?.[question.id] || question.options.map((_, i) => i); selected = selected.map(n => order[n]); }
    const elapsed = room.elapsed + now - room.startedAt!;
    player.answers[question.id] = {
      requestId: request.requestId, selected: [...selected], text, receivedAt: now,
      credit: creditFor(question, selected, text), points: pointsFor(question, selected, room.mode, elapsed, text),
    };
    const active = room.players.filter(p => p.approved && !p.removed);
    if (optionsOf(room).autoReveal && active.every(p => p.answers[question.id])) this.close(room);
    this.commit(room);
    return { accepted: true as const };
  }
  private expireQuestion(room: Room, now: number) {
    if (room.phase === 'question' && room.deadline !== null && now >= room.deadline) { this.close(room); this.commit(room); }
  }
  tick(now = Date.now()) {
    for (const room of this.rooms.values()) {
      if (room.expires <= now) { this.store.delete(room.pin); this.rooms.delete(room.pin); this.onChange(room.pin); }
      else this.expireQuestion(room, now);
    }
  }
  /** Question images are served over HTTP (and cached) instead of riding along in every snapshot. */
  media(pin: string, questionId: string, kind: 'image' | 'reveal'): string {
    const room = this.get(pin);
    const index = room.quiz.questions.findIndex(q => q.id === questionId);
    const question = room.quiz.questions[index];
    const revealed = index < room.index || (index === room.index && room.phase !== 'question' && room.phase !== 'lobby');
    const visible = kind === 'image' ? index >= 0 && index <= room.index : index >= 0 && revealed;
    const data = visible ? (kind === 'image' ? question.image : question.revealImage) : undefined;
    return data || fail('Image not available.');
  }
  private mediaUrl(room: Room, question: Question, kind: 'image' | 'reveal') {
    return `/api/rooms/${room.pin}/media/${encodeURIComponent(question.id)}/${kind}?v=${room.mediaKey || room.hostHash.slice(-8)}`;
  }
  snapshot(credentials: Credentials): Snapshot {
    const { room, role, player } = this.authorize(credentials);
    const options = optionsOf(room);
    const active = room.players.filter(p => !p.removed && p.approved);
    const revealed = room.phase !== 'lobby' && room.phase !== 'question';
    const completed = room.quiz.questions.slice(0, room.index + (revealed ? 1 : 0));
    const graded = completed.filter(q => q.type !== 'poll');
    // During a question, current points are private even if an answer was correct.
    const totals = new Map(active.map(p => [p.id, completed.reduce((sum, q) => sum + (p.answers[q.id]?.points || 0), 0)]));
    const sorted = [...active].sort((a, b) => totals.get(b.id)! - totals.get(a.id)! || a.name.localeCompare(b.name));
    const visibleScores = (p: Player) => room.leaderboard || role === 'host' || p.id === player?.id;
    const publicPlayer = (p: Player): PublicPlayer => ({
      id: p.id, name: p.name, approved: p.approved, team: p.team,
      score: visibleScores(p) ? totals.get(p.id) || 0 : 0,
      rank: visibleScores(p) ? 1 + sorted.filter(other => totals.get(other.id)! > (totals.get(p.id) || 0)).length : 0,
    });
    const question = room.quiz.questions[room.index];
    const current = player && question ? player.answers[question.id] : undefined;
    const accuracy = active.reduce((sum, p) => sum + graded.reduce((n, q) => n + (p.answers[q.id]?.credit || 0), 0), 0);
    const denominator = active.length * graded.length;
    const snapshot: Snapshot = {
      pin: room.pin, title: room.quiz.title, seq: room.seq, phase: room.phase, mode: room.mode,
      approval: room.approval, locked: room.locked, leaderboard: room.leaderboard, index: room.index,
      total: room.quiz.questions.length, deadline: room.deadline, remaining: room.remaining,
      paused: room.remaining !== null, players: [], playerCount: active.length,
      answered: question ? active.filter(p => p.answers[question.id]).length : 0,
      classScore: denominator ? Math.round(100 * accuracy / denominator) : 0, serverTime: Date.now(),
      opensAt: room.phase === 'question' ? room.startedAt : null, options,
    };
    if (role === 'host') snapshot.players = [...sorted, ...room.players.filter(p => !p.approved && !p.removed)].map(publicPlayer);
    else if (room.phase === 'lobby' || room.leaderboard && revealed) snapshot.players = sorted.map(publicPlayer);
    if (options.teams && room.index >= 0 && (room.leaderboard || role === 'host')) {
      // Team score is the members' average, so uneven teams stay fair.
      const teams = teamNames.map((name, id) => {
        const members = active.filter(p => p.team === id);
        return { id, name, members: members.length, score: members.length ? Math.round(members.reduce((n, p) => n + totals.get(p.id)!, 0) / members.length) : 0, rank: 0 };
      }).filter(t => t.members > 0).sort((a, b) => b.score - a.score);
      teams.forEach((t: TeamStanding) => { t.rank = 1 + teams.filter(o => o.score > t.score).length; });
      snapshot.teams = teams;
    }
    if (question && (!player || player.approved)) {
      const { correct, explanation, revealImage, image, ...publicQuestion } = question;
      const shown = { ...publicQuestion, ...(image ? { image: this.mediaUrl(room, question, 'image') } : {}) };
      if (revealed) snapshot.question = { ...shown, correct, explanation, ...(revealImage ? { revealImage: this.mediaUrl(room, question, 'reveal') } : {}) };
      else {
        // Accepted typed answers and the correct order stay on the server until the reveal.
        const order = room.orders?.[question.id];
        const options = question.type === 'text' ? [] : question.type === 'order' && order ? order.map(i => question.options[i]) : question.options;
        snapshot.question = { ...shown, options };
      }
      if (revealed) {
        const answers = active.map(p => p.answers[question.id]).filter(Boolean);
        snapshot.distribution = question.type === 'text' || question.type === 'order'
          ? [answers.filter(a => a.credit === 1).length, answers.filter(a => a.credit < 1).length]
          : question.options.map((_, i) => answers.filter(a => a.selected.includes(i)).length);
      }
    }
    if (player) {
      snapshot.me = { ...publicPlayer(player), selected: current?.selected, text: current?.text };
      if (revealed && current) { snapshot.me.points = current.points; snapshot.me.credit = current.credit; }
      let streak = 0;
      for (const q of [...graded].reverse()) { if (player.answers[q.id]?.credit === 1) streak++; else break; }
      snapshot.me.streak = streak;
      if (room.leaderboard && room.index >= 0) {
        const mine = totals.get(player.id) || 0;
        const above = sorted.filter(p => totals.get(p.id)! > mine).at(-1);
        const below = sorted.find(p => totals.get(p.id)! < mine);
        if (above) snapshot.me.gap = { name: above.name, points: totals.get(above.id)! - mine, ahead: true };
        else if (below) snapshot.me.gap = { name: below.name, points: mine - totals.get(below.id)!, ahead: false };
      }
      if (room.phase === 'finished') snapshot.review = room.quiz.questions.map(q => {
        const { image: _image, revealImage: _reveal, ...plain } = q;
        const answer = player.answers[q.id];
        return { question: plain, selected: answer?.selected || [], text: answer?.text, points: answer?.points || 0, credit: answer?.credit || 0 };
      });
    }
    if (role === 'host' && room.phase === 'finished') snapshot.hostQuiz = room.quiz;
    return snapshot;
  }
  csv(credentials: Credentials): string {
    const { room, role } = this.authorize(credentials);
    if (role !== 'host') return fail('Only the host can export results.');
    if (room.phase !== 'finished') return fail('Finish the game before exporting results.');
    const escape = (value: unknown) => {
      let str = String(value);
      if (/^[=+\-@\t\r\n]/.test(str)) str = `'${str}`;
      return `"${str.replaceAll('"', '""')}"`;
    };
    const teams = optionsOf(room).teams;
    const rows: unknown[][] = [['Nickname', ...(teams ? ['Team'] : []), 'Total score', ...room.quiz.questions.map(q => q.text)]];
    for (const p of room.players.filter(p => !p.removed && p.approved))
      rows.push([p.name, ...(teams ? [p.team === undefined ? '' : teamNames[p.team]] : []), Object.values(p.answers).reduce((sum, answer) => sum + answer.points, 0), ...room.quiz.questions.map(q => p.answers[q.id]?.points || 0)]);
    return '﻿' + rows.map(row => row.map(escape).join(',')).join('\r\n');
  }
}
