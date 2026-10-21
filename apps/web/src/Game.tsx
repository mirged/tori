import { useEffect, useMemo, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import QRCode from 'qrcode';
import type { Ack, Action, AnswerRequest, Credentials, PublicPlayer, Quiz, Role, Snapshot } from '../../../packages/shared/src/protocol';
import { Brand, Icon, Shape, shapeNames } from './icons';
import { download, errorText, rules, uid } from './lib';
import { HostModal, Modal, navigate } from './App';

const ordinal = (n: number) => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
const typeLabel = { single: 'Quiz', boolean: 'True or false', multiple: 'Select all that apply' } as const;

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

export function Game({ pin, role }: { pin: string; role: Role }) {
  const [state, setState] = useState<Snapshot | null>(null);
  const [connected, setConnected] = useState(false); const [fatal, setFatal] = useState(''); const [error, setError] = useState('');
  const [busy, setBusy] = useState(false); const [selected, setSelected] = useState<number[]>([]); const [answerBusy, setAnswerBusy] = useState(false);
  const [now, setNow] = useState(Date.now()); const [offset, setOffset] = useState(0); const [qr, setQr] = useState(''); const [bigQr, setBigQr] = useState(false);
  const [deleting, setDeleting] = useState(false); const [showRules, setShowRules] = useState(false); const [replay, setReplay] = useState<Quiz | null>(null);
  const [sound, setSound] = useState(() => { try { return (localStorage.getItem('tori.sound') ?? String(role !== 'player')) === 'true'; } catch { return role !== 'player'; } }); const [reduced, setReduced] = useState(() => { try { return localStorage.getItem('tori.reduced') === 'true'; } catch { return false; } });
  const [fullscreen, setFullscreen] = useState(false); const [copied, setCopied] = useState(false);
  const socketRef = useRef<Socket | null>(null); const questionRef = useRef(''); const pendingRef = useRef<AnswerRequest | null>(null); const audio = useRef<AudioContext | null>(null); const previousPhase = useRef(''); const lastTick = useRef(0); const inFlight = useRef(false);
  const joinUrl = `${location.origin}/join?pin=${pin}`;
  const isHost = role === 'host'; const isPlayer = role === 'player'; const isScreen = !isPlayer;
  useEffect(() => {
    let token: string | undefined;
    try { token = role === 'projector' ? undefined : localStorage.getItem(`tori.${role}.${pin}`) || undefined; } catch { setFatal('Browser storage is unavailable. Reopen this game in the browser where you joined.'); return; }
    if (role !== 'projector' && !token) { setFatal(`This browser doesn’t have the private ${role} credential for this game.`); return; }
    const credentials: Credentials = { pin, role, token };
    const socket = io({ auth: credentials, reconnection: true, reconnectionDelay: 500, reconnectionDelayMax: 5000 }); socketRef.current = socket;
    socket.on('connect', () => { setConnected(true); setFatal(''); });
    socket.on('disconnect', reason => { setConnected(false); if (reason === 'io server disconnect') setFatal(prior => prior || 'This game session is no longer available.'); });
    socket.on('connect_error', error => {
      setConnected(false);
      if (error.message !== 'xhr poll error' && error.message !== 'websocket error' && error.message !== 'timeout') setFatal(error.message);
    });
    socket.on('unavailable', message => { setFatal(String(message)); });
    socket.on('snapshot', (snapshot: Snapshot) => {
      setState(snapshot); setOffset(snapshot.serverTime - Date.now());
      const id = snapshot.question?.id || '';
      if (id !== questionRef.current) {
        questionRef.current = id; inFlight.current = false; setSelected(snapshot.me?.selected || []); setAnswerBusy(false); setError(''); pendingRef.current = null;
      }
      if (snapshot.me?.selected) { setSelected(snapshot.me.selected); setAnswerBusy(false); pendingRef.current = null; }
    });
    return () => { socket.disconnect(); socketRef.current = null; };
  }, [pin, role]);
  useEffect(() => { let cancelled = false; QRCode.toDataURL(joinUrl, { width: 480, margin: 1, color: { dark: '#25076b', light: '#ffffff' } }).then(value => { if (!cancelled) setQr(value); }).catch(() => {}); return () => { cancelled = true; }; }, [joinUrl]);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 100); return () => clearInterval(timer); }, []);
  useEffect(() => { document.documentElement.classList.toggle('reduce-motion', reduced); try { localStorage.setItem('tori.reduced', String(reduced)); } catch { /* Optional preference. */ } return () => document.documentElement.classList.remove('reduce-motion'); }, [reduced]);
  useEffect(() => { const handler = () => setFullscreen(!!document.fullscreenElement); document.addEventListener('fullscreenchange', handler); return () => document.removeEventListener('fullscreenchange', handler); }, []);
  function tone(notes: number[], step = .12, volume = .04) {
    if (!sound) return;
    try { audio.current ||= new AudioContext(); } catch { return; }
    const context = audio.current; if (context.state === 'suspended') void context.resume().catch(() => {});
    notes.forEach((frequency, i) => {
      const oscillator = context.createOscillator(); const gain = context.createGain(); oscillator.type = 'triangle'; oscillator.connect(gain); gain.connect(context.destination);
      const start = context.currentTime + i * step; oscillator.frequency.setValueAtTime(frequency, start);
      gain.gain.setValueAtTime(volume, start); gain.gain.exponentialRampToValueAtTime(.001, start + step * 2.2); oscillator.start(start); oscillator.stop(start + step * 2.2);
    });
  }
  useEffect(() => {
    if (state?.phase === 'reveal' && previousPhase.current === 'question') {
      if (isPlayer && state.me?.selected) tone(state.me.credit === 1 ? [523.25, 659.25, 783.99, 1046.5] : (state.me.credit || 0) > 0 ? [523.25, 659.25] : [392, 311.13]);
      else tone([523.25, 659.25]);
    }
    if (state?.phase === 'finished' && previousPhase.current && previousPhase.current !== 'finished') tone([523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5], .14);
    previousPhase.current = state?.phase || '';
  }, [state?.phase, sound]);
  useEffect(() => () => { void audio.current?.close(); }, []);
  useEffect(() => { try { localStorage.setItem('tori.sound', String(sound)); } catch { /* Optional preference. */ } }, [sound]);
  // Background music plays on the shared screen only, like a game show: lobby theme, then a countdown during questions.
  const music = useRef<{ lobby: HTMLAudioElement; countdown: HTMLAudioElement } | null>(null); const musicQuestion = useRef('');
  const [musicBlocked, setMusicBlocked] = useState(false);
  useEffect(() => {
    if (role === 'player') return;
    const track = (name: string, volume: number) => { const element = new Audio(`/audio/${encodeURIComponent(name)}`); element.loop = true; element.volume = volume; element.preload = 'auto'; return element; };
    music.current = { lobby: track('Tori Theme (Lobby Mix).wav', .45), countdown: track('Creepy Countdown.wav', .5) };
    return () => { music.current?.lobby.pause(); music.current?.countdown.pause(); music.current = null; };
  }, [role]);
  useEffect(() => {
    const tracks = music.current; if (!tracks) return;
    const phase = state?.phase; const questionId = state?.question?.id || '';
    const wanted = !sound || fatal ? null : phase === 'lobby' || phase === 'finished' ? tracks.lobby : phase === 'question' && !state?.paused ? tracks.countdown : null;
    if (phase === 'question' && questionId !== musicQuestion.current) { musicQuestion.current = questionId; tracks.countdown.currentTime = 0; }
    for (const element of [tracks.lobby, tracks.countdown]) if (element !== wanted) element.pause();
    if (wanted && wanted.paused) wanted.play().then(() => setMusicBlocked(false)).catch(() => setMusicBlocked(true));
  }, [state?.phase, state?.paused, state?.question?.id, sound, fatal, musicBlocked]);
  useEffect(() => {
    // Browsers block autoplay until the page is touched; retry on the first interaction.
    if (!musicBlocked) return;
    const retry = () => { void audio.current?.resume().catch(() => {}); setMusicBlocked(false); };
    window.addEventListener('pointerdown', retry, { once: true }); window.addEventListener('keydown', retry, { once: true });
    return () => { window.removeEventListener('pointerdown', retry); window.removeEventListener('keydown', retry); };
  }, [musicBlocked]);
  const remaining = state?.remaining ?? (state?.deadline ? Math.max(0, state.deadline - now - offset) : 0);
  const seconds = Math.ceil(remaining / 1000);
  useEffect(() => {
    // Gentle countdown ticks on the shared screen during the final seconds.
    if (!isScreen || state?.phase !== 'question' || state.paused || seconds > 5 || seconds < 1 || lastTick.current === seconds) return;
    lastTick.current = seconds; tone([880], .05, .025);
  }, [seconds]);
  const accepted = state?.me?.selected !== undefined;
  const canAnswer = connected && isPlayer && state?.phase === 'question' && !state.paused && seconds > 0 && !accepted && !answerBusy && !!state.me?.approved;
  async function submit(picked = selected) {
    if (!canAnswer || !state?.question || !picked.length || inFlight.current) return;
    inFlight.current = true;
    const request = pendingRef.current || { requestId: uid(), questionId: state.question.id, selected: [...picked] };
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
    // Single-answer questions lock in on the first tap, like a buzzer.
    if (state?.question?.type !== 'multiple') { setSelected([i]); void submit([i]); return; }
    setSelected(prev => prev.includes(i) ? prev.filter(n => n !== i) : [...prev, i]);
  };
  function action(type: Action['type'], playerId?: string) {
    if (!connected || !state || busy) return;
    setBusy(true); setError('');
    socketRef.current?.timeout(6000).emit('action', { requestId: uid(), seq: state.seq, type, playerId }, (timeout: Error | null, reply: Ack) => {
      setBusy(false);
      if (timeout) setError('The action was not confirmed. Check the updated screen before trying again.');
      else if (!reply?.ok) setError(reply && !reply.ok ? reply.error : 'The action could not be completed.');
    });
  }
  const primary: { type: Action['type']; label: string } | null = !isHost || !state ? null
    : state.phase === 'lobby' ? (state.playerCount ? { type: 'start', label: 'Start' } : null)
    : state.phase === 'question' ? { type: 'close', label: 'Skip' }
    : state.phase === 'reveal' ? { type: 'next', label: 'Next' }
    : state.phase === 'standings' ? { type: 'next', label: state.index + 1 === state.total ? 'Podium' : 'Next' } : null;
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A', 'SUMMARY'].includes((event.target as HTMLElement)?.tagName) || document.querySelector('[role="dialog"]')) return;
      if (isPlayer) {
        const n = Number(event.key) - 1;
        if (n >= 0 && n < (state?.question?.options.length || 0)) { event.preventDefault(); choose(n); }
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
  const toggleSound = async () => {
    if (!sound) { audio.current ||= new AudioContext(); await audio.current.resume(); }
    setSound(!sound);
  };
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
  const toolbar = <div className="game-tools">
    <span className={`conn-dot ${connected ? 'online' : ''}`} role="status" title={connected ? 'Connected' : 'Reconnecting'}><span className="sr-only">{connected ? 'Connected' : fatal ? 'Disconnected' : 'Reconnecting…'}</span></span>
    <button className="tool-btn" onClick={() => void toggleSound().catch(() => setError('Sound is unavailable in this browser.'))} aria-label={sound ? 'Mute sound' : 'Enable sound'} aria-pressed={sound} title={sound ? 'Mute' : 'Sound on'}><Icon name={sound ? 'sound' : 'mute'} size={19} /></button>
    {isScreen && <button className="tool-btn" onClick={toggleFullscreen} aria-label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'} title="Fullscreen (F)"><Icon name={fullscreen ? 'shrink' : 'expand'} size={19} /></button>}
    <button className="tool-btn" aria-label="Reduce motion" aria-pressed={reduced} onClick={() => setReduced(!reduced)} title="Reduce motion"><Icon name="motion" size={19} /></button>
    <button className="tool-btn" aria-label="Scoring rules" onClick={() => setShowRules(true)} title="Rules"><Icon name="help" size={19} /></button>
    {isHost && state && !fatal && state.phase !== 'finished' && <button className="tool-btn danger-tool" aria-label="End game" title="End game" onClick={() => setDeleting(true)}><Icon name="close" size={19} /></button>}
  </div>;
  const hostButton = (label: string, type: Action['type'], extra = '') => <button className={`btn white game-next ${extra}`} disabled={controlsDisabled} onClick={() => action(type)}>{label}<Icon name="arrow" size={18} /></button>;

  function screenView(s: Snapshot) {
    const q = s.question;
    if (s.phase === 'lobby') return <div className="lobby">
      <section className="lobby-banner">
        <div className="lobby-join"><span>Join at <strong>{location.host}/join</strong></span><button className="copy-link" onClick={copyLink}><Icon name={copied ? 'check' : 'link'} size={15} />{copied ? 'Copied!' : 'Copy link'}</button></div>
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
          {isHost ? <>{!p.approved && <button className="name-approve" aria-label={`Approve ${p.name}`} disabled={controlsDisabled} onClick={() => action('approve', p.id)}><Icon name="check" size={16} /></button>}<button className="name-kick" aria-label={`Remove ${p.name}`} title="Remove player" disabled={controlsDisabled} onClick={() => action('remove', p.id)}><span>{p.name}</span><Icon name="close" size={14} /></button></> : <span>{p.name}</span>}
        </div>)}</div>}
      <p className="lobby-mode"><Icon name={s.mode === 'accuracy' ? 'leaf' : 'spark'} size={16} />{s.mode === 'accuracy' ? 'Accuracy mode' : 'Classic mode'} · {s.total} questions{isHost && <span className="hide-mobile"> · Press Space to start</span>}</p>
    </div>;
    if ((s.phase === 'question' || s.phase === 'reveal') && q) {
      const reveal = s.phase === 'reveal'; const max = Math.max(1, ...(s.distribution || [0]));
      return <div className={`stage ${reveal ? 'revealed' : ''}`}>
        <h1 className="stage-question" key={q.id}>{q.text}</h1>
        <div className="stage-middle">
          <div className="stage-side">{!reveal ? <TimerRing seconds={seconds} remaining={remaining} total={q.seconds} paused={s.paused} /> : null}</div>
          <div className="stage-center">
            {reveal ? <div className="bars" role="img" aria-label={`Answers: ${q.options.map((o, i) => `${o} ${s.distribution?.[i] || 0}`).join(', ')}`}>{q.options.map((_, i) => <div key={i} className={`bar ans-${i} ${q.correct?.includes(i) ? 'right' : 'wrong'}`}><span className="bar-count">{s.distribution?.[i] || 0}</span><span className="bar-fill" style={{ height: `${Math.max(4, (s.distribution?.[i] || 0) / max * 100)}%` }} /><span className="bar-label"><Shape index={i} size={20} />{q.correct?.includes(i) && <Icon name="check" size={20} />}</span></div>)}</div>
              : q.image ? <img className="stage-image" src={q.image} alt="Question illustration" /> : <div className="stage-placeholder" aria-hidden="true"><Shape index={s.index % 4} size={90} /></div>}
          </div>
          <div className="stage-side right">{!reveal ? <div className="answer-count"><strong>{s.answered}</strong><span>{s.answered === 1 ? 'Answer' : 'Answers'}</span></div> : isHost && <div className="answer-count small"><strong>{s.classScore}%</strong><span>class accuracy</span></div>}
            {isHost && (reveal ? hostButton('Next', 'next') : <div className="stage-controls"><button className="btn white small" disabled={controlsDisabled} onClick={() => action(s.paused ? 'resume' : 'pause')}><Icon name={s.paused ? 'play' : 'pause'} size={16} />{s.paused ? 'Resume' : 'Pause'}</button>{hostButton('Skip', 'close', 'small')}</div>)}
          </div>
        </div>
        {reveal && (q.explanation || q.revealImage) && <div className="stage-explanation">{q.revealImage && <img src={q.revealImage} alt="Reveal" />}{q.explanation && <p><Icon name="spark" size={18} />{q.explanation}</p>}</div>}
        <div className={`play-grid count-${q.options.length}`}>{q.options.map((option, i) => <div key={i} className={`play-tile ans-${i} ${reveal ? q.correct?.includes(i) ? 'right' : 'wrong' : ''}`}><Shape index={i} size={34} /><span>{option}</span>{reveal && (q.correct?.includes(i) ? <Icon name="check" size={30} /> : <Icon name="close" size={26} />)}</div>)}</div>
      </div>;
    }
    if (s.phase === 'standings') return <div className="scoreboard">
      <h1 className="pill-title">Scoreboard</h1>
      {s.leaderboard ? <ol className="score-list">{ranked.slice(0, 5).map((p, i) => <li key={p.id} style={{ animationDelay: `${i * 80}ms` }}><span className="score-rank">{p.rank}</span><strong>{p.name}</strong><span>{p.score.toLocaleString()}</span></li>)}</ol>
        : <ClassScore score={s.classScore} />}
      <div className="scoreboard-foot"><span className="type-chip">Question {s.index + 1} of {s.total} · class accuracy {s.classScore}%</span>{isHost && <div className="stage-controls"><button className="btn ghost-light small" disabled={controlsDisabled} onClick={() => action('leaderboard')}>{s.leaderboard ? 'Hide scores' : 'Show scores'}</button>{hostButton(s.index + 1 === s.total ? 'Podium' : 'Next', 'next')}</div>}</div>
    </div>;
    if (s.phase === 'finished') {
      const top = ranked.slice(0, 3); const order = [top[1], top[0], top[2]];
      return <div className="podium-screen">
        {!reduced && <Confetti />}
        <h1 className="pill-title">{s.title}</h1>
        {s.leaderboard && top.length ? <div className="podium">{order.map((p, n) => p ? <div key={p.id} className={`podium-col place-${p.rank > 3 ? 3 : p.rank}`} style={{ animationDelay: `${[600, 1200, 0][n]}ms` }}><strong className="podium-name">{p.name}</strong><div className="podium-block"><span className="medal">{p.rank}</span><span className="podium-score">{p.score.toLocaleString()}</span></div></div> : <div key={n} className="podium-col empty" />)}</div>
          : <ClassScore score={s.classScore} />}
        {isHost && <div className="finish-controls">
          <button className="btn white" onClick={() => { if (s.hostQuiz) setReplay(s.hostQuiz); }}><Icon name="play" size={16} />Play again</button>
          <button className="btn ghost-light" onClick={() => void exportResults()}><Icon name="download" size={17} />Download results</button>
          <button className="btn ghost-light" disabled={controlsDisabled} onClick={() => action('leaderboard')}>{s.leaderboard ? 'Hide podium' : 'Show podium'}</button>
          <button className="btn ghost-light danger-light" onClick={() => setDeleting(true)}><Icon name="trash" size={17} />Delete game data</button>
        </div>}
        {isHost && ranked.length > 3 && s.leaderboard && <details className="full-results"><summary>All {ranked.length} players</summary><ol>{ranked.map(p => <li key={p.id}><span>{p.rank}</span><strong>{p.name}</strong><span>{p.score.toLocaleString()}</span></li>)}</ol></details>}
      </div>;
    }
    return null;
  }

  function playerView(s: Snapshot) {
    const q = s.question; const me = s.me;
    if (!me?.approved) return <div className="player-message"><div className="spinner" /><h1>Almost there!</h1><p>The host is checking nicknames. Sit tight, <strong>{me?.name}</strong>.</p></div>;
    if (s.phase === 'lobby') return <div className="player-message"><h1>You’re in!</h1><p>See your nickname on screen?</p><span className="nick-pill">{me.name}</span></div>;
    if (s.phase === 'question' && q) {
      if (accepted) return <div className="player-message"><div className="locked-shapes">{(me.selected || []).map(i => <span key={i} className={`mini-tile ans-${i}`}><Shape index={i} size={30} /></span>)}</div><h1>Answer locked in!</h1><p>Waiting for the others…</p><div className="spinner" /></div>;
      return <div className="player-question">
        <div className="pq-head"><span className="type-chip">{typeLabel[q.type]}</span><span className={`pq-timer ${seconds <= 5 ? 'urgent' : ''}`} role="timer" aria-label={`${seconds} seconds remaining`}>{s.paused ? <Icon name="pause" size={18} /> : seconds}</span></div>
        <h1 className="pq-text">{q.text}</h1>
        <div className={`player-grid count-${q.options.length}`}>{q.options.map((option, i) => {
          const chosen = selected.includes(i);
          return <button key={i} className={`player-tile ans-${i} ${chosen ? 'chosen' : ''} ${q.type === 'multiple' && selected.length && !chosen ? 'dim' : ''}`} disabled={!canAnswer || !!pendingRef.current} onClick={() => choose(i)} aria-pressed={chosen} aria-label={`${shapeNames[i]}: ${option}`}>
            <Shape index={i} size={40} /><span className="pt-text">{option}</span>{q.type === 'multiple' && <span className="pt-check">{chosen && <Icon name="check" size={20} />}</span>}<kbd className="hide-mobile">{i + 1}</kbd>
          </button>;
        })}</div>
        {(q.type === 'multiple' || pendingRef.current) && <button className="btn white full big submit-answer" disabled={!canAnswer || !selected.length} onClick={() => void submit()}>{answerBusy ? 'Sending…' : pendingRef.current ? 'Retry the same answer' : selected.length ? `Submit ${selected.length} ${selected.length === 1 ? 'answer' : 'answers'}` : 'Select your answers'}</button>}
      </div>;
    }
    if (s.phase === 'reveal' && q) {
      const credit = me.credit || 0; const answered = me.selected !== undefined;
      const kind = !answered ? 'timeout' : credit === 1 ? 'correct' : credit > 0 ? 'partial' : 'incorrect';
      return <div className={`result-screen ${kind}`}>
        <h1>{{ correct: 'Correct', partial: 'Partly correct', incorrect: 'Incorrect', timeout: 'Time’s up' }[kind]}</h1>
        <span className="result-icon"><Icon name={kind === 'correct' ? 'check' : kind === 'partial' ? 'spark' : kind === 'timeout' ? 'clock' : 'close'} size={56} /></span>
        {answered ? <span className="points-pill">+ {(me.points || 0).toLocaleString()}</span> : <p>No answer this round.</p>}
        <p className="result-rank">{me.rank ? `You’re in ${ordinal(me.rank)} place` : ''}{kind === 'incorrect' && <><br />Shake it off — the next one’s yours!</>}</p>
        {kind !== 'correct' && q.correct && <p className="result-answer">Correct: <strong>{q.correct.map(n => q.options[n]).join(', ')}</strong></p>}
        {q.revealImage && <img className="result-image" src={q.revealImage} alt="Reveal" />}
        {q.explanation && <p className="result-explanation">{q.explanation}</p>}
      </div>;
    }
    if (s.phase === 'standings') {
      const mineIndex = ranked.findIndex(p => p.id === me.id); const ahead = mineIndex > 0 ? [...ranked.slice(0, mineIndex)].reverse().find((p: PublicPlayer) => p.score > me.score) : undefined;
      return <div className="player-message">
        <span className="rank-badge">{me.rank ? ordinal(me.rank) : '–'}</span>
        <h1>{me.rank === 1 ? 'You’re in the lead!' : me.rank ? `You’re in ${ordinal(me.rank)} place` : 'Nice work'}</h1>
        {ahead && <p>{(ahead.score - me.score).toLocaleString()} points behind <strong>{ahead.name}</strong></p>}
        <p className="muted-light">Your host will start the next question soon.</p>
      </div>;
    }
    if (s.phase === 'finished') return <div className="player-final">
      {!reduced && me.rank > 0 && me.rank <= 3 && <Confetti />}
      <span className={`rank-badge place-${Math.min(me.rank || 4, 4)}`}>{me.rank ? ordinal(me.rank) : '–'}</span>
      <h1>{me.rank === 1 ? 'Winner winner!' : me.rank && me.rank <= 3 ? 'On the podium!' : 'What a game!'}</h1>
      <p>{me.score.toLocaleString()} points · class accuracy {s.classScore}%</p>
      {s.review && <section className="review"><h2>Your answers</h2>{s.review.map((item, i) => <details key={item.question.id}><summary><span className={`review-mark ${item.credit === 1 ? 'correct' : item.credit > 0 ? 'partial' : ''}`}><Icon name={item.credit === 1 ? 'check' : item.credit > 0 ? 'spark' : 'close'} size={15} /></span><strong>{i + 1}. {item.question.text}</strong><span>{item.points}</span></summary><div><p><strong>Your answer:</strong> {item.selected.length ? item.selected.map(n => item.question.options[n]).join(', ') : 'No answer'}</p><p><strong>Correct:</strong> {item.question.correct.map(n => item.question.options[n]).join(', ')}</p>{item.question.explanation && <p>{item.question.explanation}</p>}</div></details>)}</section>}
      <button className="btn white" onClick={() => navigate('/join')}>Play another game</button>
    </div>;
    return null;
  }

  return <div className={`game-shell role-${role} phase-${state?.phase || 'loading'}`}>
    <div className="bg-shapes" aria-hidden="true">{[0, 1, 2, 3, 0, 2].map((s, i) => <span key={i} className={`bgs bgs-${i}`}><Shape index={s} size={120} /></span>)}</div>
    <header className="game-topbar">
      <div className="gt-left">{isPlayer ? <span className="gt-pin">PIN {pin}</span> : <a href="/home" onClick={e => { e.preventDefault(); navigate('/home'); }} aria-label="Tori home"><Brand light /></a>}</div>
      <span className="gt-center">{state && state.phase !== 'lobby' && state.phase !== 'finished' ? `${state.index + 1} of ${state.total}` : isScreen ? state?.title : ''}</span>
      {toolbar}
    </header>
    {fatal ? <main className="player-message"><Icon name="warning" size={44} /><h1>Let’s find your way back.</h1><p role="alert">{fatal}</p><p className="muted-light">Game access belongs to the browser where you hosted or joined. Rooms also expire automatically.</p><div className="row-actions"><button className="btn white" onClick={() => navigate(isPlayer ? '/join' : '/home')}>Back to Tori</button>{isPlayer && <button className="btn ghost-light" onClick={() => { try { localStorage.removeItem(`tori.player.${pin}`); } catch { /* unavailable storage */ } location.href = `/join?pin=${pin}`; }}>Join as a new player</button>}</div></main>
      : !state ? <main className="player-message"><div className="spinner" /><h1>Connecting…</h1><p>Game {pin}. Keep this page open.</p></main>
      : <main className="game-main">
        {(!connected || state.paused) && <div className="status-banner" role="status"><Icon name={!connected ? 'warning' : 'pause'} size={17} />{!connected ? 'Connection lost. Reconnecting — accepted answers are saved.' : 'Paused. The timer is frozen for everyone.'}</div>}
        {isPlayer ? playerView(state) : screenView(state)}
        {error && <p className="game-alert" role="status">{error}{pendingRef.current && isPlayer && <button className="toast-action" onClick={() => void submit()}>Retry</button>}</p>}
      </main>}
    {musicBlocked && sound && <button className="sound-unlock" onClick={() => setMusicBlocked(false)} aria-label="Start sound"><span><Icon name="sound" size={44} /><strong>Click to start the sound</strong><small>Your browser needs one click before it plays music.</small></span></button>}
    {isPlayer && state?.me && !fatal && <footer className="player-bar"><strong>{state.me.name}</strong><span className="score-chip">{state.me.score.toLocaleString()}</span></footer>}
    {bigQr && qr && <Modal title={`Scan to join · PIN ${pin}`} onClose={() => setBigQr(false)}><img className="qr-large" src={qr} alt={`QR code to join game ${pin}`} /><p className="center-text">{joinUrl}</p></Modal>}
    {deleting && <Modal title="End and delete this game?" onClose={() => setDeleting(false)}><p>This ends the game for everyone and permanently deletes player names, answers, and scores from the server. Your quiz stays in your library.</p><div className="modal-actions"><button className="btn outline" onClick={() => setDeleting(false)}>Keep playing</button><button className="btn red" disabled={controlsDisabled} onClick={() => { action('delete'); setDeleting(false); }}>Delete game</button></div></Modal>}
    {showRules && <Modal title="How scoring works" onClose={() => setShowRules(false)}><p>{rules}</p><p>One final answer per question. Answers are accepted only before the server deadline; refreshes preserve accepted answers. A pause freezes the timer for everyone.</p><p>The class accuracy uses accuracy credit, regardless of scoring mode. Browser refreshes reconnect automatically using a private token stored on this device.</p>{isScreen && <p><strong>Host shortcuts:</strong> Space or Enter continues, F toggles fullscreen.</p>}</Modal>}
    {replay && <HostModal quiz={replay} onClose={() => setReplay(null)} />}
  </div>;
}
function ClassScore({ score }: { score: number }) {
  return <div className="class-score"><span>Class accuracy</span><strong>{score}%</strong><div className="class-meter"><span style={{ width: `${score}%` }} /></div><p>Every bit of knowledge adds up.</p></div>;
}
