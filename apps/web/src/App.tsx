import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { quizSchema, type Mode, type Quiz } from '../../../packages/shared/src/protocol';
import { isOffensiveName } from '../../../packages/shared/src/names';
import { Brand, Cover, Icon, Shape } from './icons';
import { api, csvTemplate, download, draftSchema, errorText, quizFromCsv, rules, saveCredential, uid } from './lib';
import { loadLibrary, saveLegacy, saveLibrary } from './storage';
import { getLang, languages, num, onLangChange, plural, setLang, t } from './i18n';
import { Editor } from './Editor';
import { Game } from './Game';

export function LangPicker({ light = false, compact = false }: { light?: boolean; compact?: boolean }) {
  if (compact) {
    // One button that switches to the other language, for tight toolbars.
    const next = languages.find(lang => lang.id !== getLang())!;
    return <button className="tool-btn lang-toggle" lang={next.id} title={next.name} aria-label={`${t('Language')}: ${next.name}`} onClick={() => setLang(next.id)}>{next.label}</button>;
  }
  return <div className={`lang-picker${light ? ' light' : ''}`} role="group" aria-label={t('Language')}>
    {languages.map(lang => <button key={lang.id} lang={lang.id} title={lang.name} aria-pressed={getLang() === lang.id} className={getLang() === lang.id ? 'active' : ''} onClick={() => setLang(lang.id)}>{lang.label}</button>)}
  </div>;
}
export function navigate(path: string) { history.pushState(null, '', path); window.dispatchEvent(new PopStateEvent('popstate')); window.scrollTo(0, 0); }
export function Modal({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose); closeRef.current = onClose;
  useEffect(() => {
    const prior = document.activeElement as HTMLElement;
    const first = ref.current?.querySelector<HTMLElement>('input, select, textarea, button:not(.modal-close), [tabindex="0"]'); first?.focus();
    const listener = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeRef.current();
      if (event.key !== 'Tab') return;
      const elements = [...(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href], textarea:not(:disabled), [tabindex="0"]') || [])];
      if (!elements.length) return;
      if (event.shiftKey && document.activeElement === elements[0]) { event.preventDefault(); elements.at(-1)?.focus(); }
      else if (!event.shiftKey && document.activeElement === elements.at(-1)) { event.preventDefault(); elements[0].focus(); }
    };
    document.addEventListener('keydown', listener); const overflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', listener); document.body.style.overflow = overflow; prior?.focus(); };
  }, []);
  return <div className="modal-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div className={`modal${wide ? ' wide' : ''}`} ref={ref} role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div className="modal-heading"><h2 id="modal-title">{title}</h2><button className="icon-btn modal-close" aria-label={t('Close dialog')} onClick={onClose}><Icon name="close" /></button></div>
      {children}
    </div>
  </div>;
}
interface Recent { pin: string; title: string; date: string }
function recentGames(): Recent[] {
  try { const value: unknown = JSON.parse(localStorage.getItem('tori.recent') || '[]'); return Array.isArray(value) ? value.filter(x => typeof x?.pin === 'string' && /^\d{6}$/.test(x.pin) && typeof x.title === 'string' && typeof x.date === 'string').slice(0, 20) : []; } catch { return []; }
}
const minutes = (quiz: Quiz) => Math.max(1, Math.ceil(quiz.questions.reduce((n, q) => n + q.seconds + 15, 0) / 60));

export function App() {
  const [, rerender] = useState(0);
  useEffect(() => onLangChange(() => rerender(n => n + 1)), []);
  const [path, setPath] = useState(() => {
    // The root URL is for players: send them straight to the PIN screen.
    if (location.pathname === '/') history.replaceState(null, '', '/join' + location.search);
    return location.pathname;
  });
  const [loaded, setLoaded] = useState(false);
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [storageError, setStorageError] = useState('');
  const storage = useRef({ persistent: true, readOnly: false, saved: [] as Quiz[], queue: Promise.resolve() });
  useEffect(() => {
    loadLibrary().then(result => { storage.current.persistent = result.persistent; storage.current.saved = result.quizzes; setQuizzes(result.quizzes); })
      .catch(() => { storage.current.readOnly = true; setStorageError(t('Browser drafts could not be read. Export the saved data before making new changes.')); })
      .finally(() => setLoaded(true));
  }, []);
  const [notice, setNotice] = useState('');
  const [hosting, setHosting] = useState<Quiz | null>(null);
  const [help, setHelp] = useState(false);
  const [section, setSection] = useState<'library' | 'recent'>('library');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All');
  const [quickPin, setQuickPin] = useState('');
  const importRef = useRef<HTMLInputElement>(null);
  useEffect(() => { const handler = () => { if (location.pathname === '/') history.replaceState(null, '', '/join'); setPath(location.pathname); }; window.addEventListener('popstate', handler); return () => window.removeEventListener('popstate', handler); }, []);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 5000); return () => clearTimeout(timer); }, [notice]);
  function save(next: Quiz[]) {
    setQuizzes(next);
    const state = storage.current;
    if (state.readOnly) { setStorageError(t('These changes are in memory only. Recover or clear unreadable browser data before saving.')); return; }
    // Saves run one after another so each only writes what changed since the last success.
    state.queue = state.queue.then(async () => {
      if (state.persistent) await saveLibrary(next, state.saved); else saveLegacy(next);
      state.saved = next; setStorageError('');
    }).catch(() => setStorageError(t('Browser storage is full or unavailable. Changes are in memory only; export a JSON backup before leaving.')));
  }
  function create() {
    const quiz: Quiz = { version: 1, id: uid(), title: '', description: '', category: 'General knowledge', cover: 'blue', questions: [{ id: uid(), type: 'single', text: '', options: ['', '', '', ''], correct: [0], seconds: 20, explanation: '' }] };
    save([quiz, ...quizzes]); navigate(`/edit/${quiz.id}`);
  }
  function host(quiz: Quiz) {
    const result = quizSchema.safeParse(quiz);
    if (!result.success) { setNotice(t('Finish your quiz first: {problem}', { problem: t(result.error.issues[0].message) })); navigate(`/edit/${quiz.id}`); return; }
    setHosting(result.data);
  }
  async function importQuiz(file?: File) {
    if (!file) return;
    try {
      if (file.size > 8_000_000) throw new Error(t('Keep imported files under 8 MB.'));
      if (/\.(csv|tsv|txt)$/i.test(file.name) || file.type === 'text/csv') {
        const quiz = quizFromCsv(await file.text(), file.name.replace(/\.[^.]+$/, '') || t('Imported quiz'));
        save([quiz, ...quizzes]); setNotice(t('{count} imported from the spreadsheet.', { count: plural(quiz.questions.length, 'question') })); navigate(`/edit/${quiz.id}`);
        if (importRef.current) importRef.current.value = '';
        return;
      }
      const result = draftSchema.safeParse(JSON.parse(await file.text()));
      if (!result.success) throw new Error(t('This is not a valid Tori v1 quiz.') + ' ' + t(result.error.issues[0].message));
      const quiz = { ...result.data, id: uid() }; save([quiz, ...quizzes]); setNotice(t('Quiz imported. Make it your own!')); navigate(`/edit/${quiz.id}`);
    } catch (error) { setNotice(t(errorText(error))); }
    if (importRef.current) importRef.current.value = '';
  }
  const match = /^\/(host|play|projector)\/(\d{6})$/.exec(path);
  if (match) return <Game key={path} pin={match[2]} role={match[1] === 'play' ? 'player' : match[1] as 'host' | 'projector'} />;
  if (path === '/join') return <JoinScreen />;
  const editId = /^\/edit\/([^/]+)$/.exec(path)?.[1];
  if (!loaded) return <main className="crash"><Brand light /><div className="spinner" /></main>;
  if (editId) {
    const quiz = quizzes.find(q => q.id === editId);
    if (quiz) return <><Editor quiz={quiz} onChange={next => save(quizzes.map(q => q.id === next.id ? next : q))} onHost={() => host(quiz)} storageError={storageError} />{notice && <div role="status" className="toast">{notice}</div>}{hosting && <HostModal quiz={hosting} onClose={() => setHosting(null)} />}</>;
    return <main className="crash"><Brand light /><h1>{t('We couldn’t find that draft.')}</h1><p>{t('Drafts belong to the browser where you created them. You can import a JSON backup in your library.')}</p><button className="btn white" onClick={() => navigate('/home')}>{t('Back to library')}</button></main>;
  }
  const categories = [...new Set(quizzes.map(q => q.category))];
  const filtered = quizzes.filter(q => (category === 'All' || q.category === category) && `${q.title} ${q.description} ${q.category}`.toLowerCase().includes(search.toLowerCase()));
  const recents = recentGames();
  return <div className="app-shell">
    <header className="topnav">
      <a className="brand-link" href="/home" onClick={e => { e.preventDefault(); navigate('/home'); setSection('library'); }} aria-label={t('Tori home')}><Brand /></a>
      <nav className="topnav-tabs" aria-label={t('Main navigation')}>
        <button className={section === 'library' ? 'active' : ''} aria-current={section === 'library' ? 'page' : undefined} onClick={() => setSection('library')}><Icon name="grid" size={18} />{t('Library')}<span className="nav-count">{quizzes.length}</span></button>
        <button className={section === 'recent' ? 'active' : ''} aria-current={section === 'recent' ? 'page' : undefined} onClick={() => setSection('recent')}><Icon name="clock" size={18} />{t('Recent games')}</button>
      </nav>
      <div className="topnav-actions">
        <LangPicker />
        <button className="btn ghost small hide-mobile" onClick={() => setHelp(true)}><Icon name="help" size={17} />{t('How it works')}</button>
        <a className="btn outline small" href="/join" onClick={e => { e.preventDefault(); navigate('/join'); }}><Icon name="play" size={15} />{t('Join')}</a>
        <button className="btn blue small" onClick={create}><Icon name="plus" size={17} />{t('Create')}</button>
      </div>
    </header>
    <main className="page">
      {storageError && <div className="alert storage-alert" role="alert"><Icon name="warning" /><p>{storageError}</p><button className="btn small outline" onClick={() => { try { download(localStorage.getItem('tori.quizzes.v1') || JSON.stringify(quizzes), 'tori-draft-recovery.json'); } catch { download(JSON.stringify(quizzes), 'tori-draft-recovery.json'); } }}>{t('Export recovery data')}</button></div>}
      <section className="hero-row">
        <div className="hero-card hero-play">
          <div className="hero-shapes" aria-hidden="true">{[0, 1, 2, 3].map(i => <span key={i} className={`hs hs-${i}`}><Shape index={i} size={64} /></span>)}</div>
          <h1>{t('Let’s play!')}</h1>
          <p>{t('Got a game PIN? Jump right in — no account, no download.')}</p>
          <form className="quick-join" onSubmit={e => { e.preventDefault(); navigate(`/join?pin=${quickPin}`); }}>
            <label className="sr-only" htmlFor="quick-pin">{t('Game PIN')}</label>
            <input id="quick-pin" inputMode="numeric" autoComplete="off" maxLength={6} placeholder={t('Game PIN')} value={quickPin} onChange={e => setQuickPin(e.target.value.replace(/\D/g, ''))} />
            <button className="btn dark" type="submit" disabled={quickPin.length !== 6}>{t('Enter')}</button>
          </form>
        </div>
        <div className="hero-card hero-create">
          <span className="hero-badge">{t('FREE · OPEN SOURCE')}</span>
          <h2>{t('Make a quiz in minutes')}</h2>
          <p>{t('Questions, images, timers and explanations. Or write questions in a spreadsheet —')} <button className="link-button" onClick={() => download(csvTemplate, 'tori-template.csv', 'text/csv')}>{t('download the CSV template')}</button>.</p>
          <div className="hero-actions">
            <button className="btn green" onClick={create}><Icon name="plus" size={18} />{t('Create quiz')}</button>
            <button className="btn white" onClick={() => importRef.current?.click()}><Icon name="upload" size={17} />{t('Import JSON or CSV')}</button>
          </div>
        </div>
      </section>
      <input type="file" accept=".json,application/json,.csv,text/csv" hidden ref={importRef} onChange={e => importQuiz(e.target.files?.[0])} />
      {section === 'library' ? <section className="library" aria-labelledby="library-heading">
        <div className="section-heading"><h2 id="library-heading">{t('My quizzes')}</h2><span className="count-pill">{quizzes.length}</span></div>
        <div className="library-toolbar">
          <div className="filters" role="group" aria-label={t('Filter by category')}>{['All', ...categories].map(c => <button key={c} aria-pressed={category === c} className={category === c ? 'chip active' : 'chip'} onClick={() => setCategory(c)}>{t(c)}</button>)}</div>
          <label className="search"><Icon name="search" size={18} /><input aria-label={t('Search quizzes')} type="search" placeholder={t('Search quizzes')} value={search} onChange={e => setSearch(e.target.value)} /></label>
        </div>
        <div className="quiz-grid">
          <button className="new-quiz-card" onClick={create}><span className="new-plus"><Icon name="plus" size={30} /></span><strong>{t('Create new quiz')}</strong><span>{t('Start from a blank slide')}</span></button>
          {filtered.map(quiz => <QuizCard key={quiz.id} quiz={quiz} onHost={() => host(quiz)} onEdit={() => navigate(`/edit/${quiz.id}`)} onExport={() => download(JSON.stringify(quiz, null, 2), `${quiz.title || 'tori-draft'}.json`)} onDuplicate={() => { const copy = { ...structuredClone(quiz), id: uid(), title: `${quiz.title || t('Untitled quiz')} (${t('copy')})`.slice(0, 100) }; save([copy, ...quizzes]); setNotice(t('A fresh copy is ready to edit.')); }} onDelete={() => save(quizzes.filter(q => q.id !== quiz.id))} />)}
        </div>
        {filtered.length === 0 && quizzes.length > 0 && <p className="empty-message">{t('No quizzes match this search. Try a different word or category.')}</p>}
        <p className="library-note"><Icon name="lock" size={14} />{t('Quizzes are saved in this browser. Export a JSON backup to keep them safe — clearing browser data removes drafts.')}</p>
      </section> : <section className="library">
        <div className="section-heading"><h2>{t('Recent games')}</h2><span className="count-pill">{recents.length}</span></div>
        {recents.length ? <div className="recent-list">{recents.map(game => <button key={game.pin} className="recent-row" onClick={() => navigate(`/host/${game.pin}`)}><span className="recent-icon"><Shape index={Number(game.pin) % 4} size={22} /></span><span className="recent-text"><strong>{game.title}</strong><small>PIN {game.pin} · {new Date(game.date).toLocaleString(getLang() === 'lt' ? 'lt-LT' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' })}</small></span><span className="recent-go">{t('Open')}<Icon name="arrow" size={17} /></span></button>)}</div>
          : <div className="empty-panel"><Icon name="clock" size={40} /><h3>{t('No games yet')}</h3><p>{t('Host a quiz and it will show up here so you can jump back in.')}</p><button className="btn blue" onClick={() => setSection('library')}>{t('Browse your quizzes')}</button></div>}
        <p className="library-note"><Icon name="lock" size={14} />{t('Game credentials stay in this browser. Expired and deleted games cannot be resumed.')}</p>
      </section>}
      <footer className="page-footer"><span>{t('Tori — free to play, yours to keep.')}</span><a href="https://www.gnu.org/licenses/agpl-3.0.html" target="_blank" rel="noreferrer">AGPL-3.0 ↗</a></footer>
    </main>
    {notice && <div className="toast" role="status">{notice}</div>}
    {hosting && <HostModal quiz={hosting} onClose={() => setHosting(null)} />}
    {help && <Modal title={t('How Tori works')} onClose={() => setHelp(false)}>
      <div className="tour">
        {[['Create', 'Build a quiz or start from a sample. Add images, timers and explanations. Export JSON backups anytime.'], ['Host', 'Open a lobby and share the six-digit PIN or QR code. On Wi-Fi, use the host computer’s LAN address.'], ['Play', 'Players answer on their own devices. Reveal answers together, see the scoreboard, and crown the podium.']].map(([title, text], i) => <div key={title} className={`tour-step ans-${i}`}><span><Shape index={i} size={22} /></span><section><h3>{t(title)}</h3><p>{t(text)}</p></section></div>)}
      </div>
      <details className="rules"><summary>{t('Scoring, privacy & ownership')}</summary><p>{t(rules)}</p><p>{t('Drafts and private game credentials are stored in this browser. Browser data can be cleared; keep JSON backups. Room data expires automatically, or the host can delete it immediately. No student email, ads, or third-party tracking.')}</p><p>{t('Tori is licensed under AGPL-3.0. Hosting capacity depends on the instance; no capacity has been certified for this prototype.')}</p></details>
      <button className="btn blue full" onClick={() => setHelp(false)}>{t('Got it')}</button>
    </Modal>}
  </div>;
}

function JoinScreen() {
  const [, rerender] = useState(0);
  useEffect(() => onLangChange(() => rerender(n => n + 1)), []);
  const params = new URLSearchParams(location.search);
  const [pin, setPin] = useState(params.get('pin')?.replace(/\D/g, '').slice(0, 6) || '');
  const [step, setStep] = useState<'pin' | 'name'>(/^\d{6}$/.test(pin) ? 'name' : 'pin');
  const [nickname, setNickname] = useState(() => { try { return (localStorage.getItem('tori.nickname') || '').slice(0, 15); } catch { return ''; } });
  const [error, setError] = useState('');
  const [joining, setJoining] = useState(false);
  useEffect(() => {
    // A returning player keeps their seat instead of joining twice.
    if (step !== 'name') return;
    try { if (localStorage.getItem(`tori.player.${pin}`)) navigate(`/play/${pin}`); } catch { /* storage unavailable */ }
  }, [step, pin]);
  const kicked = (value: string) => { try { return localStorage.getItem(`tori.kicked.${value}`) === '1'; } catch { return false; } };
  useEffect(() => { if (step === 'name' && kicked(pin)) { setStep('pin'); setError('You were removed from this game by the host.'); } }, [step, pin]);
  function enterPin(event: FormEvent) {
    event.preventDefault(); setError('');
    if (!/^\d{6}$/.test(pin)) { setError('Enter the six-digit PIN from your host.'); return; }
    if (kicked(pin)) { setError('You were removed from this game by the host.'); return; }
    setStep('name');
  }
  async function join(event: FormEvent) {
    event.preventDefault(); setError('');
    if (isOffensiveName(nickname)) { setError('Please choose a different nickname.'); return; }
    setJoining(true);
    try {
      const result = await api<{ pin: string; token: string }>('/api/join', { pin, name: nickname.trim() });
      saveCredential(result.pin, 'player', result.token);
      try { if (nickname.trim()) localStorage.setItem('tori.nickname', nickname.trim()); } catch { /* optional */ }
      navigate(`/play/${result.pin}`);
    } catch (error) {
      const message = errorText(error);
      setError(message);
      if (/PIN|expired|deleted|lobby|capacity|not found/i.test(message) && !/nickname/i.test(message)) setStep('pin');
    } finally { setJoining(false); }
  }
  return <div className="join-screen">
    <div className="join-top"><LangPicker light /><a className="join-home" href="/home" onClick={e => { e.preventDefault(); navigate('/home'); }}><Icon name="grid" size={17} />{t('Host or create a quiz')}</a></div>
    <div className="bg-shapes" aria-hidden="true">{[0, 1, 2, 3, 0, 2].map((s, i) => <span key={i} className={`bgs bgs-${i}`}><Shape index={s} size={120} /></span>)}</div>
    <main className="join-center">
      <Brand light />
      {step === 'pin' ? <form className="join-box" onSubmit={enterPin} key="pin">
        <label className="sr-only" htmlFor="game-pin">{t('Game PIN')}</label>
        <input id="game-pin" className="join-input" inputMode="numeric" autoComplete="off" maxLength={6} placeholder={t('Game PIN')} autoFocus value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, ''))} />
        <button className="btn dark full big" type="submit">{t('Enter')}</button>
      </form> : <form className="join-box" onSubmit={join} key="name">
        <button type="button" className="join-pin-chip" onClick={() => { setStep('pin'); setError(''); }} aria-label={t('Game PIN {pin}. Change PIN', { pin })}>PIN {pin.slice(0, 3)} {pin.slice(3)} <Icon name="edit" size={14} /></button>
        <label className="sr-only" htmlFor="nickname">{t('Nickname')}</label>
        <input id="nickname" className="join-input" placeholder={t('Nickname')} maxLength={15} autoComplete="nickname" autoFocus value={nickname} onChange={e => setNickname(e.target.value)} />
        <button className="btn dark full big" type="submit" disabled={joining}>{joining ? t('Joining…') : t('OK, go!')}</button>
        <small className="join-hint">{t('Leave it blank and we’ll pick a fun name for you.')}</small>
      </form>}
      {error && <p className="join-error" role="alert"><Icon name="warning" size={18} />{t(error)}</p>}
    </main>
    <footer className="join-footer"><a href="/home" onClick={e => { e.preventDefault(); navigate('/home'); }}>{t('Create your own quiz on')} <strong>Tori</strong></a></footer>
  </div>;
}

function QuizCard({ quiz, onHost, onEdit, onExport, onDuplicate, onDelete }: { quiz: Quiz; onHost: () => void; onEdit: () => void; onExport: () => void; onDuplicate: () => void; onDelete: () => void }) {
  const [menu, setMenu] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const ready = quizSchema.safeParse(quiz).success;
  const name = quiz.title || t('Untitled quiz');
  useEffect(() => {
    if (!menu) return;
    const close = (event: MouseEvent) => { if (!menuRef.current?.contains(event.target as Node)) setMenu(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenu(false); };
    document.addEventListener('mousedown', close); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', escape); };
  }, [menu]);
  return <article className="quiz-card">
    <button className="cover-button" onClick={onEdit} aria-label={t('Edit {name}', { name })}><Cover kind={quiz.cover} /><span className="q-count">{plural(quiz.questions.length, 'question')}</span>{!ready && <span className="draft-badge">{t('Draft')}</span>}</button>
    <div className="quiz-card-body">
      <div className="card-top"><span className="card-category">{t(quiz.category)}</span>
        <div className="card-menu-wrap" ref={menuRef}><button className="icon-btn compact" aria-label={t('Options for {name}', { name })} aria-expanded={menu} onClick={() => setMenu(!menu)}><Icon name="more" size={20} /></button>
          {menu && <div className="card-menu" role="menu"><button role="menuitem" onClick={() => { onEdit(); setMenu(false); }}><Icon name="edit" size={16} />{t('Edit')}</button><button role="menuitem" onClick={() => { onDuplicate(); setMenu(false); }}><Icon name="copy" size={16} />{t('Duplicate')}</button><button role="menuitem" onClick={() => { onExport(); setMenu(false); }}><Icon name="download" size={16} />{t('Export JSON')}</button><button role="menuitem" className="danger-text" onClick={() => { setDeleting(true); setMenu(false); }}><Icon name="trash" size={16} />{t('Delete')}</button></div>}
        </div>
      </div>
      <button className="card-title" onClick={onEdit}>{name}</button>
      <p className="card-description">{quiz.description || t('A new idea, waiting to become a great quiz.')}</p>
      <div className="card-bottom">
        <span className="card-meta"><Icon name="clock" size={15} />~{minutes(quiz)} {t('min')}</span>
        <button className="btn edit-button small" onClick={onEdit}>{t('Edit')}</button>
        <button className="btn green small" onClick={onHost}><Icon name="play" size={14} />{t('Host')}</button>
      </div>
    </div>
    {deleting && <Modal title={t('Delete this quiz?')} onClose={() => setDeleting(false)}><p>{t('“{name}” will be removed from this browser. Export a JSON backup if you want to keep a copy.', { name })}</p><div className="modal-actions"><button className="btn outline" onClick={onExport}>{t('Export backup')}</button><button className="btn red" onClick={onDelete}>{t('Delete quiz')}</button></div></Modal>}
  </article>;
}

interface HostPrefs { mode: Mode; approval: boolean; leaderboard: boolean; teams: boolean; shuffle: boolean; autoReveal: boolean; phoneText: boolean; getReady: boolean }
const hostDefaults: HostPrefs = { mode: 'speed', approval: false, leaderboard: true, teams: false, shuffle: true, autoReveal: true, phoneText: true, getReady: true };
export function HostModal({ quiz, onClose }: { quiz: Quiz; onClose: () => void }) {
  const [prefs, setPrefs] = useState<HostPrefs>(() => { try { return { ...hostDefaults, ...JSON.parse(localStorage.getItem('tori.hostPrefs') || '{}') }; } catch { return hostDefaults; } });
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const set = (patch: Partial<HostPrefs>) => setPrefs(prev => { const next = { ...prev, ...patch }; try { localStorage.setItem('tori.hostPrefs', JSON.stringify(next)); } catch { /* optional */ } return next; });
  async function start() {
    setBusy(true); setError('');
    try {
      const parsed = quizSchema.parse(quiz);
      const room = await api<{ pin: string; token: string }>('/api/rooms', { quiz: parsed, ...prefs });
      saveCredential(room.pin, 'host', room.token);
      try { localStorage.setItem('tori.recent', JSON.stringify([{ pin: room.pin, title: quiz.title, date: new Date().toISOString() }, ...recentGames()].slice(0, 20))); } catch { /* Host credential is already durable; optional history may exceed quota. */ }
      onClose(); navigate(`/host/${room.pin}`);
    } catch (error) { setError(errorText(error)); } finally { setBusy(false); }
  }
  const toggles: [keyof HostPrefs, string, string][] = [
    ['leaderboard', 'Leaderboard & podium', 'Scoreboard between questions and a podium at the end.'],
    ['teams', 'Team mode', 'Players are split into 2–4 colour teams when you start.'],
    ['getReady', 'Get ready screen', 'Show each question for 4 seconds before answers open.'],
    ['autoReveal', 'Reveal when everyone answers', 'Skip the wait once all players are in.'],
    ['shuffle', 'Shuffle answer order', 'So the right answer isn’t always the same colour.'],
    ['phoneText', 'Show question on phones', 'Turn off to show only shapes — eyes on the big screen.'],
    ['approval', 'Approve nicknames', 'Check each name before the player enters.'],
  ];
  return <Modal title={t('Host a live game')} onClose={onClose} wide>
    <div className="host-quiz"><Cover kind={quiz.cover} small /><div><strong>{quiz.title}</strong><p>{plural(quiz.questions.length, 'question')} · ~{minutes(quiz)} {t('min')}</p></div></div>
    <h3 className="field-heading">{t('Game mode')}</h3>
    <div className="mode-grid">
      <button className={`mode-option mode-speed ${prefs.mode === 'speed' ? 'selected' : ''}`} onClick={() => set({ mode: 'speed' })} aria-pressed={prefs.mode === 'speed'}><span className="mode-icon"><Icon name="spark" size={28} /></span><strong>{t('Classic')}</strong><span>{t('Faster correct answers earn more — 500 to 1,000 points.')}</span>{prefs.mode === 'speed' && <span className="mode-check"><Icon name="check" size={16} /></span>}</button>
      <button className={`mode-option mode-accuracy ${prefs.mode === 'accuracy' ? 'selected' : ''}`} onClick={() => set({ mode: 'accuracy' })} aria-pressed={prefs.mode === 'accuracy'}><span className="mode-icon"><Icon name="leaf" size={28} /></span><strong>{t('Accuracy')}</strong><span>{t('No rush. Every correct answer is worth 1,000 points.')}</span>{prefs.mode === 'accuracy' && <span className="mode-check"><Icon name="check" size={16} /></span>}</button>
    </div>
    <h3 className="field-heading">{t('Options')}</h3>
    <div className="toggle-grid">{toggles.map(([key, title, hint]) => <label key={key} className="toggle-row"><span><strong>{t(title)}</strong><small>{t(hint)}</small></span><input type="checkbox" role="switch" className="switch" checked={!!prefs[key]} onChange={e => set({ [key]: e.target.checked })} /></label>)}</div>
    {prefs.mode === 'speed' && <p className="hint-text"><Icon name="help" size={15} />{t('Network latency can affect speed scores.')}</p>}
    <details className="rules"><summary>{t('Read the scoring rules')}</summary><p>{t(rules)}</p></details>
    {error && <p className="alert" role="alert">{t(error)}</p>}
    <button className="btn green full big" onClick={start} disabled={busy}>{busy ? t('Opening the lobby…') : t('Start')}<Icon name="arrow" /></button>
  </Modal>;
}
