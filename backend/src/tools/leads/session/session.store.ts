import { randomUUID } from 'node:crypto';
import { Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { DbService } from '../../../common/db/db.service.js';
import type {
  Call,
  CompanyProfile,
  CompanyUnderstanding,
  Scenario,
  Session,
} from '../leads.types.js';

const TTL_MS = 60 * 60 * 1000;
const MAX_SESSIONS = 500;
const SWEEP_MS = 10 * 60 * 1000;

const SCHEMA = `
create table if not exists openkit_sessions (
  id text primary key,
  data jsonb not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);
create table if not exists openkit_calls (
  id text primary key,
  session_id text not null references openkit_sessions(id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
create index if not exists openkit_sessions_expires_idx on openkit_sessions (expires_at);
create index if not exists openkit_calls_session_idx on openkit_calls (session_id);
`;

const NOT_ENDED = 'That session has ended. Start again from your website.';

/**
 * Sessions and calls. Memory is a cache, and when `DATABASE_URL` is set
 * Postgres is the source of truth, so a request can be served by any server
 * instance. That matters on serverless hosting such as Vercel, where the
 * request that starts a call and the WebSocket that joins it can land on
 * different instances. Without a database it is plain memory, exactly as
 * before, which suits local development and a single server.
 *
 * Writes go through `saveSession` and `saveCall`. A failed write is logged and
 * never breaks a live call, it only means another instance could not resume it.
 */
@Injectable()
export class SessionStore {
  private readonly logger = new Logger(SessionStore.name);
  private readonly sessions = new Map<string, Session>();
  private readonly callIndex = new Map<string, string>();
  private ready?: Promise<unknown>;
  private lastSweep = 0;

  constructor(@Optional() private readonly db?: DbService) {
    // Expired sessions leave memory even when no new session arrives to trigger a purge.
    setInterval(() => this.purge(), SWEEP_MS).unref();
  }

  private get durable(): boolean {
    return Boolean(this.db?.enabled);
  }

  create(
    url: string,
    profile: CompanyProfile,
    scenarios: Scenario[],
    understanding?: CompanyUnderstanding,
  ): Session {
    this.purge();
    if (this.sessions.size >= MAX_SESSIONS) {
      const oldest = this.sessions.keys().next().value;
      if (oldest) this.delete(oldest);
    }
    const session: Session = {
      id: randomUUID(),
      url,
      profile,
      scenarios,
      understanding,
      calls: new Map(),
      expiresAt: Date.now() + TTL_MS,
    };
    this.sessions.set(session.id, session);
    return session;
  }

  /** Memory only. Use `load` when the session may live on another instance. */
  get(id: string): Session {
    const session = this.sessions.get(id);
    if (!session || session.expiresAt < Date.now()) {
      if (session) this.delete(id);
      throw new NotFoundException(NOT_ENDED);
    }
    session.expiresAt = Date.now() + TTL_MS;
    return session;
  }

  addCall(session: Session, call: Call): void {
    session.calls.set(call.id, call);
    this.callIndex.set(call.id, session.id);
  }

  /** Memory only. Use `loadCall` when the call may live on another instance. */
  getCall(callId: string): { session: Session; call: Call } {
    const sessionId = this.callIndex.get(callId);
    if (!sessionId) throw new NotFoundException('That call was not found');
    const session = this.get(sessionId);
    const call = session.calls.get(callId);
    if (!call) throw new NotFoundException('That call was not found');
    return { session, call };
  }

  /** Memory first, then the database. */
  async load(id: string): Promise<Session> {
    try {
      return this.get(id);
    } catch (error) {
      if (!this.durable) throw error;
    }
    const rows = await this.run<{ data: Session; expires_at: Date }>(
      'select data, expires_at from openkit_sessions where id = $1 and expires_at > now()',
      [id],
    );
    const row = rows?.[0];
    if (!row) throw new NotFoundException(NOT_ENDED);
    const session: Session = {
      ...row.data,
      calls: new Map(),
      expiresAt: Date.now() + TTL_MS,
    };
    this.sessions.set(session.id, session);
    return session;
  }

  async loadCall(callId: string): Promise<{ session: Session; call: Call }> {
    try {
      return this.getCall(callId);
    } catch (error) {
      if (!this.durable) throw error;
    }
    const rows = await this.run<{ data: Call; session_id: string }>(
      'select data, session_id from openkit_calls where id = $1',
      [callId],
    );
    const row = rows?.[0];
    if (!row) throw new NotFoundException('That call was not found');
    const session = await this.load(row.session_id);
    // Another request may have loaded it while we waited. Keep one copy.
    const existing = session.calls.get(callId);
    if (existing) return { session, call: existing };
    this.addCall(session, row.data);
    return { session, call: row.data };
  }

  async saveSession(session: Session): Promise<void> {
    if (!this.durable) return;
    const { calls: _calls, ...data } = session;
    await this.run(
      `insert into openkit_sessions (id, data, expires_at)
       values ($1, $2::jsonb, $3)
       on conflict (id) do update
         set data = excluded.data, expires_at = excluded.expires_at, updated_at = now()`,
      [session.id, JSON.stringify(data), new Date(session.expiresAt)],
    );
  }

  async saveCall(call: Call): Promise<void> {
    if (!this.durable) return;
    const sessionId = this.callIndex.get(call.id);
    if (!sessionId) return;
    await this.run(
      `insert into openkit_calls (id, session_id, data)
       values ($1, $2, $3::jsonb)
       on conflict (id) do update set data = excluded.data, updated_at = now()`,
      [call.id, sessionId, JSON.stringify(call)],
    );
    // A live call keeps its session alive in the database too.
    await this.run(
      'update openkit_sessions set expires_at = $2, updated_at = now() where id = $1',
      [sessionId, new Date(Date.now() + TTL_MS)],
    );
  }

  /** Runs a query. Returns undefined, after logging, when the database fails. */
  private async run<T extends Record<string, unknown>>(
    text: string,
    params: unknown[],
  ): Promise<T[] | undefined> {
    if (!this.db) return undefined;
    try {
      this.ready ??= this.db.query(SCHEMA).catch((error) => {
        this.ready = undefined;
        throw error;
      });
      await this.ready;
      return (await this.db.query<T>(text, params)).rows;
    } catch (error) {
      this.logger.warn(`Session storage failed: ${(error as Error).message}`);
      return undefined;
    }
  }

  private delete(id: string): void {
    const session = this.sessions.get(id);
    session?.calls.forEach((_, callId) => this.callIndex.delete(callId));
    this.sessions.delete(id);
  }

  private purge(): void {
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      if (session.expiresAt < now) this.delete(id);
    }
    // Expired rows leave the database too, at most every few minutes per instance.
    if (this.durable && now - this.lastSweep > SWEEP_MS) {
      this.lastSweep = now;
      void this.run('delete from openkit_sessions where expires_at < now()', []);
    }
  }
}
