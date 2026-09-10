import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { bootApp, signupOrg, teardownOrg, type Creds } from './setup.js';

// Bot identity lookup contract (packages/telegram resolveContext depends on it).

let app: INestApplication;
let base = '';
let A: Creds;
let botSecret = '';

beforeAll(async () => {
  ({ app, base } = await bootApp());
  A = await signupOrg(base, 'ctx');
  const secret = process.env['BOT_SECRET'];
  if (!secret) throw new Error('BOT_SECRET required');
  botSecret = secret;
});

afterAll(async () => {
  await teardownOrg(A.orgId);
  await app.close();
});

const ctx = (params: string, secret: string) =>
  fetch(`${base}/telegram/context${params}`, { headers: { 'x-bot-secret': secret } });

describe('GET /telegram/context', () => {
  it('returns identity + timezone for a linked sender', async () => {
    const { createDb } = await import('@debt-copilot/db');
    const cs = process.env['DATABASE_URL'];
    if (!cs) throw new Error('DATABASE_URL required');
    const { db, pool } = createDb(cs);
    const { users } = await import('@debt-copilot/db');
    const { eq } = await import('drizzle-orm');
    await db.update(users).set({ telegramUserId: 998_901_222_222n }).where(eq(users.id, A.userId));
    await pool.end();
    const res = await ctx('?telegramUserId=998901222222', botSecret);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      userId: A.userId,
      organizationId: A.orgId,
      timeZone: 'Asia/Tashkent',
    });
  });

  it('404s unknown senders, 401s bad secrets, 400s bad ids', async () => {
    expect((await ctx('?telegramUserId=998901333333', botSecret)).status).toBe(404);
    expect((await ctx('?telegramUserId=998901222222', 'wrong')).status).toBe(401);
    expect((await ctx('?telegramUserId=nope', botSecret)).status).toBe(400);
    expect((await ctx('?telegramUserId=0', botSecret)).status).toBe(400);
  });
});
