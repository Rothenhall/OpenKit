import { Injectable } from '@nestjs/common';
import { SarvamService } from '../../../common/sarvam/sarvam.service.js';
import {
  DEFAULT_LANGUAGE,
  LANGUAGES,
  isLanguageCode,
} from '../../../common/sarvam/languages.js';
import type { SitePage } from '../site/site-fetcher.service.js';
import type { CompanyProfile } from '../leads.types.js';

const MAX_SITE_CHARS = 24000;

const SYSTEM = `You read a company's website text and write a factual sales profile for cold call practice.
Hard constraints, always follow:
- Use only facts that appear in the text. If something is not stated, use an empty string or an empty list.
- Never invent customers, numbers, prices or results.
- Buyers must be job titles or buyer roles (for example "Head of Operations"), never company names.
- Every objection must connect to something on the site: the offering, the price signals, or a missing proof point.
Soft constraints, follow when the text allows:
- OneLiner names what they sell and for whom, max 25 words.
- ProofPoints keep the site's own numbers and customer names, quoted briefly.
Reply with one JSON object and nothing else, with exactly these keys:
name (string), industry (string), oneLiner (string),
offerings (string[], max 6), buyers (string[], max 5),
proofPoints (string[], max 5),
priceSignals (string, what the site says about pricing),
likelyObjections (string[], max 5),
competitors (string[], only if named or obvious from the text, max 4),
tone (string, how the company sounds, max 8 words),
language (string, the main language of the site as one of: ${Object.keys(LANGUAGES).join(', ')}).`;

export function siteToPrompt(pages: SitePage[]): string {
  const text = pages
    .map(
      (p) =>
        `PAGE ${p.url}\nTitle: ${p.title}\nDescription: ${p.description}\n${p.text}`,
    )
    .join('\n\n');
  return text.slice(0, MAX_SITE_CHARS);
}

@Injectable()
export class ProfileService {
  constructor(private readonly sarvam: SarvamService) {}

  async buildProfile(pages: SitePage[]): Promise<CompanyProfile> {
    const raw = await this.sarvam.chatJson<Partial<CompanyProfile>>([
      { role: 'system', content: SYSTEM },
      { role: 'user', content: siteToPrompt(pages) },
    ]);
    return normaliseProfile(raw, pages[0]?.title ?? '');
  }
}

const list = (value: unknown, max: number): string[] =>
  Array.isArray(value)
    ? value
        .filter((v): v is string => typeof v === 'string' && v.trim() !== '')
        .slice(0, max)
    : [];

const text = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

export function normaliseProfile(
  raw: Partial<CompanyProfile>,
  fallbackName: string,
): CompanyProfile {
  return {
    name: text(raw.name) || fallbackName || 'This company',
    industry: text(raw.industry),
    oneLiner: text(raw.oneLiner),
    offerings: list(raw.offerings, 6),
    buyers: list(raw.buyers, 5),
    proofPoints: list(raw.proofPoints, 5),
    priceSignals: text(raw.priceSignals),
    likelyObjections: list(raw.likelyObjections, 5),
    competitors: list(raw.competitors, 4),
    tone: text(raw.tone),
    language: isLanguageCode(raw.language) ? raw.language : DEFAULT_LANGUAGE,
  };
}
