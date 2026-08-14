import { createHash } from 'crypto';

export function fcmTokenOwnershipId(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function shouldClearOwnedFcmToken(input: {
  storedToken: unknown;
  requestedToken: string;
}): boolean {
  return input.storedToken === input.requestedToken;
}
