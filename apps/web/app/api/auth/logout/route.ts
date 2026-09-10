import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

function apiBase(): string {
  return (process.env['API_URL'] ?? 'http://localhost:4000').replace(/\/$/, '');
}

export async function POST(): Promise<NextResponse> {
  const jar = await cookies();
  const refresh = jar.get('refresh')?.value;
  // Best-effort server-side revocation; cookies clear regardless.
  if (refresh) {
    await fetch(`${apiBase()}/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: refresh }),
    }).catch(() => null);
  }
  jar.delete('access');
  jar.delete('refresh');
  return NextResponse.json({ ok: true });
}
