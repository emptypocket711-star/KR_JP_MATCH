import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import * as admin from 'firebase-admin';

import {
  parseMediaUploadObjectPath,
  privateMediaMetadataPatch,
} from '../mediaUploadPolicy';

const MANIFEST_KIND = 'hana.private-media-token-migration';
const MANIFEST_VERSION = 1;
const PRIVATE_CACHE_CONTROL = 'private, no-store, max-age=0';
const PROJECT_ALLOWLIST = new Set([
  'hana-e2ee6',
  'hana-production-tokyo',
]);
const PRODUCTION_PROJECT_ID = 'hana-production-tokyo';
const DEFAULT_PAGE_SIZE = 200;
const MAX_PAGE_SIZE = 500;
const DEFAULT_MAX_RECORDS = 20_000;
const HARD_MAX_RECORDS = 1_000_000;
const DEFAULT_MAX_APPLY_ACTIONS = 5_000;
const HARD_MAX_APPLY_ACTIONS = 50_000;

interface CliOptions {
  apply: boolean;
  expectedProject: string;
  confirmProject?: string;
  confirmProductionWrite?: string;
  manifestPath: string;
  manifestDigest?: string;
  pageSize: number;
  maxRecords: number;
  maxApplyActions: number;
}

interface Finding {
  code:
    | 'invalid-profile-references'
    | 'legacy-profile-object-requires-copy'
    | 'invalid-image-message-reference'
    | 'conflicting-image-message-reference'
    | 'missing-referenced-object'
    | 'invalid-storage-object-metadata';
  location: string;
}

interface ProfileAction {
  documentPath: string;
  expectedPhotoUrls: string[];
  nextPhotoUrls: string[];
}

interface MessageAction {
  documentPath: string;
  expectedImagePath: string | null;
  expectedImageUrl: string | null;
  nextImagePath: string;
}

interface ReferenceAction {
  documentPath: string;
  fieldPath: string[];
  expectedValue: string;
  nextValue: string;
}

interface StorageAction {
  objectPath: string;
  expectedGeneration: string;
  expectedMetageneration: string;
  expectedHadDownloadToken: boolean;
  expectedCacheControl: string | null;
}

interface PrivateMediaManifestUnsigned {
  schemaVersion: 1;
  kind: typeof MANIFEST_KIND;
  projectId: string;
  bucket: string;
  createdAt: string;
  scan: {
    complete: boolean;
    pageSize: number;
    maxRecordsPerSource: number;
    userDocuments: number;
    messageDocuments: number;
    denormalizedReferenceDocuments: number;
    storageObjects: number;
  };
  findings: Finding[];
  profileActions: ProfileAction[];
  messageActions: MessageAction[];
  referenceActions: ReferenceAction[];
  storageActions: StorageAction[];
}

interface PrivateMediaManifest extends PrivateMediaManifestUnsigned {
  digest: string;
}

interface ScanResult<T> {
  records: T[];
  complete: boolean;
}

function usage(): string {
  return `
Private media path backfill and Firebase download-token revocation.
Dry-run audit is the default. This program never applies a partial scan.

Audit:
  GOOGLE_CLOUD_PROJECT=hana-e2ee6 \\
  node lib/admin/privateMediaMigration.js \\
    --expected-project hana-e2ee6 \\
    --manifest /secure/path/private-media-manifest.json

Apply:
  GOOGLE_CLOUD_PROJECT=hana-e2ee6 \\
  node lib/admin/privateMediaMigration.js \\
    --apply \\
    --expected-project hana-e2ee6 \\
    --confirm-project hana-e2ee6 \\
    --manifest /secure/path/private-media-manifest.json \\
    --manifest-digest <64-char-sha256>

Production apply additionally requires:
  --confirm-production-write hana-production-tokyo

Optional bounds:
  --page-size <1..${MAX_PAGE_SIZE}>
  --max-records <1..${HARD_MAX_RECORDS}>
  --max-apply-actions <1..${HARD_MAX_APPLY_ACTIONS}>
`;
}

function valueAfter(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function boundedInteger(
  raw: string | undefined,
  fallback: number,
  flag: string,
  maximum: number
): number {
  if (raw === undefined) return fallback;
  if (!/^\d+$/.test(raw)) throw new Error(`${flag} must be an integer`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${flag} must be between 1 and ${maximum}`);
  }
  return value;
}

export function parseOptions(argv: string[]): CliOptions | 'help' {
  const values = new Map<string, string>();
  let apply = false;
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--help') return 'help';
    if (flag === '--apply') {
      if (apply) throw new Error('--apply was provided more than once');
      apply = true;
      continue;
    }
    if (![
      '--expected-project',
      '--confirm-project',
      '--confirm-production-write',
      '--manifest',
      '--manifest-digest',
      '--page-size',
      '--max-records',
      '--max-apply-actions',
    ].includes(flag)) {
      throw new Error(`Unknown argument: ${flag}`);
    }
    if (values.has(flag)) throw new Error(`${flag} was provided more than once`);
    values.set(flag, valueAfter(argv, index, flag));
    index += 1;
  }

  const expectedProject = values.get('--expected-project');
  const manifest = values.get('--manifest');
  if (!expectedProject || !manifest) {
    throw new Error('--expected-project and --manifest are required');
  }
  return {
    apply,
    expectedProject,
    confirmProject: values.get('--confirm-project'),
    confirmProductionWrite: values.get('--confirm-production-write'),
    manifestPath: path.resolve(manifest),
    manifestDigest: values.get('--manifest-digest'),
    pageSize: boundedInteger(
      values.get('--page-size'),
      DEFAULT_PAGE_SIZE,
      '--page-size',
      MAX_PAGE_SIZE
    ),
    maxRecords: boundedInteger(
      values.get('--max-records'),
      DEFAULT_MAX_RECORDS,
      '--max-records',
      HARD_MAX_RECORDS
    ),
    maxApplyActions: boundedInteger(
      values.get('--max-apply-actions'),
      DEFAULT_MAX_APPLY_ACTIONS,
      '--max-apply-actions',
      HARD_MAX_APPLY_ACTIONS
    ),
  };
}

function runtimeProjectId(): string | null {
  const direct = process.env.GOOGLE_CLOUD_PROJECT ?? process.env.GCLOUD_PROJECT;
  if (direct) return direct;
  const firebaseConfig = process.env.FIREBASE_CONFIG;
  if (!firebaseConfig) return null;
  const decoded = JSON.parse(firebaseConfig) as { projectId?: unknown };
  return typeof decoded.projectId === 'string' ? decoded.projectId : null;
}

function verifyTarget(options: CliOptions): void {
  if (!PROJECT_ALLOWLIST.has(options.expectedProject)) {
    throw new Error('Expected project is not in the Hana project allowlist');
  }
  if (runtimeProjectId() !== options.expectedProject) {
    throw new Error('Runtime project must exactly match --expected-project');
  }
  if (
    process.env.FIRESTORE_EMULATOR_HOST ||
    process.env.FIREBASE_STORAGE_EMULATOR_HOST ||
    process.env.STORAGE_EMULATOR_HOST
  ) {
    throw new Error('This migration tool refuses all emulator environments');
  }
  if (options.apply) {
    if (options.confirmProject !== options.expectedProject) {
      throw new Error('--confirm-project must exactly match the target');
    }
    if (!/^[a-f0-9]{64}$/.test(options.manifestDigest ?? '')) {
      throw new Error('--manifest-digest must be a 64-character SHA-256');
    }
    if (
      options.expectedProject === PRODUCTION_PROJECT_ID &&
      options.confirmProductionWrite !== PRODUCTION_PROJECT_ID
    ) {
      throw new Error(
        '--confirm-production-write hana-production-tokyo is required'
      );
    }
  } else if (
    options.confirmProject !== undefined ||
    options.confirmProductionWrite !== undefined ||
    options.manifestDigest !== undefined
  ) {
    throw new Error('Write confirmation flags require --apply');
  }
}

type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

function canonicalize(value: JsonValue): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonicalize(child)}`)
    .join(',')}}`;
}

export function manifestDigest(value: PrivateMediaManifestUnsigned): string {
  return createHash('sha256')
    .update(canonicalize(value as unknown as JsonValue))
    .digest('hex');
}

function unsignedManifest(
  manifest: PrivateMediaManifest
): PrivateMediaManifestUnsigned {
  const { digest: _digest, ...unsigned } = manifest;
  return unsigned;
}

export function firstPartyObjectPathFromUrl(
  value: string,
  bucket: string
): string | null {
  if (value.length === 0 || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      url.hostname !== 'firebasestorage.googleapis.com' ||
      url.username.length > 0 ||
      url.password.length > 0 ||
      url.port.length > 0 ||
      url.hash.length > 0
    ) {
      return null;
    }
    const segments = url.pathname.split('/');
    if (
      segments.length !== 6 ||
      segments[0] !== '' ||
      segments[1] !== 'v0' ||
      segments[2] !== 'b' ||
      segments[3] !== bucket ||
      segments[4] !== 'o' ||
      segments[5].length === 0 ||
      segments[5].includes('/')
    ) {
      return null;
    }
    const keys = [...url.searchParams.keys()];
    if (
      url.searchParams.get('alt') !== 'media' ||
      keys.some((key) => key !== 'alt' && key !== 'token')
    ) {
      return null;
    }
    const objectPath = decodeURIComponent(segments[5]);
    if (
      objectPath.length === 0 ||
      objectPath.length > 512 ||
      objectPath.startsWith('/') ||
      objectPath.includes('..')
    ) {
      return null;
    }
    return objectPath;
  } catch {
    return null;
  }
}

function isSafeStoragePathSegment(value: string): boolean {
  if (
    value.length === 0 ||
    value.length > 128 ||
    value === '.' ||
    value === '..'
  ) {
    return false;
  }
  return ![...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
}

/**
 * Objects whose Firebase bearer tokens this migration is allowed to revoke.
 * Canonical media uses the reservation-owned grammar. The two legacy profile
 * prefixes are accepted only so their historical tokens are not left behind
 * after document references have been copied/backfilled to canonical paths.
 */
export function isManagedPrivateMediaObjectPath(value: string): boolean {
  const canonical = parseMediaUploadObjectPath(value);
  if (canonical != null) return true;
  if (
    value.length === 0 ||
    value.length > 512 ||
    value.startsWith('/')
  ) {
    return false;
  }
  const segments = value.split('/');
  if (!segments.every(isSafeStoragePathSegment)) return false;
  return (
    (segments[0] === 'users' && segments.length === 3) ||
    (segments[0] === 'profile_photos' && segments.length >= 3)
  );
}

async function scanQuery<T>(params: {
  query: FirebaseFirestore.Query;
  pageSize: number;
  maxRecords: number;
  map: (doc: FirebaseFirestore.QueryDocumentSnapshot) => T;
}): Promise<ScanResult<T>> {
  const records: T[] = [];
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  while (records.length < params.maxRecords) {
    const remaining = params.maxRecords - records.length;
    const requested = Math.min(params.pageSize, remaining + 1);
    let query = params.query.limit(requested);
    if (cursor) query = query.startAfter(cursor);
    const snapshot = await query.get();
    if (snapshot.empty) return { records, complete: true };
    if (snapshot.docs.length > remaining) return { records, complete: false };
    records.push(...snapshot.docs.map(params.map));
    cursor = snapshot.docs.at(-1);
    if (snapshot.docs.length < requested) return { records, complete: true };
  }
  return { records, complete: false };
}

export function storagePageToken(nextQuery: unknown): string | undefined {
  if (nextQuery === null || typeof nextQuery !== 'object') return undefined;
  const value = (nextQuery as { pageToken?: unknown }).pageToken;
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

async function scanStorageObjects(params: {
  bucket: ReturnType<admin.storage.Storage['bucket']>;
  prefix: string;
  pageSize: number;
  maxRecords: number;
}): Promise<ScanResult<{
  objectPath: string;
  generation: string | null;
  metageneration: string | null;
  hadDownloadToken: boolean;
  cacheControl: string | null;
  cacheMarker: string | null;
}>> {
  const records: Array<{
    objectPath: string;
    generation: string | null;
    metageneration: string | null;
    hadDownloadToken: boolean;
    cacheControl: string | null;
    cacheMarker: string | null;
  }> = [];
  let pageToken: string | undefined;
  do {
    const remaining = params.maxRecords - records.length;
    if (remaining <= 0) return { records, complete: false };
    const [files, nextQuery] = await params.bucket.getFiles({
      prefix: params.prefix,
      autoPaginate: false,
      maxResults: Math.min(params.pageSize, remaining + 1),
      ...(pageToken ? { pageToken } : {}),
    });
    if (files.length > remaining) return { records, complete: false };
    for (const file of files) {
      const [metadata] = await file.getMetadata();
      const custom = metadata.metadata ?? {};
      records.push({
        objectPath: file.name,
        generation: metadata.generation == null
          ? null
          : String(metadata.generation),
        metageneration: metadata.metageneration == null
          ? null
          : String(metadata.metageneration),
        hadDownloadToken:
          typeof custom.firebaseStorageDownloadTokens === 'string' &&
          custom.firebaseStorageDownloadTokens.trim().length > 0,
        cacheControl:
          typeof metadata.cacheControl === 'string'
            ? metadata.cacheControl
            : null,
        cacheMarker:
          typeof custom.hanaCacheControl === 'string'
            ? custom.hanaCacheControl
            : null,
      });
    }
    pageToken = storagePageToken(nextQuery);
  } while (pageToken);
  return { records, complete: true };
}

async function audit(
  db: FirebaseFirestore.Firestore,
  bucket: ReturnType<admin.storage.Storage['bucket']>,
  options: CliOptions
): Promise<PrivateMediaManifest> {
  const users = await scanQuery({
    query: db.collection('users').orderBy(admin.firestore.FieldPath.documentId()),
    pageSize: options.pageSize,
    maxRecords: options.maxRecords,
    map: (doc) => ({ path: doc.ref.path, id: doc.id, data: doc.data() }),
  });
  const messages = await scanQuery({
    query: db
      .collectionGroup('messages')
      .orderBy(admin.firestore.FieldPath.documentId()),
    pageSize: options.pageSize,
    maxRecords: options.maxRecords,
    map: (doc) => ({ path: doc.ref.path, data: doc.data() }),
  });
  const [posts, comments, replies, blocks, matches] = await Promise.all([
    scanQuery({
      query: db.collection('posts').orderBy(admin.firestore.FieldPath.documentId()),
      pageSize: options.pageSize,
      maxRecords: options.maxRecords,
      map: (doc) => ({ path: doc.ref.path, data: doc.data() }),
    }),
    scanQuery({
      query: db.collectionGroup('comments')
        .orderBy(admin.firestore.FieldPath.documentId()),
      pageSize: options.pageSize,
      maxRecords: options.maxRecords,
      map: (doc) => ({ path: doc.ref.path, data: doc.data() }),
    }),
    scanQuery({
      query: db.collectionGroup('replies')
        .orderBy(admin.firestore.FieldPath.documentId()),
      pageSize: options.pageSize,
      maxRecords: options.maxRecords,
      map: (doc) => ({ path: doc.ref.path, data: doc.data() }),
    }),
    scanQuery({
      query: db.collectionGroup('blocks')
        .orderBy(admin.firestore.FieldPath.documentId()),
      pageSize: options.pageSize,
      maxRecords: options.maxRecords,
      map: (doc) => ({ path: doc.ref.path, data: doc.data() }),
    }),
    scanQuery({
      query: db.collection('matches')
        .orderBy(admin.firestore.FieldPath.documentId()),
      pageSize: options.pageSize,
      maxRecords: options.maxRecords,
      map: (doc) => ({ path: doc.ref.path, data: doc.data() }),
    }),
  ]);
  const [profileObjects, chatObjects, legacyUserObjects, legacyProfileObjects] =
    await Promise.all([
    scanStorageObjects({
      bucket,
      prefix: 'profile_media/',
      pageSize: options.pageSize,
      maxRecords: options.maxRecords,
    }),
    scanStorageObjects({
      bucket,
      prefix: 'chat_images/',
      pageSize: options.pageSize,
      maxRecords: options.maxRecords,
    }),
    scanStorageObjects({
      bucket,
      prefix: 'users/',
      pageSize: options.pageSize,
      maxRecords: options.maxRecords,
    }),
    scanStorageObjects({
      bucket,
      prefix: 'profile_photos/',
      pageSize: options.pageSize,
      maxRecords: options.maxRecords,
    }),
  ]);

  const findings: Finding[] = [];
  const profileActions: ProfileAction[] = [];
  const messageActions: MessageAction[] = [];
  const referenceActions: ReferenceAction[] = [];
  const referencedPaths = new Set<string>();
  const primaryProfilePathByUid = new Map<string, string>();

  for (const user of users.records) {
    if (!Object.prototype.hasOwnProperty.call(user.data, 'photoUrls')) continue;
    if (!Array.isArray(user.data.photoUrls) ||
        user.data.photoUrls.some((value: unknown) => typeof value !== 'string')) {
      findings.push({ code: 'invalid-profile-references', location: user.path });
      continue;
    }
    const expected = user.data.photoUrls as string[];
    if (expected.length > 6) {
      findings.push({ code: 'invalid-profile-references', location: user.path });
      continue;
    }
    const next: string[] = [];
    const unique = new Set<string>();
    let changed = false;
    let blocked = false;
    for (const reference of expected) {
      const direct = parseMediaUploadObjectPath(reference);
      const urlPath = firstPartyObjectPathFromUrl(reference, bucket.name);
      const candidate = direct != null ? reference : urlPath;
      const parsed = parseMediaUploadObjectPath(candidate);
      if (parsed?.kind === 'profile' && parsed.uid === user.id) {
        if (unique.has(candidate!)) {
          findings.push({ code: 'invalid-profile-references', location: user.path });
          blocked = true;
          break;
        }
        unique.add(candidate!);
        next.push(candidate!);
        referencedPaths.add(candidate!);
        changed ||= candidate !== reference;
        continue;
      }
      if (
        urlPath?.startsWith(`users/${user.id}/`) ||
        urlPath?.startsWith(`profile_photos/${user.id}/`)
      ) {
        findings.push({
          code: 'legacy-profile-object-requires-copy',
          location: user.path,
        });
      } else {
        findings.push({ code: 'invalid-profile-references', location: user.path });
      }
      blocked = true;
      break;
    }
    if (!blocked && changed) {
      profileActions.push({
        documentPath: user.path,
        expectedPhotoUrls: expected,
        nextPhotoUrls: next,
      });
    }
    if (!blocked && next.length > 0) {
      primaryProfilePathByUid.set(user.id, next[0]);
    }
  }

  for (const message of messages.records) {
    const hasImageReference =
      Object.prototype.hasOwnProperty.call(message.data, 'imagePath') ||
      Object.prototype.hasOwnProperty.call(message.data, 'imageUrl');
    if (!hasImageReference && message.data.messageType !== 'image') continue;
    if (message.data.messageType !== 'image') {
      findings.push({
        code: 'invalid-image-message-reference',
        location: message.path,
      });
      continue;
    }
    const segments = message.path.split('/');
    const matchId = segments.length === 4 && segments[0] === 'matches'
      ? segments[1]
      : null;
    const senderId = typeof message.data.senderId === 'string'
      ? message.data.senderId
      : null;
    const currentPath = typeof message.data.imagePath === 'string'
      ? message.data.imagePath
      : null;
    const currentUrl = typeof message.data.imageUrl === 'string'
      ? message.data.imageUrl
      : null;
    const urlPath = currentUrl == null
      ? null
      : firstPartyObjectPathFromUrl(currentUrl, bucket.name);
    const pathParsed = parseMediaUploadObjectPath(currentPath);
    const urlParsed = parseMediaUploadObjectPath(urlPath);
    const owned = (parsed: ReturnType<typeof parseMediaUploadObjectPath>) =>
      parsed?.kind === 'chat' &&
      parsed.matchId === matchId &&
      parsed.uid === senderId;
    if (
      (currentPath != null && !owned(pathParsed)) ||
      (currentUrl != null && !owned(urlParsed))
    ) {
      findings.push({
        code: 'invalid-image-message-reference',
        location: message.path,
      });
      continue;
    }
    if (currentPath != null && urlPath != null && currentPath !== urlPath) {
      findings.push({
        code: 'conflicting-image-message-reference',
        location: message.path,
      });
      continue;
    }
    const nextPath = currentPath ?? urlPath;
    if (nextPath == null) {
      findings.push({
        code: 'invalid-image-message-reference',
        location: message.path,
      });
      continue;
    }
    referencedPaths.add(nextPath);
    if (currentUrl != null || currentPath !== nextPath) {
      messageActions.push({
        documentPath: message.path,
        expectedImagePath: currentPath,
        expectedImageUrl: currentUrl,
        nextImagePath: nextPath,
      });
    }
  }

  const addProfileReference = (params: {
    documentPath: string;
    fieldPath: string[];
    value: unknown;
    ownerUid: unknown;
  }) => {
    if (params.value == null || params.value === '') return;
    if (typeof params.value !== 'string' || typeof params.ownerUid !== 'string') {
      findings.push({
        code: 'invalid-profile-references',
        location: params.documentPath,
      });
      return;
    }
    const direct = parseMediaUploadObjectPath(params.value);
    const urlPath = firstPartyObjectPathFromUrl(params.value, bucket.name);
    const candidate = direct != null ? params.value : urlPath;
    const parsed = parseMediaUploadObjectPath(candidate);
    let nextValue: string;
    if (parsed?.kind === 'profile' && parsed.uid === params.ownerUid) {
      nextValue = candidate!;
    } else if (
      urlPath?.startsWith(`users/${params.ownerUid}/`) ||
      urlPath?.startsWith(`profile_photos/${params.ownerUid}/`)
    ) {
      const replacement = primaryProfilePathByUid.get(params.ownerUid);
      if (replacement == null) {
        findings.push({
          code: 'legacy-profile-object-requires-copy',
          location: params.documentPath,
        });
        return;
      }
      nextValue = replacement;
    } else {
      findings.push({
        code: 'invalid-profile-references',
        location: params.documentPath,
      });
      return;
    }
    referencedPaths.add(nextValue);
    if (nextValue !== params.value) {
      referenceActions.push({
        documentPath: params.documentPath,
        fieldPath: params.fieldPath,
        expectedValue: params.value,
        nextValue,
      });
    }
  };

  for (const post of posts.records) {
    addProfileReference({
      documentPath: post.path,
      fieldPath: ['authorPhotoUrl'],
      value: post.data.authorPhotoUrl,
      ownerUid: post.data.uid,
    });
  }
  for (const comment of comments.records) {
    addProfileReference({
      documentPath: comment.path,
      fieldPath: ['authorPhotoUrl'],
      value: comment.data.authorPhotoUrl,
      ownerUid: comment.data.uid,
    });
  }
  for (const reply of replies.records) {
    addProfileReference({
      documentPath: reply.path,
      fieldPath: ['authorPhotoUrl'],
      value: reply.data.authorPhotoUrl,
      ownerUid: reply.data.uid,
    });
  }
  for (const block of blocks.records) {
    addProfileReference({
      documentPath: block.path,
      fieldPath: ['photoUrl'],
      value: block.data.photoUrl,
      ownerUid: block.data.targetUid,
    });
  }
  for (const match of matches.records) {
    const userIds = Array.isArray(match.data.userIds) &&
      match.data.userIds.length === 2 &&
      match.data.userIds.every((value: unknown) => typeof value === 'string')
      ? match.data.userIds as string[]
      : null;
    if (userIds == null) {
      if (match.data.photoUrl || match.data.myPhotoUrl || match.data.partnerFor) {
        findings.push({
          code: 'invalid-profile-references',
          location: match.path,
        });
      }
      continue;
    }
    addProfileReference({
      documentPath: match.path,
      fieldPath: ['photoUrl'],
      value: match.data.photoUrl,
      ownerUid: userIds[1],
    });
    addProfileReference({
      documentPath: match.path,
      fieldPath: ['myPhotoUrl'],
      value: match.data.myPhotoUrl,
      ownerUid: userIds[0],
    });
    const partnerFor = match.data.partnerFor;
    if (partnerFor != null &&
        (typeof partnerFor !== 'object' || Array.isArray(partnerFor))) {
      findings.push({
        code: 'invalid-profile-references',
        location: match.path,
      });
      continue;
    }
    if (partnerFor == null) continue;
    for (const [viewerUid, entry] of Object.entries(
      partnerFor as Record<string, unknown>
    )) {
      const ownerUid = userIds.find((uid) => uid !== viewerUid);
      const entryData = entry != null &&
        typeof entry === 'object' &&
        !Array.isArray(entry)
        ? entry as Record<string, unknown>
        : null;
      if (ownerUid == null || entryData == null) {
        findings.push({
          code: 'invalid-profile-references',
          location: match.path,
        });
        continue;
      }
      addProfileReference({
        documentPath: match.path,
        fieldPath: ['partnerFor', viewerUid, 'photoUrl'],
        value: entryData.photoUrl,
        ownerUid,
      });
    }
  }

  const storageRecords = [
    ...profileObjects.records,
    ...chatObjects.records,
    ...legacyUserObjects.records,
    ...legacyProfileObjects.records,
  ];
  const existingPaths = new Set(storageRecords.map((record) => record.objectPath));
  for (const reference of referencedPaths) {
    if (!existingPaths.has(reference)) {
      findings.push({ code: 'missing-referenced-object', location: reference });
    }
  }
  const storageActions: StorageAction[] = [];
  for (const record of storageRecords) {
    if (
      !isManagedPrivateMediaObjectPath(record.objectPath) ||
      record.generation == null ||
      record.metageneration == null
    ) {
      findings.push({
        code: 'invalid-storage-object-metadata',
        location: record.objectPath,
      });
      continue;
    }
    if (
      record.hadDownloadToken ||
      record.cacheControl !== PRIVATE_CACHE_CONTROL ||
      record.cacheMarker !== PRIVATE_CACHE_CONTROL
    ) {
      storageActions.push({
        objectPath: record.objectPath,
        expectedGeneration: record.generation,
        expectedMetageneration: record.metageneration,
        expectedHadDownloadToken: record.hadDownloadToken,
        expectedCacheControl: record.cacheControl,
      });
    }
  }

  const unsigned: PrivateMediaManifestUnsigned = {
    schemaVersion: MANIFEST_VERSION,
    kind: MANIFEST_KIND,
    projectId: options.expectedProject,
    bucket: bucket.name,
    createdAt: new Date().toISOString(),
    scan: {
      complete:
        users.complete &&
        messages.complete &&
        posts.complete &&
        comments.complete &&
        replies.complete &&
        blocks.complete &&
        matches.complete &&
        profileObjects.complete &&
        chatObjects.complete &&
        legacyUserObjects.complete &&
        legacyProfileObjects.complete,
      pageSize: options.pageSize,
      maxRecordsPerSource: options.maxRecords,
      userDocuments: users.records.length,
      messageDocuments: messages.records.length,
      denormalizedReferenceDocuments:
        posts.records.length +
        comments.records.length +
        replies.records.length +
        blocks.records.length +
        matches.records.length,
      storageObjects: storageRecords.length,
    },
    findings: findings.sort((a, b) =>
      a.code.localeCompare(b.code) || a.location.localeCompare(b.location)
    ),
    profileActions: profileActions.sort((a, b) =>
      a.documentPath.localeCompare(b.documentPath)
    ),
    messageActions: messageActions.sort((a, b) =>
      a.documentPath.localeCompare(b.documentPath)
    ),
    referenceActions: referenceActions.sort((a, b) =>
      a.documentPath.localeCompare(b.documentPath) ||
      a.fieldPath.join('.').localeCompare(b.fieldPath.join('.'))
    ),
    storageActions: storageActions.sort((a, b) =>
      a.objectPath.localeCompare(b.objectPath)
    ),
  };
  return { ...unsigned, digest: manifestDigest(unsigned) };
}

function equalStringArrays(left: unknown, right: string[]): boolean {
  return Array.isArray(left) &&
    left.length === right.length &&
    left.every((value, index) => value === right[index]);
}

async function applyManifest(
  db: FirebaseFirestore.Firestore,
  bucket: ReturnType<admin.storage.Storage['bucket']>,
  manifest: PrivateMediaManifest,
  options: CliOptions
): Promise<void> {
  const actionCount =
    manifest.profileActions.length +
    manifest.messageActions.length +
    manifest.referenceActions.length +
    manifest.storageActions.length;
  if (actionCount > options.maxApplyActions) {
    throw new Error('Manifest exceeds --max-apply-actions');
  }
  for (const action of manifest.profileActions) {
    const ref = db.doc(action.documentPath);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const current = snap.data()?.photoUrls;
      if (equalStringArrays(current, action.nextPhotoUrls)) return;
      if (!equalStringArrays(current, action.expectedPhotoUrls)) {
        throw new Error(`Profile changed after audit: ${action.documentPath}`);
      }
      tx.update(ref, { photoUrls: action.nextPhotoUrls });
    });
  }
  for (const action of manifest.messageActions) {
    const ref = db.doc(action.documentPath);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const data = snap.data() ?? {};
      const currentPath = typeof data.imagePath === 'string' ? data.imagePath : null;
      const currentUrl = typeof data.imageUrl === 'string' ? data.imageUrl : null;
      if (currentPath === action.nextImagePath && currentUrl == null) return;
      if (
        currentPath !== action.expectedImagePath ||
        currentUrl !== action.expectedImageUrl
      ) {
        throw new Error(`Message changed after audit: ${action.documentPath}`);
      }
      tx.update(ref, {
        imagePath: action.nextImagePath,
        imageUrl: admin.firestore.FieldValue.delete(),
      });
    });
  }
  for (const action of manifest.referenceActions) {
    const ref = db.doc(action.documentPath);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      let current: unknown = snap.data();
      for (const segment of action.fieldPath) {
        current = current != null &&
          typeof current === 'object' &&
          !Array.isArray(current)
          ? (current as Record<string, unknown>)[segment]
          : undefined;
      }
      if (current === action.nextValue) return;
      if (current !== action.expectedValue) {
        throw new Error(`Reference changed after audit: ${action.documentPath}`);
      }
      tx.update(
        ref,
        new admin.firestore.FieldPath(...action.fieldPath),
        action.nextValue
      );
    });
  }
  for (const action of manifest.storageActions) {
    const file = bucket.file(action.objectPath, {
      generation: action.expectedGeneration,
    });
    const [metadata] = await file.getMetadata();
    const generation = String(metadata.generation ?? '');
    const metageneration = String(metadata.metageneration ?? '');
    const custom = { ...(metadata.metadata ?? {}) };
    const hasToken =
      typeof custom.firebaseStorageDownloadTokens === 'string' &&
      custom.firebaseStorageDownloadTokens.trim().length > 0;
    const alreadyPrivate =
      !hasToken &&
      metadata.cacheControl === PRIVATE_CACHE_CONTROL &&
      custom.hanaCacheControl === PRIVATE_CACHE_CONTROL;
    if (alreadyPrivate) continue;
    if (
      generation !== action.expectedGeneration ||
      metageneration !== action.expectedMetageneration ||
      hasToken !== action.expectedHadDownloadToken ||
      (metadata.cacheControl ?? null) !== action.expectedCacheControl
    ) {
      throw new Error(`Storage metadata changed after audit: ${action.objectPath}`);
    }
    await file.setMetadata(
      privateMediaMetadataPatch(custom),
      {
        preconditionOpts: {
          ifGenerationMatch: action.expectedGeneration,
          ifMetagenerationMatch: action.expectedMetageneration,
        },
      }
    );
    const [verified] = await file.getMetadata();
    const verifiedCustom = verified.metadata ?? {};
    if (
      String(verified.generation ?? '') !== action.expectedGeneration ||
      verified.cacheControl !== PRIVATE_CACHE_CONTROL ||
      verifiedCustom.hanaCacheControl !== PRIVATE_CACHE_CONTROL ||
      verifiedCustom.firebaseStorageDownloadTokens != null
    ) {
      throw new Error(
        `Storage privacy metadata could not be verified: ${action.objectPath}`
      );
    }
  }
}

async function readManifest(filePath: string): Promise<PrivateMediaManifest> {
  const stat = await fs.stat(filePath);
  if (!stat.isFile() || (stat.mode & 0o077) !== 0) {
    throw new Error('Manifest must be a private regular file with mode 0600');
  }
  return JSON.parse(await fs.readFile(filePath, 'utf8')) as PrivateMediaManifest;
}

function verifyManifest(
  manifest: PrivateMediaManifest,
  options: CliOptions,
  bucket: string
): void {
  if (
    manifest.schemaVersion !== MANIFEST_VERSION ||
    manifest.kind !== MANIFEST_KIND ||
    manifest.projectId !== options.expectedProject ||
    manifest.bucket !== bucket ||
    manifest.scan?.complete !== true ||
    manifest.findings?.length !== 0
  ) {
    throw new Error('Manifest is incompatible, incomplete, or has findings');
  }
  const computed = manifestDigest(unsignedManifest(manifest));
  if (
    computed !== manifest.digest ||
    computed !== options.manifestDigest
  ) {
    throw new Error('Manifest digest verification failed');
  }
}

async function writeManifest(
  filePath: string,
  manifest: PrivateMediaManifest
): Promise<void> {
  const handle = await fs.open(filePath, 'wx', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  if (options === 'help') {
    console.log(usage());
    return;
  }
  verifyTarget(options);
  admin.initializeApp({
    projectId: options.expectedProject,
    storageBucket: `${options.expectedProject}.firebasestorage.app`,
  });
  const db = admin.firestore();
  const bucket = admin.storage().bucket();
  if (options.apply) {
    const manifest = await readManifest(options.manifestPath);
    verifyManifest(manifest, options, bucket.name);
    await applyManifest(db, bucket, manifest, options);
    console.log('Private media migration apply completed. Re-audit is required.');
    return;
  }
  const manifest = await audit(db, bucket, options);
  await writeManifest(options.manifestPath, manifest);
  console.log(JSON.stringify({
    manifest: options.manifestPath,
    digest: manifest.digest,
    complete: manifest.scan.complete,
    findings: manifest.findings.length,
    actions:
      manifest.profileActions.length +
      manifest.messageActions.length +
      manifest.referenceActions.length +
      manifest.storageActions.length,
  }));
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
