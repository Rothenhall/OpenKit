import { brandTerms } from '../../common/sarvam/brand-terms.js';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SarvamService } from '../../common/sarvam/sarvam.service.js';
import { CallService } from './call/call.service.js';
import type {
  CustomScenarioDto,
  ProfileUpdateDto,
  StartCallDto,
} from './dto/leads.dto.js';
import type {
  Call,
  EvidenceItem,
  Scorecard,
  Session,
} from './leads.types.js';
import { ScenariosService } from './scenarios/scenarios.service.js';
import { ScoringService } from './scoring/scoring.service.js';
import { SessionStore } from './session/session.store.js';
import { SiteFetcherService } from './site/site-fetcher.service.js';
import { EvidenceService } from './understanding/evidence.service.js';
import {
  toProfile,
  fallbackUnderstanding,
  repairUnderstanding,
  UnderstandingService,
  validateUnderstanding,
} from './understanding/understanding.service.js';

@Injectable()
export class LeadsService {
  private readonly logger = new Logger(LeadsService.name);

  constructor(
    private readonly site: SiteFetcherService,
    private readonly evidence: EvidenceService,
    private readonly understanding: UnderstandingService,
    private readonly scenarios: ScenariosService,
    private readonly calls: CallService,
    private readonly scoring: ScoringService,
    private readonly store: SessionStore,
    private readonly sarvam: SarvamService,
  ) {}

  /**
   * The pipeline: discover and fetch pages in parallel, extract evidence
   * in parallel, one company understanding, one blueprint matrix per role,
   * parallel scenario writing with repair of failures only.
   */
  async analyse(
    url: string,
    language?: CustomScenarioDto['language'],
  ): Promise<Session> {
    const started = Date.now();
    const at = (label: string) =>
      this.logger.debug(`analyse ${label} +${Date.now() - started}ms`);

    const pages = await this.site.fetchSite(url);
    at(`fetch ${pages.length} pages`);

    // Deduplicate near identical pages before any LLM sees them.
    const seen = new Set<string>();
    const unique = pages.filter((p) => {
      const hash = p.text.toLowerCase().replace(/\s+/g, ' ').slice(0, 2000);
      if (seen.has(hash)) return false;
      seen.add(hash);
      return true;
    });

    const extracted = await Promise.allSettled(
      unique.map((page) => this.evidence.extract(page)),
    );
    const evidence: EvidenceItem[] = [];
    for (const result of extracted) {
      if (result.status === 'fulfilled') evidence.push(...result.value);
    }
    evidence.forEach((item, i) => {
      item.id = `E${i + 1}`;
    });
    at(`evidence ${evidence.length} items`);

    const fallbackName = pages[0]?.title ?? '';
    let understanding = await this.understanding.synthesize(evidence);
    at('understanding');
    let problem = validateUnderstanding(understanding);
    if (problem) {
      // First pass was thin. Take more time for quality: one targeted LLM
      // repair, then deterministic self-heal, then a generic fallback.
      // Analysis never dead-ends the user.
      this.logger.warn(`analyse understanding failed (${problem}), repairing`);
      at('repair start');
      try {
        const fixed = await this.understanding.repair(
          evidence,
          understanding,
          problem,
        );
        understanding = fixed;
        problem = validateUnderstanding(understanding);
        at('repair model');
      } catch (error) {
        this.logger.warn(
          `analyse model repair failed: ${(error as Error).message}`,
        );
      }
      if (problem) {
        understanding = repairUnderstanding(understanding, fallbackName);
        problem = validateUnderstanding(understanding);
        at('repair deterministic');
      }
      if (problem) {
        this.logger.warn(
          `analyse using fallback understanding (${problem})`,
        );
        understanding = fallbackUnderstanding(fallbackName, evidence);
        at('repair fallback');
      }
    }

    const profile = toProfile(understanding, fallbackName);
    if (language) profile.language = language;
    const [asRep, asLead] = await Promise.all([
      this.scenarios.generate(understanding, 'rep', profile.language),
      this.scenarios.generate(understanding, 'lead', profile.language),
    ]);
    at(`scenarios ${asRep.length + asLead.length}`);
    this.logger.debug(`analyse done +${Date.now() - started}ms`);

    return this.store.create(
      pages[0].url,
      profile,
      [...asRep, ...asLead],
      understanding,
    );
  }

  getSession(id: string): Session {
    return this.store.get(id);
  }

  async updateProfile(id: string, update: ProfileUpdateDto): Promise<Session> {
    const session = this.store.get(id);
    session.profile = { ...session.profile, ...update.profile };
    if (update.regenerate) {
      if (!session.understanding) {
        throw new BadRequestException(
          'This session predates company understanding. Start again from your website.',
        );
      }
      const [asRep, asLead] = await Promise.all([
        this.scenarios.generate(
          session.understanding,
          'rep',
          session.profile.language,
        ),
        this.scenarios.generate(
          session.understanding,
          'lead',
          session.profile.language,
        ),
      ]);
      const custom = session.scenarios.filter((s) => s.custom);
      session.scenarios = [...asRep, ...asLead, ...custom];
    }
    return session;
  }

  async addCustomScenario(id: string, dto: CustomScenarioDto) {
    const session = this.store.get(id);
    if (session.scenarios.filter((s) => s.custom).length >= 10) {
      throw new BadRequestException(
        'You can add up to 10 custom scenarios per session',
      );
    }
    const scenario = await this.scenarios.createCustom(
      session.profile,
      dto.agentRole,
      dto,
    );
    session.scenarios.push(scenario);
    return scenario;
  }

  /** Starts a call. With no scenario id, picks a random scenario of the given role. */
  async startCall(id: string, dto: StartCallDto): Promise<Call> {
    const session = this.store.get(id);
    const scenario = dto.scenarioId
      ? session.scenarios.find((s) => s.id === dto.scenarioId)
      : pickRandom(
          session.scenarios.filter((s) => s.agentRole === dto.agentRole),
        );
    if (!scenario) throw new NotFoundException('That scenario was not found');
    // A voice named in the request wins, then the server default, then the persona's own.
    const voiceName = dto.voice ?? process.env.SARVAM_AGENT_VOICE;
    const voice = voiceName
      ? await this.sarvam.resolveVoice(voiceName)
      : undefined;
    const call = await this.calls.start(
      session.profile,
      scenario,
      dto.language ?? scenario.language,
      voice,
      dto.practiceMinutes,
    );
    this.store.addCall(session, call);
    return call;
  }

  async takeTurn(
    callId: string,
    message: string,
    detectedLanguage?: unknown,
  ): Promise<Call> {
    const { session, call } = this.store.getCall(callId);
    return this.calls.takeTurn(session.profile, call, message, detectedLanguage);
  }

  /** Voice path, step one: record the user's line. The reply streams separately. */
  addUserTurn(callId: string, message: string, detectedLanguage?: unknown) {
    const call = this.store.getCall(callId).call;
    this.calls.addUserTurn(call, message, detectedLanguage);
  }

  /** Voice path, step two: stream the agent's reply sentence by sentence. */
  streamAgent(
    callId: string,
    signal: AbortSignal,
    onSentence: (sentence: string) => void,
  ): Promise<void> {
    const { session, call } = this.store.getCall(callId);
    return this.calls.speakStream(session.profile, call, signal, onSentence);
  }

  /** Names speech to text should spell correctly: the company and its products. */
  brandTerms(callId: string): string[] {
    const { session } = this.store.getCall(callId);
    return brandTerms(session.profile.name, session.profile.offerings);
  }

  getCall(callId: string): Call {
    return this.store.getCall(callId).call;
  }

  /** Hangs up. Scores the call once, and returns the same scorecard on repeat calls. */
  async endCall(callId: string): Promise<Scorecard> {
    const { call } = this.store.getCall(callId);
    call.ended = true;
    return this.scorecard(callId);
  }

  async scorecard(callId: string): Promise<Scorecard> {
    const { session, call } = this.store.getCall(callId);
    if (call.scorecard) return call.scorecard;
    if (!call.turns.some((t) => t.speaker === 'user')) {
      throw new BadRequestException(
        'Have a conversation first, then ask for the scorecard',
      );
    }
    call.scorecard = await this.scoring.score(session.profile, call);
    return call.scorecard;
  }
}

function pickRandom<T>(items: T[]): T | undefined {
  return items[Math.floor(Math.random() * items.length)];
}
