import { HttpException } from '@nestjs/common';
import { RateLimiter } from '../../common/rate-limit/rate-limiter.js';
import { languageOfText } from '../../common/sarvam/languages.js';
import { pickVoice } from '../../common/sarvam/voices.js';
import { voiceFor } from './call/call.service.js';
import { normaliseScorecard } from './scoring/scoring.service.js';
import { toScenario } from './scenarios/scenarios.service.js';

describe('languageOfText', () => {
  it.each([
    ['Hello, can you send the pricing?', 'en-IN', 'en-IN'],
    ['నమస్కారం, చెప్పండి', 'en-IN', 'te-IN'],
    ['வணக்கம், பேசுங்க', 'hi-IN', 'ta-IN'],
    ['नमस्ते, मैं Rothenhall से बोल रहा हूँ', 'en-IN', 'hi-IN'],
    ['नमस्कार, मी बोलतोय', 'mr-IN', 'mr-IN'],
  ] as const)('%s -> %s', (text, preferred, expected) => {
    expect(languageOfText(text, preferred)).toBe(expected);
  });

  it('treats mostly English with a few native words as English', () => {
    expect(
      languageOfText(
        'Okay, send the demo details by email please, धन्यवाद',
        'hi-IN',
      ),
    ).toBe('en-IN');
  });
});

describe('voices', () => {
  it('gives the same voice for the same seed and matches gender', () => {
    expect(pickVoice('female', 'Meera')).toBe(pickVoice('female', 'Meera'));
    expect(['ishita']).toContain(pickVoice('female', 'Meera'));
  });

  it('picks a top-ranked speaker for the call language', () => {
    expect(['neha', 'priya']).toContain(
      pickVoice('female', 'Meera', 'te-IN'),
    );
    expect(['shubh', 'ashutosh']).toContain(
      pickVoice('male', 'Amit', 'hi-IN'),
    );
    expect(['ratan', 'rohan']).toContain(
      pickVoice('male', 'Karuna', 'ta-IN'),
    );
    expect(pickVoice('male', 'Rahul Rao', 'en-IN')).toBe('ratan');
  });

  it("uses the lead's gender for the lead voice", () => {
    const scenario = toScenario(
      { lead: { name: 'Rahul Rao', gender: 'male' } },
      'lead',
      'en-IN',
      false,
    );
    expect(voiceFor(scenario)).toBe(pickVoice('male', 'Rahul Rao'));
  });
});

describe('normaliseScorecard', () => {
  it('always returns the four dimensions with scores clamped to 1 to 5', () => {
    const card = normaliseScorecard({
      outcome: 'bogus',
      dimensions: [
        { name: 'Opening', score: 9, note: 'Clear' },
        { name: 'Close', score: 'x' },
      ],
      strengths: ['a', 1, 'b', 'c', 'd'],
      betterMoves: ['try this line'],
      coaching: ['slow down', 2],
      verdict: 'Promising, needs discovery work.',
      benefits: ['never misses a lead'],
    });
    expect(card.outcome).toBe('unclear');
    expect(card.dimensions.map((d) => d.name)).toEqual([
      'Opening',
      'Discovery',
      'Objection handling',
      'Close',
    ]);
    expect(card.dimensions.map((d) => d.score)).toEqual([5, 1, 1, 1]);
    expect(card.strengths).toEqual(['a', 'b', 'c']);
    expect(card.betterMoves).toEqual(['try this line']);
    expect(card.coaching).toEqual(['slow down']);
    expect(card.verdict).toBe('Promising, needs discovery work.');
    expect(card.benefits).toEqual(['never misses a lead']);
  });
});

describe('RateLimiter', () => {
  it('allows up to the limit then throws 429, per key', () => {
    const limiter = new RateLimiter();
    for (let i = 0; i < 3; i++) limiter.hit('a', 3, 60_000);
    expect(() => limiter.hit('a', 3, 60_000)).toThrow(HttpException);
    expect(() => limiter.hit('b', 3, 60_000)).not.toThrow();
  });

  it('frees up once the window has passed', () => {
    vi.useFakeTimers();
    const limiter = new RateLimiter();
    limiter.hit('a', 1, 1000);
    expect(() => limiter.hit('a', 1, 1000)).toThrow();
    vi.advanceTimersByTime(1001);
    expect(() => limiter.hit('a', 1, 1000)).not.toThrow();
    vi.useRealTimers();
  });
});

describe('CallService.addUserTurn language', () => {
  const callWith = (language: 'en-IN' | 'hi-IN') =>
    ({
      id: 'c',
      language,
      turns: [],
      ended: false,
      endsAt: Date.now() + 60_000,
    }) as never;

  it('keeps English when the detector mislabels an Indian accent as Hindi', async () => {
    const { CallService } = await import('./call/call.service.js');
    const call = callWith('en-IN');
    new CallService({} as never).addUserTurn(
      call,
      'Hi Arjun, this is Sam from Rothenhall. Do you have two minutes?',
      'hi-IN',
    );
    expect((call as { language: string }).language).toBe('en-IN');
  });

  it('switches to Hindi when the transcript is in Devanagari', async () => {
    const { CallService } = await import('./call/call.service.js');
    const call = callWith('en-IN');
    new CallService({} as never).addUserTurn(
      call,
      'नमस्ते, मुझे कीमत के बारे में बताइए',
      'hi-IN',
    );
    expect((call as { language: string }).language).toBe('hi-IN');
  });
});
