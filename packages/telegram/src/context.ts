// Who is writing: resolve the Telegram sender to an app user via the API.
// The bot never trusts Telegram names/phones for identity — only this lookup.

export interface BotContext {
  userId: string;
  organizationId: string;
  name: string;
  timeZone: string;
}

export async function resolveContext(
  apiUrl: string,
  botSecret: string,
  telegramUserId: number,
): Promise<BotContext | null> {
  const res = await fetch(
    `${apiUrl.replace(/\/$/, '')}/telegram/context?telegramUserId=${telegramUserId}`,
    { headers: { 'x-bot-secret': botSecret } },
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Context lookup failed: ${res.status}`);
  const body = (await res.json()) as { userId?: unknown; organizationId?: unknown; name?: unknown; timeZone?: unknown };
  if (typeof body.userId !== 'string' || typeof body.organizationId !== 'string' || typeof body.name !== 'string' || typeof body.timeZone !== 'string') {
    throw new Error('Bad context response');
  }
  return { userId: body.userId, organizationId: body.organizationId, name: body.name, timeZone: body.timeZone };
}
