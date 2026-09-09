import { Body, Controller, HttpCode, Inject, Post } from '@nestjs/common';
import { Org } from '../tenant/org.decorator.js';
import { ImportBodyDto } from './import.dto.js';
import { ImportsService } from './imports.service.js';

@Controller('imports')
export class ImportsController {
  constructor(@Inject(ImportsService) private readonly service: ImportsService) {}

  @Post()
  @HttpCode(200)
  create(@Body() body: ImportBodyDto, @Org() orgId: string) {
    return this.service.importFile(body, orgId);
  }
}
