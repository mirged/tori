// A small, deliberately conservative nickname filter for the shared projector screen.
// Each letter may repeat ("fuuuck"), common leetspeak is decoded ("sh1t"), and
// spaced-out letters are rejoined ("f u c k"). Short words that hide inside
// innocent ones (Scunthorpe, peacock, grape) only match as whole words.
const leet: Record<string, string> = { '0': 'o', '1': 'i', '!': 'i', '|': 'i', '3': 'e', '4': 'a', '@': 'a', '5': 's', '$': 's', '7': 't', '8': 'b', '9': 'g', '+': 't' };
const anywhere = [
  'fuck', 'fuk', 'shit', 'bitch', 'nigg', 'faggot', 'retard', 'whore', 'pussy', 'asshole', 'dickhead', 'motherf', 'cocksuck', 'blowjob',
  'porn', 'penis', 'vagina', 'rapist', 'hitler', 'slut', 'twat', 'wank', 'jizz', 'dildo', 'horny', 'bastard', 'bollock',
  'pidor', 'pidar', 'blyat', 'blyad', 'pizd', 'nahui', 'nahuy', 'mudak', 'gandon', 'huesos',
  'хуй', 'хуе', 'хуя', 'пизд', 'ебан', 'ебат', 'ебал', 'бля', 'пидор', 'пидар', 'мудак', 'гандон',
];
const whole = [
  'ass', 'asses', 'cunt', 'cunts', 'dick', 'dicks', 'cock', 'cocks', 'fag', 'fags', 'rape', 'raped', 'cum', 'tit', 'tits', 'anal', 'sex', 'sexy',
  'hoe', 'hoes', 'kys', 'spic', 'chink', 'kike', 'coon', 'dyke', 'tranny', 'nazi', 'nazis', 'boob', 'boobs', 'suka', 'huy', 'hui', 'сука', 'хер',
];
const pattern = (word: string) => [...word].map(c => `${c}+`).join('');
const anywhereRegex = new RegExp(anywhere.map(pattern).join('|'), 'u');
const wholeRegex = new RegExp(`^(?:${whole.map(pattern).join('|')})$`, 'u');

export function isOffensiveName(name: string): boolean {
  const decoded = name.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[0-9!|@$+]/g, c => leet[c] ?? c);
  const tokens = decoded.split(/[^\p{L}]+/u).filter(Boolean);
  // Rejoin runs of single letters so "f u c k" or "s.h.i.t" become one word.
  const words = [...tokens]; let run = '';
  for (const token of [...tokens, '']) {
    if (token.length === 1) { run += token; continue; }
    if (run.length > 1) words.push(run);
    run = '';
  }
  return words.some(word => anywhereRegex.test(word) || wholeRegex.test(word));
}
