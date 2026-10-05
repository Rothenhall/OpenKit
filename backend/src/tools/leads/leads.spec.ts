import { extractJson } from '../../common/sarvam/json.js';
import type { SarvamService } from '../../common/sarvam/sarvam.service.js';
import { CallService } from './call/call.service.js';
import {
  parseAnalyse,
  parseCustomScenario,
  parseProfileUpdate,
  parseStartCall,
} from './dto/leads.dto.js';
import type {
  CompanyProfile,
  CompanyUnderstanding,
  Scenario,
} from './leads.types.js';
import { buildSystemPrompt, connectCue } from './persona/persona-prompt.js';
import { normaliseProfile } from './profile/profile.service.js';
import { ScenariosService, toScenario } from './scenarios/scenarios.service.js';
import { SessionStore } from './session/session.store.js';

const profile: CompanyProfile = normaliseProfile(
  {
    name: 'Acme',
    oneLiner: 'Anvils for studios',
    language: 'hi-IN',
    offerings: ['Anvils'],
  },
  '',
);

const fakeSarvam = (impl: {
  chat?: (...a: unknown[]) => unknown;
  chatJson?: (...a: unknown[]) => unknown;
  chatJsonTask?: (...a: unknown[]) => unknown;
}) => impl as unknown as SarvamService;

const THEMES = [
  'price too high',
  'no budget this quarter',
  'send an email first',
  'bad timing this month',
  'burned by agencies before',
];

const rawScenario = (n: number) => ({
  title: `Scenario ${n}`,
  situation: 'Busy week',
  lead: {
    name: 'Meera Rao',
    jobTitle: 'Head of Ops',
    mood: 'rushed',
    objections: [THEMES[(n - 1) % THEMES.length], 'send email'],
  },
  goal: 'Book a demo',
  difficulty: 'hard',
});

const blueprint = (n: number) => ({
  offering: 'Anvils',
  buyer: 'Head of Ops',
  seniority: 'senior',
  buyingContext: 'Busy week',
  buyerGoal: 'Save time',
  mood: 'rushed',
  primaryFriction: `friction theme ${n}`,
  secondaryFrictions: [],
  difficulty: 'hard',
  evidenceIds: ['E1'],
  forbiddenClaims: [],
  repTrap: 'Pitching too early',
  successCondition: 'Book a demo',
});

const understanding: CompanyUnderstanding = {
  name: 'Acme',
  whatTheyDo: 'Anvils for studios',
  category: 'Manufacturing',
  language: 'hi-IN',
  products: [
    {
      name: 'Anvils',
      description: 'Heavy anvils',
      capabilities: [],
      problemsSolved: [],
      targetBuyers: ['Head of Ops'],
      valueProposition: [],
      proof: [],
      evidenceIds: ['E1'],
    },
  ],
  buyers: [
    {
      role: 'Head of Ops',
      offering: 'Anvils',
      goals: [],
      concerns: [],
      buyingContexts: [],
      evidenceIds: ['E1'],
    },
  ],
  useCases: [],
  buyingTriggers: [],
  proofPoints: [],
  commercialSignals: [],
  competitors: [],
  unknowns: [],
  unsupportedClaims: [],
  evidence: [
    {
      id: 'E1',
      type: 'offering',
      claim: 'Sells anvils',
      quote: 'Anvils for studios',
      sourceUrl: 'https://acme.test',
      section: 'Home',
      confidence: 'explicit',
    },
  ],
};

describe('extractJson', () => {
  it('handles reasoning blocks and code fences', () => {
    expect(
      extractJson('<think>hmm {x}</think>\n```json\n{"a":1}\n```'),
    ).toEqual({ a: 1 });
  });
  it('throws when there is no object', () => {
    expect(() => extractJson('sorry')).toThrow();
  });
});

describe('normaliseProfile', () => {
  it('falls back safely on missing or wrong fields', () => {
    const p = normaliseProfile(
      { language: 'xx' as never, offerings: 'nope' as never },
      'Fallback Ltd',
    );
    expect(p.name).toBe('Fallback Ltd');
    expect(p.language).toBe('en-IN');
    expect(p.offerings).toEqual([]);
  });
});

describe('ScenariosService', () => {
  it('plans one matrix then writes scenarios in parallel', async () => {
    const chatJson = vi
      .fn()
      .mockResolvedValueOnce({ blueprints: [1, 2, 3, 4].map(blueprint) })
      .mockResolvedValueOnce(rawScenario(1))
      .mockResolvedValueOnce(rawScenario(2))
      .mockResolvedValueOnce(rawScenario(3))
      .mockResolvedValueOnce(rawScenario(4));
    const service = new ScenariosService(fakeSarvam({ chatJsonTask: chatJson }));
    const scenarios = await service.generate(understanding, 'lead', 'hi-IN');
    expect(scenarios).toHaveLength(4);
    expect(scenarios[0]).toMatchObject({
      agentRole: 'lead',
      language: 'hi-IN',
      difficulty: 'hard',
      custom: false,
    });
    expect(new Set(scenarios.map((s) => s.id)).size).toBe(4);
    expect(chatJson).toHaveBeenCalledTimes(5);
    expect(String(chatJson.mock.calls[0][0][0].content)).toContain(
      'forbiddenClaims',
    );
  });
  it('repairs only failures and fails when too few pass', async () => {
    const chatJson = vi
      .fn()
      .mockResolvedValueOnce({ blueprints: [1, 2, 3].map(blueprint) })
      .mockResolvedValueOnce({ title: '', lead: {} })
      .mockResolvedValueOnce(rawScenario(2))
      .mockResolvedValueOnce(rawScenario(3))
      .mockResolvedValueOnce(rawScenario(4));
    const service = new ScenariosService(fakeSarvam({ chatJsonTask: chatJson }));
    const scenarios = await service.generate(understanding, 'rep', 'en-IN');
    expect(scenarios).toHaveLength(3);
    expect(chatJson).toHaveBeenCalledTimes(5);
  });
  it('fails when the matrix plans nothing', async () => {
    const chatJson = vi.fn().mockResolvedValue({ blueprints: [] });
    await expect(
      new ScenariosService(fakeSarvam({ chatJsonTask: chatJson })).generate(
        understanding,
        'rep',
        'en-IN',
      ),
    ).rejects.toThrow();
  });
  it('honours the difficulty the user asked for on a custom scenario', async () => {
    const chatJson = vi.fn().mockResolvedValue(rawScenario(1));
    const s = await new ScenariosService(fakeSarvam({ chatJsonTask: chatJson })).createCustom(
      profile,
      'lead',
      {
        description: 'A skeptical CFO',
        difficulty: 'easy',
        language: 'ta-IN',
      },
    );
    expect(s).toMatchObject({
      custom: true,
      difficulty: 'easy',
      language: 'ta-IN',
    });
  });
});

describe('persona prompt', () => {
  const scenario = toScenario(rawScenario(1), 'lead', 'hi-IN', false);
  it('plays the lead and follows language switches', () => {
    const prompt = buildSystemPrompt(profile, scenario, 'hi-IN');
    expect(prompt).toContain('playing Meera Rao');
    expect(prompt).toContain('Hindi');
    expect(prompt).toContain('mirror their language every turn');
    expect(prompt).toContain('Never switch language on your own');
    expect(prompt).toContain('Stay in character');
    expect(prompt).toContain('Never repeat a question');
    expect(prompt).toContain('at least one objection specifically');
  });
  it('plays the rep with no invented facts and no guarantees', () => {
    const prompt = buildSystemPrompt(
      profile,
      { ...scenario, agentRole: 'rep' },
      'en-IN',
    );
    expect(prompt).toContain('sales representative from Acme');
    expect(prompt).toContain('never guarantees');
    expect(prompt).toContain('day and time');
    expect(prompt).toContain('Never end on the first objection');
    expect(prompt).toContain('Guardrails');
    expect(prompt).toContain('For example:');
  });
  it('pins the lead identity so the agent never invents its own name', () => {
    const prompt = buildSystemPrompt(profile, scenario, 'hi-IN');
    expect(prompt).toContain('Your name is Meera Rao');
    expect(prompt).toContain('"Hello, Meera Rao speaking');
    expect(connectCue(scenario)).toContain('You are Meera Rao');
  });
  it('gives the lead guardrails and a graceful exit', () => {
    const prompt = buildSystemPrompt(profile, scenario, 'hi-IN');
    expect(prompt).toContain('Guardrails');
    expect(prompt).toContain('pause, restart or end');
    expect(prompt).toContain('exact same language and script mix');
  });
});

describe('CallService', () => {
  const scenario: Scenario = toScenario(rawScenario(1), 'lead', 'en-IN', false);

  it('opens with the agent line, then alternates turns and sends history to the model', async () => {
    const chat = vi
      .fn()
      .mockResolvedValueOnce('Hello, Meera speaking.')
      .mockResolvedValueOnce('Not now, sorry.');
    const service = new CallService(fakeSarvam({ chat }));
    const call = await service.start(profile, scenario, 'en-IN');
    expect(call.turns).toEqual([
      { speaker: 'agent', text: 'Hello, Meera speaking.' },
    ]);

    await service.takeTurn(profile, call, 'Hi Meera, this is Sam from Acme.');
    const messages = chat.mock.calls[1][0] as { role: string }[];
    expect(messages.map((m) => m.role)).toEqual([
      'system',
      'user',
      'assistant',
      'user',
    ]);
    expect(chat.mock.calls[1][1]).toMatchObject({
      temperature: 0.5,
      maxTokens: 220,
    });
    expect(call.turns).toHaveLength(3);
  });

  it('ends the call on the end token and refuses further turns', async () => {
    const chat = vi
      .fn()
      .mockResolvedValueOnce('Hello?')
      .mockResolvedValueOnce('Okay, Friday it is. [END_CALL]');
    const service = new CallService(fakeSarvam({ chat }));
    const call = await service.start(profile, scenario, 'en-IN');
    await service.takeTurn(profile, call, 'Can we do Friday?');
    expect(call.ended).toBe(true);
    expect(call.turns.at(-1)?.text).toBe('Okay, Friday it is.');
    await expect(
      service.takeTurn(profile, call, 'hello again'),
    ).rejects.toThrow('ended');
  });

  it('rejects an empty turn', async () => {
    const chat = vi.fn().mockResolvedValue('Hello?');
    const service = new CallService(fakeSarvam({ chat }));
    const call = await service.start(profile, scenario, 'en-IN');
    await expect(service.takeTurn(profile, call, '   ')).rejects.toThrow();
  });

  it('ends the call when practice time runs out', async () => {
    const chat = vi.fn().mockResolvedValue('Hello?');
    const service = new CallService(fakeSarvam({ chat }));
    const call = await service.start(profile, scenario, 'en-IN', undefined, 5);
    expect(call.practiceMinutes).toBe(5);
    expect(call.endsAt).toBeGreaterThan(call.startedAt);
    call.endsAt = Date.now() - 1;
    await expect(service.takeTurn(profile, call, 'hello?')).rejects.toThrow(
      'Practice time is up',
    );
    expect(call.ended).toBe(true);
  });

  it('retries an empty reply once, then speaks a fallback line', async () => {
    const chat = vi.fn().mockResolvedValue('   ');
    const service = new CallService(fakeSarvam({ chat }));
    const call = await service.start(profile, scenario, 'en-IN');
    expect(chat).toHaveBeenCalledTimes(2);
    expect(call.turns.at(-1)?.text).toContain('say it once more');
  });
});

describe('SessionStore', () => {
  it('returns sessions, finds calls, and expires', () => {
    const store = new SessionStore();
    const session = store.create('https://acme.test', profile, []);
    expect(store.get(session.id).url).toBe('https://acme.test');

    store.addCall(session, { id: 'c1', turns: [] } as never);
    expect(store.getCall('c1').call.id).toBe('c1');

    session.expiresAt = Date.now() - 1;
    expect(() => store.get(session.id)).toThrow('ended');
    expect(() => store.getCall('c1')).toThrow();
  });
});

describe('dto parsing', () => {
  it('validates input', () => {
    expect(parseAnalyse({ url: ' acme.test ' }).url).toBe('acme.test');
    expect(() => parseAnalyse({})).toThrow();
    expect(() => parseAnalyse({ url: 'x', language: 'fr-FR' })).toThrow();
    expect(() =>
      parseCustomScenario({ agentRole: 'boss', description: 'x' }),
    ).toThrow();
    expect(
      parseProfileUpdate({ profile: { name: 'New' }, regenerate: true }),
    ).toEqual({
      profile: { name: 'New' },
      regenerate: true,
    });
  });

  it('defaults practice time to 5 minutes and clamps it to 1 to 10', () => {
    expect(parseStartCall({}).practiceMinutes).toBe(5);
    expect(parseStartCall({ practiceMinutes: 10 }).practiceMinutes).toBe(10);
    expect(parseStartCall({ practiceMinutes: 99 }).practiceMinutes).toBe(10);
    expect(parseStartCall({ practiceMinutes: 0 }).practiceMinutes).toBe(1);
  });
});
