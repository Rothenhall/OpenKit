import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  HOUR,
  MINUTE,
  RateLimit,
  RateLimitGuard,
} from '../../common/rate-limit/rate-limit.guard.js';
import {
  parseAnalyse,
  parseCustomScenario,
  parseProfileUpdate,
  parseLead,
  parseStartCall,
  parseTurn,
} from './dto/leads.dto.js';
import { LeadsService } from './leads.service.js';
import { LeadCaptureService } from './lead-capture/lead-capture.service.js';
import { VoiceService } from './voice/voice.service.js';
import { RateLimiter } from '../../common/rate-limit/rate-limiter.js';
import type { Call, Session } from './leads.types.js';

/** The response shape hides internals such as the call map and expiry. */
const sessionView = (s: Session) => ({
  sessionId: s.id,
  url: s.url,
  profile: s.profile,
  scenarios: s.scenarios,
});

const callView = (c: Call) => ({
  callId: c.id,
  scenario: c.scenario,
  language: c.language,
  voice: c.voice,
  ended: c.ended,
  turns: c.turns,
  practiceMinutes: c.practiceMinutes,
  endsAt: c.endsAt,
  scorecard: c.scorecard,
});

/** Ceilings across all visitors, so a wave of traffic cannot run up the Sarvam bill. */
const GLOBAL_CALLS_PER_HOUR = Number(process.env.GLOBAL_CALLS_PER_HOUR ?? 300);
const GLOBAL_ANALYSES_PER_HOUR = Number(
  process.env.GLOBAL_ANALYSES_PER_HOUR ?? 200,
);

@Controller('tools/leads')
@UseGuards(RateLimitGuard)
export class LeadsController {
  constructor(
    private readonly leads: LeadsService,
    private readonly voice: VoiceService,
    private readonly limiter: RateLimiter,
    private readonly capture: LeadCaptureService,
  ) {}

  @Post('analyse')
  @HttpCode(200)
  @RateLimit('analyse', 10, HOUR)
  async analyse(@Body() body: unknown) {
    this.limiter.hit('global:analyse', GLOBAL_ANALYSES_PER_HOUR, HOUR);
    const dto = parseAnalyse(body);
    return sessionView(await this.leads.analyse(dto.url, dto.language));
  }

  @Get('sessions/:id')
  async getSession(@Param('id') id: string) {
    return sessionView(await this.leads.getSession(id));
  }

  @Patch('sessions/:id/profile')
  @RateLimit('profile', 20, HOUR)
  async updateProfile(@Param('id') id: string, @Body() body: unknown) {
    return sessionView(
      await this.leads.updateProfile(id, parseProfileUpdate(body)),
    );
  }

  @Post('sessions/:id/scenarios')
  @RateLimit('scenario', 20, HOUR)
  addScenario(@Param('id') id: string, @Body() body: unknown) {
    return this.leads.addCustomScenario(id, parseCustomScenario(body));
  }

  /** Send `scenarioId` for a chosen scenario, or nothing for a random one. */
  @Post('sessions/:id/calls')
  @RateLimit('call', 20, HOUR)
  async startCall(@Param('id') id: string, @Body() body: unknown) {
    // A ceiling across all visitors, so a wave of traffic cannot run up the Sarvam bill.
    this.limiter.hit('global:call', GLOBAL_CALLS_PER_HOUR, HOUR);
    const call = await this.leads.startCall(id, parseStartCall(body ?? {}));
    // Start speaking the greeting now, so it is ready when the user taps Begin.
    this.voice.warmGreeting(call);
    return callView(call);
  }

  @Post('calls/:id/turns')
  @HttpCode(200)
  @RateLimit('turn', 120, 10 * MINUTE)
  async takeTurn(@Param('id') id: string, @Body() body: unknown) {
    return callView(await this.leads.takeTurn(id, parseTurn(body)));
  }

  @Get('calls/:id')
  async getCall(@Param('id') id: string) {
    return callView(await this.leads.getCall(id));
  }

  /** Hangs up and returns the scorecard. */
  @Post('calls/:id/end')
  @HttpCode(200)
  @RateLimit('score', 30, HOUR)
  async endCall(@Param('id') id: string) {
    return this.leads.endCall(id);
  }

  /** The scorecard form: someone asks to be contacted. Saved to Postgres. */
  @Post('calls/:id/lead')
  @HttpCode(200)
  @RateLimit('lead', 10, HOUR)
  async captureLead(@Param('id') id: string, @Body() body: unknown) {
    const lead = parseLead(body);
    if (!lead.spam) await this.capture.capture(id, lead);
    return { ok: true };
  }

  @Get('calls/:id/scorecard')
  @RateLimit('score', 30, HOUR)
  scorecard(@Param('id') id: string) {
    return this.leads.scorecard(id);
  }
}
