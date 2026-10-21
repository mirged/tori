import { lt } from './lt';

// English text is the translation key, so untranslated strings fall back to
// readable English. `{name}` placeholders are filled from `vars`.
export type Lang = 'en' | 'lt';
export const languages: { id: Lang; label: string; name: string }[] = [
  { id: 'en', label: 'EN', name: 'English' },
  { id: 'lt', label: 'LT', name: 'Lietuvių' },
];
function detect(): Lang {
  try {
    const saved = localStorage.getItem('tori.lang');
    if (saved === 'en' || saved === 'lt') return saved;
  } catch { /* storage unavailable */ }
  return typeof navigator !== 'undefined' && /^lt\b/i.test(navigator.language || '') ? 'lt' : 'en';
}
let current: Lang = detect();
const listeners = new Set<() => void>();
export const getLang = () => current;
export function setLang(lang: Lang) {
  current = lang;
  try { localStorage.setItem('tori.lang', lang); } catch { /* optional preference */ }
  if (typeof document !== 'undefined') document.documentElement.lang = lang;
  listeners.forEach(listener => listener());
}
export function onLangChange(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
if (typeof document !== 'undefined') document.documentElement.lang = current;

export function t(text: string, vars?: Record<string, string | number>): string {
  const template = current === 'lt' ? lt[text] ?? text : text;
  return vars ? template.replace(/\{(\w+)\}/g, (match, key) => key in vars ? String(vars[key]) : match) : template;
}
/** Lithuanian has three plural forms: 1 (and 21, 31…), 2–9 (and 22–29…), and 0/10–20. */
const nouns: Record<string, { en: [string, string]; lt: [string, string, string] }> = {
  question: { en: ['question', 'questions'], lt: ['klausimas', 'klausimai', 'klausimų'] },
  player: { en: ['player', 'players'], lt: ['žaidėjas', 'žaidėjai', 'žaidėjų'] },
  answer: { en: ['answer', 'answers'], lt: ['atsakymas', 'atsakymai', 'atsakymų'] },
  point: { en: ['point', 'points'], lt: ['taškas', 'taškai', 'taškų'] },
};
export function plural(n: number, noun: keyof typeof nouns, withNumber = true) {
  const forms = nouns[noun];
  let word: string;
  if (current === 'lt') {
    const ones = n % 10, tens = n % 100;
    word = forms.lt[ones === 1 && tens !== 11 ? 0 : ones >= 2 && ones <= 9 && (tens < 11 || tens > 19) ? 1 : 2];
  } else word = forms.en[n === 1 ? 0 : 1];
  return withNumber ? `${n.toLocaleString(current)} ${word}` : word;
}
/** "1st" / "1-oje" for sentences like "You're in {place} place". */
export function place(n: number) {
  if (current === 'lt') return `${n}-oje`;
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
/** "1st" / "1." for badges. */
export function rankLabel(n: number) { return current === 'lt' ? `${n}.` : place(n); }
export const num = (n: number) => n.toLocaleString(current === 'lt' ? 'lt-LT' : 'en-US');
