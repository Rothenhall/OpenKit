import { Controller, Get } from '@nestjs/common';

@Controller()
export class AppController {
  /** Liveness probe for load balancers and uptime monitors. Touches no upstream service. */
  @Get('health')
  health() {
    return { ok: true, uptime: Math.round(process.uptime()) };
  }

  @Get()
  root() {
    return { name: 'Openkit', tools: ['leads'] };
  }
}
