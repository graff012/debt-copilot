import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import type { SessionUser } from '../tenant/org.decorator.js';
import { IS_PUBLIC } from './public.decorator.js';

interface AccessPayload {
  sub: string;
  org: string;
  role: string;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    @Inject(JwtService) private readonly jwt: JwtService,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()])) {
      return true;
    }
    const req = context.switchToHttp().getRequest<Request & { user?: SessionUser }>();
    const header = req.header('authorization') ?? '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) throw new UnauthorizedException('Missing bearer token');
    let payload: AccessPayload;
    try {
      // Pin the algorithm: no alg confusion, no 'none'.
      payload = await this.jwt.verifyAsync<AccessPayload>(token, { algorithms: ['HS256'] });
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
    if (!payload.sub || !payload.org || !payload.role) {
      throw new UnauthorizedException('Invalid token claims');
    }
    req.user = { userId: payload.sub, orgId: payload.org, role: payload.role };
    return true;
  }
}
