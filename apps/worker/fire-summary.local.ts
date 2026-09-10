import { readFileSync } from 'node:fs';
import { createDb } from '@debt-copilot/db';
import { createBot } from '@debt-copilot/telegram';
import { createBotSender } from '@debt-copilot/telegram';
import { runMorningSummary } from './src/jobs/summary.js';

// One-off live demo trigger (deleted after use). Reads env from the repo root.
const env = Object.fromEntries(
  readFileSync('/home/graff/Intensive_Applications/debt_copilot/.env', 'utf8')
    .split('\n')
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i), l.slice(i + 1)];
    }),
);
const { db, pool } = createDb(env['DATABASE_URL'] ?? '');
const bot = createBot(env['TELEGRAM_BOT_TOKEN'] ?? '', {
  db,
  apiUrl: 'http://localhost:4000',
  botSecret: env['BOT_SECRET'] ?? '',
});
const send = createBotSender(bot);
const result = await runMorningSummary(db, new Date(), send);
console.log(`summary done: sent=${result.sent} skipped=${result.skipped}`);
await pool.end();
process.exit(0);
