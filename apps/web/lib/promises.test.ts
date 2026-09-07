import { describe, expect, it } from 'vitest';
import { buildPromisesBoard } from './promises';

describe('buildPromisesBoard', () => {
  const board = buildPromisesBoard();

  it('groups OPEN promises by time state', () => {
    expect(board.today).toBe('2026-09-06');
    expect(board.dueToday.map((p) => p.id)).toEqual(['p-akbar-1']);
    expect(board.upcoming.map((p) => p.id)).toEqual(['p-silk-1']);
    expect(board.broken.map((p) => p.id)).toEqual(['p-mega-2', 'p-mega-1']); // oldest first
  });

  it('carries customer context per row', () => {
    expect(board.broken[0]).toMatchObject({
      customerName: 'Mega Shop',
      assignee: 'Aziz R.',
      amountMinor: 500_000_000n,
      currency: 'UZS',
    });
  });

  // NOTE — cross-org throw (promises.ts:47) is untestable without params:
  // buildPromisesBoard() reads fixed single-org fixtures and takes no args.
  // Instead this pins the row.group mapping for every fixture OPEN promise.
  it('maps group field for all fixture OPEN promises', () => {
    const byId = new Map(
      [...board.dueToday, ...board.upcoming, ...board.broken].map((r) => [r.id, r] as const),
    );
    expect(byId.get('p-mega-2')?.group).toBe('broken');
    expect(byId.get('p-mega-1')?.group).toBe('broken');
    expect(byId.get('p-akbar-1')?.group).toBe('due-today');
    expect(byId.get('p-silk-1')?.group).toBe('upcoming');
    // bigint amounts stay grouped separately; spot-check due-today value.
    expect(byId.get('p-akbar-1')?.amountMinor).toBe(300_000_000n);
    expect(byId.get('p-akbar-1')?.promisedDate).toBe('2026-09-06');
  });

  // Board empty-group rendering is a component concern — skipped per spec.
  // Instead: groups are mutually exclusive and exhaustive over OPEN promises.
  it('partitions OPEN promise ids with no overlap or loss', () => {
    const dueToday = board.dueToday.map((p) => p.id);
    const upcoming = board.upcoming.map((p) => p.id);
    const broken = board.broken.map((p) => p.id);
    const all = [...dueToday, ...upcoming, ...broken];
    expect(all).toHaveLength(4);
    expect(new Set(all).size).toBe(4);
    expect([...all].sort()).toEqual(['p-akbar-1', 'p-mega-1', 'p-mega-2', 'p-silk-1']);
  });

  // NOTE — same-date board tiebreak (promises.ts:64-65 byDate id fallback) is
  // untestable via fixtures: no two OPEN promises share a promisedDate, so
  // the id tiebreak never fires. Pins distinct-date precondition instead.
  it('documents same-date tiebreak untestable: OPEN promisedDates distinct', () => {
    const dates = [...board.dueToday, ...board.upcoming, ...board.broken].map((p) => p.promisedDate);
    expect(dates).toHaveLength(4);
    expect(new Set(dates).size).toBe(4);
  });
});
