import { cookies } from 'next/headers';

// Server-side API client. Tokens stay in httpOnly cookies: components and
// pages never see them. Throws ApiError (401 → caller redirects to /login).

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function apiBase(): string {
  return (process.env['API_URL'] ?? 'http://localhost:4000').replace(/\/$/, '');
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const jar = await cookies();
  const access = jar.get('access')?.value;
  const res = await fetch(`${apiBase()}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(access ? { Authorization: `Bearer ${access}` } : {}),
      ...init?.headers,
    },
    cache: 'no-store',
  });
  if (res.status === 401) throw new ApiError(401, 'Session expired — please log in again');
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: unknown } | null;
    const message = body?.message;
    throw new ApiError(res.status, typeof message === 'string' ? message : `API error ${res.status}`);
  }
  return (await res.json()) as T;
}
