import { hash, compare } from 'bcryptjs';

const COST = 12;

export async function hashPassword(password: string): Promise<string> {
  return hash(password, COST);
}

/** bcrypt compare is timing-safe; callers must still use generic error messages. */
export async function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  return compare(password, passwordHash);
}

/** Emails compare case-insensitively: normalize once at the boundary. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
