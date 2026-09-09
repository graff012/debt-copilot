import { Inject, Controller, Get, Query } from '@nestjs/common';
import { OrgId } from '../tenant/org.decorator.js';
import { DashboardService } from './dashboard.service.js';

@Controller('dashboard')
export class DashboardController {
  constructor(@Inject(DashboardService) private readonly service: DashboardService) {}

  @Get()
  get(@Query('today') today: string | undefined, @OrgId() orgId: string) {
    return this.service.get(today ?? '', orgId);
  }
}
