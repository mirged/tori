import { useEffect, useMemo, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import QRCode from 'qrcode';
import { READY_MS, teamNames, type Ack, type Action, type AnswerRequest, type Credentials, type Quiz, type Review, type Role, type Snapshot } from '../../../packages/shared/src/protocol';
import { Brand, Icon, Shape, shapeNames } from './icons';
import { download, errorText, rules, uid } from './lib';
import { HostModal, Modal, navigate } from './App';

const ordinal = (n: number) => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
const typeLabel = { single: 'Quiz', boolean: 'True or false', multiple: 'Select all that apply', poll: 'Poll', text: 'Type answer', order: 'Puzzle' } as const;
const choiceLike = (type: string) => type === 'single' || type === 'boolean' || type === 'multiple' || type === 'poll';
const gapText = (gap: { name: string; points: number; ahead: boolean }) => gap.ahead ? `${gap.points.toLocaleString()} points behind ${gap.name}` : `${gap.points.toLocaleString()} points ahead of ${gap.name}`;
const isLocalHost = (host: string) => host === 'localhost' || host.startsWith('127.') || host === '[::1]';
const stored = (key: string, fallback: string) => { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } };
const remember = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* optional preference */ } };

function Confetti() {
  const pieces = useMemo(() => Array.from({ length: 60 }, (_, i) => ({
    left: Math.random() * 100, delay: Math.random() * 3, duration: 3 + Math.random() * 3, rotate: Math.random() * 360, color: i % 5, size: 8 + Math.random() * 8,
  })), []);
  return <div className="confetti" aria-hidden="true">{pieces.map((p, i) => <span key={i} className={`c-${p.color}`} style={{ left: `${p.left}%`, animationDelay: `${p.delay}s`, animationDuration: `${p.duration}s`, width: p.size, height: p.size * .45, transform: `rotate(${p.rotate}deg)` }} />)}</div>;
}
function TimerRing({ seconds, remaining, total, paused }: { seconds: number; remaining: number; total: number; paused: boolean }) {
  const fraction = Math.max(0, Math.min(1, remaining / (total * 1000)));
  return <div className={`timer-ring ${seconds <= 5 ? 'urgent' : ''}`} role="timer" aria-label={paused ? 'Timer paused' : `${seconds} seconds remaining`}>
    <svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="44" className="ring-bg" /><circle cx="50" cy="50" r="44" className="ring-fg" pathLength={1} strokeDasharray="1" strokeDashoffset={1 - fraction} /></svg>
    <span>{paused ? <Icon name="pause" size={30} /> : seconds}</span>
  </div>;
}
function ClassScore({ score }: { score: number }) {
  return <div className="class-score"><span>Class accuracy</span><strong>{score}%</strong><div className="class-meter"><span style={{ width: `${score}%` }} /></div><p>Every bit of knowledge adds up.</p></div>;
}
/** What the player answered and what was right, in words, for any question type. */
function describe(item: Pick<Review, 'question' | 'selected' | 'text'>) {
  const { question: q } = item;
  const yours = q.type === 'text' ? item.text || '' : q.type === 'order' ? item.selected.map(n => q.options[n]).join(' → ') : item.selected.map(n => q.options[n]).join(', ');
  const right = q.type === 'text' ? q.options.join(' / ') : q.type === 'order' ? q.options.join(' → ') : q.type === 'poll' ? '' : q.correct.map(n => q.options[n]).join(', ');
  return { yours, right };
}

export function Game({ pin, role }: { pin: string; role: Role }) {
  const isHost = role === 'host'; const isPlayer = role === 'player'; const isScreen = !isPlayer;
  const [state, setState] = useState<Snapshot | null>(null);
  const [connected, setConnected] = useState(false); const [fatal, setFatal] = useState(''); const [error, setError] = useState('');
  const [busy, setBusy] = useState(false); const [selected, setSelected] = useState<number[]>([]); const [typed, setTyped] = useState(''); const [answerBusy, setAnswerBusy] = useState(false);
  const [now, setNow] = useState(Date.now()); const [offset, setOffset] = useState(0); const [qr, setQr] = useState(''); const [bigQr, setBigQr] = useState(false);
  const [deleting, setDeleting] = useState(false); const [showRules, setShowRules] = useState(false); const [replay, setReplay] = useState<Quiz | null>(null);
  const [musicOn, setMusicOn] = useState(() => stored('tori.music', String(isScreen)) === 'true');
  const [sfxOn, setSfxOn] = useState(() => stored(isPlayer ? 'tori.sfx.player' : 'tori.sfx', String(isScreen)) === 'true');
  const [volume, setVolume] = useState(() => Math.min(1, Math.max(0, Number(stored('tori.volume', '.8')) || 0)));
  const [soundMenu, setSoundMenu] = useState(false);
  const [reduced, setReduced] = useState(() => stored('tori.reduced', 'false') === 'true');
  const [fullscreen, setFullscreen] = useState(false); const [copied, setCopied] = useState(false); const [kickPrompt, setKickPrompt] = useState('');
  const [info, setInfo] = useState<{ publicUrl: string | null; lan: string[] } | null>(null);
  const socketRef = useRef<Socket | null>(null); const questionRef = useRef(''); const pendingRef = useRef<AnswerRequest | null>(null); const audio = useRef<AudioContext | null>(null); const previousPhase = useRef(''); const lastTick = useRef(0); const inFlight = useRef(false);
  // Phones must reach the join link: prefer the configured public URL, then the LAN address when hosting from localhost.
  const local = isLocalHost(location.hostname);
  const joinBase = info?.publicUrl || (local && info?.lan[0]) || location.origin;
  const joinUrl = `${joinBase}/join?pin=${pin}`;
  const joinHost = joinBase.replace(/^https?:\/\//, '');
  useEffect(() => { if (isScreen) fetch('/api/info').then(r => r.json()).then(setInfo).catch(() => {}); }, [isScreen]);
  useEffect(() => {
    let token: string | undefined;
    try { token = role === 'projector' ? undefined : localStorage.getItem(`tori.${role}.${pin}`) || undefined; } catch { setFatal('Browser storage is unavailable. Reopen this game in the browser where you joined.'); return; }
    if (role !== 'projector' && !token) { setFatal(`This browser doesn’t have the private ${role} credential for this game.`); return; }
    const fail = (message: string) => {
      // A kicked player cannot simply rejoin this game from the same browser.
      if (/removed from this game/.test(message)) remember(`tori.kicked.${pin}`, '1');
      setFatal(message);
    };
    const credentials: Credentials = { pin, role, token };
    const socket = io({ auth: credentials, reconnection: true, reconnectionDelay: 500, reconnectionDelayMax: 5000 }); socketRef.current = socket;
    socket.on('connect', () => { setConnected(true); setFatal(''); });
    socket.on('disconnect', reason => { setConnected(false); if (reason === 'io server disconnect') setFatal(prior => prior || 'This game session is no longer available.'); });
    socket.on('connect_error', error => {
      setConnected(false);
      if (error.message !== 'xhr poll error' && error.message !== 'websocket error' && error.message !== 'timeout') fail(error.message);
    });
    socket.on('unavailable', message => { fail(String(message)); });
    socket.on('snapshot', (snapshot: Snapshot) => {
      setState(snapshot); setOffset(snapshot.serverTime - Date.now());
      const id = snapshot.question?.id || '';
      if (id !== questionRef.current) {
        questionRef.current = id; inFlight.current = false; setSelected(snapshot.me?.selected || []); setTyped(''); setAnswerBusy(false); setError(''); pendingRef.current = null;
      }
      if (snapshot.me?.selected) { setSelected(snapshot.me.selected); setAnswerBusy(false); pendingRef.current = null; }
    });
    return () => { socket.disconnect(); socketRef.current = null; };
  }, [pin, role]);
  useEffect(() => { let cancelled = false; QRCode.toDataURL(joinUrl, { width: 480, margin: 1, color: { dark: '#25076b', light: '#ffffff' } }).then(value => { if (!cancelled) setQr(value); }).catch(() => {}); return () => { cancelled = true; }; }, [joinUrl]);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 100); return () => clearInterval(timer); }, []);
  useEffect(() => { document.documentElement.classList.toggle('reduce-motion', reduced); remember('tori.reduced', String(reduced)); return () => document.documentElement.classList.remove('reduce-motion'); }, [reduced]);
  useEffect(() => { const handler = () => setFullscreen(!!document.fullscreenElement); document.addEventListener('fullscreenchange', handler); return () => document.removeEventListener('fullscreenchange', handler); }, []);
  useEffect(() => { if (!kickPrompt) return; const timer = setTimeout(() => setKickPrompt(''), 8000); return () => clearTimeout(timer); }, [kickPrompt]);
  useEffect(() => { remember('tori.music', String(musicOn)); remember(isPlayer ? 'tori.sfx.player' : 'tori.sfx', String(sfxOn)); remember('tori.volume', String(volume)); }, [musicOn, sfxOn, volume, isPlayer]);
  function tone(notes: number[], step = .12, level = .04) {
    if (!sfxOn || !volume) return;
    try { audio.current ||= new AudioContext(); } catch { return; }
    const context = audio.current; if (context.state === 'suspended') void context.resume().catch(() => {});
    notes.forEach((frequency, i) => {
      const oscillator = context.createOscillator(); const gain = context.createGain(); oscillator.type = 'triangle'; oscillator.connect(gain); gain.connect(context.destination);
      const start = context.currentTime + i * step; oscillator.frequency.setValueAtTime(frequency, start);
      gain.gain.setValueAtTime(level * volume * 1.25, start); gain.gain.exponentialRampToValueAtTime(.001, start + step * 2.2); oscillator.start(start); oscillator.stop(start + step * 2.2);
    });
  }
  useEffect(() => {
    if (state?.phase === 'reveal' && previousPhase.current === 'question') {
      if (isPlayer && state.me?.selected && state.question?.type !== 'poll') tone(state.me.credit === 1 ? [523.25, 659.25, 783.99, 1046.5] : (state.me.credit || 0) > 0 ? [523.25, 659.25] : [392, 311.13]);
      else tone([523.25, 659.25]);
    }
    if (state?.phase === 'finished' && previousPhase.current && previousPhase.current !== 'finished') tone([523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5], .14);
    previousPhase.current = state?.phase || '';
  }, [state?.phase, sfxOn]);
  useEffect(() => () => { void audio.current?.close(); }, []);
  const remaining = state?.remaining ?? (state?.deadline ? Math.max(0, state.deadline - now - offset) : 0);
  const seconds = Math.min(Math.ceil(remaining / 1000), state?.question?.seconds ?? Infinity);
  const opensIn = state?.phase === 'question' && state.opensAt && !state.paused ? state.opensAt - (now + offset) : 0;
  const ready = opensIn > 0;
  // Background music plays on the shared screen only, like a game show: lobby theme, then a countdown during questions.
  const music = useRef<{ lobby: HTMLAudioElement; countdown: HTMLAudioElement } | null>(null); const musicQuestion = useRef('');
  const [musicBlocked, setMusicBlocked] = useState(false);
  useEffect(() => {
    if (isPlayer) return;
    const track = (name: string) => { const element = new Audio(`/audio/${encodeURIComponent(name)}`); element.loop = true; element.preload = 'auto'; return element; };
    music.current = { lobby: track('Tori Theme (Lobby Mix).mp3'), countdown: track('Creepy Countdown.mp3') };
    return () => { music.current?.lobby.pause(); music.current?.countdown.pause(); music.current = null; };
  }, [isPlayer]);
  useEffect(() => { if (music.current) { music.current.lobby.volume = .5 * volume; music.current.countdown.volume = .55 * volume; } }, [volume, isPlayer]);
  useEffect(() => {
    const tracks = music.current; if (!tracks) return;
    const phase = state?.phase; const questionId = state?.question?.id || '';
    const wanted = !musicOn || !volume || fatal ? null : phase === 'lobby' || phase === 'finished' ? tracks.lobby : phase === 'question' && !state?.paused && !ready ? tracks.countdown : null;
    if (phase === 'question' && questionId !== musicQuestion.current) { musicQuestion.current = questionId; tracks.countdown.currentTime = 0; }
    for (const element of [tracks.lobby, tracks.countdown]) if (element !== wanted) element.pause();
    if (wanted && wanted.paused) wanted.play().then(() => setMusicBlocked(false)).catch(() => setMusicBlocked(true));
  }, [state?.phase, state?.paused, state?.question?.id, musicOn, volume, fatal, musicBlocked, ready]);
  useEffect(() => {
    // Browsers block autoplay until the page is touched; retry on the first interaction.
    if (!musicBlocked) return;
    const retry = () => { void audio.current?.resume().catch(() => {}); setMusicBlocked(false); };
    window.addEventListener('pointerdown', retry, { once: true }); window.addEventListener('keydown', retry, { once: true });
    return () => { window.removeEventListener('pointerdown', retry); window.removeEventListener('keydown', retry); };
  }, [musicBlocked]);
  useEffect(() => {
    // Gentle countdown ticks on the shared screen during the final seconds.
    if (!isScreen || state?.phase !== 'question' || state.paused || ready || seconds > 5 || seconds < 1 || lastTick.current === seconds) return;
    lastTick.current = seconds; tone([880], .05, .025);
  }, [seconds]);
  const accepted = state?.me?.selected !== undefined;
  const canAnswer = connected && isPlayer && state?.phase === 'question' && !state.paused && !ready && seconds > 0 && !accepted && !answerBusy && !!state.me?.approved;
  async function submit(picked = selected, text?: string) {
    const q = state?.question;
    if (!canAnswer || !q || inFlight.current) return;
    if (q.type === 'text' ? !(text ?? typed).trim() : q.type === 'order' ? picked.length !== q.options.length : !picked.length) return;
    inFlight.current = true;
    const request = pendingRef.current || { requestId: uid(), questionId: q.id, selected: q.type === 'text' ? [] : [...picked], ...(q.type === 'text' ? { text: (text ?? typed).trim() } : {}) };
    pendingRef.current = request; setAnswerBusy(true); setError('');
    socketRef.current?.timeout(6000).emit('answer', request, (timeout: Error | null, reply: Ack) => {
      inFlight.current = false;
      if (questionRef.current !== request.questionId) return;
      setAnswerBusy(false);
      if (timeout) { setError('No acknowledgement yet. Retry to check the same answer safely.'); return; }
      if (!reply?.ok) { setError(reply && !reply.ok ? reply.error : 'Your answer could not be confirmed.'); pendingRef.current = null; }
    });
  }
  const choose = (i: number) => {
    if (!canAnswer || pendingRef.current || inFlight.current) return;
    const type = state?.question?.type;
    // Single-answer questions lock in on the first tap, like a buzzer. Puzzles are numbered in tap order.
    if (type === 'single' || type === 'boolean' || type === 'poll') { setSelected([i]); void submit([i]); return; }
    setSelected(prev => prev.includes(i) ? prev.filter(n => n !== i) : [...prev, i]);
  };
  function action(type: Action['type'], playerId?: string, after?: () => void) {
    if (!connected || !state || busy) return;
    setBusy(true); setError('');
    socketRef.current?.timeout(6000).emit('action', { requestId: uid(), seq: state.seq, type, playerId }, (timeout: Error | null, reply: Ack) => {
      setBusy(false);
      if (timeout) setError('The action was not confirmed. Check the updated screen before trying again.');
      else if (!reply?.ok) setError(reply && !reply.ok ? reply.error : 'The action could not be completed.');
      else after?.();
    });
  }
  const primary: { type: Action['type']; label: string } | null = !isHost || !state ? null
    : state.phase === 'lobby' ? (state.playerCount ? { type: 'start', label: 'Start' } : null)
    : state.phase === 'question' ? (ready ? null : { type: 'close', label: 'Skip' })
    : state.phase === 'reveal' ? { type: 'next', label: 'Next' }
    : state.phase === 'standings' ? { type: 'next', label: state.index + 1 === state.total ? 'Podium' : 'Next' } : null;
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A', 'SUMMARY'].includes((event.target as HTMLElement)?.tagName) || document.querySelector('[role="dialog"]')) return;
      if (isPlayer) {
        const n = Number(event.key) - 1;
        if (n >= 0 && n < (state?.question?.options.length || 0) && state?.question?.type !== 'text') { event.preventDefault(); choose(n); }
        if (event.key === 'Enter') { event.preventDefault(); void submit(); }
      } else {
        if ((event.key === ' ' || event.key === 'Enter') && primary && !busy) { event.preventDefault(); action(primary.type); }
        if (event.key === 'f') toggleFullscreen();
      }
    };
    window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler);
  });
  async function exportResults() {
    try {
      const token = localStorage.getItem(`tori.host.${pin}`);
      const response = await fetch(`/api/rooms/${pin}/results.csv`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error((await response.json()).error);
      download(await response.blob(), `tori-${pin}-results.csv`, 'text/csv');
    } catch (error) { setError(errorText(error)); }
  }
  async function unlockAudio() { try { audio.current ||= new AudioContext(); await audio.current.resume(); } catch { /* sound unavailable */ } }
  function toggleFullscreen() {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void document.documentElement.requestFullscreen?.().catch(() => setError('Fullscreen is unavailable in this browser.'));
  }
  function copyLink() {
    const done = () => { setCopied(true); setTimeout(() => setCopied(false), 1800); };
    if (navigator.clipboard) navigator.clipboard.writeText(joinUrl).then(done).catch(() => setError(`Copy this link: ${joinUrl}`));
    else setError(`Copy this link: ${joinUrl}`);
  }
  const controlsDisabled = busy || !connected;
  const ranked = (state?.players || []).filter(p => p.approved);
  const teamMode = !!state?.options.teams;
  const soundOn = isPlayer ? sfxOn : musicOn || sfxOn;
  const toolbar = <div className="game-tools">
    <span className={`conn-dot ${connected ? 'online' : ''}`} role="status" title={connected ? 'Connected' : 'Reconnecting'}><span className="sr-only">{connected ? 'Connected' : fatal ? 'Disconnected' : 'Reconnecting…'}</span></span>
    {isPlayer ? <button className="tool-btn" onClick={() => { void unlockAudio(); setSfxOn(!sfxOn); }} aria-label={sfxOn ? 'Mute sound effects' : 'Enable sound effects'} aria-pressed={sfxOn} title={sfxOn ? 'Mute' : 'Sound on'}><Icon name={sfxOn ? 'sound' : 'mute'} size={19} /></button>
      : <div className="sound-wrap"><button className="tool-btn" onClick={() => setSoundMenu(!soundMenu)} aria-label="Sound settings" aria-expanded={soundMenu} aria-pressed={soundOn} title="Sound"><Icon name={soundOn && volume ? 'sound' : 'mute'} size={19} /></button>
        {soundMenu && <div className="sound-menu" role="dialog" aria-label="Sound settings">
          <label className="sound-row"><span>Music</span><input type="checkbox" role="switch" className="switch" checked={musicOn} onChange={e => { void unlockAudio(); setMusicOn(e.target.checked); }} /></label>
          <label className="sound-row"><span>Sound effects</span><input type="checkbox" role="switch" className="switch" checked={sfxOn} onChange={e => { void unlockAudio(); setSfxOn(e.target.checked); }} /></label>
          <label className="sound-row volume"><span>Volume <small>{Math.round(volume * 100)}%</small></span><input type="range" min={0} max={1} step={.05} value={volume} onChange={e => setVolume(Number(e.target.value))} /></label>
          <button className="btn white small full" onClick={() => setSoundMenu(false)}>Done</button>
        </div>}
      </div>}
    {isScreen && <button className="tool-btn" onClick={toggleFullscreen} aria-label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'} title="Fullscreen (F)"><Icon name={fullscreen ? 'shrink' : 'expand'} size={19} /></button>}
    <button className="tool-btn" aria-label="Reduce motion" aria-pressed={reduced} onClick={() => setReduced(!reduced)} title="Reduce motion"><Icon name="motion" size={19} /></button>
    <button className="tool-btn" aria-label="Scoring rules" onClick={() => setShowRules(true)} title="Rules"><Icon name="help" size={19} /></button>
    {isHost && state && !fatal && state.phase !== 'finished' && <button className="tool-btn danger-tool" aria-label="End game" title="End game" onClick={() => setDeleting(true)}><Icon name="close" size={19} /></button>}
  </div>;
  const hostButton = (label: string, type: Action['type'], extra = '') => <button className={`btn white game-next ${extra}`} disabled={controlsDisabled} onClick={() => action(type)}>{label}<Icon name="arrow" size={18} /></button>;
  const teamBoard = (s: Snapshot) => s.teams && <ol className="team-board">{s.teams.map((team, i) => <li key={team.id} className={`ans-${team.id}`} style={{ animationDelay: `${i * 90}ms` }}><span className="team-rank">{team.rank}</span><strong>Team {team.name}</strong><small>{team.members} {team.members === 1 ? 'player' : 'players'}</small><span>{team.score.toLocaleString()}</span></li>)}</ol>;

  function screenView(s: Snapshot) {
    const q = s.question;
    if (s.phase === 'lobby') return <div className="lobby">
      <section className="lobby-banner">
        <div className="lobby-join"><span>Join at <strong>{joinHost}/join</strong></span><button className="copy-link" onClick={copyLink}><Icon name={copied ? 'check' : 'link'} size={15} />{copied ? 'Copied!' : 'Copy link'}</button>
          {local && info && !info.publicUrl && !info.lan.length && <small className="lan-warning"><Icon name="warning" size={13} />Phones can’t reach “localhost”. Open Tori with this computer’s network address.</small>}</div>
        <div className="lobby-pin"><span>Game PIN:</span><strong aria-label={`Game PIN ${pin.split('').join(' ')}`}>{pin.slice(0, 3)} {pin.slice(3)}</strong></div>
        {qr && <button className="lobby-qr" onClick={() => setBigQr(true)} aria-label="Enlarge QR code"><img src={qr} alt={`QR code to join game ${pin}`} /></button>}
      </section>
      <div className="lobby-row">
        <div className="lobby-count"><Icon name="people" size={24} /><strong>{s.playerCount}</strong><span className="hide-mobile">{s.playerCount === 1 ? 'player' : 'players'}</span></div>
        <div className="lobby-brand"><Brand light /></div>
        {isHost ? <div className="lobby-actions">
          <button className={`tool-btn big ${s.locked ? 'on' : ''}`} disabled={controlsDisabled} onClick={() => action('lock')} aria-label={s.locked ? 'Unlock lobby' : 'Lock lobby'} title={s.locked ? 'Unlock lobby' : 'Lock lobby'}><Icon name={s.locked ? 'lock' : 'unlock'} size={20} /></button>
          <a className="tool-btn big" href={`/projector/${pin}`} target="_blank" rel="noreferrer" aria-label="Open projector view" title="Projector view"><Icon name="monitor" size={20} /></a>
          <button className="btn white game-next" disabled={controlsDisabled || !s.playerCount} onClick={() => action('start')}>Start</button>
        </div> : <div className="lobby-actions" />}
      </div>
      {s.locked && <p className="lobby-locked"><Icon name="lock" size={16} />Lobby locked — no new players can join</p>}
      {s.players.length === 0 ? <div className="lobby-waiting"><span className="waiting-pill">Waiting for players…</span></div>
        : <div className="name-cloud">{s.players.map(p => <div key={p.id} className={`name-tile ${!p.approved ? 'pending' : ''}`}>
          {isHost ? <>{!p.approved && <button className="name-approve" aria-label={`Approve ${p.name}`} disabled={controlsDisabled} onClick={() => action('approve', p.id)}><Icon name="check" size={16} /></button>}<button className="name-kick" aria-label={`Remove ${p.name}`} title="Remove player" disabled={controlsDisabled} onClick={() => action('remove', p.id, () => { if (!s.locked) setKickPrompt(p.name); })}><span>{p.name}</span><Icon name="close" size={14} /></button></> : <span>{p.name}</span>}
        </div>)}</div>}
      <p className="lobby-mode"><Icon name={s.mode === 'accuracy' ? 'leaf' : 'spark'} size={16} />{s.mode === 'accuracy' ? 'Accuracy mode' : 'Classic mode'} · {s.total} questions{teamMode && ' · Team mode — teams are drawn at the start'}{isHost && <span className="hide-mobile"> · Press Space to start</span>}</p>
    </div>;
    if (s.phase === 'question' && q && ready) return <div className="get-ready">
      <span className="type-chip">Question {s.index + 1} of {s.total} · {typeLabel[q.type]}{q.points === 'double' ? ' · Double points!' : q.points === 'none' ? ' · No points' : ''}</span>
      <h1 className="ready-question">{q.text}</h1>
      <div className="ready-bar"><span style={{ width: `${Math.max(0, Math.min(100, opensIn / READY_MS * 100))}%` }} /></div>
    </div>;
    if ((s.phase === 'question' || s.phase === 'reveal') && q) {
      const reveal = s.phase === 'reveal'; const max = Math.max(1, ...(s.distribution || [0]));
      const graded = q.type !== 'poll'; const right = (i: number) => graded && !!q.correct?.includes(i);
      const center = reveal
        ? choiceLike(q.type) ? <div className="bars" role="img" aria-label={`Answers: ${q.options.map((o, i) => `${o} ${s.distribution?.[i] || 0}`).join(', ')}`}>{q.options.map((_, i) => <div key={i} className={`bar ans-${i} ${!graded ? '' : right(i) ? 'right' : 'wrong'}`}><span className="bar-count">{s.distribution?.[i] || 0}</span><span className="bar-fill" style={{ height: `${Math.max(4, (s.distribution?.[i] || 0) / max * 100)}%` }} /><span className="bar-label"><Shape index={i} size={20} />{right(i) && <Icon name="check" size={20} />}</span></div>)}</div>
          : <div className="big-stat"><strong>{s.distribution?.[0] || 0}<small> / {s.answered}</small></strong><span>{q.type === 'text' ? 'typed a correct answer' : 'got the perfect order'}</span></div>
        : q.image ? <img className="stage-image" src={q.image} alt="Question illustration" /> : <div className="stage-placeholder" aria-hidden="true"><Shape index={s.index % 4} size={90} /></div>;
      const tiles = q.type === 'text'
        ? <div className="play-grid count-1">{reveal ? q.options.map((option, i) => <div key={i} className="play-tile accepted right"><Icon name="check" size={30} /><span>{option}</span></div>) : <div className="play-tile type-tile"><Icon name="edit" size={30} /><span>Type your answer on your device</span></div>}</div>
        : q.type === 'order'
          ? <div className={`play-grid order-grid count-${q.options.length}`}>{q.options.map((option, i) => <div key={i} className={`play-tile ans-${i}`}>{reveal ? <strong className="order-num">{i + 1}</strong> : <Shape index={i} size={34} />}<span>{option}</span></div>)}</div>
          : <div className={`play-grid count-${q.options.length}`}>{q.options.map((option, i) => <div key={i} className={`play-tile ans-${i} ${reveal && graded ? right(i) ? 'right' : 'wrong' : ''}`}><Shape index={i} size={34} /><span>{option}</span>{reveal && graded && (right(i) ? <Icon name="check" size={30} /> : <Icon name="close" size={26} />)}</div>)}</div>;
      return <div className={`stage ${reveal ? 'revealed' : ''}`}>
        <h1 className="stage-question" key={q.id}>{q.text}</h1>
        {!reveal && <div className="answer-progress" role="progressbar" aria-label="Answers in" aria-valuemin={0} aria-valuemax={s.playerCount} aria-valuenow={s.answered}><span style={{ width: `${s.playerCount ? s.answered / s.playerCount * 100 : 0}%` }} /></div>}
        <div className="stage-middle">
          <div className="stage-side">{!reveal ? <TimerRing seconds={seconds} remaining={remaining} total={q.seconds} paused={s.paused} /> : <span className="type-chip">{typeLabel[q.type]}{q.points === 'double' ? ' · 2×' : ''}</span>}</div>
          <div className="stage-center">{center}</div>
          <div className="stage-side right">{!reveal ? <div className="answer-count"><strong>{s.answered}</strong><span>of {s.playerCount} answered</span></div> : isHost && graded && <div className="answer-count small"><strong>{s.classScore}%</strong><span>class accuracy</span></div>}
            {isHost && (reveal ? hostButton('Next', 'next') : <div className="stage-controls"><button className="btn white small" disabled={controlsDisabled} onClick={() => action(s.paused ? 'resume' : 'pause')}><Icon name={s.paused ? 'play' : 'pause'} size={16} />{s.paused ? 'Resume' : 'Pause'}</button>{hostButton('Skip', 'close', 'small')}</div>)}
          </div>
        </div>
        {reveal && (q.explanation || q.revealImage) && <div className="stage-explanation">{q.revealImage && <img src={q.revealImage} alt="Reveal" />}{q.explanation && <p><Icon name="spark" size={18} />{q.explanation}</p>}</div>}
        {tiles}
      </div>;
    }
    if (s.phase === 'standings') return <div className="scoreboard">
      <h1 className="pill-title">Scoreboard</h1>
      {s.leaderboard ? <>{teamBoard(s)}<ol className={`score-list ${teamMode ? 'compact' : ''}`}>{ranked.slice(0, teamMode ? 3 : 5).map((p, i) => <li key={p.id} style={{ animationDelay: `${i * 80}ms` }}><span className="score-rank">{p.rank}</span><strong>{p.name}</strong>{p.team !== undefined && <span className={`team-dot ans-${p.team}`} title={`Team ${teamNames[p.team]}`} />}<span>{p.score.toLocaleString()}</span></li>)}</ol></>
        : <ClassScore score={s.classScore} />}
      <div className="scoreboard-foot"><span className="type-chip">Question {s.index + 1} of {s.total} · class accuracy {s.classScore}%</span>{isHost && <div className="stage-controls"><button className="btn ghost-light small" disabled={controlsDisabled} onClick={() => action('leaderboard')}>{s.leaderboard ? 'Hide scores' : 'Show scores'}</button>{hostButton(s.index + 1 === s.total ? 'Podium' : 'Next', 'next')}</div>}</div>
    </div>;
    if (s.phase === 'finished') {
      const entries = teamMode && s.teams?.length ? s.teams.map(t => ({ id: String(t.id), name: `Team ${t.name}`, score: t.score, rank: t.rank, color: t.id })) : ranked.map(p => ({ id: p.id, name: p.name, score: p.score, rank: p.rank, color: -1 }));
      const top = entries.slice(0, 3); const order = [top[1], top[0], top[2]];
      return <div className="podium-screen">
        {!reduced && <Confetti />}
        <h1 className="pill-title">{s.title}</h1>
        {s.leaderboard && top.length ? <div className="podium">{order.map((p, n) => p ? <div key={p.id} className={`podium-col place-${Math.min(p.rank, 3)} ${p.color >= 0 ? `team ans-${p.color}` : ''}`} style={{ animationDelay: `${[600, 1200, 0][n]}ms` }}><strong className="podium-name">{p.name}</strong><div className="podium-block"><span className="medal">{p.rank}</span><span className="podium-score">{p.score.toLocaleString()}</span></div></div> : <div key={n} className="podium-col empty" />)}</div>
          : <ClassScore score={s.classScore} />}
        {teamMode && s.leaderboard && ranked[0] && <p className="mvp"><Icon name="trophy" size={18} />Top player: <strong>{ranked[0].name}</strong> · {ranked[0].score.toLocaleString()}</p>}
        {isHost && <div className="finish-controls">
          <button className="btn white" onClick={() => { if (s.hostQuiz) setReplay(s.hostQuiz); }}><Icon name="play" size={16} />Play again</button>
          <button className="btn ghost-light" onClick={() => void exportResults()}><Icon name="download" size={17} />Download results</button>
          <button className="btn ghost-light" disabled={controlsDisabled} onClick={() => action('leaderboard')}>{s.leaderboard ? 'Hide podium' : 'Show podium'}</button>
          <button className="btn ghost-light danger-light" onClick={() => setDeleting(true)}><Icon name="trash" size={17} />Delete game data</button>
        </div>}
        {isHost && ranked.length > 3 && s.leaderboard && <details className="full-results"><summary>All {ranked.length} players</summary><ol>{ranked.map(p => <li key={p.id}><span>{p.rank}</span><strong>{p.name}</strong>{p.team !== undefined && <small>Team {teamNames[p.team]}</small>}<span>{p.score.toLocaleString()}</span></li>)}</ol></details>}
      </div>;
    }
    return null;
  }

  function playerView(s: Snapshot) {
    const q = s.question; const me = s.me;
    if (!me?.approved) return <div className="player-message"><div className="spinner" /><h1>Almost there!</h1><p>The host is checking nicknames. Sit tight, <strong>{me?.name}</strong>.</p></div>;
    if (s.phase === 'lobby') return <div className="player-message"><h1>You’re in!</h1><p>See your nickname on screen?</p><span className="nick-pill">{me.name}</span>{teamMode && <p className="muted-light">Teams are drawn when the game starts.</p>}</div>;
    const showText = s.options.phoneText || q?.type === 'text' || q?.type === 'order';
    if (s.phase === 'question' && q && ready) return <div className="player-message get-ready-phone">
      <span className="type-chip">Question {s.index + 1} of {s.total}{q.points === 'double' ? ' · Double points!' : ''}</span>
      <h1>Get ready!</h1>
      {showText ? <p className="ready-text">{q.text}</p> : <p>Look at the big screen</p>}
      <div className="ready-bar"><span style={{ width: `${Math.max(0, Math.min(100, opensIn / READY_MS * 100))}%` }} /></div>
    </div>;
    if (s.phase === 'question' && q) {
      if (accepted) return <div className="player-message">
        {q.type === 'text' ? <span className="nick-pill">“{me.text}”</span> : q.type === 'order' ? <Icon name="grip" size={56} /> : <div className="locked-shapes">{(me.selected || []).map(i => <span key={i} className={`mini-tile ans-${i}`}><Shape index={i} size={30} /></span>)}</div>}
        <h1>{q.type === 'poll' ? 'Vote counted!' : 'Answer locked in!'}</h1><p>Waiting for the others…</p><div className="spinner" />
      </div>;
      const head = <div className="pq-head"><span className="type-chip">{typeLabel[q.type]}{q.points === 'double' ? ' · 2×' : ''}</span><span className={`pq-timer ${seconds <= 5 ? 'urgent' : ''}`} role="timer" aria-label={`${seconds} seconds remaining`}>{s.paused ? <Icon name="pause" size={18} /> : seconds}</span></div>;
      const retry = pendingRef.current && <button className="btn white full big submit-answer" disabled={!canAnswer} onClick={() => void submit()}>{answerBusy ? 'Sending…' : 'Retry the same answer'}</button>;
      if (q.type === 'text') return <form className="player-question text-question" onSubmit={e => { e.preventDefault(); void submit(); }}>
        {head}<h1 className="pq-text">{q.text}</h1>
        <label className="sr-only" htmlFor="typed-answer">Your answer</label>
        <input id="typed-answer" className="typed-input" autoFocus autoComplete="off" autoCapitalize="off" spellCheck={false} maxLength={80} placeholder="Type your answer" value={typed} disabled={!canAnswer || !!pendingRef.current} onChange={e => setTyped(e.target.value)} />
        {retry || <button className="btn white full big submit-answer" type="submit" disabled={!canAnswer || !typed.trim()}>{answerBusy ? 'Sending…' : 'Submit'}</button>}
      </form>;
      if (q.type === 'order') return <div className="player-question">
        {head}<h1 className="pq-text">{q.text}</h1>
        <p className="order-help">Tap the items in the right order — tap again to undo.</p>
        <div className="order-list">{q.options.map((option, i) => { const position = selected.indexOf(i); return <button key={i} className={`order-item ans-${i} ${position >= 0 ? 'placed' : ''}`} disabled={!canAnswer || !!pendingRef.current} onClick={() => choose(i)} aria-pressed={position >= 0}>
          <span className="order-badge">{position >= 0 ? position + 1 : <Shape index={i} size={18} />}</span><span className="pt-text">{option}</span></button>; })}</div>
        {retry || <div className="order-actions"><button className="btn ghost-light" disabled={!selected.length || !canAnswer} onClick={() => setSelected([])}>Reset</button><button className="btn white big submit-answer" disabled={!canAnswer || selected.length !== q.options.length} onClick={() => void submit()}>{answerBusy ? 'Sending…' : selected.length === q.options.length ? 'Submit order' : `${q.options.length - selected.length} left`}</button></div>}
      </div>;
      return <div className="player-question">
        {head}
        {showText ? <h1 className="pq-text">{q.text}</h1> : <p className="look-up">Look at the big screen</p>}
        <div className={`player-grid count-${q.options.length} ${showText ? '' : 'shapes-only'}`}>{q.options.map((option, i) => {
          const chosen = selected.includes(i);
          return <button key={i} className={`player-tile ans-${i} ${chosen ? 'chosen' : ''} ${q.type === 'multiple' && selected.length && !chosen ? 'dim' : ''}`} disabled={!canAnswer || !!pendingRef.current} onClick={() => choose(i)} aria-pressed={chosen} aria-label={showText ? `${shapeNames[i]}: ${option}` : shapeNames[i]}>
            <Shape index={i} size={40} />{showText && <span className="pt-text">{option}</span>}{q.type === 'multiple' && <span className="pt-check">{chosen && <Icon name="check" size={20} />}</span>}<kbd className="hide-mobile">{i + 1}</kbd>
          </button>;
        })}</div>
        {q.type === 'multiple' ? retry || <button className="btn white full big submit-answer" disabled={!canAnswer || !selected.length} onClick={() => void submit()}>{answerBusy ? 'Sending…' : selected.length ? `Submit ${selected.length} ${selected.length === 1 ? 'answer' : 'answers'}` : 'Select your answers'}</button> : retry}
      </div>;
    }
    if (s.phase === 'reveal' && q) {
      const credit = me.credit || 0; const answered = me.selected !== undefined;
      if (q.type === 'poll') return <div className="result-screen poll">
        <h1>{answered ? 'Thanks for voting!' : 'Poll closed'}</h1>
        <span className="result-icon"><Icon name="people" size={56} /></span>
        {answered && <p className="result-answer">You voted: <strong>{me.selected?.map(n => q.options[n]).join(', ')}</strong></p>}
        {me.gap && <p className="gap-line">{gapText(me.gap)}</p>}
        {q.revealImage && <img className="result-image" src={q.revealImage} alt="Reveal" />}
        {q.explanation && <p className="result-explanation">{q.explanation}</p>}
      </div>;
      const kind = !answered ? 'timeout' : credit === 1 ? 'correct' : credit > 0 ? 'partial' : 'incorrect';
      const { right } = describe({ question: { ...q, correct: q.correct || [], explanation: q.explanation || '' }, selected: me.selected || [], text: me.text });
      return <div className={`result-screen ${kind}`}>
        <h1>{{ correct: 'Correct', partial: q.type === 'order' ? `${Math.round(credit * q.options.length)} of ${q.options.length} in place` : 'Partly correct', incorrect: 'Incorrect', timeout: 'Time’s up' }[kind]}</h1>
        <span className="result-icon"><Icon name={kind === 'correct' ? 'check' : kind === 'partial' ? 'spark' : kind === 'timeout' ? 'clock' : 'close'} size={56} /></span>
        {answered ? <span className="points-pill">+ {(me.points || 0).toLocaleString()}</span> : <p>No answer this round.</p>}
        {kind === 'correct' && (me.streak || 0) >= 2 && <span className="streak-pill">🔥 Answer streak {me.streak}</span>}
        <p className="result-rank">{me.rank ? `You’re in ${ordinal(me.rank)} place` : ''}{kind === 'incorrect' && <><br />Shake it off — the next one’s yours!</>}</p>
        {me.gap && <p className="gap-line">{gapText(me.gap)}</p>}
        {kind !== 'correct' && right && <p className="result-answer">{q.type === 'text' && me.text ? <>You typed “{me.text}”. </> : null}Correct: <strong>{right}</strong></p>}
        {q.revealImage && <img className="result-image" src={q.revealImage} alt="Reveal" />}
        {q.explanation && <p className="result-explanation">{q.explanation}</p>}
      </div>;
    }
    if (s.phase === 'standings') {
      const myTeam = me.team !== undefined ? s.teams?.find(t => t.id === me.team) : undefined;
      return <div className="player-message">
        <span className="rank-badge">{me.rank ? ordinal(me.rank) : '–'}</span>
        <h1>{me.rank === 1 ? 'You’re in the lead!' : me.rank ? `You’re in ${ordinal(me.rank)} place` : 'Nice work'}</h1>
        {me.gap && <p className="gap-line">{gapText(me.gap)}</p>}
        {(me.streak || 0) >= 2 && <span className="streak-pill">🔥 Answer streak {me.streak}</span>}
        {myTeam && <p className={`team-line ans-${myTeam.id}`}>Team {myTeam.name} is {ordinal(myTeam.rank)} with {myTeam.score.toLocaleString()}</p>}
        <p className="muted-light">Your host will start the next question soon.</p>
      </div>;
    }
    if (s.phase === 'finished') {
      const myTeam = me.team !== undefined ? s.teams?.find(t => t.id === me.team) : undefined;
      return <div className="player-final">
        {!reduced && me.rank > 0 && me.rank <= 3 && <Confetti />}
        <span className={`rank-badge place-${Math.min(me.rank || 4, 4)}`}>{me.rank ? ordinal(me.rank) : '–'}</span>
        <h1>{me.rank === 1 ? 'Winner winner!' : me.rank && me.rank <= 3 ? 'On the podium!' : 'What a game!'}</h1>
        <p>{me.score.toLocaleString()} points · class accuracy {s.classScore}%</p>
        {me.gap && <p className="gap-line">{gapText(me.gap)}</p>}
        {myTeam && <p className={`team-line ans-${myTeam.id}`}>Team {myTeam.name} finished {ordinal(myTeam.rank)}</p>}
        {s.review && <section className="review"><h2>Your answers</h2>{s.review.map((item, i) => { const { yours, right } = describe(item); return <details key={item.question.id}><summary><span className={`review-mark ${item.question.type === 'poll' ? 'poll' : item.credit === 1 ? 'correct' : item.credit > 0 ? 'partial' : ''}`}><Icon name={item.question.type === 'poll' ? 'people' : item.credit === 1 ? 'check' : item.credit > 0 ? 'spark' : 'close'} size={15} /></span><strong>{i + 1}. {item.question.text}</strong><span>{item.points}</span></summary><div><p><strong>{item.question.type === 'poll' ? 'Your vote' : 'Your answer'}:</strong> {yours || 'No answer'}</p>{right && <p><strong>Correct:</strong> {right}</p>}{item.question.explanation && <p>{item.question.explanation}</p>}</div></details>; })}</section>}
        <button className="btn white" onClick={() => navigate('/join')}>Play another game</button>
      </div>;
    }
    return null;
  }

  const kicked = /removed from this game/.test(fatal);
  return <div className={`game-shell role-${role} phase-${state?.phase || 'loading'}${ready ? ' is-ready' : ''}`}>
    <div className="bg-shapes" aria-hidden="true">{[0, 1, 2, 3, 0, 2].map((s, i) => <span key={i} className={`bgs bgs-${i}`}><Shape index={s} size={120} /></span>)}</div>
    <header className="game-topbar">
      <div className="gt-left">{isPlayer ? <span className="gt-pin">PIN {pin}</span> : <a href="/home" onClick={e => { e.preventDefault(); navigate('/home'); }} aria-label="Tori home"><Brand light /></a>}</div>
      <span className="gt-center">{state && state.phase !== 'lobby' && state.phase !== 'finished' ? `${state.index + 1} of ${state.total}` : isScreen ? state?.title : ''}</span>
      {toolbar}
    </header>
    {fatal ? <main className="player-message"><Icon name="warning" size={44} /><h1>{kicked ? 'You were removed' : 'Let’s find your way back.'}</h1><p role="alert">{fatal}</p>{!kicked && <p className="muted-light">Game access belongs to the browser where you hosted or joined. Rooms also expire automatically.</p>}<div className="row-actions"><button className="btn white" onClick={() => navigate(isPlayer ? '/join' : '/home')}>Back to Tori</button>{isPlayer && !kicked && <button className="btn ghost-light" onClick={() => { try { localStorage.removeItem(`tori.player.${pin}`); } catch { /* unavailable storage */ } location.href = `/join?pin=${pin}`; }}>Join as a new player</button>}</div></main>
      : !state ? <main className="player-message"><div className="spinner" /><h1>Connecting…</h1><p>Game {pin}. Keep this page open.</p></main>
      : <main className="game-main">
        {(!connected || state.paused) && <div className="status-banner" role="status"><Icon name={!connected ? 'warning' : 'pause'} size={17} />{!connected ? 'Connection lost. Reconnecting — accepted answers are saved.' : 'Paused. The timer is frozen for everyone.'}</div>}
        {isPlayer ? playerView(state) : screenView(state)}
        {error && <p className="game-alert" role="status">{error}{pendingRef.current && isPlayer && <button className="toast-action" onClick={() => void submit()}>Retry</button>}</p>}
        {kickPrompt && state.phase === 'lobby' && !state.locked && <p className="game-alert" role="status">{kickPrompt} was removed. Lock the lobby so they can’t rejoin under a new name?<button className="toast-action" onClick={() => action('lock', undefined, () => setKickPrompt(''))}>Lock</button></p>}
      </main>}
    {musicBlocked && musicOn && <button className="sound-unlock" onClick={() => { void unlockAudio(); setMusicBlocked(false); }} aria-label="Start sound"><span><Icon name="sound" size={44} /><strong>Click to start the sound</strong><small>Your browser needs one click before it plays music.</small></span></button>}
    {isPlayer && state?.me && !fatal && <footer className="player-bar">
      <span className="pb-name"><strong>{state.me.name}</strong>{state.me.gap ? <small>{gapText(state.me.gap)}</small> : state.me.team !== undefined && <small className={`ans-${state.me.team}`}>Team {teamNames[state.me.team]}</small>}</span>
      {state.me.team !== undefined && <span className={`team-dot big ans-${state.me.team}`} title={`Team ${teamNames[state.me.team]}`} />}
      <span className="score-chip">{state.me.score.toLocaleString()}</span>
    </footer>}
    {bigQr && qr && <Modal title={`Scan to join · PIN ${pin}`} onClose={() => setBigQr(false)}><img className="qr-large" src={qr} alt={`QR code to join game ${pin}`} /><p className="center-text">{joinUrl}</p></Modal>}
    {deleting && <Modal title="End and delete this game?" onClose={() => setDeleting(false)}><p>This ends the game for everyone and permanently deletes player names, answers, and scores from the server. Your quiz stays in your library.</p><div className="modal-actions"><button className="btn outline" onClick={() => setDeleting(false)}>Keep playing</button><button className="btn red" disabled={controlsDisabled} onClick={() => { action('delete'); setDeleting(false); }}>Delete game</button></div></Modal>}
    {showRules && <Modal title="How scoring works" onClose={() => setShowRules(false)}><p>{rules}</p><p>Typed answers ignore capitals, accents and punctuation. Puzzles score each item in the right place. Polls give no points. Double-points questions are worth twice as much.</p><p>One final answer per question. Answers are accepted only before the server deadline; refreshes preserve accepted answers. A pause freezes the timer for everyone.</p>{isScreen && <p><strong>Host shortcuts:</strong> Space or Enter continues, F toggles fullscreen.</p>}</Modal>}
    {replay && <HostModal quiz={replay} onClose={() => setReplay(null)} />}
  </div>;
}
