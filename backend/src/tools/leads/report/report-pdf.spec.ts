import { buildReportPdf, splitRuns, type ReportData } from './report-pdf.js';

const card = {
  outcome: 'callback' as const,
  summary: 'You opened well. The close was soft.',
  dimensions: [
    { name: 'Opening' as const, score: 4, note: 'Clear opening.' },
    { name: 'Discovery' as const, score: 2, note: 'One question only.' },
    { name: 'Objection handling' as const, score: 3, note: 'Calm.' },
    { name: 'Close' as const, score: 2, note: 'No day and time.' },
  ],
  strengths: ['Clear opening'],
  improvements: ['Ask for a day and time'],
  betterMoves: ['When you said "let me know", try "Friday at 11?"'],
  coaching: ['Pause after each question'],
  benefits: [] as string[],
  verdict: 'Confident opener, weak close — fix the last thirty seconds.',
};

const data = (over: Partial<ReportData> = {}): ReportData => ({
  company: 'Acme',
  site: 'acme.com',
  scenarioTitle: 'Founder doubts the budget',
  buyerName: 'Meera Rao',
  buyerRole: 'Founder',
  mode: 'you-sell',
  difficulty: 'medium',
  language: 'English',
  durationSeconds: 120,
  generatedAt: new Date('2026-10-05'),
  scorecard: card,
  turns: [
    { speaker: 'agent', text: 'Hello, Meera Rao speaking.' },
    { speaker: 'user', text: 'Hi, this is Sam from Acme.' },
  ],
  ...over,
});

describe('splitRuns', () => {
  it('keeps one run for plain English', () => {
    expect(splitRuns('Hello, this is Sam.')).toEqual([
      { script: 'latin', text: 'Hello, this is Sam.' },
    ]);
  });

  it('puts Indic words in their own script and punctuation in Latin', () => {
    const runs = splitRuns('नमस्ते, Sam');
    expect(runs.map((r) => r.script)).toEqual(['devanagari', 'latin']);
    expect(runs[1].text).toContain(',');
  });

  it('sends the rupee sign to a font that has it', () => {
    expect(
      splitRuns('₹50,000').some(
        (r) => r.script === 'devanagari' && r.text.includes('₹'),
      ),
    ).toBe(true);
  });

  it('handles Tamil and Telugu', () => {
    expect(splitRuns('வணக்கம் hello')[0].script).toBe(
      'tamil',
    );
    expect(splitRuns('తెలుగు')[0].script).toBe(
      'telugu',
    );
  });
});

describe('buildReportPdf', () => {
  it('produces a real PDF of a few pages, with no blank footer pages', async () => {
    const pdf = await buildReportPdf(data());
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(5000);
    const pages = (pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? [])
      .length;
    expect(pages).toBeGreaterThanOrEqual(2);
    expect(pages).toBeLessThanOrEqual(4);
  });

  it('renders the AI caller version and Indian languages without throwing', async () => {
    await expect(buildReportPdf(data({ mode: 'ai-sells' }))).resolves.toBeInstanceOf(
      Buffer,
    );
    await expect(
      buildReportPdf(
        data({
          language: 'Hindi',
          turns: [
            {
              speaker: 'user',
              text: 'नमस्ते, मैं Sam बोल रहा हूँ। बजट ₹50,000 है।',
            },
          ],
        }),
      ),
    ).resolves.toBeInstanceOf(Buffer);
  });

  it('copes with long transcripts and empty lists', async () => {
    const turns = Array.from({ length: 120 }, (_, i) => ({
      speaker: i % 2 ? ('user' as const) : ('agent' as const),
      text: `Line ${i} `.repeat(20),
    }));
    await expect(
      buildReportPdf(
        data({
          turns,
          scorecard: {
            ...card,
            strengths: [],
            improvements: [],
            betterMoves: [],
            coaching: [],
          },
        }),
      ),
    ).resolves.toBeInstanceOf(Buffer);
  });
});
