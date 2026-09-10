import { Bot, type Context } from 'grammy';
import type { BotButton } from './callbacks.js';

// Bot-side sender: converts worker button data into a Telegram keyboard.
// grammy lives ONLY here — the worker never imports it (see BotButton).

export function buttonsToKeyboard(buttons: BotButton[]): Array<Array<{ text: string; callback_data: string }>> {
  const rows: Array<Array<{ text: string; callback_data: string }>> = [];
  for (let i = 0; i < buttons.length; i += 2) {
    const pair = buttons.slice(i, i + 2).map((b) => ({ text: b.label, callback_data: b.data }));
    rows.push(pair);
  }
  return rows;
}

export function createBotSender<C extends Context>(bot: Bot<C>): (telegramId: bigint, text: string, buttons?: BotButton[]) => Promise<void> {
  return async (telegramId, text, buttons) => {
    const chatId = Number(telegramId);
    if (!Number.isSafeInteger(chatId)) throw new RangeError('Telegram id out of safe range');
    await bot.api.sendMessage(chatId, text, {
      reply_markup:
        buttons && buttons.length > 0 ? { inline_keyboard: buttonsToKeyboard(buttons) } : undefined,
    });
  };
}
