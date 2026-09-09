import { Inject, Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { Org } from '../tenant/org.decorator.js';
import { CustomersService } from './customers.service.js';

@Controller('customers')
export class CustomersController {
  constructor(@Inject(CustomersService) private readonly service: CustomersService) {}

  @Get()
  list(@Query('today') today: string | undefined, @Org() orgId: string) {
    return this.service.list(today ?? '', orgId);
  }

  @Get(':id')
  detail(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query('today') today: string | undefined,
    @Org() orgId: string,
  ) {
    return this.service.detail(id, today ?? '', orgId);
  }
}
