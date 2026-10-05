import { BadRequestException } from '@nestjs/common';
import {
  isLanguageCode,
  type LanguageCode,
} from '../../../common/sarvam/languages.js';
import type { AgentRole, CompanyProfile, Difficulty } from '../leads.types.js';

type Body = Record<string, unknown>;

function body(input: unknown): Body {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new BadRequestException('Send a JSON body');
  }
  return input as Body;
}

function requiredString(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new BadRequestException(`${field} is required`);
  }
  return value.trim().slice(0, max);
}

function optionalLanguage(value: unknown): LanguageCode | undefined {
  if (value === undefined) return undefined;
  if (!isLanguageCode(value))
    throw new BadRequestException('That language is not supported');
  return value;
}

export function agentRole(value: unknown): AgentRole {
  if (value !== 'rep' && value !== 'lead') {
    throw new BadRequestException('agentRole must be "rep" or "lead"');
  }
  return value;
}

export interface AnalyseDto {
  url: string;
  language?: LanguageCode;
}

export function parseAnalyse(input: unknown): AnalyseDto {
  const b = body(input);
  return {
    url: requiredString(b.url, 'url', 500),
    language: optionalLanguage(b.language),
  };
}

export interface CustomScenarioDto {
  agentRole: AgentRole;
  description: string;
  difficulty?: Difficulty;
  language?: LanguageCode;
}

export function parseCustomScenario(input: unknown): CustomScenarioDto {
  const b = body(input);
  const difficulty = b.difficulty;
  if (
    difficulty !== undefined &&
    !['easy', 'medium', 'hard'].includes(difficulty as string)
  ) {
    throw new BadRequestException('difficulty must be easy, medium or hard');
  }
  return {
    agentRole: agentRole(b.agentRole),
    description: requiredString(b.description, 'description', 1000),
    difficulty: difficulty as Difficulty | undefined,
    language: optionalLanguage(b.language),
  };
}

export interface StartCallDto {
  /** Omit to get a random scenario of `agentRole`. */
  scenarioId?: string;
  /** Which side the AI plays when picking at random. Defaults to `lead`. */
  agentRole: AgentRole;
  language?: LanguageCode;
  /** A built in speaker or a saved platform voice by name, for example "kunal". */
  voice?: string;
  /** Practice time in minutes, 1 to 10. Defaults to 5. */
  practiceMinutes: number;
}

export function parseStartCall(input: unknown): StartCallDto {
  const b = body(input);
  const rawMinutes = b.practiceMinutes;
  const minutes =
    rawMinutes === undefined ? 5 : Math.round(Number(rawMinutes));
  return {
    scenarioId:
      b.scenarioId === undefined
        ? undefined
        : requiredString(b.scenarioId, 'scenarioId', 100),
    agentRole: b.agentRole === undefined ? 'lead' : agentRole(b.agentRole),
    language: optionalLanguage(b.language),
    voice:
      b.voice === undefined ? undefined : requiredString(b.voice, 'voice', 100),
    practiceMinutes: Number.isFinite(minutes)
      ? Math.min(10, Math.max(1, minutes))
      : 5,
  };
}

export function parseTurn(input: unknown): string {
  return requiredString(body(input).message, 'message', 1000);
}

const PROFILE_TEXT = [
  'name',
  'industry',
  'oneLiner',
  'priceSignals',
  'tone',
] as const;
const PROFILE_LISTS = [
  'offerings',
  'buyers',
  'proofPoints',
  'likelyObjections',
  'competitors',
] as const;

export interface ProfileUpdateDto {
  profile: Partial<CompanyProfile>;
  regenerate: boolean;
}

export function parseProfileUpdate(input: unknown): ProfileUpdateDto {
  const b = body(input);
  const raw = body(b.profile ?? {});
  const profile: Partial<CompanyProfile> = {};
  for (const key of PROFILE_TEXT) {
    if (raw[key] !== undefined)
      profile[key] = requiredString(raw[key], key, 500);
  }
  for (const key of PROFILE_LISTS) {
    if (raw[key] === undefined) continue;
    if (!Array.isArray(raw[key]))
      throw new BadRequestException(`${key} must be a list`);
    profile[key] = (raw[key] as unknown[])
      .map((v) => requiredString(v, key, 300))
      .slice(0, 8);
  }
  const language = optionalLanguage(raw.language);
  if (language) profile.language = language;
  return { profile, regenerate: b.regenerate === true };
}

export interface LeadDto {
  name: string;
  email: string;
  phone?: string;
  role?: string;
  /** True when a bot filled the hidden field. Accept quietly and save nothing. */
  spam: boolean;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** The scorecard form. Consent is required, it is the basis for contacting them. */
export function parseLead(input: unknown): LeadDto {
  const b = body(input);
  if (typeof b.website === 'string' && b.website.trim()) {
    return { name: '', email: '', spam: true };
  }
  if (b.consent !== true) {
    throw new BadRequestException(
      'Please tick the box so we can contact you about this.',
    );
  }
  const name = requiredString(b.name, 'Your name', 120);
  const email = requiredString(b.email, 'Your email', 254).toLowerCase();
  if (!EMAIL.test(email)) {
    throw new BadRequestException('That email address does not look right.');
  }
  let phone: string | undefined;
  if (typeof b.phone === 'string' && b.phone.trim()) {
    phone = b.phone.trim().slice(0, 30);
    if (!/^[+\d][\d\s().-]{5,}$/.test(phone)) {
      throw new BadRequestException('That phone number does not look right.');
    }
  }
  const role =
    typeof b.role === 'string' && b.role.trim()
      ? b.role.trim().slice(0, 120)
      : undefined;
  return { name, email, phone, role, spam: false };
}
