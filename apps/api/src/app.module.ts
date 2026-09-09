import { Module } from '@nestjs/common';
import { DbModule } from './db/db.module.js';
import { HealthController } from './health.controller.js';
import { AuthModule } from './auth/auth.module.js';
import { DashboardModule } from './dashboard/dashboard.module.js';
import { CustomersModule } from './customers/customers.module.js';
import { PromisesModule } from './promises/promises.module.js';
import { ImportsModule } from './imports/imports.module.js';
import { TelegramModule } from './telegram/telegram.module.js';

@Module({
  imports: [DbModule, AuthModule, DashboardModule, CustomersModule, PromisesModule, ImportsModule, TelegramModule],
  controllers: [HealthController],
})
export class AppModule {}
