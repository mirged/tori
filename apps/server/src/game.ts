import { randomBytes, randomInt, createHash } from 'node:crypto';
import type { Action, AnswerRequest, Credentials, Mode, Phase, PublicPlayer, Quiz, Role, Snapshot } from '../../../packages/shared/src/protocol.js';
import { creditFor, pointsFor } from '../../../packages/shared/src/scoring.js';
import type { Store } from './store.js';

interface Answer { selected: number[]; points: number; credit: number; requestId: string; receivedAt: number }
interface Player { id: string; tokenHash: string; name: string; approved: boolean; removed: boolean; answers: Record<string, Answer> }
export interface Room {
  pin: string; hostHash: string; quiz: Quiz; mode: Mode; phase: Phase;
  approval: boolean; leaderboard: boolean; locked: boolean; index: number; seq: number;
  players: Player[]; deadline: number | null; remaining: number | null;
  elapsed: number; startedAt: number | null; expires: number; requests: string[];
}
export class GameError extends Error {}
const fail = (message: string): never => { throw new GameError(message); };
const secret = () => randomBytes(32).toString('hex');
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const adjective = ['Curious', 'Sunny', 'Cosmic', 'Brave', 'Happy', 'Clever', 'Gentle', 'Mighty'];
const animal = ['Otter', 'Panda', 'Fox', 'Owl', 'Koala', 'Robin', 'Badger', 'Gecko'];

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
  create(quiz: Quiz, mode: Mode, approval: boolean, leaderboard: boolean) {
    this.tick();
    if (this.rooms.size >= this.limits.rooms) return fail('This instance is at its room capacity. Please try again later.');
    let pin: string;
    do { pin = String(randomInt(100000, 1000000)); } while (this.rooms.has(pin));
    const token = secret();
    const room: Room = {
      pin, hostHash: hash(token), quiz: structuredClone(quiz), mode, approval, leaderboard,
      phase: 'lobby', locked: false, index: -1, seq: 0, players: [], deadline: null,
      remaining: null, elapsed: 0, startedAt: null, requests: [],
      expires: Date.now() + this.limits.retentionMs,
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
    if (!player || player.removed) return fail('Your player session is no longer available.');
    return { room, role: 'player', player };
  }
  private open(room: Room, now: number) {
    room.index++;
    room.phase = 'question';
    room.elapsed = 0; room.remaining = null; room.startedAt = now;
    room.deadline = now + room.quiz.questions[room.index].seconds * 1000;
  }
  private close(room: Room) {
    room.phase = 'reveal'; room.deadline = null; room.remaining = null; room.startedAt = null;
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
    if (previous) return fail('Your answer has already been recorded.');
    if (new Set(request.selected).size !== request.selected.length || request.selected.some(n => n < 0 || n >= question.options.length)
      || !request.selected.length || (question.type !== 'multiple' && request.selected.length !== 1)) return fail('Choose a valid answer.');
    const elapsed = room.elapsed + now - room.startedAt!;
    player.answers[question.id] = {
      requestId: request.requestId, selected: [...request.selected], receivedAt: now,
      credit: creditFor(question, request.selected), points: pointsFor(question, request.selected, room.mode, elapsed),
    };
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
  snapshot(credentials: Credentials): Snapshot {
    const { room, role, player } = this.authorize(credentials);
    const active = room.players.filter(p => !p.removed && p.approved);
    const revealed = room.phase !== 'lobby' && room.phase !== 'question';
    const completed = room.quiz.questions.slice(0, room.index + (revealed ? 1 : 0));
    // During a question, current points are private even if an answer was correct.
    const totals = new Map(active.map(p => [p.id, completed.reduce((sum, q) => sum + (p.answers[q.id]?.points || 0), 0)]));
    const sorted = [...active].sort((a, b) => totals.get(b.id)! - totals.get(a.id)! || a.name.localeCompare(b.name));
    const publicPlayer = (p: Player): PublicPlayer => ({
      id: p.id, name: p.name, approved: p.approved,
      score: room.leaderboard || role === 'host' || p.id === player?.id ? totals.get(p.id) || 0 : 0,
      rank: room.leaderboard || role === 'host' || p.id === player?.id ? 1 + sorted.filter(other => totals.get(other.id)! > (totals.get(p.id) || 0)).length : 0,
    });
    const question = room.quiz.questions[room.index];
    const current = player && question ? player.answers[question.id] : undefined;
    const accuracy = active.reduce((sum, p) => sum + completed.reduce((n, q) => n + (p.answers[q.id]?.credit || 0), 0), 0);
    const denominator = active.length * completed.length;
    const snapshot: Snapshot = {
      pin: room.pin, title: room.quiz.title, seq: room.seq, phase: room.phase, mode: room.mode,
      approval: room.approval, locked: room.locked, leaderboard: room.leaderboard, index: room.index,
      total: room.quiz.questions.length, deadline: room.deadline, remaining: room.remaining,
      paused: room.remaining !== null, players: [], playerCount: active.length,
      answered: question ? active.filter(p => p.answers[question.id]).length : 0,
      classScore: denominator ? Math.round(100 * accuracy / denominator) : 0, serverTime: Date.now(),
    };
    if (role === 'host') snapshot.players = [...sorted, ...room.players.filter(p => !p.approved && !p.removed)].map(publicPlayer);
    else if (room.phase === 'lobby' || room.leaderboard && revealed) snapshot.players = sorted.map(publicPlayer);
    if (question && (!player || player.approved)) {
      const { correct, explanation, revealImage, ...publicQuestion } = question;
      snapshot.question = revealed ? { ...publicQuestion, correct, explanation, revealImage } : publicQuestion;
      if (revealed) snapshot.distribution = question.options.map((_, i) => active.filter(p => p.answers[question.id]?.selected.includes(i)).length);
    }
    if (player) {
      snapshot.me = { ...publicPlayer(player), selected: current?.selected };
      if (revealed && current) { snapshot.me.points = current.points; snapshot.me.credit = current.credit; }
      if (room.phase === 'finished') snapshot.review = room.quiz.questions.map(q => ({ question: q, selected: player.answers[q.id]?.selected || [], points: player.answers[q.id]?.points || 0, credit: player.answers[q.id]?.credit || 0 }));
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
    const rows: unknown[][] = [['Nickname', 'Total score', ...room.quiz.questions.map(q => q.text)]];
    for (const p of room.players.filter(p => !p.removed && p.approved))
      rows.push([p.name, Object.values(p.answers).reduce((sum, answer) => sum + answer.points, 0), ...room.quiz.questions.map(q => p.answers[q.id]?.points || 0)]);
    return '\ufeff' + rows.map(row => row.map(escape).join(',')).join('\r\n');
  }
}
