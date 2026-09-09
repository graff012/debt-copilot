import { Inject, Controller, Get, Query } from '@nestjs/common';
import { Org } from '../tenant/org.decorator.js';
import { DashboardService } from './dashboard.service.js';

@Controller('dashboard')
export class DashboardController {
  constructor(@Inject(DashboardService) private readonly service: DashboardService) {}

  @Get()
  get(@Query('today') today: string | undefined, @Org() orgId: string) {
    return this.service.get(today ?? '', orgId);
  }
}
