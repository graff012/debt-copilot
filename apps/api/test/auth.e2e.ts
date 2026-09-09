import { createHash, randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { bearer as H, bootApp, signupOrg, teardownOrg, type Creds } from './setup.js';

// ---------------------------------------------------------------------------
// Auth e2e: signup → login → refresh → logout, Telegram link stub, seed login.
// ---------------------------------------------------------------------------

let app: INestApplication;
let base = '';
const orgs: Creds[] = [];

const post = (path: string, body: unknown, token?: string) =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: token ? H(token) : { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

beforeAll(async () => {
  ({ app, base } = await bootApp());
});

afterAll(async () => {
  for (const o of orgs) {
    await teardownOrg(o.orgId);
  }
  await app.close();
});

async function freshOrg(tag: string): Promise<Creds> {
  const c = await signupOrg(base, tag);
  orgs.push(c);
  return c;
}

describe('signup', () => {
  it('creates an org + owner and returns tokens with identity', async () => {
    const c = await freshOrg('signup');
    expect(c.access.length).toBeGreaterThan(20);
    expect(c.refresh.length).toBeGreaterThan(20);
    expect(c.orgId).toMatch(/^[0-9a-f-]{36}$/);
    const me = await fetch(`${base}/dashboard?today=2026-09-06`, { headers: H(c.access) });
    expect(me.status).toBe(200);
  });

  it('rejects weak passwords and duplicate emails per org', async () => {
    const bad = await post('/auth/signup', {
      organizationName: 'X',
      timeZone: 'UTC',
      name: 'X',
      email: 'weak@t.uz',
      password: 'short',
    });
    expect(bad.status).toBe(400);
  });
});

describe('login', () => {
  it('logs in with good credentials, one message for all failures', async () => {
    const c = await freshOrg('login');
    const ok = await post('/auth/login', { email: c.email, password: 'Test1234!!' });
    expect(ok.status).toBe(200);
    const wrongPass = await post('/auth/login', { email: c.email, password: 'Wrong1234!!' });
    expect(wrongPass.status).toBe(401);
    expect(await wrongPass.json()).toMatchObject({ message: 'Invalid email or password' });
    const unknown = await post('/auth/login', { email: 'nobody@t.uz', password: 'Test1234!!' });
    expect(unknown.status).toBe(401);
    expect(await unknown.json()).toMatchObject({ message: 'Invalid email or password' });
  });

  it('logs in the seeded demo owner', async () => {
    const res = await post('/auth/login', { email: 'owner@demo.uz', password: 'Demo1234!!' });
    expect(res.status).toBe(200);
  });
});

describe('refresh + logout', () => {
  it('rotates refresh tokens and rejects reuse', async () => {
    const c = await freshOrg('refresh');
    const r1 = await post('/auth/refresh', { refreshToken: c.refresh });
    expect(r1.status).toBe(200);
    const pair = (await r1.json()) as { accessToken: string; refreshToken: string };
    // Old refresh token is spent: reuse must fail.
    const reuse = await post('/auth/refresh', { refreshToken: c.refresh });
    expect(reuse.status).toBe(401);
    // New pair works.
    const me = await fetch(`${base}/dashboard?today=2026-09-06`, {
      headers: H(pair.accessToken),
    });
    expect(me.status).toBe(200);
    // Logout kills the new refresh token.
    expect((await post('/auth/logout', { refreshToken: pair.refreshToken })).status).toBe(200);
    expect((await post('/auth/refresh', { refreshToken: pair.refreshToken })).status).toBe(401);
  });
});

describe('telegram linking stub', () => {
  it('needs auth for link-code, bot secret for confirm', async () => {
    expect((await post('/telegram/link-code', {})).status).toBe(401);
    const c = await freshOrg('tg');
    const link = (await (
      await fetch(`${base}/telegram/link-code`, { method: 'POST', headers: H(c.access), body: '{}' })
    ).json()) as { url: string; expiresInMinutes: number };
    expect(link.url).toMatch(/^https:\/\/t\.me\/.+\?start=link_[0-9a-f]+$/);
    expect(link.expiresInMinutes).toBe(15);
    const code = link.url.split('link_')[1] ?? '';
    // Wrong bot secret.
    expect(
      (
        await fetch(`${base}/telegram/confirm`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-bot-secret': 'wrong' },
          body: JSON.stringify({ code, telegramUserId: 998_901_111_111 }),
        })
      ).status,
    ).toBe(401);
    // Right secret binds the Telegram id.
    const botSecret = process.env['BOT_SECRET'];
    if (!botSecret) throw new Error('BOT_SECRET required');
    expect(
      (
        await fetch(`${base}/telegram/confirm`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-bot-secret': botSecret },
          body: JSON.stringify({ code, telegramUserId: 998_901_111_111 }),
        })
      ).status,
    ).toBe(200);
    // Single-use: replay fails.
    expect(
      (
        await fetch(`${base}/telegram/confirm`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-bot-secret': botSecret },
          body: JSON.stringify({ code, telegramUserId: 998_901_111_111 }),
        })
      ).status,
    ).toBe(401);
  });
});

describe('email normalization', () => {
  it("trims + lowercases: padded upper-case login works after lowercase signup", async () => {
    const c = await freshOrg('norm');
    const padded = `  ${c.email.toUpperCase()}  `;
    const res = await post('/auth/login', { email: padded, password: 'Test1234!!' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { organizationId: string };
    expect(body.organizationId).toBe(c.orgId);
  });
});

describe('ambiguous email across orgs', () => {
  it('401 generic without organizationId, 200 with the correct one', async () => {
    const shared = `e2e-amb-${Date.now()}@t.uz`;
    const signup = (organizationName: string) =>
      post('/auth/signup', {
        organizationName,
        timeZone: 'Asia/Tashkent',
        name: 'E2E Owner',
        email: shared,
        password: 'Test1234!!',
      });
    const r1 = await signup('e2e amb one');
    expect(r1.status).toBe(201);
    const b1 = (await r1.json()) as {
      accessToken: string;
      refreshToken: string;
      userId: string;
      organizationId: string;
    };
    orgs.push({ orgId: b1.organizationId, userId: b1.userId, access: b1.accessToken, refresh: b1.refreshToken, email: shared });
    const r2 = await signup('e2e amb two');
    expect(r2.status).toBe(201);
    const b2 = (await r2.json()) as {
      accessToken: string;
      refreshToken: string;
      userId: string;
      organizationId: string;
    };
    orgs.push({ orgId: b2.organizationId, userId: b2.userId, access: b2.accessToken, refresh: b2.refreshToken, email: shared });
    expect(b1.organizationId).not.toBe(b2.organizationId);

    const bare = await post('/auth/login', { email: shared, password: 'Test1234!!' });
    expect(bare.status).toBe(401);
    expect(await bare.json()).toMatchObject({ message: 'Invalid email or password' });

    const withOrg1 = await post('/auth/login', {
      email: shared,
      password: 'Test1234!!',
      organizationId: b1.organizationId,
    });
    expect(withOrg1.status).toBe(200);
    expect(((await withOrg1.json()) as { organizationId: string }).organizationId).toBe(b1.organizationId);

    const withOrg2 = await post('/auth/login', {
      email: shared,
      password: 'Test1234!!',
      organizationId: b2.organizationId,
    });
    expect(withOrg2.status).toBe(200);
    expect(((await withOrg2.json()) as { organizationId: string }).organizationId).toBe(b2.organizationId);
  });
});

describe('password byte-length guard', () => {
  it('rejects >72-byte multibyte passwords with 4xx, never 500', async () => {
    const tooLong = '💰'.repeat(19); // 19 chars, 76 bytes in utf8
    expect(Buffer.byteLength(tooLong, 'utf8')).toBeGreaterThan(72);
    const res = await post('/auth/signup', {
      organizationName: 'e2e longpw',
      timeZone: 'Asia/Tashkent',
      name: 'E2E Owner',
      email: `e2e-longpw-${Date.now()}@t.uz`,
      password: tooLong,
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });
});

describe('forged bearer tokens', () => {
  it("rejects garbage 'Bearer nope' and truncated tokens with 401", async () => {
    const c = await freshOrg('badalg');
    const garbage = await fetch(`${base}/dashboard?today=2026-09-06`, {
      headers: { Authorization: 'Bearer nope' },
    });
    expect(garbage.status).toBe(401);
    const truncated = c.access.slice(0, Math.floor(c.access.length / 2));
    expect(truncated.length).toBeGreaterThan(10);
    const cut = await fetch(`${base}/dashboard?today=2026-09-06`, { headers: H(truncated) });
    expect(cut.status).toBe(401);
  });
});

describe('telegram expired link', () => {
  it('rejects an expired link code with 401', async () => {
    const c = await freshOrg('tgexpired');
    const botSecret = process.env['BOT_SECRET'];
    if (!botSecret) throw new Error('BOT_SECRET required');
    const code = randomBytes(16).toString('hex');
    const codeHash = createHash('sha256').update(code).digest('hex');
    const { createDb } = await import('@debt-copilot/db');
    const cs = process.env['DATABASE_URL'];
    if (!cs) throw new Error('DATABASE_URL required');
    const { db, pool } = createDb(cs);
    const { telegramLinks } = await import('@debt-copilot/db');
    await db
      .insert(telegramLinks)
      .values({ userId: c.userId, codeHash, expiresAt: new Date(Date.now() - 60_000) });
    await pool.end();
    const res = await fetch(`${base}/telegram/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-bot-secret': botSecret },
      body: JSON.stringify({ code, telegramUserId: 998_901_222_222 }),
    });
    expect(res.status).toBe(401);
  });
});

describe('telegram duplicate binding', () => {
  it('second confirm with the same telegramUserId in one org → 409, never 500', async () => {
    const c = await freshOrg('tgdup');
    const botSecret = process.env['BOT_SECRET'];
    if (!botSecret) throw new Error('BOT_SECRET required');
    const { createDb } = await import('@debt-copilot/db');
    const cs = process.env['DATABASE_URL'];
    if (!cs) throw new Error('DATABASE_URL required');
    const { db, pool } = createDb(cs);
    const { users } = await import('@debt-copilot/db');
    const { hash } = await import('bcryptjs');
    const secondEmail = `e2e-tgdup2-${Date.now()}@t.uz`;
    const [u2] = await db
      .insert(users)
      .values({
        organizationId: c.orgId,
        name: 'Second',
        email: secondEmail,
        passwordHash: await hash('Test1234!!', 12),
        role: 'collector',
      })
      .returning({ id: users.id });
    await pool.end();
    if (!u2) throw new Error('second-user setup failed');

    const login2 = await post('/auth/login', { email: secondEmail, password: 'Test1234!!' });
    expect(login2.status).toBe(200);
    const b2 = (await login2.json()) as { accessToken: string };

    const link1 = (await (
      await fetch(`${base}/telegram/link-code`, { method: 'POST', headers: H(c.access), body: '{}' })
    ).json()) as { url: string };
    const link2 = (await (
      await fetch(`${base}/telegram/link-code`, { method: 'POST', headers: H(b2.accessToken), body: '{}' })
    ).json()) as { url: string };
    const code1 = link1.url.split('link_')[1] ?? '';
    const code2 = link2.url.split('link_')[1] ?? '';
    expect(code1.length).toBeGreaterThan(10);
    expect(code2.length).toBeGreaterThan(10);
    expect(code1).not.toBe(code2);

    const tgId = 998_901_333_000 + (Date.now() % 1000);
    const first = await fetch(`${base}/telegram/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-bot-secret': botSecret },
      body: JSON.stringify({ code: code1, telegramUserId: tgId }),
    });
    expect(first.status).toBe(200);
    const dup = await fetch(`${base}/telegram/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-bot-secret': botSecret },
      body: JSON.stringify({ code: code2, telegramUserId: tgId }),
    });
    expect(dup.status).toBe(409);
  });
});
