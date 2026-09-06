/** BigInt-safe money formatting. Never float: groups the integer major part. */
export function formatMoney(minor: bigint, currency: string): string {
  const abs = minor < 0n ? -minor : minor;
  const sign = minor < 0n ? '-' : '';
  const grouped = new Intl.NumberFormat('en-US').format(abs / 100n);
  const frac = abs % 100n;
  const fracStr = frac === 0n ? '' : `.${frac.toString().padStart(2, '0')}`;
  return `${sign}${grouped}${fracStr} ${currency}`;
}

/** Compact millions for bucket cards: 24_400_000_00n → "24.4M". Whole millions only. */
export function formatMillions(minor: bigint, currency: string): string {
  const abs = minor < 0n ? -minor : minor;
  const sign = minor < 0n ? '-' : '';
  const whole = abs / 100_000_000n;
  const tenth = Number((abs % 100_000_000n) / 10_000_000n);
  return `${sign}${whole.toString()}.${tenth.toString()}M ${currency}`;
}
