import { config } from 'dotenv';
import type { Config } from 'drizzle-kit';

config({ path: '../../.env' });

// Generate needs no live DB; migrate/seed enforce the real variable strictly.
const connectionString =
  process.env['DATABASE_URL'] ?? 'postgres://localhost:5432/placeholder';

export default {
  schema: './src/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url: connectionString },
} satisfies Config;
