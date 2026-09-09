import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { TenantMiddleware, type OrgRequest } from '../src/tenant/tenant.middleware.js';

const ORG = '11111111-1111-4111-8111-111111111111';

const req = (headers: Record<string, string>, url = '/dashboard'): OrgRequest =>
  ({
    header: (name: string) => headers[name],
    originalUrl: url,
    path: url.split('?')[0],
  }) as unknown as OrgRequest;

describe('TenantMiddleware', () => {
  it('accepts a valid UUID org header', () => {
    const mw = new TenantMiddleware();
    const next = vi.fn();
    const r = req({ 'X-Organization-Id': ORG });
    mw.use(r, {} as unknown as Parameters<typeof mw.use>[1], next);
    expect(r.orgId).toBe(ORG);
    expect(next).toHaveBeenCalledOnce();
  });

  it('rejects missing and malformed org headers', () => {
    const mw = new TenantMiddleware();
    expect(() => mw.use(req({}), {} as never, vi.fn())).toThrow(BadRequestException);
    expect(() => mw.use(req({ 'X-Organization-Id': 'nope' }), {} as never, vi.fn())).toThrow(
      BadRequestException,
    );
  });

  it('lets healthz through without a header (Express 5: originalUrl, not path)', () => {
    const mw = new TenantMiddleware();
    const next = vi.fn();
    mw.use(req({}, '/healthz'), {} as never, next);
    expect(next).toHaveBeenCalledOnce();
  });
});
