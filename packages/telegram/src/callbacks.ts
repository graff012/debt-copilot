// Callback payloads stay under Telegram's 64-byte limit:
// `v1:<action>:<uuid>` = 3 + 1 + ~7 + 1 + 36 = ~48 chars. Amounts and dates
// ride in the chat session, never in callbacks.

// Plain button data: the worker builds these without importing grammY.
export interface BotButton {
  label: string;
  data: string;
}

export type CallbackAction = 'called' | 'promise' | 'note';

const ACTIONS: ReadonlySet<string> = new Set(['called', 'promise', 'note']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ParsedCallback {
  action: CallbackAction;
  customerId: string;
}

export function encodeCallback(action: CallbackAction, customerId: string): string {
  if (!UUID_RE.test(customerId)) throw new RangeError('customerId must be a UUID');
  return `v1:${action}:${customerId}`;
}

export function decodeCallback(data: string): ParsedCallback | null {
  const m = /^v1:([a-z]+):(.+)$/.exec(data);
  if (!m?.[1] || !m[2]) return null;
  if (!ACTIONS.has(m[1]) || !UUID_RE.test(m[2])) return null;
  return { action: m[1] as CallbackAction, customerId: m[2] };
}
