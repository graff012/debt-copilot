import { config } from 'dotenv';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDb } from './index.js';

config({ path: '../../.env' });

const connectionString = process.env['DATABASE_URL'];
if (!connectionString) {
  throw new Error('DATABASE_URL is required (see .env.example; db: docker compose up -d db)');
}

const { db, pool } = createDb(connectionString);
await migrate(db, { migrationsFolder: './drizzle' });
await pool.end();
console.log('migrated');
