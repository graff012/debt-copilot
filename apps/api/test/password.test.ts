import { describe, expect, it } from 'vitest';
import { hashPassword, normalizeEmail, verifyPassword } from '../src/auth/password.js';

describe('normalizeEmail', () => {
  it('trims and lowercases so logins compare case-insensitively', () => {
    expect(normalizeEmail('  Owner@Demo.UZ ')).toBe('owner@demo.uz');
  });
});

describe('password hashing', () => {
  it('round-trips and salts (same password, different hashes)', async () => {
    const a = await hashPassword('Test1234!!');
    const b = await hashPassword('Test1234!!');
    expect(a).not.toBe(b);
    expect(await verifyPassword('Test1234!!', a)).toBe(true);
    expect(await verifyPassword('Test1234!!', b)).toBe(true);
  });

  it('rejects wrong passwords', async () => {
    const hash = await hashPassword('Test1234!!');
    expect(await verifyPassword('Wrong1234!!', hash)).toBe(false);
    expect(await verifyPassword('', hash)).toBe(false);
  });
});
