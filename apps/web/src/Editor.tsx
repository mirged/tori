import { useEffect, useRef, useState } from 'react';
import { questionSchema, questionTypes, quizSchema, type Question, type Quiz } from '../../../packages/shared/src/protocol';
import { Brand, Cover, Icon, Shape } from './icons';
import { download, errorText, prepareImage, uid } from './lib';
import { LangPicker, Modal, navigate } from './App';
import { plural, t } from './i18n';

const typeNames: Record<Question['type'], string> = { single: 'Quiz', boolean: 'True or false', multiple: 'Multi-select', poll: 'Poll', text: 'Type answer', order: 'Puzzle' };
const typeHints: Record<Question['type'], string> = {
  single: 'One correct answer.', boolean: 'Is it true or false?', multiple: 'Mark every correct answer.',
  poll: 'No right answer — everyone votes and sees the results. No points.',
  text: 'Players type their answer. Capitals, accents and punctuation are ignored. Add other accepted spellings.',
  order: 'Write the items in the correct order. Players see them shuffled and put them back in order.',
};
const usesCorrect = (type: Question['type']) => type === 'single' || type === 'boolean' || type === 'multiple';
const blank = (type: Question['type'] = 'single'): Question => ({ id: uid(), type, text: '', options: type === 'boolean' ? ['True', 'False'] : type === 'text' ? [''] : ['', '', '', ''], correct: usesCorrect(type) ? [0] : [], seconds: type === 'text' || type === 'order' ? 30 : 20, explanation: '' });
function convert(q: Question, type: Question['type']): Question {
  if (type === 'boolean') return { ...q, type, options: ['True', 'False'], correct: [q.correct[0] === 1 ? 1 : 0] };
  const choices = q.type === 'boolean' ? ['', '', '', ''] : q.type === 'text' ? [...q.options, '', '', ''].slice(0, Math.max(4, q.options.length)) : q.options;
  if (type === 'text') return { ...q, type, options: [usesCorrect(q.type) ? q.options[q.correct[0]] || '' : q.options[0] || ''].map(o => q.type === 'boolean' ? '' : o), correct: [] };
  if (type === 'poll' || type === 'order') return { ...q, type, options: choices, correct: [] };
  const first = usesCorrect(q.type) ? q.correct : [0];
  return { ...q, type, options: choices, correct: type === 'multiple' ? (first.length ? first : [0]) : first.slice(0, 1).concat(first.length ? [] : [0]) };
}
const issuesFor = (q: Question) => { const result = questionSchema.safeParse(q); return result.success ? [] : [...new Set(result.error.issues.map(i => i.message))]; };

export function Editor({ quiz, onChange, onHost, storageError }: { quiz: Quiz; onChange: (quiz: Quiz) => void; onHost: () => void; storageError: string }) {
  const [index, setIndex] = useState(0); const [preview, setPreview] = useState(false); const [showCorrect, setShowCorrect] = useState(false); const [error, setError] = useState('');
  const [settings, setSettings] = useState(!quiz.title); const [addMenu, setAddMenu] = useState(false); const [dragging, setDragging] = useState<number | null>(null);
  const [undo, setUndo] = useState<{ question: Question; index: number } | null>(null); const [dropActive, setDropActive] = useState(false);
  const imageRef = useRef<HTMLInputElement>(null); const revealRef = useRef<HTMLInputElement>(null); const textRef = useRef<HTMLTextAreaElement>(null);
  const q = quiz.questions[index];
  const update = (patch: Partial<Quiz>) => { onChange({ ...quiz, ...patch }); setError(''); };
  const updateQuestion = (patch: Partial<Question>) => update({ questions: quiz.questions.map((q, i) => i === index ? { ...q, ...patch } : q) });
  useEffect(() => { if (!undo) return; const timer = setTimeout(() => setUndo(null), 7000); return () => clearTimeout(timer); }, [undo]);
  useEffect(() => { if (index >= quiz.questions.length && quiz.questions.length) setIndex(quiz.questions.length - 1); }, [index, quiz.questions.length]);
  function add(type: Question['type'] = 'single') {
    if (quiz.questions.length >= 50) return;
    const questions = [...quiz.questions]; questions.splice(index + 1, 0, blank(type));
    update({ questions }); setIndex(quiz.questions.length ? index + 1 : 0); setAddMenu(false);
    requestAnimationFrame(() => textRef.current?.focus());
  }
  function move(from: number, to: number) {
    if (to < 0 || to >= quiz.questions.length || from === to) return;
    const questions = [...quiz.questions]; const [item] = questions.splice(from, 1); questions.splice(to, 0, item);
    update({ questions }); setIndex(to);
  }
  function remove() {
    setUndo({ question: q, index });
    update({ questions: quiz.questions.filter((_, i) => i !== index) }); setIndex(Math.max(0, index - 1));
  }
  function restore() {
    if (!undo) return;
    const questions = [...quiz.questions]; questions.splice(undo.index, 0, undo.question);
    update({ questions }); setIndex(undo.index); setUndo(null);
  }
  async function image(file?: File, field: 'image' | 'revealImage' = 'image') {
    if (!file) return;
    try {
      setError('');
      const data = await prepareImage(file);
      const result = questionSchema.shape.image.safeParse(data);
      if (!result.success) throw new Error(t('That image format could not be verified. Try another PNG, JPEG, WebP, or GIF.'));
      updateQuestion({ [field]: data });
    } catch (error) { setError(errorText(error)); }
    if (imageRef.current) imageRef.current.value = '';
    if (revealRef.current) revealRef.current.value = '';
  }
  function host() {
    const result = quizSchema.safeParse(quiz);
    if (!result.success) {
      const issue = result.error.issues[0]; const qIndex = issue.path[1];
      if (typeof qIndex === 'number') setIndex(qIndex); else if (issue.path[0] !== 'questions') setSettings(true);
      setError(issue.message); return;
    }
    onHost();
  }
  const setType = (type: Question['type']) => { if (type !== q.type) updateQuestion(convert(q, type)); };
  const toggleCorrect = (i: number) => updateQuestion({ correct: q.type === 'multiple' ? q.correct.includes(i) ? q.correct.filter(n => n !== i) : [...q.correct, i] : [i] });
  const issues = q ? issuesFor(q) : [];
  return <div className="editor-shell">
    <header className="editor-topbar">
      <a href="/home" className="brand-link" onClick={e => { e.preventDefault(); navigate('/home'); }} aria-label={t('Tori home')}><Brand /></a>
      <button className="title-button" onClick={() => setSettings(true)}><span>{quiz.title || t('Enter quiz title…')}</span><span className="settings-pill"><Icon name="settings" size={15} />{t('Settings')}</span></button>
      <span className={`save-status ${storageError ? 'unsaved' : ''}`} role="status"><Icon name={storageError ? 'warning' : 'check'} size={15} /><span className="hide-mobile">{storageError ? t('Backup needed') : t('Saved')}</span></span>
      <div className="editor-top-actions">
        <LangPicker />
        <button className="btn ghost small hide-mobile" onClick={() => { setShowCorrect(false); setPreview(true); }} disabled={!q}><Icon name="eye" size={17} />{t('Preview')}</button>
        <button className="btn ghost small hide-mobile" onClick={() => download(JSON.stringify(quiz, null, 2), `${quiz.title || 'tori-draft'}.json`)}><Icon name="download" size={17} />{t('Export')}</button>
        <button className="btn outline small" onClick={() => navigate('/home')}>{t('Exit')}</button>
        <button className="btn green small" onClick={host}><Icon name="play" size={14} />{t('Host')}</button>
      </div>
    </header>
    {(storageError || error) && <div className="editor-alerts">{storageError && <p className="alert" role="alert"><Icon name="warning" size={17} />{storageError}</p>}{error && <p className="alert" role="alert"><Icon name="warning" size={17} />{t(error)}</p>}</div>}
    <div className="editor-layout">
      <aside className="slide-rail" aria-label={t('Questions')}>
        <ol>{quiz.questions.map((question, i) => {
          const bad = issuesFor(question).length > 0;
          return <li key={question.id} draggable onDragStart={() => setDragging(i)} onDragEnd={() => setDragging(null)} onDragOver={e => e.preventDefault()} onDrop={() => { if (dragging !== null) move(dragging, i); setDragging(null); }} className={dragging === i ? 'dragging' : ''}>
            <span className="slide-num">{i + 1}<small>{t(typeNames[question.type])}</small></span>
            <button className={`slide-thumb ${i === index ? 'active' : ''}`} onClick={() => { setIndex(i); setError(''); }} aria-current={i === index ? 'step' : undefined} aria-label={`${t('Question {n}', { n: i + 1 })}: ${question.text || t('empty')}${bad ? ` (${t('Needs attention')})` : ''}`}>
              <span className="thumb-text">{question.text || t('Question')}</span>
              <span className="thumb-time">{question.seconds}</span>
              {question.image ? <img className="thumb-image" src={question.image} alt="" /> : <span className="thumb-image placeholder"><Icon name="image" size={14} /></span>}
              <span className="thumb-answers">{question.options.map((_, n) => <span key={n} className={`ans-${n} ${question.correct.includes(n) ? 'ok' : ''}`} />)}</span>
              {bad && <span className="thumb-warning" title={t('Needs attention')}><Icon name="warning" size={13} /></span>}
            </button>
          </li>;
        })}</ol>
        <div className="add-wrap">
          <button className="btn blue full" onClick={() => setAddMenu(!addMenu)} aria-expanded={addMenu} disabled={quiz.questions.length >= 50}><Icon name="plus" size={17} />{t('Add question')}</button>
          {addMenu && <div className="add-menu" role="menu">{questionTypes.map(type => <button role="menuitem" key={type} onClick={() => add(type)}><span className={`type-icon type-${type}`}>{type === 'boolean' ? <><Shape index={0} size={10} /><Shape index={1} size={10} /></> : type === 'text' ? <Icon name="edit" size={14} /> : type === 'order' ? <Icon name="grip" size={14} /> : type === 'poll' ? <Icon name="people" size={14} /> : <><Shape index={0} size={9} /><Shape index={1} size={9} /><Shape index={2} size={9} /><Shape index={3} size={9} /></>}</span>{t(typeNames[type])}</button>)}</div>}
          <small className="rail-count">{quiz.questions.length}/50 {plural(50, 'question', false)}</small>
        </div>
      </aside>

      <main className="canvas">
        {q ? <>
          <label className="sr-only" htmlFor="question-text">{t('Question text')}</label>
          <textarea id="question-text" ref={textRef} className="canvas-question" rows={2} maxLength={300} placeholder={t('Start typing your question')} value={q.text} onChange={e => updateQuestion({ text: e.target.value })} />
          <div className={`canvas-media ${dropActive ? 'drop' : ''}`} onDragOver={e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDropActive(true); } }} onDragLeave={() => setDropActive(false)} onDrop={e => { if (!e.dataTransfer.files.length) return; e.preventDefault(); setDropActive(false); void image(e.dataTransfer.files[0]); }}>
            {q.image ? <div className="media-image"><img src={q.image} alt={t('Question illustration')} /><div className="media-actions"><button className="btn white small" onClick={() => imageRef.current?.click()}><Icon name="image" size={15} />{t('Replace')}</button><button className="btn white small" onClick={() => updateQuestion({ image: undefined })}><Icon name="trash" size={15} />{t('Remove')}</button></div></div>
              : <button className="media-empty" onClick={() => imageRef.current?.click()}><span className="media-plus"><Icon name="plus" size={30} /></span><strong>{t('Insert an image')}</strong><small>{t('Drop a file here · PNG, JPEG, WebP, GIF · photos are shrunk automatically')}</small></button>}
            <input type="file" ref={imageRef} hidden accept="image/png,image/jpeg,image/webp,image/gif" onChange={e => image(e.target.files?.[0])} />
          </div>
          <p className="type-hint"><Icon name="help" size={15} />{t(typeHints[q.type])}</p>
          {q.type === 'text' || q.type === 'order' ? <div className="list-answers">{q.options.map((option, i) => <div className={`list-answer ${q.type === 'order' ? `ans-${i}` : 'accepted'}`} key={`${q.id}-${i}`}>
              <span className="list-tag">{q.type === 'order' ? i + 1 : <Icon name="check" size={16} />}</span>
              <label className="sr-only" htmlFor={`answer-${i}`}>{q.type === 'order' ? t('Item {n}', { n: i + 1 }) : t('Accepted answer {n}', { n: i + 1 })}</label>
              <input id={`answer-${i}`} maxLength={160} value={option} placeholder={q.type === 'order' ? t('Item {n}', { n: i + 1 }) : i ? t('Another accepted spelling') : t('The correct answer')} onChange={e => updateQuestion({ options: q.options.map((o, n) => n === i ? e.target.value : o) })} />
              {q.type === 'order' && <><button className="answer-remove" aria-label={t('Move item {n} up', { n: i + 1 })} disabled={!i} onClick={() => { const options = [...q.options]; [options[i - 1], options[i]] = [options[i], options[i - 1]]; updateQuestion({ options }); }}><Icon name="up" size={15} /></button><button className="answer-remove" aria-label={t('Move item {n} down', { n: i + 1 })} disabled={i === q.options.length - 1} onClick={() => { const options = [...q.options]; [options[i + 1], options[i]] = [options[i], options[i + 1]]; updateQuestion({ options }); }}><Icon name="down" size={15} /></button></>}
              {q.options.length > (q.type === 'order' ? 2 : 1) && <button className="answer-remove" aria-label={t('Remove {n}', { n: i + 1 })} onClick={() => updateQuestion({ options: q.options.filter((_, n) => n !== i) })}><Icon name="close" size={14} /></button>}
            </div>)}</div>
          : <div className="canvas-answers">{q.options.map((option, i) => {
            const correct = q.correct.includes(i);
            return <div className={`edit-answer ans-${i} ${option ? 'filled' : ''} ${correct ? 'correct' : ''}`} key={`${q.id}-${i}`}>
              <span className="edit-shape"><Shape index={i} size={22} /></span>
              <label className="sr-only" htmlFor={`answer-${i}`}>{t('Answer {n}', { n: i + 1 })}</label>
              <input id={`answer-${i}`} maxLength={160} value={q.type === 'boolean' ? t(option) : option} readOnly={q.type === 'boolean'} placeholder={i >= 2 ? t('Add answer {n} (optional)', { n: i + 1 }) : t('Add answer {n}', { n: i + 1 })} onChange={e => updateQuestion({ options: q.options.map((o, n) => n === i ? e.target.value : o) })} />
              {q.options.length > 2 && q.type !== 'boolean' && <button className="answer-remove" aria-label={t('Remove answer {n}', { n: i + 1 })} onClick={() => updateQuestion({ options: q.options.filter((_, n) => n !== i), correct: q.correct.filter(n => n !== i).map(n => n > i ? n - 1 : n) })}><Icon name="close" size={14} /></button>}
              {usesCorrect(q.type) && <button className={`correct-toggle ${q.type === 'multiple' ? 'square' : ''}`} role={q.type === 'multiple' ? 'checkbox' : 'radio'} aria-checked={correct} aria-label={t('Answer {n} is correct', { n: i + 1 })} onClick={() => toggleCorrect(i)}>{correct && <Icon name="check" size={18} />}</button>}
            </div>;
          })}</div>}
          {q.type !== 'boolean' && q.options.length < 6 && <button className="btn white small add-answer" onClick={() => updateQuestion({ options: [...q.options, ''] })}><Icon name="plus" size={15} />{q.type === 'text' ? t('Add another accepted answer') : q.type === 'order' ? t('Add another item') : t('Add more answers')}</button>}
          <label className="canvas-explanation"><span><Icon name="spark" size={16} />{t('Explanation')} <small>{t('shown after the reveal · optional')}</small></span><textarea rows={2} maxLength={1000} placeholder={t('Why is this the answer? Share a fun fact.')} value={q.explanation} onChange={e => updateQuestion({ explanation: e.target.value })} />
            {q.revealImage ? <div className="reveal-image-edit"><img src={q.revealImage} alt={t('Reveal image')} /><button className="btn white small" onClick={e => { e.preventDefault(); updateQuestion({ revealImage: undefined }); }}><Icon name="trash" size={15} />{t('Remove')}</button></div>
              : <button className="btn ghost small reveal-add" onClick={e => { e.preventDefault(); revealRef.current?.click(); }}><Icon name="image" size={16} />{t('Add a reveal image — a meme or GIF shown with the answer')}</button>}
            <input type="file" ref={revealRef} hidden accept="image/png,image/jpeg,image/webp,image/gif" onChange={e => image(e.target.files?.[0], 'revealImage')} /></label>
        </> : <div className="canvas-empty"><Icon name="spark" size={40} /><h2>{t('Every good quiz starts somewhere.')}</h2><button className="btn blue" onClick={() => add()}>{t('Add your first question')}</button></div>}
      </main>

      {q && <aside className="inspector" aria-label={t('Question settings')}>
        <div className="inspector-group"><h3><Icon name="help" size={16} />{t('Question type')}</h3>
          <div className="type-picker" role="radiogroup" aria-label={t('Question type')}>{questionTypes.map(type => <button key={type} role="radio" aria-checked={q.type === type} className={q.type === type ? 'active' : ''} onClick={() => setType(type)}>{t(typeNames[type])}</button>)}</div>
        </div>
        <div className="inspector-group"><h3><Icon name="clock" size={16} />{t('Time limit')}</h3>
          <div className="time-picker" role="radiogroup" aria-label={t('Time limit')}>{[...new Set([5, 10, 20, 30, 60, 90, 120, 240, q.seconds])].sort((a, b) => a - b).map(s => <button key={s} role="radio" aria-checked={q.seconds === s} className={q.seconds === s ? 'active' : ''} onClick={() => updateQuestion({ seconds: s })}>{s < 60 ? t('{n}s', { n: s }) : t('{n}m', { n: s / 60 })}</button>)}</div>
        </div>
        <div className="inspector-group"><h3><Icon name="trophy" size={16} />{t('Points')}</h3>
          <div className="time-picker" role="radiogroup" aria-label={t('Points')}>{(['standard', 'double', 'none'] as const).map(points => <button key={points} role="radio" aria-checked={(q.points || 'standard') === points} className={(q.points || 'standard') === points ? 'active' : ''} disabled={q.type === 'poll'} onClick={() => updateQuestion({ points: points === 'standard' ? undefined : points })}>{points === 'standard' ? t('Standard') : points === 'double' ? t('Double') : t('None')}</button>)}</div>
        </div>
        {issues.length > 0 && <div className="inspector-group issues"><h3><Icon name="warning" size={16} />{t('Needs attention')}</h3><ul>{issues.map(m => <li key={m}>{t(m)}</li>)}</ul></div>}
        <div className="inspector-actions">
          <button className="btn ghost small" disabled={index === 0} onClick={() => move(index, index - 1)}><Icon name="up" size={16} />{t('Move up')}</button>
          <button className="btn ghost small" disabled={index === quiz.questions.length - 1} onClick={() => move(index, index + 1)}><Icon name="down" size={16} />{t('Move down')}</button>
          <button className="btn ghost small" disabled={quiz.questions.length >= 50} onClick={() => { const questions = [...quiz.questions]; questions.splice(index + 1, 0, { ...structuredClone(q), id: uid() }); update({ questions }); setIndex(index + 1); }}><Icon name="copy" size={16} />{t('Duplicate')}</button>
          <button className="btn ghost small danger-text" onClick={remove}><Icon name="trash" size={16} />{t('Delete')}</button>
        </div>
        <button className="btn outline full small show-mobile" onClick={() => { setShowCorrect(false); setPreview(true); }}><Icon name="eye" size={16} />{t('Preview question')}</button>
      </aside>}
    </div>
    {undo && <div className="toast" role="status">{t('Question deleted')}<button className="toast-action" onClick={restore}>{t('Undo')}</button></div>}
    {settings && <Modal title={t('Quiz settings')} onClose={() => setSettings(false)}>
      <div className="settings-form">
        <label>{t('Title')}<input placeholder={t('Give your quiz a catchy name')} maxLength={100} value={quiz.title} onChange={e => update({ title: e.target.value })} /></label>
        <label>{t('Description')} <span className="optional">{t('optional')}</span><textarea rows={2} placeholder={t('A little introduction for your players')} maxLength={300} value={quiz.description} onChange={e => update({ description: e.target.value })} /></label>
        <label>{t('Category')}<select value={quiz.category} onChange={e => update({ category: e.target.value })}>{[...new Set(['General knowledge', 'Nature', 'Science & space', 'Arts & culture', 'History', 'Just for fun', quiz.category])].map(c => <option key={c} value={c}>{t(c)}</option>)}</select></label>
        <fieldset className="cover-field"><legend>{t('Cover color')}</legend><div className="cover-picker">{(['green', 'peach', 'lilac', 'blue'] as const).map(color => <button key={color} className={`cover-swatch ${quiz.cover === color ? 'active' : ''}`} aria-label={t('{color} cover', { color: t(color) })} aria-pressed={quiz.cover === color} onClick={() => update({ cover: color })}><Cover kind={color} small /></button>)}</div></fieldset>
      </div>
      <button className="btn blue full" onClick={() => setSettings(false)}>{t('Done')}</button>
    </Modal>}
    {preview && q && <Modal title={`${t('Preview')} · ${t('Question {n}', { n: index + 1 })}`} onClose={() => setPreview(false)} wide>
      <div className="question-preview">
        <div className="preview-stage"><h2>{q.text || t('Your question will appear here.')}</h2>{q.image && <img className="preview-image" src={q.image} alt={t('Question illustration')} />}<span className="preview-timer">{q.seconds}</span></div>
        {q.type === 'text' ? <div className="preview-text">{showCorrect ? `${t('Accepted:')} ${q.options.filter(Boolean).join(' · ') || '—'}` : t('Players type their answer here')}</div>
          : <div className="preview-answers">{q.options.map((o, i) => <div key={i} className={`play-tile ans-${i} ${showCorrect && usesCorrect(q.type) ? q.correct.includes(i) ? 'right' : 'wrong' : ''}`}>{q.type === 'order' && showCorrect ? <strong>{i + 1}</strong> : <Shape index={i} size={26} />}<span>{q.type === 'boolean' ? t(o) : o || t('Answer {n}', { n: i + 1 })}</span>{showCorrect && q.correct.includes(i) && <Icon name="check" size={24} />}</div>)}</div>}
        {showCorrect && <p className="explanation-box">{q.explanation || t('Add an explanation to share the story behind this answer.')}</p>}{showCorrect && q.revealImage && <img className="preview-image" src={q.revealImage} alt={t('Reveal image')} />}
        <button className="btn blue full" onClick={() => setShowCorrect(!showCorrect)}>{showCorrect ? t('Hide correct answer') : t('Reveal correct answer')}</button>
      </div>
    </Modal>}
  </div>;
}
