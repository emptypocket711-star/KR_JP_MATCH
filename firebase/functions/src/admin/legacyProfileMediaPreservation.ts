import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { promises as fs } from 'node:fs';

import * as admin from 'firebase-admin';
import sharp from 'sharp';

import { activeAccountIssue } from '../callablePolicy';
import {
  mediaUploadMaxBytes,
  mediaUploadMaxDimension,
  mediaUploadMaxPixels,
  parseMediaUploadObjectPath,
  privateMediaCacheControl,
  safeJpegUploadIssue,
} from '../mediaUploadPolicy';
import {
  profileMediaVisibilityDecision,
  profileMediaVisibilityVersion,
} from '../profileMediaVisibilityPolicy';
import { isDeletedOrUnavailableUser } from '../profileExposurePolicy';
import { firstPartyObjectPathFromUrl } from './privateMediaMigration';

const MANIFEST_KIND = 'hana.legacy-profile-media-preservation';
const MANIFEST_VERSION = 1;
const PROJECT_ALLOWLIST = new Set([
  'hana-e2ee6',
  'hana-production-tokyo',
]);
const PRODUCTION_PROJECT_ID = 'hana-production-tokyo';
const DEFAULT_MAX_USERS = 20_000;
const HARD_MAX_USERS = 1_000_000;
const MAX_SOURCE_BYTES = 15 * 1024 * 1024;
const MANIFEST_MAX_AGE_MILLIS = 24 * 60 * 60 * 1000;

interface Options {
  apply: boolean;
  expectedProject: string;
  confirmProject?: string;
  confirmProductionWrite?: string;
  confirmActionCount?: number;
  manifestPath: string;
  manifestDigest?: string;
  maxUsers: number;
}

export interface MediaAction {
  sourceReference: string;
  sourceObjectPath: string;
  sourceGeneration: string;
  sourceMetageneration: string;
  targetObjectPath: string;
  outputSha256: string;
  outputSize: number;
}

export interface UserAction {
  uid: string;
  documentPath: string;
  expectedPhotoUrls: string[];
  nextPhotoUrls: string[];
  media: MediaAction[];
}

interface Finding {
  code:
    | 'invalid-photo-references'
    | 'ineligible-owner'
    | 'missing-source-object'
    | 'unsafe-source-object';
  location: string;
}

interface ManifestUnsigned {
  schemaVersion: 1;
  kind: typeof MANIFEST_KIND;
  projectId: string;
  bucket: string;
  createdAt: string;
  scan: { complete: boolean; users: number; maxUsers: number };
  findings: Finding[];
  actions: UserAction[];
  auditFingerprint: string;
}

interface Manifest extends ManifestUnsigned {
  digest: string;
}

export interface PreservedTarget {
  objectPath: string;
  generation: string;
  size: number;
  created: boolean;
}

export interface ManifestReadExpectations {
  projectId: string;
  bucket: string;
  maxUsers: number;
  actionCount: number;
  digest: string;
  now?: Date;
}

export class PreservationRollbackError extends Error {
  readonly operationError: unknown;
  readonly cleanupError: unknown;

  constructor(operationError: unknown, cleanupError: unknown) {
    super('Preservation action failed and exact-generation cleanup failed');
    this.name = 'PreservationRollbackError';
    this.operationError = operationError;
    this.cleanupError = cleanupError;
  }
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
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw new Error(`${flag} must be between 0 and ${maximum}`);
  }
  return value;
}

export function parseOptions(argv: string[]): Options | 'help' {
  if (argv.includes('--help')) return 'help';
  const values = new Map<string, string>();
  let apply = false;
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--apply') {
      if (apply) throw new Error('--apply was provided more than once');
      apply = true;
      continue;
    }
    if (![
      '--expected-project',
      '--confirm-project',
      '--confirm-production-write',
      '--confirm-action-count',
      '--manifest',
      '--manifest-digest',
      '--max-users',
    ].includes(flag)) {
      throw new Error(`Unknown argument: ${flag}`);
    }
    if (values.has(flag)) throw new Error(`${flag} was provided more than once`);
    values.set(flag, valueAfter(argv, index, flag));
    index += 1;
  }
  const expectedProject = values.get('--expected-project');
  const manifestPath = values.get('--manifest');
  if (!expectedProject || !manifestPath) {
    throw new Error('--expected-project and --manifest are required');
  }
  return {
    apply,
    expectedProject,
    manifestPath,
    manifestDigest: values.get('--manifest-digest'),
    confirmProject: values.get('--confirm-project'),
    confirmProductionWrite: values.get('--confirm-production-write'),
    confirmActionCount: values.has('--confirm-action-count')
      ? boundedInteger(
        values.get('--confirm-action-count'),
        0,
        '--confirm-action-count',
        HARD_MAX_USERS
      )
      : undefined,
    maxUsers: boundedInteger(
      values.get('--max-users'),
      DEFAULT_MAX_USERS,
      '--max-users',
      HARD_MAX_USERS
    ),
  };
}

function runtimeProject(): string | null {
  return process.env.GOOGLE_CLOUD_PROJECT ?? process.env.GCLOUD_PROJECT ?? null;
}

function verifyOptions(options: Options): void {
  if (!PROJECT_ALLOWLIST.has(options.expectedProject)) {
    throw new Error('Project is not in the Hana allowlist');
  }
  if (runtimeProject() !== options.expectedProject) {
    throw new Error('Runtime project must exactly match --expected-project');
  }
  if (process.env.FIRESTORE_EMULATOR_HOST || process.env.STORAGE_EMULATOR_HOST) {
    throw new Error('Emulator environments are refused');
  }
  const applyOnly = [
    options.confirmProject,
    options.confirmProductionWrite,
    options.confirmActionCount,
    options.manifestDigest,
  ];
  if (!options.apply) {
    if (applyOnly.some((value) => value !== undefined)) {
      throw new Error('Confirmation flags require --apply');
    }
    return;
  }
  if (
    options.confirmProject !== options.expectedProject ||
    options.confirmActionCount === undefined ||
    !/^[a-f0-9]{64}$/.test(options.manifestDigest ?? '')
  ) {
    throw new Error('Apply requires exact project, action-count, and digest confirmations');
  }
  if (
    options.expectedProject === PRODUCTION_PROJECT_ID &&
    options.confirmProductionWrite !== PRODUCTION_PROJECT_ID
  ) {
    throw new Error('Production apply requires the exact production confirmation');
  }
}

type JsonValue = null | boolean | number | string | JsonValue[] | {
  [key: string]: JsonValue;
};

function canonicalize(value: JsonValue): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalize(value[key])}`
  ).join(',')}}`;
}

export function digest(value: unknown): string {
  return createHash('sha256')
    .update(canonicalize(value as JsonValue))
    .digest('hex');
}

function sha256Bytes(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

export function legacyProfileTargetPath(input: {
  uid: string;
  sourceObjectPath: string;
  sourceGeneration: string;
}): string {
  const authorizationId = `legacy-${digest([
    input.uid,
    input.sourceObjectPath,
    input.sourceGeneration,
  ]).slice(0, 40)}`;
  return `profile_media/${input.uid}/${authorizationId}/image.jpg`;
}

export function preservationOwnerIssue(input: {
  exists: boolean;
  userData: Record<string, unknown> | undefined;
}): 'missing' | 'banned' | 'deleted' | 'unavailable' | null {
  const activeIssue = activeAccountIssue(input);
  if (activeIssue != null) return activeIssue;
  return isDeletedOrUnavailableUser(input.userData) ? 'unavailable' : null;
}

export async function sanitizeLegacyProfileJpeg(
  source: Buffer
): Promise<Buffer> {
  if (source.length < 4 || source.length > MAX_SOURCE_BYTES) {
    throw new Error('unsafe-source-size');
  }
  const image = sharp(source, {
    failOn: 'error',
    limitInputPixels: 40_000_000,
    pages: 1,
  });
  const metadata = await image.metadata();
  if (
    metadata.format !== 'jpeg' ||
    metadata.pages != null && metadata.pages !== 1 ||
    metadata.width == null ||
    metadata.height == null ||
    metadata.width <= 0 ||
    metadata.height <= 0
  ) {
    throw new Error('unsafe-source-format');
  }
  const swapsAxes = metadata.orientation != null && metadata.orientation >= 5;
  const width = swapsAxes ? metadata.height : metadata.width;
  const height = swapsAxes ? metadata.width : metadata.height;
  const scale = Math.min(
    1,
    mediaUploadMaxDimension / width,
    mediaUploadMaxDimension / height,
    Math.sqrt(mediaUploadMaxPixels / (width * height))
  );
  const targetWidth = Math.max(1, Math.floor(width * scale));
  const targetHeight = Math.max(1, Math.floor(height * scale));
  const output = await image
    .rotate()
    .resize({
      width: targetWidth,
      height: targetHeight,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .toColourspace('srgb')
    .jpeg({ quality: 88, progressive: false, chromaSubsampling: '4:2:0' })
    .toBuffer();
  if (output.length > mediaUploadMaxBytes || safeJpegUploadIssue(output) !== null) {
    throw new Error('unsafe-sanitized-output');
  }
  return output;
}

function manifestFingerprint(input: {
  complete: boolean;
  findings: Finding[];
  actions: UserAction[];
}): string {
  return digest(input);
}

async function audit(
  db: FirebaseFirestore.Firestore,
  bucket: ReturnType<admin.storage.Storage['bucket']>,
  options: Options
): Promise<ManifestUnsigned> {
  const snapshot = await db.collection('users')
    .orderBy(admin.firestore.FieldPath.documentId())
    .limit(options.maxUsers + 1)
    .get();
  const complete = snapshot.size <= options.maxUsers;
  const docs = complete ? snapshot.docs : snapshot.docs.slice(0, options.maxUsers);
  const findings: Finding[] = [];
  const actions: UserAction[] = [];

  for (const doc of docs) {
    const data = doc.data();
    if (!Object.prototype.hasOwnProperty.call(data, 'photoUrls')) continue;
    if (!Array.isArray(data.photoUrls) ||
        data.photoUrls.length > 6 ||
        new Set(data.photoUrls).size !== data.photoUrls.length ||
        data.photoUrls.some((value: unknown) => typeof value !== 'string')) {
      findings.push({ code: 'invalid-photo-references', location: doc.ref.path });
      continue;
    }
    const expected = data.photoUrls as string[];
    const next: string[] = [];
    const media: MediaAction[] = [];
    let blocked = false;
    for (const reference of expected) {
      const canonical = parseMediaUploadObjectPath(reference);
      if (canonical?.kind === 'profile' && canonical.uid === doc.id) {
        next.push(reference);
        continue;
      }
      const sourceObjectPath = firstPartyObjectPathFromUrl(reference, bucket.name);
      if (
        sourceObjectPath == null ||
        (!sourceObjectPath.startsWith(`users/${doc.id}/`) &&
          !sourceObjectPath.startsWith(`profile_photos/${doc.id}/`))
      ) {
        findings.push({ code: 'invalid-photo-references', location: doc.ref.path });
        blocked = true;
        break;
      }
      const sourceFile = bucket.file(sourceObjectPath);
      let metadata;
      try {
        [metadata] = await sourceFile.getMetadata();
      } catch (_) {
        findings.push({ code: 'missing-source-object', location: doc.ref.path });
        blocked = true;
        break;
      }
      const generation = metadata.generation == null
        ? ''
        : String(metadata.generation);
      const metageneration = metadata.metageneration == null
        ? ''
        : String(metadata.metageneration);
      const size = Number(metadata.size);
      if (
        generation.length === 0 ||
        metageneration.length === 0 ||
        metadata.contentType !== 'image/jpeg' ||
        !Number.isSafeInteger(size) ||
        size <= 0 ||
        size > MAX_SOURCE_BYTES
      ) {
        findings.push({ code: 'unsafe-source-object', location: doc.ref.path });
        blocked = true;
        break;
      }
      try {
        const [source] = await bucket.file(sourceObjectPath, { generation }).download();
        const sanitized = await sanitizeLegacyProfileJpeg(source);
        const targetObjectPath = legacyProfileTargetPath({
          uid: doc.id,
          sourceObjectPath,
          sourceGeneration: generation,
        });
        media.push({
          sourceReference: reference,
          sourceObjectPath,
          sourceGeneration: generation,
          sourceMetageneration: metageneration,
          targetObjectPath,
          outputSha256: sha256Bytes(sanitized),
          outputSize: sanitized.length,
        });
        next.push(targetObjectPath);
      } catch (_) {
        findings.push({ code: 'unsafe-source-object', location: doc.ref.path });
        blocked = true;
        break;
      }
    }
    if (!blocked && media.length > 0 &&
        preservationOwnerIssue({ exists: doc.exists, userData: data }) !== null) {
      findings.push({ code: 'ineligible-owner', location: doc.ref.path });
      continue;
    }
    if (!blocked && media.length > 0) {
      actions.push({
        uid: doc.id,
        documentPath: doc.ref.path,
        expectedPhotoUrls: expected,
        nextPhotoUrls: next,
        media,
      });
    }
  }

  findings.sort((a, b) =>
    a.code.localeCompare(b.code) || a.location.localeCompare(b.location)
  );
  actions.sort((a, b) => a.documentPath.localeCompare(b.documentPath));
  const auditFingerprint = manifestFingerprint({ complete, findings, actions });
  return {
    schemaVersion: MANIFEST_VERSION,
    kind: MANIFEST_KIND,
    projectId: options.expectedProject,
    bucket: bucket.name,
    createdAt: new Date().toISOString(),
    scan: { complete, users: docs.length, maxUsers: options.maxUsers },
    findings,
    actions,
    auditFingerprint,
  };
}

async function writeManifest(filePath: string, manifest: Manifest): Promise<void> {
  const handle = await fs.open(filePath, 'wx', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[]
): boolean {
  const actual = Object.keys(value);
  return actual.length === expected.length &&
    actual.every((key) => expected.includes(key));
}

function isSafeUid(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 128) {
    return false;
  }
  if (value === '.' || value === '..' || value.includes('/')) return false;
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    if (codePoint <= 0x1f || codePoint === 0x7f) return false;
  }
  return true;
}

function isStringArray(
  value: unknown,
  minimumLength: number,
  maximumLength: number
): value is string[] {
  return Array.isArray(value) &&
    value.length >= minimumLength &&
    value.length <= maximumLength &&
    value.every((entry) =>
      typeof entry === 'string' && entry.length > 0 && entry.length <= 20_000
    ) &&
    new Set(value).size === value.length;
}

function isGeneration(value: unknown): value is string {
  return typeof value === 'string' && /^\d{1,30}$/.test(value);
}

function assertMediaActionSchema(
  raw: unknown,
  uid: string,
  bucket: string
): asserts raw is MediaAction {
  if (!isRecord(raw) || !hasExactKeys(raw, [
    'sourceReference',
    'sourceObjectPath',
    'sourceGeneration',
    'sourceMetageneration',
    'targetObjectPath',
    'outputSha256',
    'outputSize',
  ])) {
    throw new Error('Manifest media action schema validation failed');
  }
  if (
    typeof raw.sourceReference !== 'string' ||
    raw.sourceReference.length === 0 ||
    raw.sourceReference.length > 20_000 ||
    typeof raw.sourceObjectPath !== 'string' ||
    !isGeneration(raw.sourceGeneration) ||
    !isGeneration(raw.sourceMetageneration) ||
    typeof raw.targetObjectPath !== 'string' ||
    typeof raw.outputSha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(raw.outputSha256) ||
    !Number.isSafeInteger(raw.outputSize) ||
    (raw.outputSize as number) <= 0 ||
    (raw.outputSize as number) > mediaUploadMaxBytes
  ) {
    throw new Error('Manifest media action value validation failed');
  }
  const sourceObjectPath = firstPartyObjectPathFromUrl(raw.sourceReference, bucket);
  if (
    sourceObjectPath !== raw.sourceObjectPath ||
    (!sourceObjectPath.startsWith(`users/${uid}/`) &&
      !sourceObjectPath.startsWith(`profile_photos/${uid}/`)) ||
    raw.targetObjectPath !== legacyProfileTargetPath({
      uid,
      sourceObjectPath,
      sourceGeneration: raw.sourceGeneration,
    })
  ) {
    throw new Error('Manifest media action path validation failed');
  }
}

function assertUserActionSchema(
  raw: unknown,
  bucket: string
): asserts raw is UserAction {
  if (!isRecord(raw) || !hasExactKeys(raw, [
    'uid',
    'documentPath',
    'expectedPhotoUrls',
    'nextPhotoUrls',
    'media',
  ]) || !isSafeUid(raw.uid) || raw.documentPath !== `users/${raw.uid}` ||
      !isStringArray(raw.expectedPhotoUrls, 1, 6) ||
      !isStringArray(raw.nextPhotoUrls, 1, 6) ||
      raw.expectedPhotoUrls.length !== raw.nextPhotoUrls.length ||
      !Array.isArray(raw.media) || raw.media.length === 0 || raw.media.length > 6) {
    throw new Error('Manifest user action schema validation failed');
  }

  const mediaBySource = new Map<string, MediaAction>();
  const mediaTargets = new Set<string>();
  for (const entry of raw.media) {
    assertMediaActionSchema(entry, raw.uid, bucket);
    if (
      mediaBySource.has(entry.sourceReference) ||
      mediaTargets.has(entry.targetObjectPath)
    ) {
      throw new Error('Manifest contains duplicate media actions');
    }
    mediaBySource.set(entry.sourceReference, entry);
    mediaTargets.add(entry.targetObjectPath);
  }

  let mediaIndex = 0;
  for (let index = 0; index < raw.expectedPhotoUrls.length; index += 1) {
    const expected = raw.expectedPhotoUrls[index];
    const next = raw.nextPhotoUrls[index];
    const canonical = parseMediaUploadObjectPath(expected);
    if (canonical?.kind === 'profile' && canonical.uid === raw.uid) {
      if (next !== expected) {
        throw new Error('Manifest changes an existing canonical profile path');
      }
      continue;
    }
    const media = mediaBySource.get(expected);
    if (
      media == null ||
      raw.media[mediaIndex] !== media ||
      next !== media.targetObjectPath
    ) {
      throw new Error('Manifest media action order or replacement is invalid');
    }
    mediaIndex += 1;
  }
  if (mediaIndex !== raw.media.length || raw.nextPhotoUrls.some((value) => {
    const parsed = parseMediaUploadObjectPath(value);
    return parsed?.kind !== 'profile' || parsed.uid !== raw.uid;
  })) {
    throw new Error('Manifest canonical profile replacements are invalid');
  }
}

function assertManifestSchema(
  value: unknown,
  expectations: ManifestReadExpectations
): asserts value is Manifest {
  if (!isRecord(value) || !hasExactKeys(value, [
    'schemaVersion',
    'kind',
    'projectId',
    'bucket',
    'createdAt',
    'scan',
    'findings',
    'actions',
    'auditFingerprint',
    'digest',
  ]) || value.schemaVersion !== MANIFEST_VERSION ||
      value.kind !== MANIFEST_KIND ||
      value.projectId !== expectations.projectId ||
      value.bucket !== expectations.bucket ||
      typeof value.createdAt !== 'string' ||
      typeof value.auditFingerprint !== 'string' ||
      !/^[a-f0-9]{64}$/.test(value.auditFingerprint) ||
      typeof value.digest !== 'string' ||
      !/^[a-f0-9]{64}$/.test(value.digest) ||
      !isRecord(value.scan) || !hasExactKeys(value.scan, [
        'complete', 'users', 'maxUsers',
      ]) || typeof value.scan.complete !== 'boolean' ||
      !Number.isSafeInteger(value.scan.users) ||
      (value.scan.users as number) < 0 ||
      !Number.isSafeInteger(value.scan.maxUsers) ||
      value.scan.maxUsers !== expectations.maxUsers ||
      (value.scan.users as number) > (value.scan.maxUsers as number) ||
      !Array.isArray(value.findings) || !Array.isArray(value.actions) ||
      value.actions.length !== expectations.actionCount) {
    throw new Error('Manifest schema, target, or count validation failed');
  }

  const createdAtMillis = Date.parse(value.createdAt);
  const nowMillis = (expectations.now ?? new Date()).getTime();
  if (
    !Number.isFinite(createdAtMillis) ||
    new Date(createdAtMillis).toISOString() !== value.createdAt ||
    !Number.isFinite(nowMillis) ||
    nowMillis < createdAtMillis ||
    nowMillis - createdAtMillis > MANIFEST_MAX_AGE_MILLIS
  ) {
    throw new Error('Manifest is expired or has an invalid creation time');
  }

  const findingCodes = new Set<string>([
    'invalid-photo-references',
    'ineligible-owner',
    'missing-source-object',
    'unsafe-source-object',
  ]);
  const findingKeys = new Set<string>();
  for (const finding of value.findings) {
    if (!isRecord(finding) || !hasExactKeys(finding, ['code', 'location']) ||
        typeof finding.code !== 'string' || !findingCodes.has(finding.code) ||
        typeof finding.location !== 'string') {
      throw new Error('Manifest finding schema validation failed');
    }
    const uid = finding.location.startsWith('users/')
      ? finding.location.slice('users/'.length)
      : null;
    const key = `${finding.code}\u0000${finding.location}`;
    if (!isSafeUid(uid) || finding.location !== `users/${uid}` ||
        findingKeys.has(key)) {
      throw new Error('Manifest finding path validation failed');
    }
    findingKeys.add(key);
  }

  const actionPaths = new Set<string>();
  const targetPaths = new Set<string>();
  for (const action of value.actions) {
    assertUserActionSchema(action, expectations.bucket);
    if (actionPaths.has(action.documentPath)) {
      throw new Error('Manifest contains duplicate user actions');
    }
    actionPaths.add(action.documentPath);
    for (const media of action.media) {
      if (targetPaths.has(media.targetObjectPath)) {
        throw new Error('Manifest contains duplicate canonical targets');
      }
      targetPaths.add(media.targetObjectPath);
    }
  }
  if (value.actions.length + value.findings.length > (value.scan.users as number)) {
    throw new Error('Manifest scan counts are inconsistent');
  }

  const typedFindings = value.findings as Finding[];
  const typedActions = value.actions as UserAction[];
  if (value.auditFingerprint !== manifestFingerprint({
    complete: value.scan.complete,
    findings: typedFindings,
    actions: typedActions,
  })) {
    throw new Error('Manifest audit fingerprint verification failed');
  }
  const { digest: storedDigest, ...unsigned } = value;
  if (
    digest(unsigned) !== storedDigest ||
    storedDigest !== expectations.digest
  ) {
    throw new Error('Manifest digest verification failed');
  }
}

export async function readPreservationManifest(
  filePath: string,
  expectations: ManifestReadExpectations
): Promise<Manifest> {
  const handle = await fs.open(
    filePath,
    fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW
  );
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || (stat.mode & 0o777) !== 0o600) {
      throw new Error('Manifest must be a regular mode-0600 file');
    }
    const raw = await handle.readFile('utf8');
    const value: unknown = JSON.parse(raw);
    assertManifestSchema(value, expectations);
    return value;
  } finally {
    await handle.close();
  }
}

function isGenerationPreconditionFailure(error: unknown): boolean {
  return isRecord(error) && Number(error.code) === 412;
}

export async function cleanupCreatedPreservationTargets(
  bucket: ReturnType<admin.storage.Storage['bucket']>,
  targets: readonly PreservedTarget[]
): Promise<void> {
  const failures: unknown[] = [];
  const seen = new Set<string>();
  for (const target of [...targets].reverse()) {
    if (!target.created) continue;
    const key = `${target.objectPath}\u0000${target.generation}`;
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      const exact = bucket.file(target.objectPath, {
        generation: target.generation,
      });
      await exact.delete({
        ignoreNotFound: true,
        ifGenerationMatch: target.generation,
      });
      const [stillExists] = await exact.exists();
      if (stillExists) {
        throw new Error('Exact-generation target still exists after cleanup');
      }
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) {
    throw new Error(
      `Exact-generation preservation cleanup failed for ${failures.length} target(s)`
    );
  }
}

async function rethrowAfterCleanup(
  operationError: unknown,
  createdTargets: readonly PreservedTarget[],
  cleanup: (targets: readonly PreservedTarget[]) => Promise<void>
): Promise<never> {
  if (createdTargets.length > 0) {
    try {
      await cleanup(createdTargets);
    } catch (cleanupError) {
      throw new PreservationRollbackError(operationError, cleanupError);
    }
  }
  throw operationError;
}

export async function executePreservationUserAction(
  media: readonly MediaAction[],
  operations: {
    saveOrVerifyTarget: (entry: MediaAction) => Promise<PreservedTarget>;
    commitUser: () => Promise<void>;
    cleanupCreatedTargets: (
      targets: readonly PreservedTarget[]
    ) => Promise<void>;
  }
): Promise<void> {
  const createdTargets: PreservedTarget[] = [];
  try {
    for (const entry of media) {
      const target = await operations.saveOrVerifyTarget(entry);
      if (target.created) createdTargets.push(target);
    }
    await operations.commitUser();
  } catch (error) {
    await rethrowAfterCleanup(
      error,
      createdTargets,
      operations.cleanupCreatedTargets
    );
  }
}

async function saveOrVerifyTarget(
  bucket: ReturnType<admin.storage.Storage['bucket']>,
  media: MediaAction
): Promise<PreservedTarget> {
  const [sourceMetadata] = await bucket
    .file(media.sourceObjectPath, { generation: media.sourceGeneration })
    .getMetadata();
  if (String(sourceMetadata.metageneration ?? '') !== media.sourceMetageneration) {
    throw new Error('Source metadata changed after audit');
  }
  const [source] = await bucket
    .file(media.sourceObjectPath, { generation: media.sourceGeneration })
    .download();
  const sanitized = await sanitizeLegacyProfileJpeg(source);
  if (
    sanitized.length !== media.outputSize ||
    sha256Bytes(sanitized) !== media.outputSha256
  ) {
    throw new Error('Sanitized output changed after audit');
  }
  const target = bucket.file(media.targetObjectPath);
  let created = false;
  try {
    await target.save(sanitized, {
      resumable: false,
      validation: 'crc32c',
      preconditionOpts: { ifGenerationMatch: 0 },
      metadata: {
        contentType: 'image/jpeg',
        cacheControl: privateMediaCacheControl,
        metadata: { hanaCacheControl: privateMediaCacheControl },
      },
    });
    created = true;
  } catch (error) {
    if (!isGenerationPreconditionFailure(error)) throw error;
  }
  let generation = created
    ? String(target.metadata?.generation ?? '')
    : '';
  if (!created) {
    const [metadata] = await target.getMetadata();
    generation = String(metadata.generation ?? '');
  }
  if (!isGeneration(generation)) {
    throw new Error('Canonical target generation is missing or invalid');
  }
  const createdTarget: PreservedTarget = {
    objectPath: media.targetObjectPath,
    generation,
    size: media.outputSize,
    created,
  };
  try {
    const exactTarget = bucket.file(media.targetObjectPath, { generation });
    const [metadata] = await exactTarget.getMetadata();
    const [bytes] = await exactTarget.download();
    const custom = metadata.metadata ?? {};
    if (
      String(metadata.generation ?? '') !== generation ||
      bytes.length !== media.outputSize ||
      sha256Bytes(bytes) !== media.outputSha256 ||
      metadata.contentType !== 'image/jpeg' ||
      metadata.cacheControl !== privateMediaCacheControl ||
      Object.keys(custom).length !== 1 ||
      custom.hanaCacheControl !== privateMediaCacheControl ||
      custom.firebaseStorageDownloadTokens != null ||
      safeJpegUploadIssue(bytes) !== null
    ) {
      throw new Error('Canonical target verification failed');
    }
  } catch (error) {
    if (created) {
      await rethrowAfterCleanup(
        error,
        [createdTarget],
        (targets) => cleanupCreatedPreservationTargets(bucket, targets)
      );
    }
    throw error;
  }
  return createdTarget;
}

async function applyActions(
  db: FirebaseFirestore.Firestore,
  bucket: ReturnType<admin.storage.Storage['bucket']>,
  manifest: Manifest
): Promise<void> {
  for (const action of manifest.actions) {
    const userRef = db.doc(action.documentPath);
    await executePreservationUserAction(action.media, {
      saveOrVerifyTarget: (media) => saveOrVerifyTarget(bucket, media),
      cleanupCreatedTargets: (targets) =>
        cleanupCreatedPreservationTargets(bucket, targets),
      commitUser: () => db.runTransaction(async (tx) => {
        const snap = await tx.get(userRef);
        if (
          preservationOwnerIssue({
            exists: snap.exists,
            userData: snap.data(),
          }) !== null ||
          JSON.stringify(snap.data()?.photoUrls) !==
            JSON.stringify(action.expectedPhotoUrls)
        ) {
          throw new Error('User profile changed after audit');
        }
        const nextData = { ...snap.data(), photoUrls: action.nextPhotoUrls };
        const update: FirebaseFirestore.UpdateData<FirebaseFirestore.DocumentData> = {
          photoUrls: action.nextPhotoUrls,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };
        const visibility = profileMediaVisibilityDecision(nextData);
        if (visibility === 'set') {
          update.profileMediaVisibilityVersion = profileMediaVisibilityVersion;
        } else if (visibility === 'clear') {
          update.profileMediaVisibilityVersion = admin.firestore.FieldValue.delete();
        }
        tx.update(userRef, update);
      }),
    });
  }
}

async function main(): Promise<void> {
  const parsed = parseOptions(process.argv.slice(2));
  if (parsed === 'help') {
    console.log(
      'Dry-run: --expected-project <id> --manifest <new-file> [--max-users N]\n' +
      'Apply: --apply --expected-project <id> --confirm-project <id> ' +
      '--confirm-action-count N --manifest <file> --manifest-digest <digest> ' +
      '[--max-users N] [--confirm-production-write <production-id>]'
    );
    return;
  }
  verifyOptions(parsed);
  admin.initializeApp({
    projectId: parsed.expectedProject,
    storageBucket: `${parsed.expectedProject}.firebasestorage.app`,
  });
  const db = admin.firestore();
  const bucket = admin.storage().bucket();
  if (!parsed.apply) {
    const unsigned = await audit(db, bucket, parsed);
    const manifest: Manifest = { ...unsigned, digest: digest(unsigned) };
    await writeManifest(parsed.manifestPath, manifest);
    console.log(JSON.stringify({
      manifest: parsed.manifestPath,
      digest: manifest.digest,
      complete: manifest.scan.complete,
      findings: manifest.findings.length,
      actions: manifest.actions.length,
    }));
    if (!manifest.scan.complete || manifest.findings.length > 0) {
      process.exitCode = 2;
    }
    return;
  }
  const manifest = await readPreservationManifest(parsed.manifestPath, {
    projectId: parsed.expectedProject,
    bucket: bucket.name,
    maxUsers: parsed.maxUsers,
    actionCount: parsed.confirmActionCount!,
    digest: parsed.manifestDigest!,
  });
  if (
    manifest.projectId !== parsed.expectedProject ||
    manifest.bucket !== bucket.name ||
    manifest.digest !== parsed.manifestDigest ||
    manifest.actions.length !== parsed.confirmActionCount ||
    !manifest.scan.complete ||
    manifest.findings.length > 0
  ) {
    throw new Error('Manifest does not match the explicit apply confirmations');
  }
  const fresh = await audit(db, bucket, parsed);
  if (
    fresh.scan.users !== manifest.scan.users ||
    fresh.scan.maxUsers !== manifest.scan.maxUsers ||
    fresh.auditFingerprint !== manifest.auditFingerprint
  ) {
    throw new Error('Live preservation audit changed; create a new manifest');
  }
  await applyActions(db, bucket, manifest);
  console.log(JSON.stringify({ applied: manifest.actions.length, reAuditRequired: true }));
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
