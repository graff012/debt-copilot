import { BadRequestException, Controller, Get, Inject, Query } from '@nestjs/common';
import { OrgId } from '../tenant/org.decorator.js';
import { PromisesService, type PromiseGroup } from './promises.service.js';

const GROUPS: ReadonlySet<string> = new Set(['today', 'upcoming', 'broken']);
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

@Controller('promises')
export class PromisesController {
  constructor(@Inject(PromisesService) private readonly service: PromisesService) {}

  @Get()
  board(
    @Query('today') today: string | undefined,
    @Query('group') group: string | undefined,
    @OrgId() orgId: string,
  ) {
    if (!today || !DAY_RE.test(today)) throw new BadRequestException('today must be YYYY-MM-DD');
    if (group !== undefined && !GROUPS.has(group)) {
      throw new BadRequestException('group must be today|upcoming|broken');
    }
    return this.service.board(today, orgId, group as PromiseGroup | undefined);
  }
}
