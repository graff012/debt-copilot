// Human-readable minor units. Grouped majors, exact cents, never float:
// 1_500_000_00n + 'UZS' → "15,000,000 UZS". Presentation only — math stays
// in bigint everywhere else.

const group = new Intl.NumberFormat('en-US');

export function formatMinor(minor: bigint, currency: string): string {
  const abs = minor < 0n ? -minor : minor;
  const sign = minor < 0n ? '-' : '';
  const grouped = group.format(abs / 100n);
  const frac = abs % 100n;
  const fracStr = frac === 0n ? '' : `.${frac.toString().padStart(2, '0')}`;
  return `${sign}${grouped}${fracStr} ${currency}`;
}
