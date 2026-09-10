// Transport boundary for all outbound Telegram traffic. Tokenless dev uses
// logSender (jobs still run); the grammY sender plugs in here (phase 3).
// Skipped recipients (no telegram_user_id) are logged by callers, never silent.

// Plain data only: the worker never imports grammY (bot package converts).
// BotButton lives in @debt-copilot/telegram to avoid a worker→bot→worker cycle.
import type { BotButton } from '@debt-copilot/telegram';

export type { BotButton };

export type Sender = (telegramUserId: bigint, text: string, buttons?: BotButton[]) => Promise<void>;

export const logSender: Sender = async (telegramUserId, text) => {
  console.log(`[send-skip] telegram:${telegramUserId.toString()} chars=${text.length}`);
};
