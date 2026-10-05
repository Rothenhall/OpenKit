import { Module } from '@nestjs/common';
import { SarvamService } from './sarvam.service.js';

@Module({
  providers: [SarvamService],
  exports: [SarvamService],
})
export class SarvamModule {}
