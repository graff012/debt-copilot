import { config } from 'dotenv';
import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module.js';

config({ path: '../../.env' });

// Shared e2e harness: boot once per file, signup scratch orgs via the API,
// full RESTRICT-order teardown. Every request carries a Bearer token.

export interface Creds {
  orgId: string;
  userId: string;
  access: string;
  refresh: string;
  email: string;
}

export const bearer = (token: string): Record<string, string> => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${token}`,
});

export async function bootApp(): Promise<{ app: INestApplication; base: string }> {
  if (!process.env['DATABASE_URL']) throw new Error('DATABASE_URL required (docker compose up -d db)');
  const app = await NestFactory.create(AppModule, { logger: false });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.listen(0);
  const url = await app.getUrl();
  return { app, base: url.replace('[::1]', '127.0.0.1') };
}

export async function signupOrg(base: string, tag: string): Promise<Creds> {
  const email = `e2e-${tag}-${Date.now()}@t.uz`;
  const res = await fetch(`${base}/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      organizationName: `e2e ${tag}`,
      timeZone: 'Asia/Tashkent',
      name: 'E2E Owner',
      email,
      password: 'Test1234!!',
    }),
  });
  if (!res.ok) throw new Error(`signup failed: ${res.status}`);
  const body = (await res.json()) as {
    accessToken: string;
    refreshToken: string;
    userId: string;
    organizationId: string;
  };
  return { orgId: body.organizationId, userId: body.userId, access: body.accessToken, refresh: body.refreshToken, email };
}

export async function teardownOrg(orgId: string): Promise<void> {
  const { createDb } = await import('@debt-copilot/db');
  const cs = process.env['DATABASE_URL'];
  if (!cs) throw new Error('DATABASE_URL required');
  const { db, pool } = createDb(cs);
  const {
    customers,
    importJobs,
    interactions,
    organizations,
    payments,
    promises,
    receivables,
    reminders,
    users,
  } = await import('@debt-copilot/db');
  const { eq } = await import('drizzle-orm');
  // refresh_tokens + telegram_links cascade off users; everything else is explicit.
  await db.delete(reminders).where(eq(reminders.organizationId, orgId));
  await db.delete(interactions).where(eq(interactions.organizationId, orgId));
  await db.delete(payments).where(eq(payments.organizationId, orgId));
  await db.delete(promises).where(eq(promises.organizationId, orgId));
  await db.delete(receivables).where(eq(receivables.organizationId, orgId));
  await db.delete(importJobs).where(eq(importJobs.organizationId, orgId));
  await db.delete(users).where(eq(users.organizationId, orgId));
  await db.delete(customers).where(eq(customers.organizationId, orgId));
  await db.delete(organizations).where(eq(organizations.id, orgId));
  await pool.end();
}
