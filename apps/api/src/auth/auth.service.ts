import { createHash, randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { and, eq, lt } from 'drizzle-orm';
import { JwtService } from '@nestjs/jwt';
import { organizations, refreshTokens, users, type Db } from '@debt-copilot/db';
import { DbService } from '../db/db.module.js';
import { requireOrg } from '../tenant/require-org.js';
import { hashPassword, normalizeEmail, verifyPassword } from './password.js';
import type { LoginDto, SignupDto } from './auth.dto.js';

const ACCESS_TTL = '15m';
const REFRESH_DAYS = 30;

export interface AuthResult {
  accessToken: string;
  refreshToken: string;
  userId: string;
  organizationId: string;
  role: string;
}

// Constant-time filler so unknown-email logins cost the same bcrypt work as
// real ones (kills the response-time enumeration oracle).
const DUMMY_HASH = '$2b$12$a9mWdMAhdJE.YiZDdnxDP..btiRDh0OZGlTx69YW855Aq3EgoR306';

const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');
const INVALID = 'Invalid email or password';

@Injectable()
export class AuthService {
  private readonly db: Db;

  constructor(
    @Inject(DbService) dbService: DbService,
    @Inject(JwtService) private readonly jwt: JwtService,
  ) {
    this.db = dbService.db;
  }

  private async issue(userId: string, orgId: string, role: string): Promise<AuthResult> {
    const accessToken = await this.jwt.signAsync({ sub: userId, org: orgId, role }, { expiresIn: ACCESS_TTL });
    const refreshToken = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + REFRESH_DAYS * 86_400_000);
    await this.db.insert(refreshTokens).values({ userId, tokenHash: sha256(refreshToken), expiresAt });
    return { accessToken, refreshToken, userId, organizationId: orgId, role };
  }

  async signup(dto: SignupDto): Promise<AuthResult> {
    const email = normalizeEmail(dto.email);
    if (Buffer.byteLength(dto.password, 'utf8') > 72) {
      // bcrypt truncates past 72 BYTES (chars ≠ bytes for multibyte input).
      throw new ConflictException('Password is too long');
    }
    const timeZone = dto.timeZone.trim();
    try {
      // IANA check now: an invalid zone would 500 every org-today calc later.
      new Intl.DateTimeFormat('en-CA', { timeZone });
    } catch {
      throw new BadRequestException('Unknown timezone');
    }
    const passwordHash = await hashPassword(dto.password);
    // Fresh orgId per signup, so the email unique index cannot collide here;
    // the same address may own several orgs (login disambiguates).
    const created = await this.db.transaction(async (tx) => {
        const [org] = await tx
          .insert(organizations)
          .values({ name: dto.organizationName.trim(), timeZone, baseCurrency: 'UZS' })
          .returning({ id: organizations.id });
      if (!org) throw new Error('Org insert failed');
      const [user] = await tx
        .insert(users)
        .values({ organizationId: org.id, name: dto.name.trim(), email, passwordHash, role: 'owner' })
        .returning({ id: users.id, organizationId: users.organizationId, role: users.role });
      if (!user) throw new Error('User insert failed');
      return user;
    });
    return this.issue(created.id, created.organizationId, created.role);
  }

  async login(dto: LoginDto): Promise<AuthResult> {
    const email = normalizeEmail(dto.email);
    const candidates = await this.db
      .select()
      .from(users)
      .where(eq(users.email, email));
    const withPassword = candidates.filter((u) => u.passwordHash !== null);
    let user = withPassword.length === 1 ? withPassword[0] : undefined;
    if (!user && dto.organizationId) {
      user = withPassword.find((u) => u.organizationId === dto.organizationId);
    }
    if (!user) {
      // Same cost and message whether the email is unknown, has no password,
      // or is ambiguous across orgs without organizationId: no oracle.
      await verifyPassword(dto.password, DUMMY_HASH);
      throw new UnauthorizedException(INVALID);
    }
    const ok = user.passwordHash ? await verifyPassword(dto.password, user.passwordHash) : false;
    if (!ok) throw new UnauthorizedException(INVALID);
    return this.issue(user.id, user.organizationId, user.role);
  }

  async refresh(refreshToken: string): Promise<AuthResult> {
    const hash = sha256(refreshToken);
    // Check-then-revoke runs inside one transaction with a row lock: two
    // concurrent refreshes with the same token cannot both issue.
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(refreshTokens)
        .where(eq(refreshTokens.tokenHash, hash))
        .for('update');
      const now = new Date();
      if (!row) throw new UnauthorizedException('Invalid or expired refresh token');
      if (row.revokedAt) {
        // Spent token reused while still fresh = likely theft: wipe the family.
        if (row.expiresAt.getTime() > now.getTime()) {
          await tx.delete(refreshTokens).where(eq(refreshTokens.userId, row.userId));
        } else {
          await tx.delete(refreshTokens).where(eq(refreshTokens.id, row.id));
        }
        throw new UnauthorizedException('Invalid or expired refresh token');
      }
      if (row.expiresAt.getTime() <= now.getTime()) {
        await tx.delete(refreshTokens).where(eq(refreshTokens.id, row.id));
        throw new UnauthorizedException('Invalid or expired refresh token');
      }
      const [user] = await tx.select().from(users).where(eq(users.id, row.userId));
      if (!user) throw new UnauthorizedException('Invalid or expired refresh token');
      await tx.update(refreshTokens).set({ revokedAt: now }).where(eq(refreshTokens.id, row.id));
      // Opportunistic purge: expired rows for this user never accumulate.
      // Spent-but-unexpired rows stay as theft-tripwires (bounded, 30d max).
      await tx
        .delete(refreshTokens)
        .where(and(eq(refreshTokens.userId, row.userId), lt(refreshTokens.expiresAt, now)));
      const accessToken = await this.jwt.signAsync(
        { sub: user.id, org: user.organizationId, role: user.role },
        { expiresIn: ACCESS_TTL },
      );
      const next = randomBytes(32).toString('hex');
      const expiresAt = new Date(now.getTime() + REFRESH_DAYS * 86_400_000);
      await tx.insert(refreshTokens).values({ userId: user.id, tokenHash: sha256(next), expiresAt });
      return {
        accessToken,
        refreshToken: next,
        userId: user.id,
        organizationId: user.organizationId,
        role: user.role,
      };
    });
  }

  async logout(refreshToken: string): Promise<void> {
    await this.db.delete(refreshTokens).where(eq(refreshTokens.tokenHash, sha256(refreshToken)));
  }

  async me(userId: string): Promise<{
    userId: string;
    organizationId: string;
    role: string;
    timeZone: string;
  }> {
    const [user] = await this.db.select().from(users).where(eq(users.id, userId));
    if (!user) throw new UnauthorizedException('Invalid session');
    const org = await requireOrg(this.db, user.organizationId);
    return { userId: user.id, organizationId: org.id, role: user.role, timeZone: org.timeZone };
  }

  async revokeFamily(userId: string): Promise<void> {
    await this.db.delete(refreshTokens).where(eq(refreshTokens.userId, userId));
  }
}
