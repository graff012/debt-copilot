import type { MiddlewareConsumer, NestModule } from '@nestjs/common';
import { Module } from '@nestjs/common';
import { DbModule } from './db/db.module.js';
import { HealthController } from './health.controller.js';
import { TenantMiddleware } from './tenant/tenant.middleware.js';
import { DashboardModule } from './dashboard/dashboard.module.js';
import { CustomersModule } from './customers/customers.module.js';
import { PromisesModule } from './promises/promises.module.js';
import { ImportsModule } from './imports/imports.module.js';

@Module({
  imports: [DbModule, DashboardModule, CustomersModule, PromisesModule, ImportsModule],
  controllers: [HealthController],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(TenantMiddleware).forRoutes('*');
  }
}
