import { Injectable } from '@nestjs/common';
import { SarvamService } from '../../../common/sarvam/sarvam.service.js';
import type { SitePage } from '../site/site-fetcher.service.js';
import type { EvidenceItem } from '../leads.types.js';

const EVIDENCE_TYPES = [
  'offering',
  'buyer',
  'proof',
  'pricing',
  'objection',
  'other',
] as const;

const SYSTEM = `You extract sales evidence from one company web page. Extract only what the page says, never personas, never scenarios, never advice.
Hard constraints:
- Every item needs a short quote copied from the page text. No quote, no item.
- Confidence is "explicit" when the page states it outright, "inferred" when it strongly implies it.
- Max 8 items per page. Prefer offerings, buyers, proof, pricing and objections.
Reply with one JSON object and nothing else:
{"evidence": [{"type": "offering" | "buyer" | "proof" | "pricing" | "objection" | "other", "claim": string, "quote": string (copied from the page), "section": string (page title or heading)}]}`;

interface RawEvidence {
  evidence?: {
    type?: unknown;
    claim?: unknown;
    quote?: unknown;
    section?: unknown;
    confidence?: unknown;
  }[];
}

const str = (v: unknown, fallback = ''): string =>
  typeof v === 'string' && v.trim() ? v.trim() : fallback;

/**
 * Pulls grounded claims out of pages. Each page is independent, so callers
 * fan these out in parallel. The scenario writer never sees raw HTML.
 */
@Injectable()
export class EvidenceService {
  constructor(private readonly sarvam: SarvamService) {}

  async extract(page: SitePage): Promise<EvidenceItem[]> {
    const raw = await this.sarvam.chatJsonTask<RawEvidence>(
      [
        { role: 'system', content: SYSTEM },
        {
          role: 'user',
          content: `PAGE ${page.url}\nTitle: ${page.title}\nDescription: ${page.description}\n${page.text.slice(0, 4000)}`,
        },
      ],
      { temperature: 0.2 },
    );
    const items: EvidenceItem[] = (raw.evidence ?? [])
      .map((item) => ({
        id: '',
        type: EVIDENCE_TYPES.includes(item?.type as never)
          ? (item?.type as EvidenceItem['type'])
          : ('other' as EvidenceItem['type']),
        claim: str(item?.claim),
        quote: str(item?.quote),
        sourceUrl: page.url,
        section: str(item?.section, page.title),
        confidence: (item?.confidence === 'inferred' ? 'inferred' : 'explicit') as
          | 'explicit'
          | 'inferred',
      }))
      .filter((item) => item.claim && item.quote);
    return items;
  }
}
