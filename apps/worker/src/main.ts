import { createDb } from '@debt-copilot/db';
import { createBot } from '@debt-copilot/telegram';
import { createBotSender } from '@debt-copilot/telegram';
import { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { API_URL, BOT_SECRET, DATABASE_URL, REDIS_URL, TELEGRAM_BOT_TOKEN } from './env.js';
import { runMorningSummary } from './jobs/summary.js';
import { runNightly } from './jobs/nightly.js';
import { runReminders } from './jobs/reminders.js';
import { createQueues, repeatable, type QueueName } from './queues.js';
import { logSender, type Sender } from './sender.js';

async function main(): Promise<void> {
  const { db, pool } = createDb(DATABASE_URL);
  const queues = createQueues(REDIS_URL);

  let send: Sender = logSender;
  let stopBot: (() => Promise<void>) | null = null;
  if (TELEGRAM_BOT_TOKEN) {
    const bot = createBot(TELEGRAM_BOT_TOKEN, { db, apiUrl: API_URL, botSecret: BOT_SECRET });
    const botSend = createBotSender(bot);
    send = botSend;
    bot.start();
    stopBot = async (): Promise<void> => {
      await bot.stop();
    };
  }

  const handlers: Record<QueueName, () => Promise<unknown>> = {
    'nightly-states': () => runNightly(db, new Date()),
    'morning-summary': () => runMorningSummary(db, new Date(), send),
    'promise-reminders': () => runReminders(db, new Date()),
  };

  const workers: Worker[] = [];
  for (const name of Object.keys(queues) as QueueName[]) {
    const queue = queues[name];
    const spec = repeatable(name);
    await queue.upsertJobScheduler(spec.schedulerId, { pattern: spec.pattern }, { name: spec.jobName, data: {} });
    const handler = handlers[name];
    workers.push(
      new Worker(
        name,
        async () => {
          await handler();
        },
        { connection: new Redis(REDIS_URL, { maxRetriesPerRequest: null }) },
      ),
    );
  }

  console.log(
    `worker up: queues=${Object.keys(queues).join(',')} telegram=${TELEGRAM_BOT_TOKEN ? 'live' : 'log-mode (no token)'}`,
  );

  const shutdown = async (): Promise<void> => {
    if (stopBot) await stopBot();
    for (const w of workers) await w.close();
    for (const q of Object.values(queues)) await q.close();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());
}

await main();
