import { BadRequestException, Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// DEMO tenant stand-in. Task 8 (auth) replaces X-Organization-Id with a
// session-derived org. The header name is intentionally ugly to prevent
// anyone mistaking it for real auth.
// ---------------------------------------------------------------------------

export interface OrgRequest extends Request {
  orgId?: string;
}

@Injectable()
export class TenantMiddleware implements NestMiddleware {
  use(req: OrgRequest, _res: Response, next: NextFunction): void {
    // originalUrl: never rewritten by mounts (req.path misbehaves under Express 5 routers).
    const path = req.originalUrl.split('?')[0];
    if (path === '/healthz' || path === '/healthz/') {
      next();
      return;
    }
    const raw = req.header('X-Organization-Id');
    if (!raw || !UUID_RE.test(raw)) {
      throw new BadRequestException('X-Organization-Id must be a UUID (demo auth, see task 8)');
    }
    req.orgId = raw;
    next();
  }
}
