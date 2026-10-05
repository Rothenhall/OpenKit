/** Bulbul v3 voices, grouped so a persona can get a voice that fits them. */
const FEMALE = [
  'ritu',
  'priya',
  'neha',
  'pooja',
  'simran',
  'kavya',
  'ishita',
  'shreya',
  'roopa',
  'tanya',
  'shruti',
  'suhani',
  'kavitha',
  'rupali',
] as const;

const MALE = [
  'shubh',
  'aditya',
  'rahul',
  'rohan',
  'amit',
  'dev',
  'ratan',
  'varun',
  'manan',
  'sumit',
  'kabir',
  'aayan',
  'ashutosh',
  'advait',
  'anand',
  'tarun',
  'sunny',
  'mani',
  'gokul',
  'vijay',
  'mohit',
  'rehan',
  'soham',
] as const;

export type Voice = (typeof FEMALE)[number] | (typeof MALE)[number];
export type Gender = 'female' | 'male';

import type { LanguageCode } from './languages.js';

/**
 * Best Bulbul v3 speaker per language, from Sarvam's measured pronunciation
 * accuracy (CER) rankings. First entry is the top pick. A voice that scores
 * well in the call's language sounds natural, others can sound flat or
 * mispronounce words, so always pick from this table, never at random.
 */
const BEST_VOICES: Record<LanguageCode, { male: Voice[]; female: Voice[] }> =
  {
    'en-IN': { male: ['ratan'], female: ['ishita'] },
    'hi-IN': { male: ['shubh', 'ashutosh'], female: ['priya', 'suhani'] },
    'te-IN': { male: ['shubh', 'ratan'], female: ['neha', 'priya'] },
    'kn-IN': { male: ['shubh', 'ratan'], female: ['neha', 'ishita'] },
    'bn-IN': { male: ['rehan'], female: ['roopa', 'suhani'] },
    'ta-IN': { male: ['ratan', 'rohan'], female: ['ishita', 'ritu'] },
    'od-IN': { male: ['shubh'], female: ['ritu', 'pooja'] },
    'ml-IN': { male: ['shubh'], female: ['pooja'] },
    'mr-IN': { male: ['ratan'], female: ['priya', 'ritu'] },
    'pa-IN': { male: ['mani'], female: ['roopa', 'suhani'] },
    'gu-IN': { male: ['ratan'], female: ['priya', 'ritu'] },
  };

function hash(text: string): number {
  let h = 0;
  for (const char of text) h = (h * 31 + char.charCodeAt(0)) >>> 0;
  return h;
}

/**
 * Picks a top-ranked voice for the gender and language. The same seed always
 * gets the same voice, so a persona sounds consistent across calls, and
 * different personas get different voices from the ranked list.
 */
export function pickVoice(
  gender: Gender,
  seed: string,
  language: LanguageCode = 'en-IN',
): Voice {
  const pool = BEST_VOICES[language][gender];
  return pool[hash(seed) % pool.length];
}

/** A voice saved on the Sarvam platform, such as a cloned one. Ids look like `svc-<uuid>`. */
export type CustomVoiceId = `svc-${string}`;
export type VoiceId = Voice | CustomVoiceId;

export function isCustomVoice(value: string): value is CustomVoiceId {
  return value.startsWith('svc-');
}

export function isBuiltInVoice(value: string): value is Voice {
  return (
    (FEMALE as readonly string[]).includes(value) ||
    (MALE as readonly string[]).includes(value)
  );
}

export function isGender(value: unknown): value is Gender {
  return value === 'female' || value === 'male';
}
