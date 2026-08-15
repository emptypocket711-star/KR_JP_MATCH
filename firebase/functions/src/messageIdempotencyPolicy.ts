import { createHash } from 'crypto';

const CLIENT_REQUEST_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function normalizeClientRequestId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return CLIENT_REQUEST_ID_PATTERN.test(normalized) ? normalized : null;
}

/**
 * Keeps message ids stable for a sender retry without exposing a client-chosen
 * Firestore document id or allowing two participants to collide.
 */
export function idempotentMessageDocumentId(
  senderUid: string,
  clientRequestId: string
): string {
  return createHash('sha256')
    .update(`${senderUid}:${clientRequestId}`)
    .digest('hex');
}

export function isMatchingIdempotentMessage(
  data: Record<string, unknown> | undefined,
  expected: { senderUid: string; clientRequestId: string }
): boolean {
  return data?.senderId === expected.senderUid &&
    data?.clientRequestId === expected.clientRequestId;
}
