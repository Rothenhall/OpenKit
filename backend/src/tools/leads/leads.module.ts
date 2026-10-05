import { Module } from '@nestjs/common';
import { DbModule } from '../../common/db/db.module.js';
import { MailModule } from '../../common/mail/mail.module.js';
import { RateLimitModule } from '../../common/rate-limit/rate-limit.module.js';
import { SarvamModule } from '../../common/sarvam/sarvam.module.js';
import { CallService } from './call/call.service.js';
import { LeadCaptureService } from './lead-capture/lead-capture.service.js';
import { LeadsController } from './leads.controller.js';
import { LeadsService } from './leads.service.js';
import { ScenariosService } from './scenarios/scenarios.service.js';
import { ScoringService } from './scoring/scoring.service.js';
import { SessionStore } from './session/session.store.js';
import { SiteFetcherService } from './site/site-fetcher.service.js';
import { EvidenceService } from './understanding/evidence.service.js';
import { UnderstandingService } from './understanding/understanding.service.js';
import { VoiceGateway } from './voice/voice.gateway.js';
import { VoiceService } from './voice/voice.service.js';

@Module({
  imports: [SarvamModule, RateLimitModule, DbModule, MailModule],
  controllers: [LeadsController],
  providers: [
    LeadsService,
    SiteFetcherService,
    EvidenceService,
    UnderstandingService,
    ScenariosService,
    CallService,
    ScoringService,
    SessionStore,
    LeadCaptureService,
    VoiceService,
    VoiceGateway,
  ],
})
export class LeadsModule {}
