import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

export const QUEUE_NAMES = ['nightly-states', 'morning-summary', 'promise-reminders'] as const;

export type QueueName = (typeof QUEUE_NAMES)[number];

export function createQueues(connectionString: string): Record<QueueName, Queue> {
  // BullMQ needs one dedicated connection per Queue/Worker (blocking calls).
  const conn = (): Redis => new Redis(connectionString, { maxRetriesPerRequest: null });
  return {
    'nightly-states': new Queue('nightly-states', { connection: conn() }),
    'morning-summary': new Queue('morning-summary', { connection: conn() }),
    'promise-reminders': new Queue('promise-reminders', { connection: conn() }),
  };
}

export interface RepeatSpec {
  schedulerId: string;
  pattern: string;
  jobName: string;
}

export function repeatable(name: QueueName): RepeatSpec {
  switch (name) {
    case 'nightly-states':
      return { schedulerId: `${name}-schedule`, pattern: '5 0 * * *', jobName: 'flip' };
    case 'morning-summary':
      return { schedulerId: `${name}-schedule`, pattern: '55 8 * * *', jobName: 'send' };
    case 'promise-reminders':
      return { schedulerId: `${name}-schedule`, pattern: '0 * * * *', jobName: 'remind' };
  }
}
