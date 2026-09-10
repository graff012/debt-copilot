import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { ConflictException, Inject, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { telegramLinks, users, type Db } from '@debt-copilot/db';
import { DbService } from '../db/db.module.js';
import { requireOrg } from '../tenant/require-org.js';
import type { SessionUser } from '../tenant/org.decorator.js';

const LINK_TTL_MS = 15 * 60_000;
const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

function botSecret(): string {
  const secret = process.env['BOT_SECRET'];
  if (!secret) throw new Error('BOT_SECRET must be set (bot side of Telegram linking)');
  return secret;
}

function botUsername(): string {
  return process.env['TELEGRAM_BOT_USERNAME'] ?? 'DebtCopilotBot';
}

/**
 * Telegram account linking stub (spec §26). The bot runtime arrives later;
 * this is the contract: app issues single-use codes, bot confirms them.
 */
@Injectable()
export class TelegramService {
  private readonly db: Db;

  constructor(@Inject(DbService) dbService: DbService) {
    this.db = dbService.db;
  }

  async issueLink(user: SessionUser): Promise<{ url: string; expiresInMinutes: number }> {
    const code = randomBytes(16).toString('hex');
    const expiresAt = new Date(Date.now() + LINK_TTL_MS);
    await this.db.insert(telegramLinks).values({
      userId: user.userId,
      codeHash: sha256(code),
      expiresAt,
    });
    return { url: `https://t.me/${botUsername()}?start=link_${code}`, expiresInMinutes: 15 };
  }

  async confirm(code: string, telegramUserId: number, presentedSecret: string): Promise<void> {    const expected = Buffer.from(botSecret(), 'utf8');
    const presented = Buffer.from(presentedSecret, 'utf8');
    // Constant-time compare (length check first: length itself is not secret).
    if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) {
      throw new UnauthorizedException('Bad bot secret');
    }
    const [link] = await this.db
      .select()
      .from(telegramLinks)
      .where(eq(telegramLinks.codeHash, sha256(code)));
    const now = new Date();
    if (!link || link.usedAt || link.expiresAt.getTime() <= now.getTime()) {
      throw new UnauthorizedException('Invalid or expired link code');
    }
    await this.db.transaction(async (tx) => {
      // Conditional consume: concurrent confirms race here, exactly one wins —
      // the loser updates zero rows (usedAt already set) and gets 401.
      const [claimed] = await tx
        .update(telegramLinks)
        .set({ usedAt: now })
        .where(and(eq(telegramLinks.id, link.id), isNull(telegramLinks.usedAt)))
        .returning({ id: telegramLinks.id, userId: telegramLinks.userId });
      if (!claimed) throw new UnauthorizedException('Invalid or expired link code');
      const [owner] = await tx.select().from(users).where(eq(users.id, claimed.userId));
      if (!owner) throw new UnauthorizedException('Invalid or expired link code');
      // Explicit clash check first: the unique violation below is the backstop,
      // and driver error shapes vary too much to rely on alone.
      const [clash] = await tx
        .select({ id: users.id })
        .from(users)
        .where(
          and(
            eq(users.organizationId, owner.organizationId),
            eq(users.telegramUserId, BigInt(telegramUserId)),
          ),
        );
      if (clash && clash.id !== claimed.userId) {
        throw new ConflictException('Telegram account is already linked in this organization');
      }
      await tx
        .update(users)
        .set({ telegramUserId: BigInt(telegramUserId) })
        .where(eq(users.id, claimed.userId));
    });
  }

  /** Bot-side identity lookup. Unknown senders 404 (bot replies "please link first"). */
  async context(
    telegramUserId: number,
    presentedSecret: string,
  ): Promise<{ userId: string; organizationId: string; name: string; timeZone: string }> {
    const expected = Buffer.from(botSecret(), 'utf8');
    const presented = Buffer.from(presentedSecret, 'utf8');
    if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) {
      throw new UnauthorizedException('Bad bot secret');
    }
    const [user] = await this.db
      .select()
      .from(users)
      .where(eq(users.telegramUserId, BigInt(telegramUserId)));
    if (!user) throw new NotFoundException('Telegram account is not linked');
    const org = await requireOrg(this.db, user.organizationId);
    return { userId: user.id, organizationId: user.organizationId, name: user.name, timeZone: org.timeZone };
  }
}
