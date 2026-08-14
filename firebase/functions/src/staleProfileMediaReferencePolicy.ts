import { parseMediaUploadObjectPath } from './mediaUploadPolicy';

const safeIdPattern = /^[A-Za-z0-9_-]{1,128}$/;
const safeBucketPattern = /^[a-z0-9][a-z0-9.-]{1,221}[a-z0-9]$/;
const firebaseDownloadHost = 'firebasestorage.googleapis.com';
const googleStorageHost = 'storage.googleapis.com';
const googleCloudStorageHost = 'storage.cloud.google.com';
const hanaStorageBuckets: Readonly<Record<string, string>> = Object.freeze({
  'hana-e2ee6': 'hana-e2ee6.firebasestorage.app',
  'hana-production-tokyo': 'hana-production-tokyo.firebasestorage.app',
});

export function knownHanaStorageBucket(projectId: unknown): string | null {
  return typeof projectId === 'string'
    ? hanaStorageBuckets[projectId] ?? null
    : null;
}

export type ProfilePhotoState =
  | {
    kind: 'none';
    exactPhotoUrls: readonly string[];
  }
  | {
    kind: 'canonical';
    exactPhotoUrls: readonly string[];
    canonicalPaths: readonly string[];
  }
  | {
    kind: 'blocking-legacy-trusted-reupload';
    exactPhotoUrls: readonly [string];
    legacyValue: string;
  }
  | {
    kind: 'blocking-invalid';
    exactPhotoUrls: readonly unknown[] | null;
    reason:
      | 'unsafe-owner-uid'
      | 'photoUrls-not-an-array'
      | 'malformed-photo-value'
      | 'too-many-photo-values'
      | 'duplicate-canonical-path'
      | 'wrong-owner-canonical-path'
      | 'invalid-canonical-looking-path'
      | 'mixed-canonical-and-legacy'
      | 'multiple-noncanonical-values';
  };

export type StaleReferenceKind =
  | 'post-author'
  | 'comment-author'
  | 'reply-author'
  | 'block-target'
  | 'match-photoUrl'
  | 'match-myPhotoUrl'
  | 'match-partnerFor-photoUrl';

/**
 * Deliberately narrower than Firestore's document-ID grammar. Firebase Auth
 * UIDs created by this app fit this grammar, and refusing ambiguous map/path
 * characters is safer than trying to escape a migration manifest field path.
 */
export function isSafeUid(value: unknown): value is string {
  return typeof value === 'string' &&
    safeIdPattern.test(value) &&
    !/^__.*__$/.test(value);
}

export function classifyOwnerPhotoState(
  photoUrls: unknown,
  ownerUid: string
): ProfilePhotoState {
  if (!isSafeUid(ownerUid)) {
    return {
      kind: 'blocking-invalid',
      exactPhotoUrls: Array.isArray(photoUrls) ? [...photoUrls] : null,
      reason: 'unsafe-owner-uid',
    };
  }
  if (photoUrls == null) {
    return { kind: 'none', exactPhotoUrls: [] };
  }
  if (!Array.isArray(photoUrls)) {
    return {
      kind: 'blocking-invalid',
      exactPhotoUrls: null,
      reason: 'photoUrls-not-an-array',
    };
  }
  if (photoUrls.length === 0) {
    return { kind: 'none', exactPhotoUrls: [] };
  }
  if (photoUrls.length > 6) {
    return {
      kind: 'blocking-invalid',
      exactPhotoUrls: [...photoUrls],
      reason: 'too-many-photo-values',
    };
  }

  const values: string[] = [];
  const canonicalPaths = new Set<string>();
  let canonicalCount = 0;
  for (const value of photoUrls) {
    if (!isWellFormedStoredPhotoValue(value)) {
      return {
        kind: 'blocking-invalid',
        exactPhotoUrls: [...photoUrls],
        reason: 'malformed-photo-value',
      };
    }
    values.push(value);
    const parsed = parseMediaUploadObjectPath(value);
    if (parsed != null) {
      if (parsed.kind !== 'profile' || parsed.uid !== ownerUid) {
        return {
          kind: 'blocking-invalid',
          exactPhotoUrls: [...photoUrls],
          reason: 'wrong-owner-canonical-path',
        };
      }
      if (canonicalPaths.has(value)) {
        return {
          kind: 'blocking-invalid',
          exactPhotoUrls: [...photoUrls],
          reason: 'duplicate-canonical-path',
        };
      }
      canonicalPaths.add(value);
      canonicalCount += 1;
      continue;
    }
    if (value.startsWith('profile_media/')) {
      return {
        kind: 'blocking-invalid',
        exactPhotoUrls: [...photoUrls],
        reason: 'invalid-canonical-looking-path',
      };
    }
  }

  if (canonicalCount === values.length) {
    return {
      kind: 'canonical',
      exactPhotoUrls: [...values],
      canonicalPaths: [...values],
    };
  }
  if (canonicalCount > 0) {
    return {
      kind: 'blocking-invalid',
      exactPhotoUrls: [...values],
      reason: 'mixed-canonical-and-legacy',
    };
  }
  if (values.length === 1) {
    return {
      kind: 'blocking-legacy-trusted-reupload',
      exactPhotoUrls: [values[0]],
      legacyValue: values[0],
    };
  }
  return {
    kind: 'blocking-invalid',
    exactPhotoUrls: [...values],
    reason: 'multiple-noncanonical-values',
  };
}

export function isSafeDocumentPathForReference(
  kind: StaleReferenceKind,
  documentPath: string
): boolean {
  const segments = safeDocumentPathSegments(documentPath);
  if (segments == null) return false;
  switch (kind) {
    case 'post-author':
      return segments.length === 2 && segments[0] === 'posts';
    case 'comment-author':
      return segments.length === 4 &&
        segments[0] === 'posts' && segments[2] === 'comments';
    case 'reply-author':
      return segments.length === 6 &&
        segments[0] === 'posts' &&
        segments[2] === 'comments' &&
        segments[4] === 'replies';
    case 'block-target':
      return segments.length === 4 &&
        segments[0] === 'users' &&
        segments[2] === 'blocks' &&
        isSafeUid(segments[1]) &&
        isSafeUid(segments[3]);
    case 'match-photoUrl':
    case 'match-myPhotoUrl':
    case 'match-partnerFor-photoUrl':
      return segments.length === 2 && segments[0] === 'matches';
  }
}

export function isSafeFieldPathForReference(
  kind: StaleReferenceKind,
  fieldPath: string
): boolean {
  switch (kind) {
    case 'post-author':
    case 'comment-author':
    case 'reply-author':
      return fieldPath === 'authorPhotoUrl';
    case 'block-target':
      return fieldPath === 'photoUrl';
    case 'match-photoUrl':
      return fieldPath === 'photoUrl';
    case 'match-myPhotoUrl':
      return fieldPath === 'myPhotoUrl';
    case 'match-partnerFor-photoUrl': {
      const fields = fieldPath.split('.');
      return fields.length === 3 &&
        fields[0] === 'partnerFor' &&
        isSafeUid(fields[1]) &&
        fields[2] === 'photoUrl';
    }
  }
}

export function referenceOwnerUid(
  kind: StaleReferenceKind,
  documentPath: string,
  fieldPath: string,
  data: unknown
): string | null {
  if (
    !isSafeDocumentPathForReference(kind, documentPath) ||
    !isSafeFieldPathForReference(kind, fieldPath) ||
    !isPlainRecord(data)
  ) {
    return null;
  }

  if (
    kind === 'post-author' ||
    kind === 'comment-author' ||
    kind === 'reply-author'
  ) {
    return isSafeUid(data.uid) ? data.uid : null;
  }

  if (kind === 'block-target') {
    const pathTargetUid = documentPath.split('/')[3];
    return isSafeUid(data.targetUid) && data.targetUid === pathTargetUid
      ? data.targetUid
      : null;
  }

  const participants = exactDirectParticipants(data.userIds);
  if (participants == null) return null;
  if (kind === 'match-photoUrl') return participants[1];
  if (kind === 'match-myPhotoUrl') return participants[0];

  const viewerUid = fieldPath.split('.')[1];
  if (viewerUid === participants[0]) return participants[1];
  if (viewerUid === participants[1]) return participants[0];
  return null;
}

/**
 * Parses only the exact Firebase download-URL grammar accepted by the
 * downstream private-media migration for one of the explicitly supplied
 * first-party buckets. Token values are never returned or logged.
 */
export function firstPartyFirebaseObjectPathFromUrl(
  value: unknown,
  allowedBuckets: ReadonlySet<string> | readonly string[]
): string | null {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 2048 ||
    containsControlCharacter(value)
  ) return null;
  const buckets = normalizedBuckets(allowedBuckets);
  if (buckets == null) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch (_) {
    return null;
  }
  if (
    url.protocol !== 'https:' ||
    url.hostname !== firebaseDownloadHost ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.port.length > 0 ||
    url.hash.length > 0
  ) return null;
  const segments = url.pathname.split('/');
  if (
    segments.length !== 6 ||
    segments[0] !== '' ||
    segments[1] !== 'v0' ||
    segments[2] !== 'b' ||
    !buckets.has(segments[3].toLowerCase()) ||
    segments[4] !== 'o' ||
    segments[5].length === 0 ||
    segments[5].includes('/') ||
    url.searchParams.getAll('alt').length !== 1 ||
    url.searchParams.get('alt') !== 'media' ||
    url.searchParams.getAll('token').length > 1 ||
    [...url.searchParams.keys()].some((key) => key !== 'alt' && key !== 'token')
  ) return null;
  let objectPath: string;
  try {
    objectPath = decodeURIComponent(segments[5]);
  } catch (_) {
    return null;
  }
  return isSafeMigrationObjectPath(objectPath) ? objectPath : null;
}

/**
 * Returns true only for an unambiguous external HTTPS photo URL. Exact Firebase
 * download URLs in an allowlisted bucket are first party and therefore false.
 * Ambiguous/malformed Google Storage URLs also fail closed to false.
 */
export function isExternalNonFirstPartyHttpsPhotoUrl(
  value: unknown,
  allowedBuckets: ReadonlySet<string> | readonly string[]
): value is string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 2048 ||
    containsControlCharacter(value)
  ) {
    return false;
  }

  let url: URL;
  try {
    url = new URL(value);
    // Reject invalid percent escapes that URL itself deliberately preserves.
    decodeURIComponent(url.pathname);
  } catch (_) {
    return false;
  }
  if (
    url.protocol !== 'https:' ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.port.length > 0 ||
    url.hash.length > 0 ||
    url.pathname.length <= 1 ||
    !isPublicDnsHostname(url.hostname)
  ) {
    return false;
  }

  const buckets = normalizedBuckets(allowedBuckets);
  if (buckets == null) return false;
  const hostname = url.hostname.toLowerCase();
  if (buckets.has(hostname)) return false;
  if (
    hostname.endsWith('.storage.googleapis.com') ||
    hostname.endsWith('.storage.cloud.google.com')
  ) {
    const bucket = hostname
      .replace(/\.(?:storage\.googleapis\.com|storage\.cloud\.google\.com)$/, '');
    if (!isSafeBucketName(bucket)) return false;
    return !buckets.has(bucket);
  }

  if (hostname === firebaseDownloadHost) {
    const segments = url.pathname.split('/');
    if (
      segments.length !== 6 ||
      segments[0] !== '' ||
      segments[1] !== 'v0' ||
      segments[2] !== 'b' ||
      !isSafeBucketName(segments[3]) ||
      segments[4] !== 'o' ||
      segments[5].length === 0 ||
      segments[5].includes('/')
    ) {
      return false;
    }
    let objectPath: string;
    try {
      objectPath = decodeURIComponent(segments[5]);
    } catch (_) {
      return false;
    }
    if (!isSafeDecodedObjectPath(objectPath)) return false;
    return !buckets.has(segments[3].toLowerCase());
  }

  if (hostname === googleStorageHost) {
    const segments = url.pathname.split('/');
    if (segments.length < 3 || !isSafeBucketName(segments[1])) return false;
    if (!isSafeDecodedObjectPath(segments.slice(2).join('/'))) return false;
    return !buckets.has(segments[1].toLowerCase());
  }

  if (hostname === googleCloudStorageHost) {
    const segments = url.pathname.split('/');
    if (segments.length < 3 || !isSafeBucketName(segments[1])) return false;
    if (!isSafeDecodedObjectPath(segments.slice(2).join('/'))) return false;
    return !buckets.has(segments[1].toLowerCase());
  }

  // Google-owned Storage/API endpoints outside the strict grammars above are
  // ambiguous and can still identify a Hana first-party object. They are never
  // sufficient evidence for destructive orphan-post remediation.
  if (
    hostname.endsWith('.googleapis.com') ||
    hostname.endsWith('.google.com') ||
    hostname.endsWith('.firebasestorage.app') ||
    hostname.endsWith('.appspot.com')
  ) return false;

  if (/%(?:2e|2f|5c)/i.test(value)) return false;
  return true;
}

export function nestedValue(
  data: unknown,
  fieldPath: string
): unknown {
  if (!isPlainRecord(data) || !isSafeNestedFieldPath(fieldPath)) {
    return undefined;
  }
  let cursor: unknown = data;
  for (const segment of fieldPath.split('.')) {
    if (!isPlainRecord(cursor) ||
        !Object.prototype.hasOwnProperty.call(cursor, segment)) {
      return undefined;
    }
    cursor = cursor[segment];
  }
  return cursor;
}

export function exactStringArray(
  value: unknown,
  expected: readonly string[]
): value is string[] {
  return Array.isArray(value) &&
    value.length === expected.length &&
    value.every((entry, index) =>
      typeof entry === 'string' && entry === expected[index]
    );
}

function exactDirectParticipants(value: unknown): readonly [string, string] | null {
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    !isSafeUid(value[0]) ||
    !isSafeUid(value[1]) ||
    value[0] === value[1]
  ) {
    return null;
  }
  return [value[0], value[1]];
}

function safeDocumentPathSegments(documentPath: string): string[] | null {
  if (
    typeof documentPath !== 'string' ||
    documentPath.length === 0 ||
    documentPath.length > 1024 ||
    documentPath.startsWith('/') ||
    documentPath.endsWith('/') ||
    documentPath.includes('%') ||
    documentPath.includes('\\') ||
    containsControlCharacter(documentPath)
  ) {
    return null;
  }
  const segments = documentPath.split('/');
  return segments.every((segment) =>
    safeIdPattern.test(segment) && !/^__.*__$/.test(segment)
  ) ? segments : null;
}

function isSafeNestedFieldPath(fieldPath: string): boolean {
  if (
    typeof fieldPath !== 'string' ||
    fieldPath.length === 0 ||
    fieldPath.length > 512 ||
    fieldPath.includes('/') ||
    fieldPath.includes('`') ||
    fieldPath.includes('[') ||
    fieldPath.includes(']') ||
    fieldPath.includes('*') ||
    containsControlCharacter(fieldPath)
  ) {
    return false;
  }
  const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
  return fieldPath.split('.').every((segment) =>
    safeIdPattern.test(segment) && !forbidden.has(segment)
  );
}

function isWellFormedStoredPhotoValue(value: unknown): value is string {
  return typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 2048 &&
    value.trim() === value &&
    !containsControlCharacter(value);
}

function normalizedBuckets(
  allowedBuckets: ReadonlySet<string> | readonly string[]
): Set<string> | null {
  if (
    !(allowedBuckets instanceof Set) &&
    !Array.isArray(allowedBuckets)
  ) {
    return null;
  }
  const normalized = new Set<string>();
  for (const value of allowedBuckets) {
    if (!isSafeBucketName(value)) return null;
    normalized.add(value.toLowerCase());
  }
  return normalized.size > 0 ? normalized : null;
}

function isSafeBucketName(value: unknown): value is string {
  return typeof value === 'string' &&
    value.length >= 3 &&
    value.length <= 222 &&
    safeBucketPattern.test(value.toLowerCase()) &&
    value === value.toLowerCase() &&
    !value.includes('..');
}

function isSafeDecodedObjectPath(value: string): boolean {
  if (
    value.length === 0 ||
    value.length > 1024 ||
    value.startsWith('/') ||
    value.endsWith('/') ||
    value.includes('%') ||
    value.includes('\\') ||
    containsControlCharacter(value)
  ) {
    return false;
  }
  return value.split('/').every((segment) =>
    segment.length > 0 &&
    segment.length <= 255 &&
    segment !== '.' &&
    segment !== '..' &&
    /^[A-Za-z0-9._-]+$/.test(segment)
  );
}

function isSafeMigrationObjectPath(value: string): boolean {
  if (
    value.length === 0 ||
    value.length > 512 ||
    value.startsWith('/') ||
    value.endsWith('/') ||
    value.includes('\\') ||
    containsControlCharacter(value)
  ) return false;
  return value.split('/').every((segment) =>
    segment.length > 0 &&
    segment.length <= 255 &&
    segment !== '.' &&
    segment !== '..'
  );
}

function isPublicDnsHostname(value: string): boolean {
  const normalized = value.toLowerCase();
  if (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized.endsWith('.') ||
    !normalized.includes('.') ||
    normalized.includes('..') ||
    /^\d{1,3}(?:\.\d{1,3}){3}$/.test(normalized)
  ) {
    return false;
  }
  const labels = normalized.split('.');
  return labels.every((label) =>
    /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)
  );
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function containsControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    if (codePoint <= 0x1f || codePoint === 0x7f) return true;
  }
  return false;
}
