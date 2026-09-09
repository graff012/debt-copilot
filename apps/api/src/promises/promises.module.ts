import { Module } from '@nestjs/common';
import { PromisesController } from './promises.controller.js';
import { PromisesService } from './promises.service.js';

@Module({
  controllers: [PromisesController],
  providers: [PromisesService],
})
export class PromisesModule {}
