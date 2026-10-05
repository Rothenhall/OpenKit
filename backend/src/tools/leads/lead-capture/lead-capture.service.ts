import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { DbService } from '../../../common/db/db.service.js';
import { MailService } from '../../../common/mail/mail.service.js';
import { LANGUAGES } from '../../../common/sarvam/languages.js';
import type { Call, Scorecard, Session } from '../leads.types.js';
import { LeadsService } from '../leads.service.js';
import { buildReportPdf } from '../report/report-pdf.js';
import { SessionStore } from '../session/session.store.js';

export interface ReportRequest {
  email: string;
  phone?: string;
}

const SCHEMA = `
create table if not exists lead_captures (
  id uuid primary key default gen_random_uuid(),
  call_id text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  name text,
  email text not null,
  phone text,
  role text,
  company_name text,
  company_url text,
  mode text,
  scenario_title text,
  difficulty text,
  language text,
  outcome text,
  avg_score numeric(3,1),
  call_seconds integer,
  consent boolean not null,
  consent_at timestamptz not null default now(),
  source text not null default 'sales-call-trainer'
);
alter table lead_captures alter column name drop not null;
alter table lead_captures add column if not exists report_status text;
alter table lead_captures add column if not exists report_sent_at timestamptz;
alter table lead_captures add column if not exists report_attempts integer not null default 0;
create index if not exists lead_captures_email_idx on lead_captures (lower(email));
create index if not exists lead_captures_created_idx on lead_captures (created_at desc);
`;

const MAX_ATTEMPTS_PER_CALL = 3;
const MAX_REPORTS_PER_EMAIL_PER_DAY = 3;

const OUTCOME_LABEL: Record<string, string> = {
  next_step_agreed: 'Next step agreed',
  callback: 'Callback',
  declined: 'Declined',
  unclear: 'Unclear',
};

/**
 * The email gate. A visitor never sees their scorecard on screen. They give an
 * email address, and the report arrives as a PDF. That one exchange is the
 * lead: the address, an optional phone number, and everything about the call
 * the sales team needs to open a good conversation.
 *
 * The company, outcome and score come from the call on the server, never from
 * the form, so a lead cannot be forged. To keep the form from being used to
 * send mail to strangers, each call can send a few times at most, each address
 * receives a few reports a day, and the route is rate limited per visitor.
 */
@Injectable()
export class LeadCaptureService {
  private readonly logger = new Logger(LeadCaptureService.name);
  private ready?: Promise<unknown>;
  /** Without a database, the same limits are kept in memory for this process. */
  private readonly memory = new Map<
    string,
    { attempts: number; sentTo?: string }
  >();

  constructor(
    private readonly db: DbService,
    private readonly store: SessionStore,
    private readonly leads: LeadsService,
    private readonly mail: MailService,
  ) {}

  async requestReport(
    callId: string,
    request: ReportRequest,
  ): Promise<{ alreadySent: boolean }> {
    const { session, call } = await this.store.loadCall(callId);
    if (!call.turns.some((t) => t.speaker === 'user')) {
      throw new BadRequestException(
        'Have a conversation first, then ask for the report.',
      );
    }
    if (!this.mail.enabled) {
      this.logger.error('Report requested but SMTP is not configured');
      throw new HttpException(
        'Email is not set up yet. Please try again later.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    const email = request.email.toLowerCase();
    const attempt = await this.begin(callId, call, session, request);
    if (attempt.alreadySentTo === email) return { alreadySent: true };
    if (attempt.attempts > MAX_ATTEMPTS_PER_CALL) {
      throw new HttpException(
        'That is enough tries for this call. Please start a new call.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (await this.tooManyToAddress(email, callId)) {
      throw new HttpException(
        'That address already received its reports for today. Try again tomorrow.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // Scoring started when the call ended, so this usually returns at once.
    const scorecard = await this.leads.scorecard(callId);
    const facts = this.facts(session, call, scorecard);
    try {
      const pdf = await buildReportPdf({
        company: facts.company,
        site: facts.url,
        scenarioTitle: call.scenario.title,
        buyerName: call.scenario.lead.name,
        buyerRole: call.scenario.lead.jobTitle,
        mode: facts.mode,
        difficulty: call.scenario.difficulty,
        language: LANGUAGES[call.language] ?? call.language,
        durationSeconds: facts.seconds,
        turns: call.turns,
        scorecard,
        generatedAt: new Date(),
      });
      await this.mail.send({
        to: email,
        subject: `Your Sales Call Trainer report: ${facts.company}`,
        text: this.plainText(call, scorecard, facts.average),
        html: this.html(call, scorecard, facts.average),
        attachments: [
          {
            filename: `sales-call-report-${slug(facts.company)}.pdf`,
            content: pdf,
            contentType: 'application/pdf',
          },
        ],
      });
    } catch (error) {
      await this.mark(callId, 'failed');
      throw error;
    }
    await this.mark(callId, 'sent', facts, email);
    void this.notify(email, request.phone, facts);
    return { alreadySent: false };
  }

  /** Saves the lead and counts the attempt. One round trip, and it is the lead even if sending fails. */
  private async begin(
    callId: string,
    call: Call,
    session: Session,
    request: ReportRequest,
  ): Promise<{ attempts: number; alreadySentTo?: string }> {
    const email = request.email.toLowerCase();
    if (!this.db.enabled) {
      const entry = this.memory.get(callId) ?? { attempts: 0 };
      entry.attempts += 1;
      this.memory.set(callId, entry);
      return { attempts: entry.attempts, alreadySentTo: entry.sentTo };
    }
    await this.migrate();
    const facts = this.facts(session, call, call.scorecard);
    const result = await this.db.query<{
      report_attempts: number;
      report_sent_at: Date | null;
      email: string;
    }>(
      `insert into lead_captures
         (call_id, email, phone, company_name, company_url, mode, scenario_title,
          difficulty, language, outcome, avg_score, call_seconds, consent, report_attempts)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,true,1)
       on conflict (call_id) do update set
         email = excluded.email,
         phone = coalesce(excluded.phone, lead_captures.phone),
         updated_at = now(),
         report_attempts = lead_captures.report_attempts + 1
       returning report_attempts, report_sent_at, email`,
      [
        callId,
        email,
        request.phone ?? null,
        facts.company,
        facts.url,
        facts.mode,
        call.scenario.title,
        call.scenario.difficulty,
        call.language,
        facts.outcome,
        facts.average,
        facts.seconds,
      ],
    );
    const row = result.rows[0];
    return {
      attempts: row?.report_attempts ?? 1,
      alreadySentTo: row?.report_sent_at ? row.email : undefined,
    };
  }

  private async tooManyToAddress(email: string, callId: string): Promise<boolean> {
    if (!this.db.enabled) return false;
    const result = await this.db.query<{ n: number }>(
      `select count(*)::int as n from lead_captures
       where lower(email) = $1 and call_id <> $2
         and report_sent_at > now() - interval '1 day'`,
      [email, callId],
    );
    return (result.rows[0]?.n ?? 0) >= MAX_REPORTS_PER_EMAIL_PER_DAY;
  }

  private async mark(
    callId: string,
    status: 'sent' | 'failed',
    facts?: ReturnType<LeadCaptureService['facts']>,
    email?: string,
  ): Promise<void> {
    if (!this.db.enabled) {
      const entry = this.memory.get(callId);
      if (entry && status === 'sent') entry.sentTo = email;
      return;
    }
    try {
      await this.db.query(
        `update lead_captures set
           report_status = $2,
           report_sent_at = case when $2 = 'sent' then now() else report_sent_at end,
           outcome = coalesce($3, outcome),
           avg_score = coalesce($4, avg_score),
           updated_at = now()
         where call_id = $1`,
        [callId, status, facts?.outcome ?? null, facts?.average ?? null],
      );
    } catch (error) {
      this.logger.warn(`Could not record report status: ${(error as Error).message}`);
    }
  }

  private migrate(): Promise<unknown> {
    // One attempt at a time. A failure is not cached, so the next request retries.
    this.ready ??= this.db.query(SCHEMA).catch((error) => {
      this.ready = undefined;
      throw error;
    });
    return this.ready;
  }

  private facts(session: Session, call: Call, scorecard?: Scorecard) {
    const dimensions = scorecard?.dimensions ?? [];
    const average = dimensions.length
      ? Math.round(
          (dimensions.reduce((sum, d) => sum + d.score, 0) / dimensions.length) *
            10,
        ) / 10
      : null;
    return {
      company: session.profile.name,
      url: session.url,
      mode: (call.scenario.agentRole === 'lead' ? 'you-sell' : 'ai-sells') as
        | 'you-sell'
        | 'ai-sells',
      outcome: scorecard?.outcome ?? null,
      average: average as number | null,
      seconds: Math.max(0, Math.round((Date.now() - call.startedAt) / 1000)),
    };
  }

  private plainText(call: Call, card: Scorecard, average: number | null): string {
    return [
      'Hi,',
      '',
      `Your report for "${call.scenario.title}" is attached as a PDF.`,
      '',
      `Outcome: ${OUTCOME_LABEL[card.outcome] ?? card.outcome}${average === null ? '' : `, average score ${average} out of 5`}.`,
      `The short version: ${card.verdict || card.summary}`,
      '',
      'Want your whole team calling this well? Rothenhall runs the go-to-market and revenue operations behind it. Talk to us: https://rothenhall.com/contact',
      '',
      'Rothenhall. Be the company the AI recommends.',
    ].join('\n');
  }

  private html(call: Call, card: Scorecard, average: number | null): string {
    const verdict = escapeHtml(card.verdict || card.summary);
    const outcome = escapeHtml(OUTCOME_LABEL[card.outcome] ?? card.outcome);
    return `<!doctype html><html><body style="margin:0;background:#f7f3ea;font-family:Arial,Helvetica,sans-serif;color:#2b261f">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f3ea"><tr><td align="center" style="padding:28px 12px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden">
<tr><td style="background:#14110c;padding:20px 28px;color:#ffffff;font-size:18px;font-weight:bold">Rothenhall <span style="color:#e8b98a;font-size:11px;letter-spacing:2px;font-weight:normal;margin-left:8px">SALES CALL TRAINER</span></td></tr>
<tr><td style="height:4px;background:#c67c48;font-size:0;line-height:0">&nbsp;</td></tr>
<tr><td style="padding:28px">
<p style="margin:0 0 6px;font-size:20px;color:#14110c;font-weight:bold">Your report is ready</p>
<p style="margin:0 0 18px;font-size:14px;line-height:1.55">The full report for <strong>${escapeHtml(call.scenario.title)}</strong> is attached as a PDF.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#14110c;border-radius:10px"><tr><td style="padding:18px 20px;color:#ffffff">
<div style="font-size:11px;letter-spacing:2px;color:#e8b98a">${outcome.toUpperCase()}</div>
<div style="font-size:28px;font-weight:bold;margin:4px 0 6px">${average === null ? '' : `${average}<span style="font-size:14px;color:#bdb4a3"> / 5</span>`}</div>
<div style="font-size:14px;line-height:1.5">${verdict}</div>
</td></tr></table>
<p style="margin:22px 0 6px;font-size:15px;color:#14110c;font-weight:bold">Want your whole team calling this well?</p>
<p style="margin:0 0 16px;font-size:14px;line-height:1.55">Rothenhall runs the go-to-market and revenue operations behind it.</p>
<a href="https://rothenhall.com/contact" style="display:inline-block;background:#c67c48;color:#14110c;text-decoration:none;font-weight:bold;font-size:14px;padding:11px 20px;border-radius:8px">Talk to Rothenhall</a>
</td></tr>
<tr><td style="padding:16px 28px;background:#f7f3ea;font-size:12px;color:#6b6458">Rothenhall. Be the company the AI recommends.</td></tr>
</table></td></tr></table></body></html>`;
  }

  /**
   * Tells the team, if `LEAD_WEBHOOK_URL` is set. The payload works as a Slack
   * incoming webhook and is plain JSON for Zapier or Make. A failure is logged
   * and never reaches the visitor, the lead is already saved.
   */
  private async notify(
    email: string,
    phone: string | undefined,
    facts: ReturnType<LeadCaptureService['facts']>,
  ): Promise<void> {
    const url = process.env.LEAD_WEBHOOK_URL;
    if (!url) return;
    const score = facts.average === null ? 'no score' : `${facts.average}/5`;
    try {
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: `New Openkit lead: ${email}${phone ? `, ${phone}` : ''} at ${facts.company} (${facts.url}). ${facts.mode}, ${facts.outcome ?? 'no outcome'}, ${score}. Report emailed.`,
          email,
          phone,
          ...facts,
        }),
        signal: AbortSignal.timeout(5000),
      });
    } catch (error) {
      this.logger.warn(`Lead webhook failed: ${(error as Error).message}`);
    }
  }
}

function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'call'
  );
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
