/** Languages Sarvam chat, speech to text and text to speech all support. */
export const LANGUAGES = {
  'en-IN': 'English',
  'hi-IN': 'Hindi',
  'bn-IN': 'Bengali',
  'gu-IN': 'Gujarati',
  'kn-IN': 'Kannada',
  'ml-IN': 'Malayalam',
  'mr-IN': 'Marathi',
  'od-IN': 'Odia',
  'pa-IN': 'Punjabi',
  'ta-IN': 'Tamil',
  'te-IN': 'Telugu',
} as const;

export type LanguageCode = keyof typeof LANGUAGES;

export const DEFAULT_LANGUAGE: LanguageCode = 'en-IN';

export function isLanguageCode(value: unknown): value is LanguageCode {
  return typeof value === 'string' && value in LANGUAGES;
}

/** Each script and the languages written in it. The first is the default. */
const SCRIPTS: [RegExp, LanguageCode[]][] = [
  [/[ऀ-ॿ]/g, ['hi-IN', 'mr-IN']],
  [/[ঀ-৿]/g, ['bn-IN']],
  [/[਀-੿]/g, ['pa-IN']],
  [/[઀-૿]/g, ['gu-IN']],
  [/[଀-୿]/g, ['od-IN']],
  [/[஀-௿]/g, ['ta-IN']],
  [/[ఀ-౿]/g, ['te-IN']],
  [/[ಀ-೿]/g, ['kn-IN']],
  [/[ഀ-ൿ]/g, ['ml-IN']],
];

/**
 * Works out which language the user is speaking, from the script in their
 * text. Works for any supported language, including code-mixed speech such
 * as Telugu+English or Hindi+English, where Sarvam returns Indic words in
 * native script and English words in English.
 * `preferred` is the call's current language. It wins when it shares the
 * script, for example Marathi and Hindi, and it is kept when the native
 * share is small, so a single "dhanyavad" does not flip an English call.
 */
export function languageOfText(
  text: string,
  preferred: LanguageCode,
): LanguageCode {
  let best: { count: number; languages: LanguageCode[] } | undefined;
  for (const [pattern, languages] of SCRIPTS) {
    const count = text.match(pattern)?.length ?? 0;
    if (count > (best?.count ?? 0)) best = { count, languages };
  }
  const latin = text.match(/[A-Za-z]/g)?.length ?? 0;
  if (!best || latin > best.count * 3) return 'en-IN';
  return best.languages.includes(preferred) ? preferred : best.languages[0];
}

/**
 * Which language code Bulbul text to speech should use. Unlike
 * `languageOfText`, this prefers the native language as soon as a few native
 * characters are present, even in English-dominant mixes. Bulbul handles
 * code-mixed text on its own, but it needs the native code for correct
 * normalisation, and Romanised Indic input sounds worse per Sarvam docs.
 */
export function ttsLanguageFor(
  text: string,
  preferred: LanguageCode,
): LanguageCode {
  let best: { count: number; languages: LanguageCode[] } | undefined;
  for (const [pattern, languages] of SCRIPTS) {
    const count = text.match(pattern)?.length ?? 0;
    if (count > (best?.count ?? 0)) best = { count, languages };
  }
  if (!best || best.count < 3) {
    // Models sometimes write Hindi or Telugu in Roman letters anyway. An
    // English voice reads those words with English sounds, so keep the call's
    // own language, Bulbul pronounces romanised Indic far better that way.
    return preferred !== 'en-IN' && looksRomanisedIndic(text)
      ? preferred
      : 'en-IN';
  }
  return best.languages.includes(preferred) ? preferred : best.languages[0];
}

const ROMAN_INDIC = new Set(
  (
    'haan han nahi nahin hai hain hoon kya aap ap hum main mujhe mera meri ' +
    'tumhara aapka aapki aapke ko ke ki ka mein par bolo batao bataiye acha ' +
    'accha theek thik kaise kaisa kitna kitne abhi pehle phir lekin magar ' +
    'bahut sab kuch karo karna kar raha rahe rahi sakta sakte chahiye zaroor ' +
    'dhanyavad namaste ji nahi ' +
    'ledu undi avunu enti cheppandi baagundi ' +
    'illa irukku sollunga vanakkam romba ' +
    'aahe nahi kay tumhi ' +
    'achhe bhalo ki koro'
  ).split(' '),
);

/** True when the text reads as Hindi, Telugu, Tamil and the like in Roman letters. */
export function looksRomanisedIndic(text: string): boolean {
  let hits = 0;
  for (const word of text.toLowerCase().match(/[a-z]+/g) ?? []) {
    if (ROMAN_INDIC.has(word) && ++hits >= 2) return true;
  }
  return false;
}
