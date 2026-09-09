import { BadRequestException, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { OrgRequest } from './tenant.middleware.js';

/** Validated organization id from TenantMiddleware. Throws 400 when absent. */
export const OrgId = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  const req = ctx.switchToHttp().getRequest<OrgRequest>();
  if (!req.orgId) throw new BadRequestException('Missing tenant context');
  return req.orgId;
});
