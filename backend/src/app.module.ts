import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { LeadsModule } from './tools/leads/leads.module.js';

@Module({
  imports: [LeadsModule],
  controllers: [AppController],
})
export class AppModule {}
