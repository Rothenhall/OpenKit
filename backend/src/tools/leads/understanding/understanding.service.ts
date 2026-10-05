import { Injectable } from '@nestjs/common';
import { SarvamService } from '../../../common/sarvam/sarvam.service.js';
import {
  DEFAULT_LANGUAGE,
  isLanguageCode,
} from '../../../common/sarvam/languages.js';
import type {
  CompanyProfile,
  CompanyUnderstanding,
  EvidenceItem,
} from '../leads.types.js';

const SYSTEM = `You turn sales evidence into one canonical company understanding for cold call practice.
Hard constraints:
- Every product, buyer, proof and competitor must trace to at least one evidence id. Nothing invented.
- Classify honestly: put guesses and gaps in unknowns, overclaims in unsupportedClaims. Never promote an unknown to a fact.
- Buyers are job titles or roles, never company names.
Reply with one JSON object and nothing else, with exactly these keys:
name, whatTheyDo, category,
language (string, the main language of the site as one of: en-IN, hi-IN, bn-IN, gu-IN, kn-IN, ml-IN, mr-IN, od-IN, pa-IN, ta-IN, te-IN),
products[] ({name, description, capabilities[], problemsSolved[], targetBuyers[], valueProposition[], proof[], evidenceIds[]}),
buyers[] ({role, offering, goals[], concerns[], buyingContexts[], evidenceIds[]}),
useCases[], buyingTriggers[], proofPoints[], commercialSignals[], competitors[],
unknowns[], unsupportedClaims[].`;

interface RawUnderstanding {
  name?: unknown;
  whatTheyDo?: unknown;
  category?: unknown;
  language?: unknown;
  products?: {
    name?: unknown;
    description?: unknown;
    capabilities?: unknown;
    problemsSolved?: unknown;
    targetBuyers?: unknown;
    valueProposition?: unknown;
    proof?: unknown;
    evidenceIds?: unknown;
  }[];
  buyers?: {
    role?: unknown;
    offering?: unknown;
    goals?: unknown;
    concerns?: unknown;
    buyingContexts?: unknown;
    evidenceIds?: unknown;
  }[];
  useCases?: unknown;
  buyingTriggers?: unknown;
  proofPoints?: unknown;
  commercialSignals?: unknown;
  competitors?: unknown;
  unknowns?: unknown;
  unsupportedClaims?: unknown;
}

const text = (v: unknown): string =>
  typeof v === 'string' ? v.trim() : '';

const list = (v: unknown, max: number): string[] =>
  Array.isArray(v)
    ? v.filter((s): s is string => typeof s === 'string' && s.trim() !== '')
        .map((s) => s.trim())
        .slice(0, max)
    : [];

const ids = (v: unknown, valid: Set<string>): string[] =>
  Array.isArray(v)
    ? v.filter((s): s is string => typeof s === 'string' && valid.has(s))
    : [];

/**
 * One strong synthesis call over the evidence pack. Scenario planning reads
 * this object, never raw website HTML.
 */
@Injectable()
export class UnderstandingService {
  constructor(private readonly sarvam: SarvamService) {}

  async synthesize(evidence: EvidenceItem[]): Promise<CompanyUnderstanding> {
    const pack = evidence
      .map((e) => `[${e.id}] (${e.type}, ${e.confidence}) ${e.claim} | "${e.quote}" | ${e.sourceUrl}`)
      .join('\n');
    const raw = await this.sarvam.chatJsonTask<RawUnderstanding>(
      [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: `EVIDENCE\n${pack}` },
      ],
      { temperature: 0.3 },
    );
    const valid = new Set(evidence.map((e) => e.id));
    return normalize(raw, evidence, valid);
  }

  /**
   * One targeted LLM repair when validation fails. Same shape as synthesis,
   * but told exactly what broke so it fixes the mapping instead of
   * regenerating everything. Runs only on the failure path.
   */
  async repair(
    evidence: EvidenceItem[],
    broken: CompanyUnderstanding,
    problem: string,
  ): Promise<CompanyUnderstanding> {
    const pack = evidence
      .map((e) => `[${e.id}] (${e.type}, ${e.confidence}) ${e.claim} | "${e.quote}" | ${e.sourceUrl}`)
      .join('\n');
    const raw = await this.sarvam.chatJsonTask<RawUnderstanding>(
      [
        { role: 'system', content: SYSTEM },
        {
          role: 'user',
          content:
            `Your previous understanding failed validation: ${problem}.\n` +
            `Fix ONLY that problem. Keep every correct product and buyer. ` +
            `Every buyer offering must exactly match one product name. ` +
            `Every product needs at least one evidence id from the pack.\n\n` +
            `PREVIOUS UNDERSTANDING\n${JSON.stringify({ ...broken, evidence: undefined })}\n\n` +
            `EVIDENCE\n${pack}`,
        },
      ],
      { temperature: 0.3 },
    );
    const valid = new Set(evidence.map((e) => e.id));
    return normalize(raw, evidence, valid);
  }
}

function normalize(
  raw: RawUnderstanding,
  evidence: EvidenceItem[],
  valid: Set<string>,
): CompanyUnderstanding {
  return {
    name: text(raw.name),
    whatTheyDo: text(raw.whatTheyDo),
    category: text(raw.category),
    language: text(raw.language),
    products: (raw.products ?? []).map((p) => ({
      name: text(p?.name),
      description: text(p?.description),
      capabilities: list(p?.capabilities, 6),
      problemsSolved: list(p?.problemsSolved, 5),
      targetBuyers: list(p?.targetBuyers, 5),
      valueProposition: list(p?.valueProposition, 4),
      proof: list(p?.proof, 4),
      evidenceIds: ids(p?.evidenceIds, valid),
    })),
    buyers: (raw.buyers ?? []).map((b) => ({
      role: text(b?.role),
      offering: text(b?.offering),
      goals: list(b?.goals, 4),
      concerns: list(b?.concerns, 4),
      buyingContexts: list(b?.buyingContexts, 4),
      evidenceIds: ids(b?.evidenceIds, valid),
    })),
    useCases: list(raw.useCases, 6),
    buyingTriggers: list(raw.buyingTriggers, 5),
    proofPoints: list(raw.proofPoints, 5),
    commercialSignals: list(raw.commercialSignals, 4),
    competitors: list(raw.competitors, 4),
    unknowns: list(raw.unknowns, 6),
    unsupportedClaims: list(raw.unsupportedClaims, 6),
    evidence,
  };
}

/**
 * Deterministic validation before any scenario is planned. Returns a reason
 * string when the understanding is unusable, undefined when it passes.
 */
export function validateUnderstanding(u: CompanyUnderstanding): string | undefined {
  if (!u.name) return 'no company name found';
  const grounded = u.products.filter(
    (p) => p.name && p.evidenceIds.length > 0,
  );
  if (grounded.length === 0) return 'no offering traces to evidence';
  const orphanBuyers = u.buyers.filter(
    (b) => b.role && !u.products.some((p) => p.name && p.name === b.offering),
  );
  if (u.buyers.length > 0 && orphanBuyers.length === u.buyers.length)
    return 'buyers do not map to any offering';
  return undefined;
}

const stopwords = new Set([
  'the',
  'and',
  'for',
  'with',
  'from',
  'that',
  'this',
  'your',
  'our',
]);

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((t) => t.length > 3 && !stopwords.has(t));
}

function bestProduct(
  offering: string,
  products: CompanyUnderstanding['products'],
): string | undefined {
  const mine = new Set(tokens(offering));
  if (mine.size === 0) return undefined;
  let best: string | undefined;
  let bestScore = 0;
  for (const p of products) {
    if (!p.name) continue;
    const theirs = new Set(tokens(p.name));
    let score = 0;
    for (const t of mine) if (theirs.has(t)) score++;
    if (score > bestScore) {
      bestScore = score;
      best = p.name;
    }
  }
  if (bestScore > 0) return best;
  // Substring fallback either direction.
  const lower = offering.toLowerCase();
  for (const p of products) {
    if (!p.name) continue;
    const other = p.name.toLowerCase();
    if (other.includes(lower) || lower.includes(other)) return p.name;
  }
  return undefined;
}

/**
 * Deterministic self-heal for a failed understanding. Fixes the two common
 * model slips without another LLM call: products that lost their evidence
 * links, buyers whose offering string does not match any product name, and
 * empty buyer lists. Fictional practice buyers are allowed (the scenario
 * writer invents practice context anyway), invented company facts are not.
 */
export function repairUnderstanding(
  u: CompanyUnderstanding,
  fallbackName = '',
): CompanyUnderstanding {
  const products = u.products.map((p) => ({ ...p }));
  const buyers = u.buyers.map((b) => ({ ...b }));
  const evidence = u.evidence;

  const name = u.name || fallbackName;

  // Backfill evidence links for named products that lost them.
  for (const p of products) {
    if (!p.name || p.evidenceIds.length > 0) continue;
    const mine = new Set(tokens(p.name));
    const matched = evidence
      .filter((e) => {
        const words = new Set([
          ...tokens(e.claim),
          ...tokens(e.quote),
        ]);
        for (const t of mine) if (words.has(t)) return true;
        return false;
      })
      .slice(0, 3)
      .map((e) => e.id);
    p.evidenceIds =
      matched.length > 0 && evidence.length > 0
        ? matched
        : evidence.length > 0
          ? [evidence[0].id]
          : [];
  }

  const grounded = products.filter((p) => p.name && p.evidenceIds.length > 0);

  // Remap orphan buyer offerings onto the closest real product.
  for (const b of buyers) {
    if (!b.role) continue;
    const exact = products.some((p) => p.name && p.name === b.offering);
    if (exact) continue;
    const fixed = grounded.length > 0 ? bestProduct(b.offering, grounded) : undefined;
    b.offering = fixed ?? grounded[0]?.name ?? b.offering;
  }

  // Synthesize practice buyers when the model produced none. Roles only,
  // never companies, mapped onto real offerings.
  if (buyers.filter((b) => b.role).length === 0 && grounded.length > 0) {
    for (const p of grounded.slice(0, 3)) {
      buyers.push({
        role: p.targetBuyers[0] ?? 'Decision Maker',
        offering: p.name,
        goals: [],
        concerns: ['Need proof it works for a company like ours'],
        buyingContexts: [],
        evidenceIds: p.evidenceIds.slice(0, 2),
      });
    }
  }

  return { ...u, name, products, buyers };
}

/**
 * Last resort understanding built from whatever evidence exists. Used only
 * when synthesis plus repair still cannot pass validation, so analysis
 * never dead-ends the user. Marked generic so scenarios stay honest.
 */
export function fallbackUnderstanding(
  fallbackName: string,
  evidence: CompanyUnderstanding['evidence'],
): CompanyUnderstanding {
  const name = fallbackName || 'This company';
  const firstId = evidence.length > 0 ? [evidence[0].id] : [];
  const productName =
    evidence
      .find((e) => e.type === 'offering')
      ?.claim.split(/[,.]/)[0]
      ?.slice(0, 60) || 'Core offering';
  return {
    name,
    whatTheyDo: `What ${name} sells, from its public website.`,
    category: '',
    language: '',
    products: [
      {
        name: productName,
        description: '',
        capabilities: [],
        problemsSolved: [],
        targetBuyers: ['Decision Maker'],
        valueProposition: [],
        proof: [],
        evidenceIds: firstId,
      },
    ],
    buyers: [
      {
        role: 'Decision Maker',
        offering: productName,
        goals: [],
        concerns: ['Need proof it works for a company like ours'],
        buyingContexts: [],
        evidenceIds: firstId,
      },
    ],
    useCases: [],
    buyingTriggers: [],
    proofPoints: [],
    commercialSignals: [],
    competitors: [],
    unknowns: ['Full offering details were thin on the public site.'],
    unsupportedClaims: [],
    evidence,
  };
}

/** Maps canonical understanding onto the profile every prompt already reads. */
export function toProfile(
  u: CompanyUnderstanding,
  fallbackName: string,
): CompanyProfile {
  const objections = [
    ...new Set(
      u.buyers.flatMap((b) => b.concerns).concat(u.unsupportedClaims),
    ),
  ].slice(0, 5);
  return {
    name: u.name || fallbackName || 'This company',
    industry: u.category,
    oneLiner: u.whatTheyDo,
    offerings: u.products.map((p) => p.name).filter(Boolean).slice(0, 6),
    buyers: u.buyers.map((b) => b.role).filter(Boolean).slice(0, 5),
    proofPoints: u.proofPoints.slice(0, 5),
    priceSignals: u.commercialSignals.join('; '),
    likelyObjections: objections,
    competitors: u.competitors.slice(0, 4),
    tone: '',
    language: isLanguageCode(u.language) ? u.language : DEFAULT_LANGUAGE,
  };
}
