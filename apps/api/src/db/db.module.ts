import { Global, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import { Pool } from 'pg';
import { createDb, type Db } from '@debt-copilot/db';

@Injectable()
export class DbService implements OnApplicationShutdown {
  readonly db: Db;
  private readonly pool: Pool;

  constructor() {
    const connectionString = process.env['DATABASE_URL'];
    if (!connectionString) {
      throw new Error('DATABASE_URL is required (docker compose up -d db, see .env.example)');
    }
    const { db, pool } = createDb(connectionString);
    this.db = db;
    this.pool = pool;
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}

@Global()
@Module({
  providers: [DbService],
  exports: [DbService],
})
export class DbModule {}
