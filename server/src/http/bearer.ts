import type { Request } from 'express';

/** Extract the token from an `Authorization: Bearer <token>` header. */
export function getBearerToken(req: Request): string | undefined {
  const header = req.header('authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1] : undefined;
}
