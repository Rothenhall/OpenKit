import { randomUUID } from 'node:crypto';
import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  Call,
  CompanyProfile,
  CompanyUnderstanding,
  Scenario,
  Session,
} from '../leads.types.js';

const TTL_MS = 60 * 60 * 1000;
const MAX_SESSIONS = 500;

/** Sessions live in memory only and expire an hour after last use. */
@Injectable()
export class SessionStore {
  private readonly sessions = new Map<string, Session>();
  private readonly callIndex = new Map<string, string>();

  constructor() {
    // Expired sessions leave memory even when no new session arrives to trigger a purge.
    setInterval(() => this.purge(), 5 * 60_000).unref();
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

  get(id: string): Session {
    const session = this.sessions.get(id);
    if (!session || session.expiresAt < Date.now()) {
      if (session) this.delete(id);
      throw new NotFoundException(
        'That session has ended. Start again from your website.',
      );
    }
    session.expiresAt = Date.now() + TTL_MS;
    return session;
  }

  addCall(session: Session, call: Call): void {
    session.calls.set(call.id, call);
    this.callIndex.set(call.id, session.id);
  }

  getCall(callId: string): { session: Session; call: Call } {
    const sessionId = this.callIndex.get(callId);
    if (!sessionId) throw new NotFoundException('That call was not found');
    const session = this.get(sessionId);
    const call = session.calls.get(callId);
    if (!call) throw new NotFoundException('That call was not found');
    return { session, call };
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
  }
}
