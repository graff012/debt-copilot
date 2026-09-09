import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = Symbol('IS_PUBLIC');

/** Skips JwtAuthGuard (health, signup, login, refresh). Everything else is closed. */
export const Public = (): ReturnType<typeof SetMetadata> => SetMetadata(IS_PUBLIC, true);
