import { Bot, Context, InlineKeyboard, session, type SessionFlavor } from 'grammy';
import { and, eq } from 'drizzle-orm';
import { assertDayString, formatMinor, getOrgToday } from '@debt-copilot/domain';
import { customers, interactions, promises, receivables, type Db } from '@debt-copilot/db';
import { decodeCallback } from './callbacks.js';
import { resolveContext, type BotContext } from './context.js';
import { parseAmountInput, parseDayInput } from './parse.js';

// ---------------------------------------------------------------------------
// Operational assistant (spec §3): summaries arrive from the worker; here are
// the action buttons + /start linking. Every write is org-scoped, validated,
// and audit-logged exactly like the API path. Unknown senders and foreign
// customer ids get a dead end — the bot never acts for strangers, and
// 1:1 chats only (group sessions would share pending flows).
// ---------------------------------------------------------------------------

export interface PendingFlow {
  kind: 'promise-currency' | 'promise-date' | 'promise-amount' | 'promise-confirm' | 'note';
  customerId: string;
  customerName: string;
  currency?: string;
  promisedDate?: string;
  amountMinor?: string;
  outstandingMinor?: string;
}

export interface SessionData {
  pending?: PendingFlow;
}

export type BotCtx = Context & SessionFlavor<SessionData>;

export interface BotDeps {
  db: Db;
  apiUrl: string;
  botSecret: string;
}

async function who(ctx: BotCtx, deps: BotDeps): Promise<BotContext | null> {
  const tgId = ctx.from?.id;
  if (!tgId) return null;
  return resolveContext(deps.apiUrl, deps.botSecret, tgId);
}

/** Ownership gate: the customer must exist IN the writer's org. */
async function requireCustomer(
  deps: BotDeps,
  orgId: string,
  customerId: string,
): Promise<{ id: string; name: string } | null> {
  const [c] = await deps.db
    .select({ id: customers.id, name: customers.name })
    .from(customers)
    .where(and(eq(customers.id, customerId), eq(customers.organizationId, orgId)));
  return c ?? null;
}

async function outstandingLanes(
  deps: BotDeps,
  orgId: string,
  customerId: string,
): Promise<Array<{ currency: string; minor: bigint }>> {
  const rows = await deps.db
    .select({ minor: receivables.remainingMinor, currency: receivables.currency })
    .from(receivables)
    .where(and(eq(receivables.customerId, customerId), eq(receivables.organizationId, orgId)));
  const lanes = new Map<string, bigint>();
  for (const r of rows) {
    if (r.minor > 0n) lanes.set(r.currency, (lanes.get(r.currency) ?? 0n) + r.minor);
  }
  return [...lanes].map(([currency, minor]) => ({ currency, minor }));
}

function needLink(ctx: BotCtx): Promise<unknown> {
  return ctx.reply('I do not know you yet — ask your admin for a Telegram link code, then /start with it.');
}

export function createBot(token: string, deps: BotDeps): Bot<BotCtx> {
  const bot = new Bot<BotCtx>(token);
  bot.use(session({ initial: (): SessionData => ({}) }));

  // 1:1 chats only: group sessions would share one pending flow per chat.
  bot.use(async (ctx, next) => {
    if (ctx.chat?.type !== 'private') {
      if (ctx.hasCommand('start')) {
        await ctx.reply('Talk to me in a private chat — group flows are disabled.');
      }
      return;
    }
    await next();
  });

  bot.command('start', async (ctx) => {
    const payload = ctx.match.trim();
    const code = payload.startsWith('link_') ? payload.slice('link_'.length) : '';
    if (!code || !ctx.from) {
      await ctx.reply('Welcome to Debt Copilot. Open the web app, go to Settings → Telegram, and tap your personal link.');
      return;
    }
    try {
      const res = await fetch(`${deps.apiUrl.replace(/\/$/, '')}/telegram/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-bot-secret': deps.botSecret },
        body: JSON.stringify({ code, telegramUserId: ctx.from.id }),
      });
      await ctx.reply(res.ok ? 'Linked! You will get the morning briefings here.' : 'That code did not work — ask for a fresh one.');
    } catch {
      await ctx.reply('Linking failed (network). Try again in a minute.');
    }
  });

  // Owns ONLY v1:customer callbacks. Namespaced flows (date:, amount:,
  // confirm:, cancel:) have dedicated handlers below: this one acks silently
  // and, critically, never touches the session (it once wiped pending flows).
  bot.on('callback_query:data', async (ctx) => {
    const data = ctx.callbackQuery.data;
    if (!data.startsWith('v1:')) {
      await ctx.answerCallbackQuery();
      return;
    }
    const parsed = decodeCallback(data);
    if (!parsed) {
      await ctx.answerCallbackQuery('Unknown button.');
      return;
    }
    const me = await who(ctx, deps);
    if (!me) {
      await ctx.answerCallbackQuery();
      await needLink(ctx);
      return;
    }
    const customer = await requireCustomer(deps, me.organizationId, parsed.customerId);
    if (!customer) {
      await ctx.answerCallbackQuery('Unknown customer.');
      return;
    }
    ctx.session.pending = undefined;

    if (parsed.action === 'called') {
      await deps.db.insert(interactions).values({
        organizationId: me.organizationId,
        customerId: customer.id,
        userId: me.userId,
        type: 'call',
        note: 'Logged from Telegram.',
        source: 'bot',
      });
      await ctx.answerCallbackQuery('Call logged.');
      return;
    }
    if (parsed.action === 'note') {
      ctx.session.pending = { kind: 'note', customerId: customer.id, customerName: customer.name };
      await ctx.answerCallbackQuery();
      await ctx.reply(`What should I note for ${customer.name}? Send it as your next message.`);
      return;
    }
    if (parsed.action === 'promise') {
      const lanes = await outstandingLanes(deps, me.organizationId, customer.id);
      if (lanes.length === 1 && lanes[0]) {
        ctx.session.pending = {
          kind: 'promise-date',
          customerId: customer.id,
          customerName: customer.name,
          currency: lanes[0].currency,
        };
        const keyboard = new InlineKeyboard().text('Today', 'date:today').text('Tomorrow', 'date:tomorrow').text('Friday', 'date:friday');
        await ctx.answerCallbackQuery();
        await ctx.reply(`When will ${customer.name} pay (${lanes[0].currency})? Pick or type YYYY-MM-DD.`, { reply_markup: keyboard });
        return;
      }
      const options = lanes.length > 0 ? lanes.map((l) => l.currency) : ['UZS', 'USD'];
      const keyboard = new InlineKeyboard();
      for (const ccy of options) keyboard.text(ccy, `ccy:${ccy}`);
      ctx.session.pending = { kind: 'promise-currency', customerId: customer.id, customerName: customer.name };
      await ctx.answerCallbackQuery();
      await ctx.reply(`Which currency is the promise in?`, { reply_markup: keyboard });
      return;
    }
  });

  bot.callbackQuery(/^ccy:([A-Z]{3})$/, async (ctx) => {
    const pending = ctx.session.pending;
    if (!pending || pending.kind !== 'promise-currency') {
      await ctx.answerCallbackQuery('Nothing to confirm.');
      return;
    }
    const me = await who(ctx, deps);
    if (!me) {
      await ctx.answerCallbackQuery();
      await needLink(ctx);
      return;
    }
    const customer = await requireCustomer(deps, me.organizationId, pending.customerId);
    if (!customer) {
      ctx.session.pending = undefined;
      await ctx.answerCallbackQuery('Unknown customer.');
      return;
    }
    const match = ctx.match as RegExpMatchArray;
    ctx.session.pending = { ...pending, kind: 'promise-date', currency: match[1] };
    const keyboard = new InlineKeyboard().text('Today', 'date:today').text('Tomorrow', 'date:tomorrow').text('Friday', 'date:friday');
    await ctx.answerCallbackQuery();
    await ctx.reply(`When will ${customer.name} pay (${match[1]})? Pick or type YYYY-MM-DD.`, { reply_markup: keyboard });
  });

  bot.callbackQuery(/^date:(today|tomorrow|friday)$/, async (ctx) => {
    const pending = ctx.session.pending;
    if (!pending || pending.kind !== 'promise-date' || !pending.currency) {
      await ctx.answerCallbackQuery('Nothing to confirm.');
      return;
    }
    const me = await who(ctx, deps);
    if (!me) {
      await ctx.answerCallbackQuery();
      await needLink(ctx);
      return;
    }
    const customer = await requireCustomer(deps, me.organizationId, pending.customerId);
    if (!customer) {
      ctx.session.pending = undefined;
      await ctx.answerCallbackQuery('Unknown customer.');
      return;
    }
    const today = getOrgToday({ organizationId: me.organizationId, timeZone: me.timeZone, now: new Date() });
    const match = ctx.match as RegExpMatchArray;
    const day = parseDayInput(match[1] ?? '', today);
    if (!day) {
      await ctx.answerCallbackQuery('Could not parse that.');
      return;
    }
    await askAmount(ctx, deps, me, pending, day);
  });

  bot.callbackQuery(/^amount:full$/, async (ctx) => {
    const pending = ctx.session.pending;
    if (!pending || pending.kind !== 'promise-amount' || !pending.outstandingMinor) {
      await ctx.answerCallbackQuery('Nothing to confirm.');
      return;
    }
    await ctx.answerCallbackQuery();
    await askConfirm(ctx, pending, pending.outstandingMinor);
  });

  bot.on('message:text', async (ctx) => {
    const pending = ctx.session.pending;
    if (!pending) return; // Plain chatter: ignore (no AI small-talk in V1).
    const me = await who(ctx, deps);
    if (!me) {
      ctx.session.pending = undefined;
      await needLink(ctx);
      return;
    }
    const customer = await requireCustomer(deps, me.organizationId, pending.customerId);
    if (!customer) {
      ctx.session.pending = undefined;
      await ctx.reply('That customer is gone — flow cancelled.');
      return;
    }
    const today = getOrgToday({ organizationId: me.organizationId, timeZone: me.timeZone, now: new Date() });

    if (pending.kind === 'promise-currency') {
      const ccy = ctx.message.text.trim().toUpperCase();
      if (!/^[A-Z]{3}$/.test(ccy)) {
        await ctx.reply('Pick a button, or type a 3-letter code like UZS.');
        return;
      }
      ctx.session.pending = { ...pending, kind: 'promise-date', currency: ccy };
      const keyboard = new InlineKeyboard().text('Today', 'date:today').text('Tomorrow', 'date:tomorrow').text('Friday', 'date:friday');
      await ctx.reply(`When will ${customer.name} pay (${ccy})? Pick or type YYYY-MM-DD.`, { reply_markup: keyboard });
      return;
    }
    if (pending.kind === 'note') {
      const note = ctx.message.text.slice(0, 2000);
      await deps.db.insert(interactions).values({
        organizationId: me.organizationId,
        customerId: customer.id,
        userId: me.userId,
        type: 'note',
        note,
        source: 'bot',
      });
      ctx.session.pending = undefined;
      await ctx.reply(`Noted for ${customer.name}.`);
      return;
    }
    if (pending.kind === 'promise-date') {
      if (!pending.currency) {
        ctx.session.pending = undefined;
        await ctx.reply('Lost track of the currency — start over from the summary.');
        return;
      }
      const day = parseDayInput(ctx.message.text, today);
      if (!day) {
        await ctx.reply('I did not get that date. Try YYYY-MM-DD, "today", "tomorrow", or a weekday.');
        return;
      }
      try {
        assertDayString(day, 'promisedDate');
      } catch {
        await ctx.reply('That is not a real calendar day — try again.');
        return;
      }
      await askAmount(ctx, deps, me, pending, day);
      return;
    }
    if (pending.kind === 'promise-amount') {
      if (!pending.currency || !pending.promisedDate) {
        ctx.session.pending = undefined;
        await ctx.reply('Lost track of the flow — start over from the summary.');
        return;
      }
      const full = BigInt(pending.outstandingMinor ?? '0');
      let amount: bigint;
      try {
        amount = parseAmountInput(ctx.message.text, full);
      } catch {
        await ctx.reply('I need a number like 8000000, or the word "full".');
        return;
      }
      ctx.session.pending = { ...pending, kind: 'promise-confirm', amountMinor: amount.toString() };
      await askConfirm(ctx, pending, amount.toString());
    }
  });

  // Confirm carries the customer id; amount+date+currency ride in the session
  // and must agree with the button — forged confirm for another customer dies.
  bot.callbackQuery(/^confirm:/, async (ctx) => {
    const decoded = decodeCallback(ctx.callbackQuery.data);
    const pending = ctx.session.pending;
    if (!pending || pending.kind !== 'promise-confirm') {
      await ctx.answerCallbackQuery('Nothing to confirm.');
      return;
    }
    const amountMinor = pending.amountMinor;
    const promisedDate = pending.promisedDate;
    const currency = pending.currency;
    if (!amountMinor || !promisedDate || !currency) {
      await ctx.answerCallbackQuery('Nothing to confirm.');
      return;
    }
    if (!decoded || decoded.customerId !== pending.customerId) {
      ctx.session.pending = undefined;
      await ctx.answerCallbackQuery('Mismatch — start over.');
      return;
    }
    const me = await who(ctx, deps);
    if (!me) {
      await ctx.answerCallbackQuery();
      await needLink(ctx);
      return;
    }
    const customer = await requireCustomer(deps, me.organizationId, pending.customerId);
    if (!customer) {
      ctx.session.pending = undefined;
      await ctx.answerCallbackQuery('Unknown customer.');
      return;
    }
    try {
      assertDayString(promisedDate, 'promisedDate');
    } catch {
      ctx.session.pending = undefined;
      await ctx.answerCallbackQuery('Bad date — start over.');
      return;
    }
    await deps.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(promises)
        .values({
          organizationId: me.organizationId,
          customerId: customer.id,
          amountMinor: BigInt(amountMinor),
          currency,
          promisedDate,
          status: 'OPEN',
          createdByUserId: me.userId,
          source: 'bot',
        })
        .returning({ id: promises.id });
      if (!row) throw new Error('Promise insert failed');
      await tx.insert(interactions).values({
        organizationId: me.organizationId,
        customerId: customer.id,
        userId: me.userId,
        type: 'promise',
        note: `Promise via Telegram: ${amountMinor} ${currency} by ${promisedDate}`,
        amountBeforeMinor: null,
        amountAfterMinor: BigInt(amountMinor),
        source: 'bot',
      });
    });
    ctx.session.pending = undefined;
    await ctx.answerCallbackQuery('Promise saved.');
    await ctx.reply(
      `Saved: ${customer.name} promised ${formatMinor(BigInt(amountMinor), currency)} on ${promisedDate}.`,
    );
  });

  bot.callbackQuery(/^cancel:/, async (ctx) => {
    ctx.session.pending = undefined;
    await ctx.answerCallbackQuery('Cancelled.');
    await ctx.reply('Cancelled — nothing was saved.');
  });

  bot.catch((err) => {
    console.error(`[bot] update failed: ${(err as Error).message}`);
  });

  return bot;
}

async function askAmount(
  ctx: BotCtx,
  deps: BotDeps,
  me: { organizationId: string },
  pending: { customerId: string; customerName: string; currency?: string },
  day: string,
): Promise<void> {
  const lanes = await outstandingLanes(deps, me.organizationId, pending.customerId);
  const lane = lanes.find((l) => l.currency === pending.currency);
  const outstanding = lane?.minor ?? 0n;
  const currency = pending.currency ?? lane?.currency ?? 'UZS';
  const keyboard = new InlineKeyboard().text(`Full ${formatMinor(outstanding, currency)}`, 'amount:full');
  // Session carries the flow (callback data budget is 64 bytes).
  ctx.session.pending = {
    kind: 'promise-amount',
    customerId: pending.customerId,
    customerName: pending.customerName,
    promisedDate: day,
    currency,
    outstandingMinor: outstanding.toString(),
  };
  await ctx.reply(`How much will ${pending.customerName} pay on ${day} (${currency})?`, { reply_markup: keyboard });
}

async function askConfirm(ctx: BotCtx, pending: PendingFlow, amountMinor: string): Promise<void> {
  const currency = pending.currency ?? 'UZS';
  const keyboard = new InlineKeyboard()
    .text('Confirm', `confirm:${pending.customerId}`)
    .text('Cancel', `cancel:${pending.customerId}`);
  await ctx.reply(
    `Promise: ${formatMinor(BigInt(amountMinor), currency)} from ${pending.customerName} on ${pending.promisedDate}. Confirm?`,
    { reply_markup: keyboard },
  );
}
