import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '../../../common/db/db.service.js';
import type { Call, Session } from '../leads.types.js';
import { SessionStore } from '../session/session.store.js';

export interface LeadInput {
  name: string;
  email: string;
  phone?: string;
  role?: string;
}

const SCHEMA = `
create table if not exists lead_captures (
  id uuid primary key default gen_random_uuid(),
  call_id text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  name text not null,
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
create index if not exists lead_captures_email_idx on lead_captures (lower(email));
create index if not exists lead_captures_created_idx on lead_captures (created_at desc);
`;

/**
 * Saves the people who try the tool and ask to be contacted. Everything
 * about the call (company, outcome, score) is read from the call itself on
 * the server, never from the form, so a lead cannot be forged or skewed.
 */
@Injectable()
export class LeadCaptureService {
  private readonly logger = new Logger(LeadCaptureService.name);
  private ready?: Promise<unknown>;

  constructor(
    private readonly db: DbService,
    private readonly store: SessionStore,
  ) {}

  async capture(callId: string, lead: LeadInput): Promise<void> {
    const { session, call } = this.store.getCall(callId);
    await this.migrate();
    const record = this.record(session, call);
    await this.db.query(
      `insert into lead_captures
         (call_id, name, email, phone, role, company_name, company_url, mode,
          scenario_title, difficulty, language, outcome, avg_score, call_seconds, consent)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,true)
       on conflict (call_id) do update set
         name = excluded.name, email = excluded.email, phone = excluded.phone,
         role = excluded.role, updated_at = now()`,
      [
        callId,
        lead.name,
        lead.email.toLowerCase(),
        lead.phone ?? null,
        lead.role ?? null,
        record.company,
        record.url,
        record.mode,
        record.scenario,
        record.difficulty,
        record.language,
        record.outcome,
        record.score,
        record.seconds,
      ],
    );
    void this.notify(lead, record);
  }

  private migrate(): Promise<unknown> {
    // One attempt at a time. A failure is not cached, so the next request retries.
    this.ready ??= this.db.query(SCHEMA).catch((error) => {
      this.ready = undefined;
      throw error;
    });
    return this.ready;
  }

  private record(session: Session, call: Call) {
    const dimensions = call.scorecard?.dimensions ?? [];
    const score = dimensions.length
      ? Math.round(
          (dimensions.reduce((sum, d) => sum + d.score, 0) /
            dimensions.length) *
            10,
        ) / 10
      : null;
    return {
      company: session.profile.name,
      url: session.url,
      mode: call.scenario.agentRole === 'lead' ? 'you-sell' : 'ai-sells',
      scenario: call.scenario.title,
      difficulty: call.scenario.difficulty,
      language: call.language,
      outcome: call.scorecard?.outcome ?? null,
      score,
      seconds: Math.max(0, Math.round((Date.now() - call.startedAt) / 1000)),
    };
  }

  /**
   * Tells the team, if `LEAD_WEBHOOK_URL` is set. The payload works as a
   * Slack incoming webhook and is plain JSON for Zapier or Make. A failure is
   * logged and never reaches the visitor, the lead is already saved.
   */
  private async notify(
    lead: LeadInput,
    record: ReturnType<LeadCaptureService['record']>,
  ): Promise<void> {
    const url = process.env.LEAD_WEBHOOK_URL;
    if (!url) return;
    const score = record.score === null ? 'no score' : `${record.score}/5`;
    try {
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: `New Openkit lead: ${lead.name} <${lead.email}>${lead.role ? `, ${lead.role}` : ''} at ${record.company} (${record.url}). ${record.mode}, ${record.difficulty}, ${record.outcome ?? 'no outcome'}, ${score}.`,
          lead,
          ...record,
        }),
        signal: AbortSignal.timeout(5000),
      });
    } catch (error) {
      this.logger.warn(`Lead webhook failed: ${(error as Error).message}`);
    }
  }
}
