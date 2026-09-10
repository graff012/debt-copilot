import { config } from 'dotenv';

config({ path: '../../.env' });

export function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required (see .env.example)`);
  return value;
}

export const DATABASE_URL = requiredEnv('DATABASE_URL');
export const REDIS_URL = requiredEnv('REDIS_URL');
// Empty = jobs run, Telegram sends log + skip. From BotFather when ready.
export const TELEGRAM_BOT_TOKEN = process.env['TELEGRAM_BOT_TOKEN'] ?? '';
export const BOT_SECRET = process.env['BOT_SECRET'] ?? '';
export const API_URL = (process.env['API_URL'] ?? 'http://localhost:4000').replace(/\/$/, '');
