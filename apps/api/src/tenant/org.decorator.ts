import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

export interface SessionUser {
  userId: string;
  orgId: string;
  role: string;
}

/** Organization id from the verified session. Never from headers. */
export const Org = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  const req = ctx.switchToHttp().getRequest<{ user?: SessionUser }>();
  if (!req.user) throw new Error('Org used outside JwtAuthGuard');
  return req.user.orgId;
});

/** Full session for endpoints that need role/user (none yet — task: RBAC). */
export const Session = createParamDecorator((_data: unknown, ctx: ExecutionContext): SessionUser => {
  const req = ctx.switchToHttp().getRequest<{ user?: SessionUser }>();
  if (!req.user) throw new Error('Session used outside JwtAuthGuard');
  return req.user;
});
