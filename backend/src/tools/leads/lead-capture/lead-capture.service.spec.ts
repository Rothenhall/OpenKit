import { BadRequestException, HttpException } from '@nestjs/common';
import { LeadCaptureService } from './lead-capture.service.js';

const card = {
  outcome: 'next_step_agreed',
  summary: 'Good.',
  dimensions: [
    { name: 'Opening', score: 4, note: '' },
    { name: 'Discovery', score: 4, note: '' },
    { name: 'Objection handling', score: 4, note: '' },
    { name: 'Close', score: 4, note: '' },
  ],
  strengths: [],
  improvements: [],
  betterMoves: [],
  coaching: [],
  benefits: [],
  verdict: 'Strong call.',
};

interface Sent {
  to: string;
  subject: string;
  attachments?: { filename: string; contentType: string; content: Buffer }[];
}

function setup(
  over: {
    turns?: { speaker: string; text: string }[];
    mailEnabled?: boolean;
  } = {},
) {
  const call = {
    id: 'c1',
    language: 'en-IN',
    startedAt: Date.now() - 60_000,
    turns: over.turns ?? [
      { speaker: 'agent', text: 'Hello' },
      { speaker: 'user', text: 'Hi there' },
    ],
    scenario: {
      title: 'Doubts',
      agentRole: 'lead',
      difficulty: 'easy',
      lead: { name: 'Meera', jobTitle: 'Founder' },
    },
    scorecard: card,
  };
  const session = { url: 'acme.com', profile: { name: 'Acme' } };
  const sent: Sent[] = [];
  const mail = {
    enabled: over.mailEnabled ?? true,
    send: vi.fn(async (m: Sent) => {
      sent.push(m);
    }),
  };
  const service = new LeadCaptureService(
    { enabled: false } as never,
    { loadCall: async () => ({ call, session }) } as never,
    { scorecard: async () => card } as never,
    mail as never,
  );
  return { service, mail, sent, call };
}

describe('LeadCaptureService.requestReport', () => {
  it('emails the PDF to the address', async () => {
    const { service, sent } = setup();
    const result = await service.requestReport('c1', {
      email: 'Priya@Example.com',
    });
    expect(result).toEqual({ alreadySent: false });
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe('priya@example.com');
    expect(sent[0].subject).toContain('Acme');
    expect(sent[0].attachments?.[0].filename).toBe('sales-call-report-acme.pdf');
    expect(sent[0].attachments?.[0].contentType).toBe('application/pdf');
    expect(sent[0].attachments?.[0].content.subarray(0, 5).toString()).toBe(
      '%PDF-',
    );
  });

  it('does not send the same report twice to the same address', async () => {
    const { service, mail } = setup();
    await service.requestReport('c1', { email: 'a@b.co' });
    expect(await service.requestReport('c1', { email: 'a@b.co' })).toEqual({
      alreadySent: true,
    });
    expect(mail.send).toHaveBeenCalledTimes(1);
  });

  it('stops after a few attempts on one call', async () => {
    const { service } = setup();
    await service.requestReport('c1', { email: 'a1@b.co' });
    await service.requestReport('c1', { email: 'a2@b.co' });
    await service.requestReport('c1', { email: 'a3@b.co' });
    await expect(
      service.requestReport('c1', { email: 'a4@b.co' }),
    ).rejects.toMatchObject({ status: 429 });
  });

  it('refuses a call with no conversation', async () => {
    const { service } = setup({
      turns: [{ speaker: 'agent', text: 'Hello' }],
    });
    await expect(
      service.requestReport('c1', { email: 'a@b.co' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('says so plainly when email is not configured', async () => {
    const { service } = setup({ mailEnabled: false });
    await expect(
      service.requestReport('c1', { email: 'a@b.co' }),
    ).rejects.toBeInstanceOf(HttpException);
  });
});
