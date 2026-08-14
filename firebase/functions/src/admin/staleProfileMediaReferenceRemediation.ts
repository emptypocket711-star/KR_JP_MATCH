import { promises as fs } from 'node:fs';
import path from 'node:path';

import * as admin from 'firebase-admin';

import {
  ClearStaleProfileMediaReferenceAction,
  OwnerExpectation,
  StaleProfileMediaAction,
  StaleProfileMediaFinding,
  StaleProfileMediaManifest,
  StaleProfileMediaScanCounts,
  buildStaleProfileMediaManifest,
  staleProfileMediaActionKey,
  verifyStaleProfileMediaManifest,
} from '../staleProfileMediaReferenceManifest';
import {
  StaleReferenceKind,
  classifyOwnerPhotoState,
  firstPartyFirebaseObjectPathFromUrl,
  isExternalNonFirstPartyHttpsPhotoUrl,
  isSafeUid,
  knownHanaStorageBucket,
  nestedValue,
  referenceOwnerUid,
} from '../staleProfileMediaReferencePolicy';

const projectAllowlist = new Set([
  'hana-e2ee6',
  'hana-production-tokyo',
]);
const productionProjectId = 'hana-production-tokyo';
const productionConfirmationPhrase =
  'I UNDERSTAND HANA PRODUCTION STALE MEDIA WRITES';
const defaultPageSize = 200;
const maxPageSize = 500;
const defaultMaxDocuments = 20_000;
const hardMaxDocuments = 1_000_000;
const defaultMaxApplyActions = 5_000;
const hardMaxApplyActions = 50_000;
const manifestMaxAgeMillis = 24 * 60 * 60 * 1000;
const manifestMaxFutureSkewMillis = 5 * 60 * 1000;
const authBatchSize = 100;

interface CliOptions {
  apply: boolean;
  expectedProject: string;
  confirmProject?: string;
  confirmProductionWrite?: string;
  confirmActionCount?: number;
  manifestPath: string;
  manifestDigest?: string;
  pageSize: number;
  maxDocuments: number;
  maxApplyActions: number;
}

interface RuntimeFirebaseIdentity {
  projectId: string;
  storageBucket: string;
}

export interface StaleMediaAuditDocument {
  path: string;
  id: string;
  data: Record<string, unknown>;
}

interface CollectionScan {
  records: StaleMediaAuditDocument[];
  complete: boolean;
}

export interface StaleMediaAuditRecords {
  users: readonly StaleMediaAuditDocument[];
  posts: readonly StaleMediaAuditDocument[];
  comments: readonly StaleMediaAuditDocument[];
  replies: readonly StaleMediaAuditDocument[];
  blocks: readonly StaleMediaAuditDocument[];
  matches: readonly StaleMediaAuditDocument[];
}

interface ReferenceCandidate {
  kind: StaleReferenceKind;
  documentPath: string;
  fieldPath: string;
  data: Record<string, unknown>;
  value: unknown;
}

export interface StaleMediaClassification {
  findings: StaleProfileMediaFinding[];
  actions: StaleProfileMediaAction[];
  referencedOwnerUids: Set<string>;
  deletePostPaths: Set<string>;
  deferredFirstPartyReferences: number;
}

interface AuditResult {
  manifest: StaleProfileMediaManifest;
  existingPostPaths: Set<string>;
}

function usage(): string {
  return `
Stale profile-media snapshot remediation (dry-run by default).

This tool clears an old denormalized photo only when its exact owner has no
current canonical photo. A sole current legacy photo is a blocking finding and
must first pass the trusted preservation/re-encode workflow.

Audit (no writes):
  GOOGLE_CLOUD_PROJECT=hana-e2ee6 \\
  node lib/admin/staleProfileMediaReferenceRemediation.js \\
    --expected-project hana-e2ee6 \\
    --manifest /secure/path/stale-profile-media.json

Apply:
  GOOGLE_CLOUD_PROJECT=hana-e2ee6 \\
  node lib/admin/staleProfileMediaReferenceRemediation.js \\
    --apply \\
    --expected-project hana-e2ee6 \\
    --confirm-project hana-e2ee6 \\
    --confirm-action-count <exact-count> \\
    --manifest /secure/path/stale-profile-media.json \\
    --manifest-digest <64-char-sha256>

Production apply additionally requires the exact phrase:
  --confirm-production-write "${productionConfirmationPhrase}"

Optional audit/apply bounds:
  --page-size <1..${maxPageSize}>
  --max-documents <1..${hardMaxDocuments}> (per source)
  --max-apply-actions <1..${hardMaxApplyActions}>
`;
}

function valueAfter(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function boundedPositiveInteger(
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

function nonNegativeInteger(raw: string | undefined, flag: string): number {
  if (raw === undefined || !/^\d+$/.test(raw)) {
    throw new Error(`${flag} must be a non-negative safe integer`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${flag} must be a non-negative safe integer`);
  }
  return value;
}

export function parseStaleMediaOptions(argv: string[]): CliOptions | 'help' {
  const values = new Map<string, string>();
  let apply = false;
  const valueFlags = new Set([
    '--expected-project',
    '--confirm-project',
    '--confirm-production-write',
    '--confirm-action-count',
    '--manifest',
    '--manifest-digest',
    '--page-size',
    '--max-documents',
    '--max-apply-actions',
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--help') return 'help';
    if (flag === '--apply') {
      if (apply) throw new Error('--apply was provided more than once');
      apply = true;
      continue;
    }
    if (!valueFlags.has(flag)) throw new Error(`Unknown argument: ${flag}`);
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
    confirmProject: values.get('--confirm-project'),
    confirmProductionWrite: values.get('--confirm-production-write'),
    confirmActionCount: values.has('--confirm-action-count')
      ? nonNegativeInteger(
          values.get('--confirm-action-count'),
          '--confirm-action-count'
        )
      : undefined,
    manifestPath: path.resolve(manifestPath),
    manifestDigest: values.get('--manifest-digest'),
    pageSize: boundedPositiveInteger(
      values.get('--page-size'),
      defaultPageSize,
      '--page-size',
      maxPageSize
    ),
    maxDocuments: boundedPositiveInteger(
      values.get('--max-documents'),
      defaultMaxDocuments,
      '--max-documents',
      hardMaxDocuments
    ),
    maxApplyActions: boundedPositiveInteger(
      values.get('--max-apply-actions'),
      defaultMaxApplyActions,
      '--max-apply-actions',
      hardMaxApplyActions
    ),
  };
}

function runtimeFirebaseIdentity(
  expectedProject: string
): RuntimeFirebaseIdentity | null {
  const direct = process.env.GOOGLE_CLOUD_PROJECT ?? process.env.GCLOUD_PROJECT;
  const firebaseConfig = process.env.FIREBASE_CONFIG;
  const expectedBucket = knownHanaStorageBucket(expectedProject);
  if (expectedBucket === null) return null;
  if (!firebaseConfig) {
    return direct === undefined
      ? null
      : { projectId: direct, storageBucket: expectedBucket };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(firebaseConfig);
  } catch (error: unknown) {
    const configError = new Error('FIREBASE_CONFIG is not valid JSON');
    (configError as Error & { cause?: unknown }).cause = error;
    throw configError;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const config = parsed as Record<string, unknown>;
  const configProjectId = typeof config.projectId === 'string'
    ? config.projectId
    : null;
  const storageBucket = typeof config.storageBucket === 'string'
    ? config.storageBucket
    : null;
  const projectId = direct ?? configProjectId;
  if (
    projectId === null ||
    (direct !== undefined && configProjectId !== null && direct !== configProjectId) ||
    storageBucket !== expectedBucket
  ) return null;
  return { projectId, storageBucket };
}

export function verifyStaleMediaTarget(options: CliOptions): string {
  if (!projectAllowlist.has(options.expectedProject)) {
    throw new Error('Expected project is not in the Hana project allowlist');
  }
  const runtimeIdentity = runtimeFirebaseIdentity(options.expectedProject);
  if (
    runtimeIdentity?.projectId !== options.expectedProject ||
    runtimeIdentity.storageBucket !== knownHanaStorageBucket(options.expectedProject)
  ) {
    throw new Error(
      'Runtime project or Storage bucket does not match --expected-project'
    );
  }
  if (
    process.env.FIRESTORE_EMULATOR_HOST ||
    process.env.FIREBASE_AUTH_EMULATOR_HOST ||
    process.env.FIREBASE_STORAGE_EMULATOR_HOST ||
    process.env.STORAGE_EMULATOR_HOST
  ) {
    throw new Error('This remediation tool refuses emulator environments');
  }

  if (options.apply) {
    if (options.confirmProject !== options.expectedProject) {
      throw new Error('--confirm-project must exactly match --expected-project');
    }
    if (!/^[a-f0-9]{64}$/.test(options.manifestDigest ?? '')) {
      throw new Error('--manifest-digest must be a 64-character SHA-256');
    }
    if (options.confirmActionCount === undefined) {
      throw new Error('--confirm-action-count is required in apply mode');
    }
    if (
      options.expectedProject === productionProjectId &&
      options.confirmProductionWrite !== productionConfirmationPhrase
    ) {
      throw new Error(
        `--confirm-production-write ${productionConfirmationPhrase} is required`
      );
    }
  } else if (
    options.confirmProject !== undefined ||
    options.confirmProductionWrite !== undefined ||
    options.confirmActionCount !== undefined ||
    options.manifestDigest !== undefined
  ) {
    throw new Error('Apply confirmation flags are invalid without --apply');
  }
  return runtimeIdentity.projectId;
}

async function scanQuery(params: {
  query: FirebaseFirestore.Query;
  pageSize: number;
  maxDocuments: number;
}): Promise<CollectionScan> {
  const records: StaleMediaAuditDocument[] = [];
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  while (true) {
    const remaining = params.maxDocuments - records.length;
    const requestSize = Math.min(params.pageSize, remaining + 1);
    let query = params.query.limit(requestSize);
    if (cursor !== undefined) query = query.startAfter(cursor);
    const snapshot = await query.get();
    if (snapshot.empty) return { records, complete: true };
    if (snapshot.docs.length > remaining) return { records, complete: false };
    records.push(...snapshot.docs.map((doc) => ({
      path: doc.ref.path,
      id: doc.id,
      data: doc.data(),
    })));
    cursor = snapshot.docs.at(-1);
    if (snapshot.docs.length < requestSize) return { records, complete: true };
  }
}

function referenceCandidates(
  records: StaleMediaAuditRecords
): { candidates: ReferenceCandidate[]; findings: StaleProfileMediaFinding[] } {
  const candidates: ReferenceCandidate[] = [];
  const findings: StaleProfileMediaFinding[] = [];
  const add = (
    kind: StaleReferenceKind,
    document: StaleMediaAuditDocument,
    fieldPath: string,
    directValue?: unknown
  ) => {
    const candidateValue = directValue ?? nestedValue(document.data, fieldPath);
    if (referenceOwnerUid(
      kind,
      document.path,
      fieldPath,
      document.data
    ) === null) {
      if (
        candidateValue !== undefined &&
        candidateValue !== null &&
        candidateValue !== ''
      ) {
        findings.push({
          code: 'malformed-reference-schema',
          location: `${document.path}#${fieldPath}`,
        });
      }
      return;
    }
    candidates.push({
      kind,
      documentPath: document.path,
      fieldPath,
      data: document.data,
      value: candidateValue,
    });
  };

  for (const post of records.posts) add('post-author', post, 'authorPhotoUrl');
  for (const comment of records.comments) {
    add('comment-author', comment, 'authorPhotoUrl');
  }
  for (const reply of records.replies) {
    add('reply-author', reply, 'authorPhotoUrl');
  }
  for (const block of records.blocks) add('block-target', block, 'photoUrl');
  for (const match of records.matches) {
    add('match-photoUrl', match, 'photoUrl');
    add('match-myPhotoUrl', match, 'myPhotoUrl');
    const partnerFor = match.data.partnerFor;
    if (partnerFor == null) continue;
    if (
      typeof partnerFor !== 'object' ||
      Array.isArray(partnerFor) ||
      Object.getPrototypeOf(partnerFor) !== Object.prototype
    ) {
      findings.push({
        code: 'malformed-reference-schema',
        location: `${match.path}#partnerFor`,
      });
      continue;
    }
    for (const [viewerUid, entry] of Object.entries(partnerFor)) {
      if (
        entry == null ||
        typeof entry !== 'object' ||
        Array.isArray(entry) ||
        Object.getPrototypeOf(entry) !== Object.prototype
      ) {
        findings.push({
          code: 'malformed-reference-schema',
          location: `${match.path}#partnerFor.${viewerUid}`,
        });
        continue;
      }
      add(
        'match-partnerFor-photoUrl',
        match,
        `partnerFor.${viewerUid}.photoUrl`,
        (entry as Record<string, unknown>).photoUrl
      );
    }
  }
  return { candidates, findings };
}

function ownerExpectationForNoPhoto(
  data: Record<string, unknown>
): OwnerExpectation | null {
  if (!Object.prototype.hasOwnProperty.call(data, 'photoUrls')) {
    return {
      kind: 'existing-no-current-photo',
      photoUrlsState: 'absent',
    };
  }
  if (data.photoUrls === null) {
    return {
      kind: 'existing-no-current-photo',
      photoUrlsState: 'null',
    };
  }
  if (Array.isArray(data.photoUrls) && data.photoUrls.length === 0) {
    return {
      kind: 'existing-no-current-photo',
      photoUrlsState: 'empty-array',
    };
  }
  return null;
}

function firstPartyBuckets(projectId: string): readonly string[] {
  const bucket = knownHanaStorageBucket(projectId);
  return bucket === null ? [] : [bucket];
}

function downstreamCanMigrateFirstPartyReference(
  value: string,
  ownerUid: string,
  currentPrimaryPath: string,
  projectId: string
): boolean {
  const objectPath = firstPartyFirebaseObjectPathFromUrl(
    value,
    firstPartyBuckets(projectId)
  );
  if (objectPath === null) return false;
  const canonicalState = classifyOwnerPhotoState([objectPath], ownerUid);
  if (canonicalState.kind === 'canonical') {
    return objectPath === currentPrimaryPath;
  }
  return objectPath.startsWith(`users/${ownerUid}/`) ||
    objectPath.startsWith(`profile_photos/${ownerUid}/`);
}

function addFindingOnce(
  target: Map<string, StaleProfileMediaFinding>,
  finding: StaleProfileMediaFinding
): void {
  target.set(`${finding.code}:${finding.location}`, finding);
}

export function classifyStaleMediaAuditRecords(params: {
  projectId: string;
  records: StaleMediaAuditRecords;
  authPresentWithoutUser: ReadonlySet<string>;
  authMissingOwners: ReadonlySet<string>;
}): StaleMediaClassification {
  const findings = new Map<string, StaleProfileMediaFinding>();
  const actions: StaleProfileMediaAction[] = [];
  const usersByUid = new Map(params.records.users.map((user) => [user.id, user]));
  const refs = referenceCandidates(params.records);
  refs.findings.forEach((finding) => addFindingOnce(findings, finding));

  for (const user of params.records.users) {
    if (!isSafeUid(user.id)) {
      addFindingOnce(findings, {
        code: 'invalid-current-photo-state',
        location: user.path,
      });
      continue;
    }
    const state = classifyOwnerPhotoState(user.data.photoUrls, user.id);
    if (state.kind === 'blocking-legacy-trusted-reupload') {
      addFindingOnce(findings, {
        code: 'legacy-current-photo-requires-trusted-reupload',
        location: user.path,
      });
    } else if (state.kind === 'blocking-invalid') {
      addFindingOnce(findings, {
        code: 'invalid-current-photo-state',
        location: user.path,
      });
    }
  }

  const deletePostPaths = new Set<string>();
  const referencedOwnerUids = new Set<string>();
  let deferredFirstPartyReferences = 0;
  for (const candidate of refs.candidates) {
    if (
      candidate.value === undefined ||
      candidate.value === null ||
      candidate.value === ''
    ) continue;
    const ownerUid = referenceOwnerUid(
      candidate.kind,
      candidate.documentPath,
      candidate.fieldPath,
      candidate.data
    );
    if (ownerUid === null || typeof candidate.value !== 'string') {
      addFindingOnce(findings, {
        code: 'malformed-reference-schema',
        location: `${candidate.documentPath}#${candidate.fieldPath}`,
      });
      continue;
    }
    referencedOwnerUids.add(ownerUid);
    const owner = usersByUid.get(ownerUid);
    if (owner !== undefined) {
      const state = classifyOwnerPhotoState(owner.data.photoUrls, ownerUid);
      if (state.kind === 'none') {
        const ownerExpectation = ownerExpectationForNoPhoto(owner.data);
        if (ownerExpectation === null) {
          addFindingOnce(findings, {
            code: 'invalid-current-photo-state',
            location: owner.path,
          });
          continue;
        }
        actions.push({
          actionType: 'clear-reference',
          referenceKind: candidate.kind,
          documentPath: candidate.documentPath,
          fieldPath: candidate.fieldPath,
          ownerUid,
          expectedValue: candidate.value,
          ownerExpectation,
        });
      } else if (
        state.kind === 'canonical' &&
        candidate.value !== state.canonicalPaths[0]
      ) {
        if (downstreamCanMigrateFirstPartyReference(
          candidate.value,
          ownerUid,
          state.canonicalPaths[0],
          params.projectId
        )) {
          deferredFirstPartyReferences += 1;
        } else {
          addFindingOnce(findings, {
            code: 'current-photo-reference-needs-path-migration',
            location: `${candidate.documentPath}#${candidate.fieldPath}`,
          });
        }
      }
      continue;
    }

    if (params.authPresentWithoutUser.has(ownerUid)) {
      addFindingOnce(findings, {
        code: 'missing-user-auth-record-still-exists',
        location: `${candidate.documentPath}#${candidate.fieldPath}`,
      });
      continue;
    }
    if (!params.authMissingOwners.has(ownerUid)) {
      addFindingOnce(findings, {
        code: 'scan-incomplete',
        location: `${candidate.documentPath}#${candidate.fieldPath}`,
      });
      continue;
    }

    if (candidate.kind === 'post-author') {
      if (!isExternalNonFirstPartyHttpsPhotoUrl(
        candidate.value,
        firstPartyBuckets(params.projectId)
      )) {
        addFindingOnce(findings, {
          code: 'orphan-post-not-external',
          location: candidate.documentPath,
        });
        continue;
      }
      actions.push({
        actionType: 'delete-orphan-post-tree',
        documentPath: candidate.documentPath,
        ownerUid,
        expectedAuthorPhotoUrl: candidate.value,
        ownerExpectation: { kind: 'missing-user-and-auth' },
      });
      deletePostPaths.add(candidate.documentPath);
      continue;
    }
    actions.push({
      actionType: 'clear-reference',
      referenceKind: candidate.kind,
      documentPath: candidate.documentPath,
      fieldPath: candidate.fieldPath,
      ownerUid,
      expectedValue: candidate.value,
      ownerExpectation: { kind: 'missing-user-and-auth' },
    });
  }

  const filteredActions = actions.filter((action) =>
    action.actionType === 'delete-orphan-post-tree' ||
    ![...deletePostPaths].some((postPath) =>
      action.documentPath.startsWith(`${postPath}/`)
    )
  );
  return {
    findings: [...findings.values()],
    actions: filteredActions,
    referencedOwnerUids,
    deletePostPaths,
    deferredFirstPartyReferences,
  };
}

function potentialMissingOwnerUids(
  records: StaleMediaAuditRecords
): Set<string> {
  const users = new Set(records.users.map((user) => user.id));
  const result = new Set<string>();
  const refs = referenceCandidates(records).candidates;
  for (const candidate of refs) {
    if (
      candidate.value === undefined ||
      candidate.value === null ||
      candidate.value === ''
    ) continue;
    const ownerUid = referenceOwnerUid(
      candidate.kind,
      candidate.documentPath,
      candidate.fieldPath,
      candidate.data
    );
    if (ownerUid !== null && !users.has(ownerUid)) result.add(ownerUid);
  }
  return result;
}

async function lookupMissingOwnersInAuth(
  auth: admin.auth.Auth,
  ownerUids: ReadonlySet<string>
): Promise<{ present: Set<string>; missing: Set<string> }> {
  const requested = [...ownerUids].sort();
  const present = new Set<string>();
  const missing = new Set<string>();
  for (let offset = 0; offset < requested.length; offset += authBatchSize) {
    const uids = requested.slice(offset, offset + authBatchSize);
    const result = await auth.getUsers(uids.map((uid) => ({ uid })));
    for (const user of result.users) {
      if (!uids.includes(user.uid) || present.has(user.uid)) {
        throw new Error('Auth lookup returned an unexpected or duplicate user');
      }
      present.add(user.uid);
    }
    for (const identifier of result.notFound) {
      const uid = 'uid' in identifier ? identifier.uid : undefined;
      if (!uid || !uids.includes(uid) || missing.has(uid)) {
        throw new Error('Auth lookup returned an unexpected missing identifier');
      }
      missing.add(uid);
    }
    for (const uid of uids) {
      if (present.has(uid) === missing.has(uid)) {
        throw new Error('Auth lookup did not classify every requested owner');
      }
    }
  }
  return { present, missing };
}

async function auditCurrentState(params: {
  db: FirebaseFirestore.Firestore;
  auth: admin.auth.Auth;
  options: Pick<CliOptions, 'expectedProject' | 'pageSize' | 'maxDocuments'>;
}): Promise<AuditResult> {
  const scan = async (query: FirebaseFirestore.Query) => scanQuery({
    query,
    pageSize: params.options.pageSize,
    maxDocuments: params.options.maxDocuments,
  });
  const [users, posts, comments, replies, blocks, matches] = await Promise.all([
    scan(params.db.collection('users')
      .orderBy(admin.firestore.FieldPath.documentId())),
    scan(params.db.collection('posts')
      .orderBy(admin.firestore.FieldPath.documentId())),
    scan(params.db.collectionGroup('comments')
      .orderBy(admin.firestore.FieldPath.documentId())),
    scan(params.db.collectionGroup('replies')
      .orderBy(admin.firestore.FieldPath.documentId())),
    scan(params.db.collectionGroup('blocks')
      .orderBy(admin.firestore.FieldPath.documentId())),
    scan(params.db.collection('matches')
      .orderBy(admin.firestore.FieldPath.documentId())),
  ]);
  const records: StaleMediaAuditRecords = {
    users: users.records,
    posts: posts.records,
    comments: comments.records,
    replies: replies.records,
    blocks: blocks.records,
    matches: matches.records,
  };
  const complete = [users, posts, comments, replies, blocks, matches]
    .every((source) => source.complete);
  let classification: StaleMediaClassification = {
    findings: [{ code: 'scan-incomplete', location: 'scan' }],
    actions: [],
    referencedOwnerUids: new Set(),
    deletePostPaths: new Set(),
    deferredFirstPartyReferences: 0,
  };
  let authState = { present: new Set<string>(), missing: new Set<string>() };
  if (complete) {
    const missingOwnerUids = potentialMissingOwnerUids(records);
    authState = await lookupMissingOwnersInAuth(params.auth, missingOwnerUids);
    classification = classifyStaleMediaAuditRecords({
      records,
      projectId: params.options.expectedProject,
      authPresentWithoutUser: authState.present,
      authMissingOwners: authState.missing,
    });
  }
  const scanCounts: StaleProfileMediaScanCounts = {
    users: users.records.length,
    posts: posts.records.length,
    comments: comments.records.length,
    replies: replies.records.length,
    blocks: blocks.records.length,
    matches: matches.records.length,
    referencedOwners: classification.referencedOwnerUids.size,
    missingOwnersCheckedInAuth: authState.present.size + authState.missing.size,
    missingOwnersConfirmed: authState.missing.size,
    authRecordsFoundWithoutUser: authState.present.size,
    deferredFirstPartyReferences:
      classification.deferredFirstPartyReferences,
  };
  return {
    manifest: buildStaleProfileMediaManifest({
      projectId: params.options.expectedProject,
      bucket: knownHanaStorageBucket(params.options.expectedProject)!,
      createdAt: new Date(),
      pageSize: params.options.pageSize,
      maxDocumentsPerSource: params.options.maxDocuments,
      scanComplete: complete,
      scanCounts,
      findings: classification.findings,
      actions: classification.actions,
    }),
    existingPostPaths: new Set(posts.records.map((post) => post.path)),
  };
}

export async function writeNewPrivateManifest(
  filePath: string,
  manifest: StaleProfileMediaManifest
): Promise<void> {
  const handle = await fs.open(filePath, 'wx', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  const stat = await fs.lstat(filePath);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o600) {
    throw new Error('New manifest was not created as a mode-0600 regular file');
  }
}

async function readPrivateManifest(
  filePath: string
): Promise<StaleProfileMediaManifest> {
  const stat = await fs.lstat(filePath);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    (stat.mode & 0o777) !== 0o600
  ) {
    throw new Error('Manifest must be a private regular file with mode 0600');
  }
  const raw = await fs.readFile(filePath, 'utf8');
  const parsed: unknown = JSON.parse(raw);
  if (!verifyStaleProfileMediaManifest(parsed)) {
    throw new Error('Manifest schema or digest verification failed');
  }
  return parsed;
}

async function verifyLiveStorageBucketIdentity(
  bucket: ReturnType<admin.storage.Storage['bucket']>,
  expectedProject: string
): Promise<void> {
  const expectedBucket = knownHanaStorageBucket(expectedProject);
  if (expectedBucket === null || bucket.name !== expectedBucket) {
    throw new Error('Configured Storage bucket is outside the Hana allowlist');
  }
  const [metadata] = await bucket.getMetadata();
  if (metadata.name !== expectedBucket) {
    throw new Error('Live Storage bucket does not match the expected Hana bucket');
  }
}

export function verifyManifestForApply(params: {
  manifest: StaleProfileMediaManifest;
  options: CliOptions;
  now?: Date;
}): void {
  const { manifest, options } = params;
  if (manifest.projectId !== options.expectedProject) {
    throw new Error('Manifest project does not match --expected-project');
  }
  if (manifest.bucket !== knownHanaStorageBucket(options.expectedProject)) {
    throw new Error('Manifest Storage bucket does not match the target project');
  }
  if (manifest.digest !== options.manifestDigest) {
    throw new Error('--manifest-digest does not match the verified manifest');
  }
  if (manifest.counts.actions !== options.confirmActionCount) {
    throw new Error('--confirm-action-count does not match the manifest');
  }
  if (!manifest.scan.complete || manifest.findings.length > 0) {
    throw new Error('Manifest is incomplete or contains blocking findings');
  }
  if (manifest.actions.length > options.maxApplyActions) {
    throw new Error('Manifest exceeds --max-apply-actions');
  }
  const now = (params.now ?? new Date()).getTime();
  const createdAt = Date.parse(manifest.createdAt);
  if (createdAt < now - manifestMaxAgeMillis) {
    throw new Error('Manifest is older than 24 hours');
  }
  if (createdAt > now + manifestMaxFutureSkewMillis) {
    throw new Error('Manifest creation time is too far in the future');
  }
}

async function expectAuthMissing(auth: admin.auth.Auth, uid: string): Promise<void> {
  try {
    await auth.getUser(uid);
  } catch (error: unknown) {
    const code = error !== null && typeof error === 'object'
      ? (error as { code?: unknown }).code
      : undefined;
    if (code === 'auth/user-not-found') return;
    throw error;
  }
  throw new Error('Missing owner acquired an Auth record during apply');
}

function exactNoPhotoOwnerExpectation(
  data: Record<string, unknown>,
  expectation: Extract<OwnerExpectation, {
    kind: 'existing-no-current-photo';
  }>
): boolean {
  const hasPhotoUrls = Object.prototype.hasOwnProperty.call(data, 'photoUrls');
  if (expectation.photoUrlsState === 'absent') return !hasPhotoUrls;
  if (expectation.photoUrlsState === 'null') {
    return hasPhotoUrls && data.photoUrls === null;
  }
  return hasPhotoUrls && Array.isArray(data.photoUrls) && data.photoUrls.length === 0;
}

async function applyClearReferenceGroup(params: {
  db: FirebaseFirestore.Firestore;
  auth: admin.auth.Auth;
  actions: ClearStaleProfileMediaReferenceAction[];
}): Promise<'updated' | 'already-cleared'> {
  const [first] = params.actions;
  const missingOwnerUids = new Set(params.actions
    .filter((action) => action.ownerExpectation.kind === 'missing-user-and-auth')
    .map((action) => action.ownerUid));
  for (const uid of missingOwnerUids) await expectAuthMissing(params.auth, uid);

  const result = await params.db.runTransaction(async (transaction) => {
    const documentRef = params.db.doc(first.documentPath);
    const ownerUids = [...new Set(params.actions.map((action) => action.ownerUid))];
    const snapshots = await Promise.all([
      transaction.get(documentRef),
      ...ownerUids.map((uid) =>
        transaction.get(params.db.collection('users').doc(uid))
      ),
    ]);
    const document = snapshots[0];
    if (!document.exists) {
      throw new Error('Reference document disappeared during apply');
    }
    const data = document.data() ?? {};
    const ownerSnapshots = new Map(ownerUids.map((uid, index) => [
      uid,
      snapshots[index + 1],
    ]));

    for (const action of params.actions) {
      const ownerSnapshot = ownerSnapshots.get(action.ownerUid)!;
      if (action.ownerExpectation.kind === 'missing-user-and-auth') {
        if (ownerSnapshot.exists) {
          throw new Error('Missing owner user document reappeared during apply');
        }
      } else {
        if (!ownerSnapshot.exists) {
          throw new Error('Existing owner disappeared during apply');
        }
        const ownerData = ownerSnapshot.data() ?? {};
        if (
          !exactNoPhotoOwnerExpectation(ownerData, action.ownerExpectation) ||
          classifyOwnerPhotoState(ownerData.photoUrls, action.ownerUid).kind !== 'none'
        ) {
          throw new Error('Owner current-photo state changed after audit');
        }
      }
      if (referenceOwnerUid(
        action.referenceKind,
        action.documentPath,
        action.fieldPath,
        data
      ) !== action.ownerUid) {
        throw new Error('Reference owner relation changed after audit');
      }
      const current = nestedValue(data, action.fieldPath);
      if (current !== action.expectedValue && current !== '') {
        throw new Error('Reference value changed after audit');
      }
    }

    const pending = params.actions.filter(
      (action) => nestedValue(data, action.fieldPath) !== ''
    );
    if (pending.length === 0) return 'already-cleared' as const;
    const [firstPending, ...remaining] = pending;
    transaction.update(
      documentRef,
      new admin.firestore.FieldPath(...firstPending.fieldPath.split('.')),
      '',
      ...remaining.flatMap((action) => [
        new admin.firestore.FieldPath(...action.fieldPath.split('.')),
        '',
      ])
    );
    return 'updated' as const;
  });
  for (const uid of missingOwnerUids) await expectAuthMissing(params.auth, uid);
  return result;
}

async function applyDeleteOrphanPostTree(params: {
  db: FirebaseFirestore.Firestore;
  auth: admin.auth.Auth;
  projectId: string;
  action: Extract<StaleProfileMediaAction, {
    actionType: 'delete-orphan-post-tree';
  }>;
}): Promise<'deleted' | 'already-deleted'> {
  const { action } = params;
  await expectAuthMissing(params.auth, action.ownerUid);
  const postRef = params.db.doc(action.documentPath);
  const userRef = params.db.collection('users').doc(action.ownerUid);
  const rootResult = await params.db.runTransaction(async (transaction) => {
    const [post, user] = await Promise.all([
      transaction.get(postRef),
      transaction.get(userRef),
    ]);
    if (user.exists) {
      throw new Error('Orphan post owner user document reappeared during apply');
    }
    if (!post.exists) return 'already-deleted' as const;
    const data = post.data() ?? {};
    if (
      referenceOwnerUid(
        'post-author',
        action.documentPath,
        'authorPhotoUrl',
        data
      ) !== action.ownerUid ||
      data.authorPhotoUrl !== action.expectedAuthorPhotoUrl ||
      !isExternalNonFirstPartyHttpsPhotoUrl(
        data.authorPhotoUrl,
        firstPartyBuckets(params.projectId)
      )
    ) {
      throw new Error('Orphan post owner or audited photo changed after audit');
    }
    transaction.delete(postRef);
    return 'deleted' as const;
  });

  if (rootResult === 'already-deleted') {
    // Without a durable receipt proving that this tool deleted the audited
    // root, descendants could belong to a different repair/recreation. A fresh
    // manifest is required instead of deleting them by path alone.
    throw new Error(
      'Orphan post root is already absent; descendant cleanup lacks a durable proof'
    );
  }

  // Root deletion prevents new callable mutations. Recursive cleanup is scoped
  // strictly to this audited post and its like mirror; reports stay untouched.
  await params.db.recursiveDelete(postRef);
  await params.db.recursiveDelete(
    params.db.collection('post_likes').doc(postRef.id)
  );
  const [postAfter, likesAfter] = await Promise.all([
    postRef.get(),
    params.db.collection('post_likes').doc(postRef.id).get(),
  ]);
  if (postAfter.exists || likesAfter.exists) {
    throw new Error('Orphan post tree zero verification failed');
  }
  const [commentsAfter, likesChildrenAfter] = await Promise.all([
    postRef.collection('comments').limit(1).get(),
    params.db.collection('post_likes').doc(postRef.id)
      .collection('likes').limit(1).get(),
  ]);
  if (!commentsAfter.empty || !likesChildrenAfter.empty) {
    throw new Error('Orphan post descendant zero verification failed');
  }
  await expectAuthMissing(params.auth, action.ownerUid);
  return rootResult;
}

function actionIsInsideApprovedDeletedPost(
  action: StaleProfileMediaAction,
  deletedPostPaths: ReadonlySet<string>
): boolean {
  return [...deletedPostPaths].some((postPath) =>
    action.documentPath.startsWith(`${postPath}/`)
  );
}

function findingIsInsideApprovedDeletedPost(
  finding: StaleProfileMediaFinding,
  deletedPostPaths: ReadonlySet<string>
): boolean {
  return [...deletedPostPaths].some((postPath) =>
    finding.location.startsWith(`${postPath}/`)
  );
}

async function applyManifest(params: {
  db: FirebaseFirestore.Firestore;
  auth: admin.auth.Auth;
  options: CliOptions;
  manifest: StaleProfileMediaManifest;
}): Promise<{
  documentsUpdated: number;
  documentsAlreadyCleared: number;
  postTreesDeleted: number;
  postTreesAlreadyDeleted: number;
}> {
  const current = await auditCurrentState({
    db: params.db,
    auth: params.auth,
    options: params.options,
  });
  if (!current.manifest.scan.complete) {
    throw new Error('Apply re-audit is incomplete');
  }
  const manifestKeys = new Set(params.manifest.actions.map(staleProfileMediaActionKey));
  const approvedDeletedPostPaths = new Set(params.manifest.actions
    .filter((action) => action.actionType === 'delete-orphan-post-tree')
    .filter((action) => !current.existingPostPaths.has(action.documentPath))
    .map((action) => action.documentPath));
  const unexpectedFindings = current.manifest.findings.filter(
    (finding) => !findingIsInsideApprovedDeletedPost(
      finding,
      approvedDeletedPostPaths
    )
  );
  if (unexpectedFindings.length > 0) {
    throw new Error('Apply re-audit found blocking findings');
  }
  for (const action of current.manifest.actions) {
    if (
      actionIsInsideApprovedDeletedPost(action, approvedDeletedPostPaths) ||
      manifestKeys.has(staleProfileMediaActionKey(action))
    ) continue;
    throw new Error('Apply re-audit found an unapproved stale-media action');
  }

  let documentsUpdated = 0;
  let documentsAlreadyCleared = 0;
  const clearGroups = new Map<string, ClearStaleProfileMediaReferenceAction[]>();
  for (const action of params.manifest.actions) {
    if (action.actionType !== 'clear-reference') continue;
    const group = clearGroups.get(action.documentPath) ?? [];
    group.push(action);
    clearGroups.set(action.documentPath, group);
  }
  for (const actions of clearGroups.values()) {
    const result = await applyClearReferenceGroup({
      db: params.db,
      auth: params.auth,
      actions,
    });
    if (result === 'updated') documentsUpdated += 1;
    else documentsAlreadyCleared += 1;
  }

  let postTreesDeleted = 0;
  let postTreesAlreadyDeleted = 0;
  for (const action of params.manifest.actions) {
    if (action.actionType !== 'delete-orphan-post-tree') continue;
    const result = await applyDeleteOrphanPostTree({
      db: params.db,
      auth: params.auth,
      projectId: params.options.expectedProject,
      action,
    });
    if (result === 'deleted') postTreesDeleted += 1;
    else postTreesAlreadyDeleted += 1;
  }

  const verified = await auditCurrentState({
    db: params.db,
    auth: params.auth,
    options: params.options,
  });
  if (
    !verified.manifest.scan.complete ||
    verified.manifest.findings.length !== 0 ||
    verified.manifest.actions.length !== 0
  ) {
    throw new Error('Post-apply re-audit did not reach zero findings/actions');
  }
  return {
    documentsUpdated,
    documentsAlreadyCleared,
    postTreesDeleted,
    postTreesAlreadyDeleted,
  };
}

async function main(argv: string[]): Promise<void> {
  const parsed = parseStaleMediaOptions(argv);
  if (parsed === 'help') {
    console.log(usage().trim());
    return;
  }
  const options = parsed;
  const projectId = verifyStaleMediaTarget(options);

  // Apply validates the private file, strict schema, digest, count, age and
  // target before Firebase initialization or any live read.
  const manifest = options.apply
    ? await readPrivateManifest(options.manifestPath)
    : null;
  if (manifest !== null) verifyManifestForApply({ manifest, options });

  admin.initializeApp({
    projectId,
    storageBucket: knownHanaStorageBucket(projectId)!,
  });
  const db = admin.firestore();
  const auth = admin.auth();
  await verifyLiveStorageBucketIdentity(admin.storage().bucket(), projectId);
  if (!options.apply) {
    const audit = await auditCurrentState({ db, auth, options });
    await writeNewPrivateManifest(options.manifestPath, audit.manifest);
    console.log(JSON.stringify({
      mode: 'dry-run',
      projectId,
      complete: audit.manifest.scan.complete,
      digest: audit.manifest.digest,
      counts: audit.manifest.counts,
      scanCounts: audit.manifest.scan.counts,
    }));
    if (!audit.manifest.scan.complete || audit.manifest.findings.length > 0) {
      process.exitCode = 2;
    }
    return;
  }

  const result = await applyManifest({
    db,
    auth,
    options,
    manifest: manifest!,
  });
  console.log(JSON.stringify({
    mode: 'apply',
    projectId,
    digest: manifest!.digest,
    confirmedActions: manifest!.counts.actions,
    ...result,
    postAudit: { findings: 0, actions: 0 },
  }));
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Unknown failure';
    console.error(`Stale profile media remediation aborted: ${message}`);
    process.exitCode = 1;
  });
}
