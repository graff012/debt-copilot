import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

function apiBase(): string {
  return (process.env['API_URL'] ?? 'http://localhost:4000').replace(/\/$/, '');
}

function cookieFlags(maxAge: number): {
  httpOnly: boolean;
  sameSite: 'lax';
  secure: boolean;
  path: string;
  maxAge: number;
} {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env['NODE_ENV'] === 'production',
    path: '/',
    maxAge,
  };
}

export async function POST(req: Request): Promise<NextResponse> {
  const body: unknown = await req.json().catch(() => null);
  const upstream = await fetch(`${apiBase()}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!upstream.ok) {
    const err = (await upstream.json().catch(() => null)) as { message?: unknown } | null;
    const message = err?.message;
    return NextResponse.json(
      { message: typeof message === 'string' ? message : 'Login failed' },
      { status: upstream.status },
    );
  }
  const data = (await upstream.json()) as { accessToken?: unknown; refreshToken?: unknown };
  if (typeof data.accessToken !== 'string' || typeof data.refreshToken !== 'string') {
    return NextResponse.json({ message: 'Bad auth response' }, { status: 502 });
  }
  const jar = await cookies();
  jar.set('access', data.accessToken, cookieFlags(900));
  jar.set('refresh', data.refreshToken, cookieFlags(30 * 86_400));
  return NextResponse.json({ ok: true });
}
