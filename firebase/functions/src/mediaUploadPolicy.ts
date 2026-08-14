export const mediaUploadAuthorizationTtlMillis = 5 * 60 * 1000;
export const mediaUploadQuotaRetentionMillis = 3 * 24 * 60 * 60 * 1000;
// Cloud Storage resumable sessions can remain valid for one week and Gen 1
// event retries can also span seven days. Keep an extra day so a no-object
// expiry tombstone still recognizes and removes the latest possible finalize.
export const mediaUploadLateFinalizeRetentionMillis =
  15 * 24 * 60 * 60 * 1000;
export const mediaUploadMaxBytes = 5 * 1024 * 1024;
export const mediaUploadMaxDimension = 2400;
export const mediaUploadMaxPixels = 4 * 1000 * 1000;
export const privateMediaCacheControl = 'private, no-store, max-age=0';
export const mediaUploadDailyLimits = {
  profile: 12,
  // 20 * 5 MiB also caps never-confirmed upload ingress/storage at 100 MiB.
  chat: 20,
} as const;
export const mediaUploadDailyByteLimits = {
  profile: 60 * 1024 * 1024,
  chat: 100 * 1024 * 1024,
} as const;
export const mediaUploadDailyConfirmAttemptLimit = 100;
export const mediaUploadDailyServerRequestLimit = 100;

export type MediaUploadKind = keyof typeof mediaUploadDailyLimits;

export type ReserveMediaUploadRequest =
  | { kind: 'profile' }
  | { kind: 'chat'; matchId: string };

export type ReserveMediaUploadValidation =
  | { ok: true; value: ReserveMediaUploadRequest }
  | { ok: false; reason: string };

export interface ParsedMediaUploadPath {
  kind: MediaUploadKind;
  uid: string;
  authorizationId: string;
  matchId?: string;
}

export interface MediaUploadAuthorizationExpectation {
  uid: string;
  kind: MediaUploadKind;
  objectPath: string;
  matchId?: string;
}

export type MediaUploadAuthorizationIssue =
  | 'missing'
  | 'wrong-owner'
  | 'wrong-kind'
  | 'wrong-path'
  | 'wrong-chat'
  | 'not-reserved'
  | 'not-byte-charged'
  | 'invalid-expiry'
  | 'expired'
  | null;

export type MediaUploadConfirmationLeaseIssue =
  | 'not-confirming'
  | 'wrong-owner'
  | 'not-byte-charged'
  | 'wrong-generation'
  | 'wrong-size'
  | null;

export type SafeJpegUploadIssue =
  | 'invalid-signature'
  | 'forbidden-metadata'
  | 'malformed'
  | null;

export interface ExpiredMediaCleanupClaim {
  objectPath: string;
  generation: string;
}

export type FinalizedMediaDisposition =
  | 'process-reservation'
  | 'preserve-server-upload'
  | 'recover-server-upload'
  | 'preserve-live-authorization'
  | 'preserve-existing-cleanup'
  | 'cleanup-unpublishable';

export interface PrivateMediaMetadataLike {
  generation?: string | number;
  size?: string | number;
  contentType?: string;
  cacheControl?: string;
  metadata?: Record<string, string | boolean | number | null>;
}

export interface FinalizedServerUploadContext {
  nowMillis: number;
  protocolVersion: number;
  leaseOwner: string;
  payloadDigest: string;
}

export function privateMediaMetadataPatch(
  customMetadata: Record<string, string | boolean | number | null> = {}
): {
  cacheControl: string;
  metadata: Record<string, string | boolean | number | null>;
} {
  return {
    cacheControl: privateMediaCacheControl,
    metadata: {
      ...customMetadata,
      // A Cloud Storage metadata PATCH must use null to delete one custom key.
      // Omitting the key can merge with and retain the bearer credential.
      firebaseStorageDownloadTokens: null,
      hanaCacheControl: privateMediaCacheControl,
    },
  };
}

export function validateReserveMediaUploadRequest(
  input: unknown
): ReserveMediaUploadValidation {
  if (!isPlainRecord(input)) {
    return { ok: false, reason: 'request must be an object' };
  }
  const kind = input.kind;
  if (kind !== 'profile' && kind !== 'chat') {
    return { ok: false, reason: 'kind must be profile or chat' };
  }

  const allowedKeys = kind === 'profile'
    ? new Set(['kind'])
    : new Set(['kind', 'matchId']);
  for (const key of Object.keys(input)) {
    if (!allowedKeys.has(key)) {
      return { ok: false, reason: `Unexpected field: ${key}` };
    }
  }

  if (kind === 'profile') return { ok: true, value: { kind } };

  const matchId = typeof input.matchId === 'string'
    ? input.matchId.trim()
    : '';
  if (!isSafeFirestoreDocumentId(matchId)) {
    return { ok: false, reason: 'matchId is invalid' };
  }
  return { ok: true, value: { kind, matchId } };
}

export function mediaUploadUtcDayKey(referenceDate = new Date()): string {
  if (Number.isNaN(referenceDate.getTime())) {
    throw new RangeError('referenceDate must be valid');
  }
  return referenceDate.toISOString().slice(0, 10);
}

export function mediaUploadQuotaId(
  uid: string,
  dayKey: string
): string {
  if (!isSafePathSegment(uid) || !/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) {
    throw new RangeError('uid and dayKey must be valid');
  }
  return `${uid}_${dayKey}`;
}

export function nextMediaUploadQuotaCount(input: {
  kind: MediaUploadKind;
  existingDayKey: unknown;
  existingCount: unknown;
  requestedDayKey: string;
}): number | null {
  const current = input.existingDayKey === input.requestedDayKey &&
      typeof input.existingCount === 'number' &&
      Number.isSafeInteger(input.existingCount) &&
      input.existingCount >= 0
    ? input.existingCount
    : 0;
  const next = current + 1;
  return next <= mediaUploadDailyLimits[input.kind] ? next : null;
}

export function nextMediaUploadQuotaBytes(input: {
  kind: MediaUploadKind;
  existingDayKey: unknown;
  existingBytes: unknown;
  requestedDayKey: string;
  uploadedBytes: unknown;
}): number | null {
  if (
    typeof input.uploadedBytes !== 'number' ||
    !Number.isSafeInteger(input.uploadedBytes) ||
    input.uploadedBytes <= 0 ||
    input.uploadedBytes > mediaUploadMaxBytes
  ) {
    return null;
  }
  const current = input.existingDayKey === input.requestedDayKey &&
      typeof input.existingBytes === 'number' &&
      Number.isSafeInteger(input.existingBytes) &&
      input.existingBytes >= 0
    ? input.existingBytes
    : 0;
  const next = current + input.uploadedBytes;
  return next <= mediaUploadDailyByteLimits[input.kind] ? next : null;
}

export function nextMediaUploadConfirmAttempt(input: {
  existingDayKey: unknown;
  existingAttempts: unknown;
  requestedDayKey: string;
}): number | null {
  const current = input.existingDayKey === input.requestedDayKey &&
      typeof input.existingAttempts === 'number' &&
      Number.isSafeInteger(input.existingAttempts) &&
      input.existingAttempts >= 0
    ? input.existingAttempts
    : 0;
  const next = current + 1;
  return next <= mediaUploadDailyConfirmAttemptLimit ? next : null;
}

export function nextMediaUploadServerRequestAttempt(input: {
  existingDayKey: unknown;
  existingAttempts: unknown;
  requestedDayKey: string;
}): number | null {
  const current = input.existingDayKey === input.requestedDayKey &&
      typeof input.existingAttempts === 'number' &&
      Number.isSafeInteger(input.existingAttempts) &&
      input.existingAttempts >= 0
    ? input.existingAttempts
    : 0;
  const next = current + 1;
  return next <= mediaUploadDailyServerRequestLimit ? next : null;
}

export function mediaUploadObjectPath(input: {
  uid: string;
  authorizationId: string;
  kind: MediaUploadKind;
  matchId?: string;
}): string {
  if (!isSafePathSegment(input.uid) ||
      !isSafePathSegment(input.authorizationId)) {
    throw new RangeError('uid and authorizationId must be safe path segments');
  }
  if (input.kind === 'profile') {
    if (input.matchId != null) {
      throw new RangeError('profile uploads must not include matchId');
    }
    return `profile_media/${input.uid}/${input.authorizationId}/image.jpg`;
  }
  if (!isSafeFirestoreDocumentId(input.matchId ?? '')) {
    throw new RangeError('chat uploads require a valid matchId');
  }
  return `chat_images/${input.matchId}/${input.uid}/${input.authorizationId}/image.jpg`;
}

export function parseMediaUploadObjectPath(
  objectPath: unknown
): ParsedMediaUploadPath | null {
  if (typeof objectPath !== 'string' || objectPath.length > 512) return null;
  const segments = objectPath.split('/');
  if (
    segments.length === 4 &&
    segments[0] === 'profile_media' &&
    isSafePathSegment(segments[1]) &&
    isSafePathSegment(segments[2]) &&
    segments[3] === 'image.jpg'
  ) {
    return {
      kind: 'profile',
      uid: segments[1],
      authorizationId: segments[2],
    };
  }
  if (
    segments.length === 5 &&
    segments[0] === 'chat_images' &&
    isSafeFirestoreDocumentId(segments[1]) &&
    isSafePathSegment(segments[2]) &&
    isSafePathSegment(segments[3]) &&
    segments[4] === 'image.jpg'
  ) {
    return {
      kind: 'chat',
      matchId: segments[1],
      uid: segments[2],
      authorizationId: segments[3],
    };
  }
  return null;
}

export function mediaUploadAuthorizationIssue(
  data: Record<string, unknown> | undefined,
  expected: MediaUploadAuthorizationExpectation,
  nowMillis: number,
  allowedStatuses: readonly string[] = ['reserved']
): MediaUploadAuthorizationIssue {
  if (data == null) return 'missing';
  if (data.uid !== expected.uid) return 'wrong-owner';
  if (data.kind !== expected.kind) return 'wrong-kind';
  if (data.objectPath !== expected.objectPath) return 'wrong-path';
  if (expected.kind === 'chat' && data.matchId !== expected.matchId) {
    return 'wrong-chat';
  }
  if (typeof data.status !== 'string' || !allowedStatuses.includes(data.status)) {
    return 'not-reserved';
  }
  const expiresAtMillis = timestampLikeToMillis(data.expiresAt);
  if (expiresAtMillis == null) return 'invalid-expiry';
  if (expiresAtMillis <= nowMillis) return 'expired';
  return null;
}

export function confirmedMediaUploadAuthorizationIssue(
  data: Record<string, unknown> | undefined,
  expected: MediaUploadAuthorizationExpectation,
  nowMillis: number,
  lockedGeneration: unknown,
  lockedSize: unknown
): MediaUploadAuthorizationIssue {
  const issue = mediaUploadAuthorizationIssue(
    data,
    expected,
    nowMillis,
    ['confirmed']
  );
  if (issue != null) return issue;
  if (data?.byteCharged !== true) return 'not-byte-charged';
  if (
    typeof lockedGeneration !== 'string' ||
    lockedGeneration.length === 0 ||
    data.confirmedGeneration !== lockedGeneration
  ) {
    return 'wrong-path';
  }
  if (
    typeof lockedSize !== 'number' ||
    !Number.isSafeInteger(lockedSize) ||
    data.confirmedSize !== lockedSize
  ) {
    return 'wrong-path';
  }
  return null;
}

/**
 * A confirmation worker may mutate or clean up an object only while it owns
 * the exact immutable-generation lease. A second callable gets a different
 * random owner and therefore cannot publish or delete the first worker's
 * object.
 */
export function mediaUploadConfirmationLeaseIssue(
  data: Record<string, unknown> | undefined,
  expected: {
    owner: string;
    generation: string;
    size: number;
  }
): MediaUploadConfirmationLeaseIssue {
  if (data?.status !== 'confirming') return 'not-confirming';
  if (data.confirmLeaseOwner !== expected.owner) return 'wrong-owner';
  if (data.byteCharged !== true) return 'not-byte-charged';
  if (data.lockedGeneration !== expected.generation) return 'wrong-generation';
  if (data.lockedSize !== expected.size) return 'wrong-size';
  return null;
}

/**
 * Resolves the exact immutable object generation an expired authorization may
 * clean. This is evaluated again inside the cleanup transaction so a stale
 * scheduler query can never delete media that a consumer has since committed.
 */
export function expiredMediaCleanupClaim(
  authorizationId: string,
  data: Record<string, unknown> | undefined,
  nowMillis: number,
  inspectedFallback?: ExpiredMediaCleanupClaim
): ExpiredMediaCleanupClaim | null {
  if (data == null || !isSafePathSegment(authorizationId)) return null;
  if (
    data.status !== 'reserved' &&
    data.status !== 'uploaded' &&
    data.status !== 'confirming' &&
    data.status !== 'confirmed'
  ) {
    return null;
  }
  const expiresAtMillis = timestampLikeToMillis(data.expiresAt);
  if (expiresAtMillis == null || expiresAtMillis > nowMillis) return null;

  const parsed = parseMediaUploadObjectPath(data.objectPath);
  if (
    parsed == null ||
    parsed.authorizationId !== authorizationId ||
    parsed.uid !== data.uid ||
    parsed.kind !== data.kind ||
    (parsed.kind === 'chat' && parsed.matchId !== data.matchId)
  ) {
    return null;
  }

  let generation = data.status === 'confirmed'
    ? data.confirmedGeneration
    : data.status === 'confirming'
      ? data.lockedGeneration
      : data.uploadedGeneration;
  if (
    (data.status === 'reserved' || data.status === 'uploaded') &&
    (typeof generation !== 'string' || generation.length === 0) &&
    inspectedFallback != null &&
    inspectedFallback.objectPath === data.objectPath
  ) {
    generation = inspectedFallback.generation;
  }
  if (typeof generation !== 'string' || generation.length === 0) return null;
  return { objectPath: data.objectPath as string, generation };
}

/**
 * Decides whether a finalized immutable generation may enter the confirmation
 * flow or must be removed. A delayed finalize can arrive after an expired
 * reservation tombstone (or even after its retention cleanup), while a normal
 * finalize can also arrive after confirmation/consumption. Only the latter
 * live states are preserved without taking over another cleanup lease.
 */
export function finalizedMediaDisposition(
  data: Record<string, unknown> | undefined,
  expected: MediaUploadAuthorizationExpectation,
  finalizedGeneration: string,
  serverUpload?: FinalizedServerUploadContext
): FinalizedMediaDisposition {
  if (data == null) {
    // A missing ledger has no immutable-generation proof. Even if an old
    // document still references the path, a late resumable session must not be
    // allowed to replace the previously published bytes.
    return 'cleanup-unpublishable';
  }
  if (
    data.uid !== expected.uid ||
    data.kind !== expected.kind ||
    data.objectPath !== expected.objectPath ||
    (expected.kind === 'chat' && data.matchId !== expected.matchId)
  ) {
    return 'cleanup-unpublishable';
  }
  if (data.status === 'reserved') {
    // Only the legacy no-version reservation is a direct Storage writer. A V2
    // lease may reset to reserved after a missing-object recovery; a delayed
    // original save must be generation-cleaned, never promoted into the V1
    // uploaded/confirm flow.
    return data.uploadProtocolVersion == null
      ? 'process-reservation'
      : 'cleanup-unpublishable';
  }
  if (data.status === 'server_uploading') {
    const leaseUntilMillis = timestampLikeToMillis(data.serverUploadLeaseUntil);
    const exactMarker = serverUpload != null &&
      data.uploadProtocolVersion === serverUpload.protocolVersion &&
      data.serverUploadLeaseOwner === serverUpload.leaseOwner &&
      data.serverUploadDigest === serverUpload.payloadDigest;
    if (!exactMarker || leaseUntilMillis == null) return 'cleanup-unpublishable';
    return leaseUntilMillis > serverUpload.nowMillis
      ? 'preserve-server-upload'
      : 'recover-server-upload';
  }
  if (data.status === 'cleanup_required') {
    return data.cleanupGeneration === finalizedGeneration
      ? 'preserve-existing-cleanup'
      : 'cleanup-unpublishable';
  }
  const expectedGeneration = data.status === 'uploaded'
    ? data.uploadedGeneration
    : data.status === 'confirming'
      ? data.lockedGeneration
      : data.confirmedGeneration;
  if (
    data.status === 'uploaded' ||
    data.status === 'confirming' ||
    data.status === 'confirmed' ||
    data.status === 'consumed'
  ) {
    if (
      data.uploadProtocolVersion != null &&
      (data.status === 'uploaded' || data.status === 'confirming')
    ) {
      return 'cleanup-unpublishable';
    }
    return finalizedGeneration.length > 0 &&
      expectedGeneration === finalizedGeneration
      ? 'preserve-live-authorization'
      : 'cleanup-unpublishable';
  }
  return 'cleanup-unpublishable';
}

export function isSafeMediaUploadAuthorizationId(value: unknown): value is string {
  return typeof value === 'string' && isSafePathSegment(value);
}

/**
 * Legacy client-write prefixes that become forbidden at the private-media
 * cutover. These objects have no reservation ledger, so a delayed resumable
 * finalize must be removed by the environment-gated cutover trigger.
 */
export function isLegacyPrivateMediaObjectPath(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512) {
    return false;
  }
  const segments = value.split('/');
  if (!segments.every(isSafePathSegment)) return false;
  if (
    (segments[0] === 'users' || segments[0] === 'profile_photos') &&
    segments.length >= 3
  ) {
    return true;
  }
  return segments[0] === 'chat_images' && segments.length >= 4 &&
    parseMediaUploadObjectPath(value) == null;
}

export interface ParsedLegacyPrivateMediaObjectPath {
  uid: string;
  kind: 'profile' | 'chat';
  matchId: string | null;
}

/** Extracts only the owner identity already encoded by an exact legacy path. */
export function parseLegacyPrivateMediaObjectPath(
  value: unknown
): ParsedLegacyPrivateMediaObjectPath | null {
  if (!isLegacyPrivateMediaObjectPath(value)) return null;
  const segments = value.split('/');
  if (segments[0] === 'chat_images') {
    return { uid: segments[2], kind: 'chat', matchId: segments[1] };
  }
  return { uid: segments[1], kind: 'profile', matchId: null };
}

export function isVerifiedPrivateMediaMetadata(
  metadata: PrivateMediaMetadataLike,
  expected: { generation: string; size: number }
): boolean {
  const custom = metadata.metadata ?? {};
  return String(metadata.generation ?? '') === expected.generation &&
    Number(metadata.size) === expected.size &&
    metadata.contentType === 'image/jpeg' &&
    metadata.cacheControl === privateMediaCacheControl &&
    custom.hanaCacheControl === privateMediaCacheControl &&
    custom.firebaseStorageDownloadTokens == null;
}

export function hasJpegSignature(bytes: ArrayLike<number>): boolean {
  return bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff;
}

/**
 * Parses the full JPEG marker stream without decoding pixels. New Hana clients
 * re-encode pixels before upload, but this server boundary also rejects legacy
 * or malicious files carrying EXIF/XMP (APP1), IPTC (APP13), comments, or a
 * malformed marker length. Entropy-coded 0xff bytes must be stuffed and restart
 * markers are accepted; every file must contain a frame, scan, and final EOI.
 */
export function safeJpegUploadIssue(
  bytes: ArrayLike<number>
): SafeJpegUploadIssue {
  const byteLength = bytes.length;
  if (
    !Number.isSafeInteger(byteLength) ||
    byteLength < 4 ||
    bytes[0] !== 0xff ||
    bytes[1] !== 0xd8
  ) {
    return 'invalid-signature';
  }

  let offset = 2;
  let sawFrame = false;
  let sawScan = false;
  let sawApp0 = false;
  let frameWidth: number | null = null;
  let frameHeight: number | null = null;
  while (offset < byteLength) {
    if (bytes[offset] !== 0xff) return 'malformed';
    while (offset < byteLength && bytes[offset] === 0xff) offset += 1;
    if (offset >= byteLength) return 'malformed';

    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xd9) {
      return sawFrame && sawScan && offset === byteLength
        ? null
        : 'malformed';
    }
    if (
      marker === 0x00 ||
      marker === 0x01 ||
      marker === 0xd8 ||
      (marker >= 0xd0 && marker <= 0xd7)
    ) {
      return 'malformed';
    }
    // APP0/JFIF is the sole application segment emitted by Hana's sanitizer.
    // Reject APP1..APP15 and COM so private payloads cannot be moved into an
    // uncommon application marker to evade the EXIF/XMP/IPTC checks.
    if ((marker >= 0xe1 && marker <= 0xef) || marker === 0xfe) {
      return 'forbidden-metadata';
    }
    if (offset + 1 >= byteLength) return 'malformed';

    const segmentLength = (bytes[offset] << 8) | bytes[offset + 1];
    if (segmentLength < 2 || offset + segmentLength > byteLength) {
      return 'malformed';
    }
    const segmentEnd = offset + segmentLength;

    if (marker === 0xe0) {
      const isJfifWithoutThumbnail =
        !sawApp0 &&
        !sawFrame &&
        segmentLength === 16 &&
        bytes[offset + 2] === 0x4a &&
        bytes[offset + 3] === 0x46 &&
        bytes[offset + 4] === 0x49 &&
        bytes[offset + 5] === 0x46 &&
        bytes[offset + 6] === 0x00 &&
        bytes[offset + 14] === 0x00 &&
        bytes[offset + 15] === 0x00;
      if (!isJfifWithoutThumbnail) return 'forbidden-metadata';
      sawApp0 = true;
    }

    if (isJpegFrameMarker(marker)) {
      // SOF length is 8 + 3 * component count and dimensions must be nonzero.
      if (marker !== 0xc0 || sawFrame || segmentLength < 11) return 'malformed';
      const height = (bytes[offset + 3] << 8) | bytes[offset + 4];
      const width = (bytes[offset + 5] << 8) | bytes[offset + 6];
      const componentCount = bytes[offset + 7];
      if (
        bytes[offset + 2] !== 8 ||
        width <= 0 ||
        height <= 0 ||
        width > mediaUploadMaxDimension ||
        height > mediaUploadMaxDimension ||
        width > Math.floor(mediaUploadMaxPixels / height) ||
        componentCount !== 3 ||
        segmentLength !== 8 + 3 * componentCount ||
        (frameWidth != null && frameWidth !== width) ||
        (frameHeight != null && frameHeight !== height)
      ) {
        return 'malformed';
      }
      frameWidth = width;
      frameHeight = height;
      sawFrame = true;
    }

    if (marker !== 0xda) {
      offset = segmentEnd;
      continue;
    }

    if (!sawFrame || sawScan || segmentLength < 8) return 'malformed';
    const scanComponentCount = bytes[offset + 2];
    if (
      scanComponentCount !== 3 ||
      segmentLength !== 6 + 2 * scanComponentCount
    ) {
      return 'malformed';
    }
    sawScan = true;
    offset = segmentEnd;

    // Scan entropy until an unstuffed, non-restart marker begins. The outer
    // loop then validates that marker and any later progressive scans.
    let foundNextMarker = false;
    while (offset < byteLength) {
      if (bytes[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const markerStart = offset;
      while (offset < byteLength && bytes[offset] === 0xff) offset += 1;
      if (offset >= byteLength) return 'malformed';
      const entropyMarker = bytes[offset];
      offset += 1;
      if (entropyMarker === 0x00) continue;
      if (entropyMarker >= 0xd0 && entropyMarker <= 0xd7) continue;
      offset = markerStart;
      foundNextMarker = true;
      break;
    }
    if (!foundNextMarker) return 'malformed';
  }
  return 'malformed';
}

function isJpegFrameMarker(marker: number): boolean {
  return (
    (marker >= 0xc0 && marker <= 0xc3) ||
    (marker >= 0xc5 && marker <= 0xc7) ||
    (marker >= 0xc9 && marker <= 0xcb) ||
    (marker >= 0xcd && marker <= 0xcf)
  );
}

function timestampLikeToMillis(value: unknown): number | null {
  if (value == null || typeof value !== 'object') return null;
  const toMillis = (value as { toMillis?: unknown }).toMillis;
  if (typeof toMillis !== 'function') return null;
  try {
    const millis = (toMillis as () => unknown).call(value);
    return typeof millis === 'number' && Number.isFinite(millis)
      ? millis
      : null;
  } catch (_) {
    return null;
  }
}

function isSafeFirestoreDocumentId(value: string): boolean {
  return value.length > 0 &&
    value.length <= 128 &&
    value !== '.' &&
    value !== '..' &&
    !value.includes('/') &&
    !/^__.*__$/.test(value) &&
    !containsControlCharacter(value);
}

function isSafePathSegment(value: string): boolean {
  return value.length > 0 &&
    value.length <= 128 &&
    value !== '.' &&
    value !== '..' &&
    !value.includes('/') &&
    !containsControlCharacter(value);
}

function containsControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    if (codePoint <= 0x1f || codePoint === 0x7f) return true;
  }
  return false;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
