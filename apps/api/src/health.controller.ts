import { Controller, Get } from '@nestjs/common';
import { Public } from './auth/public.decorator.js';

@Controller()
export class HealthController {
  @Public()
  @Get('healthz')
  health(): { ok: boolean } {
    return { ok: true };
  }
}
