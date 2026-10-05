import type { SarvamService } from '../../../common/sarvam/sarvam.service.js';
import type { EvidenceItem } from '../leads.types.js';
import { EvidenceService } from './evidence.service.js';
import {
  fallbackUnderstanding,
  repairUnderstanding,
  toProfile,
  UnderstandingService,
  validateUnderstanding,
} from './understanding.service.js';

const fakeSarvam = (impl: {
  chatJsonTask?: (...a: unknown[]) => unknown;
}) => impl as unknown as SarvamService;

const page = {
  url: 'https://acme.test/pricing',
  title: 'Pricing',
  description: '',
  text: 'Plans start at 999 a month. Anvils for studios.',
};

const evidence: EvidenceItem[] = [
  {
    id: 'E1',
    type: 'offering',
    claim: 'Sells anvils',
    quote: 'Anvils for studios',
    sourceUrl: 'https://acme.test',
    section: 'Home',
    confidence: 'explicit',
  },
];

describe('EvidenceService', () => {
  it('keeps only quoted claims and tags the source page', async () => {
    const chatJsonTask = vi.fn().mockResolvedValue({
      evidence: [
        {
          type: 'pricing',
          claim: 'Starts at 999',
          quote: 'Plans start at 999 a month',
          section: 'Pricing',
          confidence: 'explicit',
        },
        { type: 'proof', claim: 'No quote here', quote: '' },
      ],
    });
    const items = await new EvidenceService(
      fakeSarvam({ chatJsonTask }),
    ).extract(page);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      type: 'pricing',
      claim: 'Starts at 999',
      sourceUrl: 'https://acme.test/pricing',
    });
  });
});

describe('UnderstandingService', () => {
  it('synthesizes understanding and drops unknown evidence ids', async () => {
    const chatJsonTask = vi.fn().mockResolvedValue({
      name: 'Acme',
      whatTheyDo: 'Anvils for studios',
      language: 'en-IN',
      products: [
        {
          name: 'Anvils',
          targetBuyers: ['Head of Ops'],
          evidenceIds: ['E1', 'E99'],
        },
      ],
      buyers: [{ role: 'Head of Ops', offering: 'Anvils', evidenceIds: [] }],
      unknowns: ['Implementation timeline'],
    });
    const u = await new UnderstandingService(
      fakeSarvam({ chatJsonTask }),
    ).synthesize(evidence);
    expect(u.name).toBe('Acme');
    expect(u.products[0].evidenceIds).toEqual(['E1']);
    expect(validateUnderstanding(u)).toBeUndefined();
  });

  it('rejects understanding with no grounded offering', () => {
    expect(
      validateUnderstanding({
        name: 'Acme',
        whatTheyDo: '',
        category: '',
        language: 'en-IN',
        products: [{ name: '', evidenceIds: [] }],
        buyers: [],
        useCases: [],
        buyingTriggers: [],
        proofPoints: [],
        commercialSignals: [],
        competitors: [],
        unknowns: [],
        unsupportedClaims: [],
        evidence: [],
      } as never),
    ).toBe('no offering traces to evidence');
  });

  it('maps understanding onto the call profile', () => {    const u = {
      name: 'Acme',
      whatTheyDo: 'Anvils for studios',
      category: 'Manufacturing',
      language: 'te-IN',
      products: [{ name: 'Anvils', evidenceIds: ['E1'] }],
      buyers: [{ role: 'Head of Ops', offering: 'Anvils', concerns: ['price'] }],
      proofPoints: ['100 studios'],
      commercialSignals: ['Starts at 999'],
      competitors: [],
      unknowns: [],
      unsupportedClaims: [],
      evidence,
    } as never;
    const profile = toProfile(u, 'Fallback');
    expect(profile).toMatchObject({
      name: 'Acme',
      industry: 'Manufacturing',
      oneLiner: 'Anvils for studios',
      language: 'te-IN',
    });
    expect(profile.offerings).toEqual(['Anvils']);
    expect(profile.likelyObjections).toContain('price');
  });
});

describe('repairUnderstanding', () => {
  const broken = {
    name: 'Acme',
    whatTheyDo: 'Anvils for studios',
    category: '',
    language: 'en-IN',
    products: [
      {
        name: 'AI Visibility Platform',
        description: '',
        capabilities: [],
        problemsSolved: [],
        targetBuyers: [],
        valueProposition: [],
        proof: [],
        evidenceIds: ['E1'],
      },
    ],
    buyers: [
      {
        role: 'Founder',
        offering: 'SEO tool',
        goals: [],
        concerns: [],
        buyingContexts: [],
        evidenceIds: [],
      },
    ],
    useCases: [],
    buyingTriggers: [],
    proofPoints: [],
    commercialSignals: [],
    competitors: [],
    unknowns: [],
    unsupportedClaims: [],
    evidence,
  } as never;

  it('remaps orphan buyers onto the closest real product', () => {
    expect(validateUnderstanding(broken)).toBe(
      'buyers do not map to any offering',
    );
    const fixed = repairUnderstanding(broken, 'Acme');
    expect(validateUnderstanding(fixed)).toBeUndefined();
    expect(fixed.buyers[0].offering).toBe('AI Visibility Platform');
  });

  it('synthesizes practice buyers when the model produced none', () => {
    const fixed = repairUnderstanding(
      { ...(broken as object), buyers: [] } as never,
      'Acme',
    );
    expect(fixed.buyers.length).toBeGreaterThan(0);
    expect(validateUnderstanding(fixed)).toBeUndefined();
  });

  it('falls back to a generic understanding that always passes', () => {
    const fallback = fallbackUnderstanding('Acme', evidence);
    expect(validateUnderstanding(fallback)).toBeUndefined();
    expect(fallback.buyers[0].offering).toBe(
      fallback.products[0].name,
    );
  });
});

describe('UnderstandingService.repair', () => {
  it('sends the failure reason and normalizes the fixed shape', async () => {
    const chatJsonTask = vi.fn().mockResolvedValue({
      name: 'Acme',
      products: [{ name: 'Anvils', evidenceIds: ['E1'] }],
      buyers: [{ role: 'Head of Ops', offering: 'Anvils' }],
    });
    const broken = {
      name: 'Acme',
      products: [],
      buyers: [],
      evidence,
    } as never;
    const fixed = await new UnderstandingService(
      fakeSarvam({ chatJsonTask }),
    ).repair(evidence, broken, 'no offering traces to evidence');
    expect(fixed.products[0].name).toBe('Anvils');
    const prompt = String(chatJsonTask.mock.calls[0][0][1].content);
    expect(prompt).toContain('no offering traces to evidence');
    expect(prompt).toContain('Fix ONLY that problem');
  });
});
