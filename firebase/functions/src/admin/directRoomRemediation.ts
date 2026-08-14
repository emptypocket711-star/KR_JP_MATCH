import { promises as fs } from 'node:fs';
import path from 'node:path';

import * as admin from 'firebase-admin';

import {
  PARTICIPANT_ROOM_QUERY_LIMIT,
  normalizeDirectRoomParticipants,
  participantRoomScanIsComplete,
} from '../directRoomMigrationPolicy';
import {
  ClearStaleClosedPointerCandidate,
  CloseUnavailableRoomCandidate,
  DirectRoomRemediationCandidate,
  DirectRoomRemediationClassification,
  DirectRoomRemediationManifest,
  ParticipantAccountAuditRecord,
  RemediationChatPairAuditRecord,
  RemediationMatchAuditRecord,
  actionKey,
  buildDirectRoomRemediationManifest,
  classifyDirectRoomRemediation,
  createRemediationIdentifierProtector,
  participantAccountState,
  remediationManifestActionForCandidate,
  verifyDirectRoomRemediationManifest,
} from '../directRoomRemediationPolicy';

const PROJECT_ALLOWLIST = new Set([
  'hana-e2ee6',
  'hana-production-tokyo',
]);
const PRODUCTION_PROJECT_ID = 'hana-production-tokyo';
const DEFAULT_PAGE_SIZE = 200;
const MAX_PAGE_SIZE = 500;
const DEFAULT_MAX_DOCUMENTS = 10_000;
const HARD_MAX_DOCUMENTS = 1_000_000;
const DEFAULT_APPLY_BATCH_SIZE = 20;
const MAX_APPLY_BATCH_SIZE = 50;
const DEFAULT_MAX_APPLY_ACTIONS = 2_000;
const HARD_MAX_APPLY_ACTIONS = 10_000;
const GET_ALL_CHUNK_SIZE = 100;

interface CliOptions {
  apply: boolean;
  expectedProject: string;
  confirmProject?: string;
  confirmProductionWrite?: string;
  confirmCloseCount?: number;
  confirmPointerCleanupCount?: number;
  manifestPath: string;
  manifestDigest?: string;
  hashKeyPath: string;
  pageSize: number;
  maxDocuments: number;
  applyBatchSize: number;
  maxApplyActions: number;
  allowEmulator: boolean;
}

interface CollectionScan<T> {
  records: T[];
  complete: boolean;
}

interface FullAudit {
  activeMatches: CollectionScan<RemediationMatchAuditRecord>;
  chatPairs: CollectionScan<RemediationChatPairAuditRecord>;
  participantAccounts: ParticipantAccountAuditRecord[];
  participantReferencesRequested: number;
  participantDocumentsFound: number;
  referencedClosedMatches: RemediationMatchAuditRecord[];
  closedMatchReferencesRequested: number;
  closedMatchDocumentsFound: number;
  classification: DirectRoomRemediationClassification;
  complete: boolean;
}

function usage(): string {
  return `
Direct-room staging remediation (dry-run by default).
This tool only closes a unique active room with exactly one missing/deleted
participant and no pair pointer, or removes stale closed fields from one exact
active pointer after validating its historical room and one of the narrowly
supported close-reason shapes, including an absent legacy pointer reason with
a retained non-empty historical reason.

Audit:
  GOOGLE_CLOUD_PROJECT=hana-e2ee6 \\
  node lib/admin/directRoomRemediation.js \\
    --expected-project hana-e2ee6 \\
    --manifest /secure/path/direct-room-remediation.json \\
    --hash-key-file /secure/path/direct-room-hmac.key

Apply:
  GOOGLE_CLOUD_PROJECT=hana-e2ee6 \\
  node lib/admin/directRoomRemediation.js \\
    --apply \\
    --expected-project hana-e2ee6 \\
    --confirm-project hana-e2ee6 \\
    --confirm-close-count <exact-dry-run-count> \\
    --confirm-pointer-cleanup-count <exact-dry-run-count> \\
    --manifest /secure/path/direct-room-remediation.json \\
    --manifest-digest <64-char-sha256> \\
    --hash-key-file /secure/path/direct-room-hmac.key

Production apply additionally requires:
  --confirm-production-write hana-production-tokyo

Optional bounds:
  --page-size <1..${MAX_PAGE_SIZE}>
  --max-documents <1..${HARD_MAX_DOCUMENTS}>
  --apply-batch-size <1..${MAX_APPLY_BATCH_SIZE}>
  --max-apply-actions <1..${HARD_MAX_APPLY_ACTIONS}>
  --allow-emulator (audit only; apply is always refused)
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

function boundedCount(
  raw: string | undefined,
  flag: string
): number | undefined {
  if (raw === undefined) return undefined;
  if (!/^\d+$/.test(raw)) throw new Error(`${flag} must be an integer`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0 || value > HARD_MAX_APPLY_ACTIONS) {
    throw new Error(`${flag} must be between 0 and ${HARD_MAX_APPLY_ACTIONS}`);
  }
  return value;
}

function parseCliOptions(argv: string[]): CliOptions | 'help' {
  const values = new Map<string, string>();
  const booleans = new Set<string>();
  const valueFlags = new Set([
    '--expected-project',
    '--confirm-project',
    '--confirm-production-write',
    '--confirm-close-count',
    '--confirm-pointer-cleanup-count',
    '--manifest',
    '--manifest-digest',
    '--hash-key-file',
    '--page-size',
    '--max-documents',
    '--apply-batch-size',
    '--max-apply-actions',
  ]);
  const booleanFlags = new Set(['--apply', '--allow-emulator', '--help']);
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (valueFlags.has(flag)) {
      if (values.has(flag)) throw new Error(`${flag} was provided more than once`);
      values.set(flag, valueAfter(argv, index, flag));
      index += 1;
      continue;
    }
    if (booleanFlags.has(flag)) {
      if (booleans.has(flag)) throw new Error(`${flag} was provided more than once`);
      booleans.add(flag);
      continue;
    }
    throw new Error(`Unknown argument: ${flag}`);
  }
  if (booleans.has('--help')) return 'help';

  const expectedProject = values.get('--expected-project');
  const manifestPath = values.get('--manifest');
  const hashKeyPath = values.get('--hash-key-file');
  if (!expectedProject || !manifestPath || !hashKeyPath) {
    throw new Error(
      '--expected-project, --manifest, and --hash-key-file are required'
    );
  }
  return {
    apply: booleans.has('--apply'),
    expectedProject,
    confirmProject: values.get('--confirm-project'),
    confirmProductionWrite: values.get('--confirm-production-write'),
    confirmCloseCount: boundedCount(
      values.get('--confirm-close-count'),
      '--confirm-close-count'
    ),
    confirmPointerCleanupCount: boundedCount(
      values.get('--confirm-pointer-cleanup-count'),
      '--confirm-pointer-cleanup-count'
    ),
    manifestPath: path.resolve(manifestPath),
    manifestDigest: values.get('--manifest-digest'),
    hashKeyPath: path.resolve(hashKeyPath),
    pageSize: boundedPositiveInteger(
      values.get('--page-size'),
      DEFAULT_PAGE_SIZE,
      '--page-size',
      MAX_PAGE_SIZE
    ),
    maxDocuments: boundedPositiveInteger(
      values.get('--max-documents'),
      DEFAULT_MAX_DOCUMENTS,
      '--max-documents',
      HARD_MAX_DOCUMENTS
    ),
    applyBatchSize: boundedPositiveInteger(
      values.get('--apply-batch-size'),
      DEFAULT_APPLY_BATCH_SIZE,
      '--apply-batch-size',
      MAX_APPLY_BATCH_SIZE
    ),
    maxApplyActions: boundedPositiveInteger(
      values.get('--max-apply-actions'),
      DEFAULT_MAX_APPLY_ACTIONS,
      '--max-apply-actions',
      HARD_MAX_APPLY_ACTIONS
    ),
    allowEmulator: booleans.has('--allow-emulator'),
  };
}

function runtimeProjectId(): string | null {
  const direct = process.env.GOOGLE_CLOUD_PROJECT ?? process.env.GCLOUD_PROJECT;
  if (direct) return direct;
  const firebaseConfig = process.env.FIREBASE_CONFIG;
  if (!firebaseConfig) return null;
  try {
    const decoded = JSON.parse(firebaseConfig) as { projectId?: unknown };
    return typeof decoded.projectId === 'string' ? decoded.projectId : null;
  } catch {
    throw new Error('FIREBASE_CONFIG is not valid JSON');
  }
}

function verifyTarget(options: CliOptions): string {
  if (!PROJECT_ALLOWLIST.has(options.expectedProject)) {
    throw new Error('Expected project is not in the Hana project allowlist');
  }
  const runtimeProject = runtimeProjectId();
  if (!runtimeProject) {
    throw new Error(
      'GOOGLE_CLOUD_PROJECT or GCLOUD_PROJECT must explicitly select the target project'
    );
  }
  if (runtimeProject !== options.expectedProject) {
    throw new Error('Runtime project does not match --expected-project');
  }
  const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
  if (emulatorHost && !options.allowEmulator) {
    throw new Error(
      'FIRESTORE_EMULATOR_HOST is set; pass --allow-emulator for an explicit audit'
    );
  }
  if (emulatorHost && options.apply) {
    throw new Error('Apply mode is disabled while FIRESTORE_EMULATOR_HOST is set');
  }
  if (options.apply) {
    if (options.confirmProject !== options.expectedProject) {
      throw new Error(
        '--confirm-project must exactly match --expected-project in apply mode'
      );
    }
    if (!/^[a-f0-9]{64}$/.test(options.manifestDigest ?? '')) {
      throw new Error('--manifest-digest must be a 64-character SHA-256');
    }
    if (
      options.confirmCloseCount === undefined ||
      options.confirmPointerCleanupCount === undefined
    ) {
      throw new Error(
        'Apply requires exact close and pointer-cleanup count confirmations'
      );
    }
    if (
      options.expectedProject === PRODUCTION_PROJECT_ID &&
      options.confirmProductionWrite !== PRODUCTION_PROJECT_ID
    ) {
      throw new Error(
        '--confirm-production-write hana-production-tokyo is required for production apply'
      );
    }
  } else if (
    options.confirmProject !== undefined ||
    options.confirmProductionWrite !== undefined ||
    options.confirmCloseCount !== undefined ||
    options.confirmPointerCleanupCount !== undefined ||
    options.manifestDigest !== undefined
  ) {
    throw new Error('Apply confirmation flags are invalid without --apply');
  }
  return runtimeProject;
}

async function readIdentifierKey(filePath: string): Promise<Buffer> {
  const stat = await fs.stat(filePath);
  if (!stat.isFile()) throw new Error('Identifier HMAC key path is not a file');
  if ((stat.mode & 0o077) !== 0) {
    throw new Error('Identifier HMAC key file must not be group/world accessible');
  }
  if (stat.size > 4096) {
    throw new Error('Identifier HMAC key file is unexpectedly large');
  }
  const key = await fs.readFile(filePath);
  if (key.length < 32) {
    throw new Error('Identifier HMAC key file must contain at least 32 bytes');
  }
  return key;
}

export async function writeNewManifest(
  filePath: string,
  manifest: DirectRoomRemediationManifest
): Promise<void> {
  await fs.writeFile(filePath, `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });
}

async function readManifest(
  filePath: string
): Promise<DirectRoomRemediationManifest> {
  const stat = await fs.stat(filePath);
  if (!stat.isFile() || (stat.mode & 0o777) !== 0o600) {
    throw new Error('Manifest must be a private regular file with mode 0600');
  }
  const parsed = JSON.parse(await fs.readFile(filePath, 'utf8')) as unknown;
  if (!verifyDirectRoomRemediationManifest(parsed)) {
    throw new Error('Manifest schema or digest verification failed');
  }
  return parsed;
}

async function scanQuery<T>(params: {
  query: FirebaseFirestore.Query;
  pageSize: number;
  maxDocuments: number;
  map: (doc: FirebaseFirestore.QueryDocumentSnapshot) => T;
}): Promise<CollectionScan<T>> {
  const records: T[] = [];
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  while (true) {
    const remaining = params.maxDocuments - records.length;
    const requestSize = Math.min(params.pageSize, remaining + 1);
    let query = params.query.limit(requestSize);
    if (cursor !== undefined) query = query.startAfter(cursor);
    const snapshot = await query.get();
    if (snapshot.empty) return { records, complete: true };
    if (snapshot.docs.length > remaining) return { records, complete: false };
    records.push(...snapshot.docs.map(params.map));
    cursor = snapshot.docs.at(-1);
    if (snapshot.docs.length < requestSize) return { records, complete: true };
  }
}

function matchAuditRecord(
  snapshot: FirebaseFirestore.DocumentSnapshot
): RemediationMatchAuditRecord {
  const data = snapshot.data() ?? {};
  return {
    id: snapshot.id,
    userIds: data.userIds,
    isActive: data.isActive,
    pairKey: data.pairKey,
    directRoomVersion: data.directRoomVersion,
    hiddenFor: data.hiddenFor,
    closedBy: data.closedBy,
    closedReason: data.closedReason,
  };
}

async function getAllInChunks(
  db: FirebaseFirestore.Firestore,
  refs: FirebaseFirestore.DocumentReference[]
): Promise<FirebaseFirestore.DocumentSnapshot[]> {
  const snapshots: FirebaseFirestore.DocumentSnapshot[] = [];
  for (let offset = 0; offset < refs.length; offset += GET_ALL_CHUNK_SIZE) {
    snapshots.push(...await db.getAll(...refs.slice(offset, offset + GET_ALL_CHUNK_SIZE)));
  }
  return snapshots;
}

async function auditCurrentState(
  db: FirebaseFirestore.Firestore,
  options: Pick<CliOptions, 'pageSize' | 'maxDocuments'>
): Promise<FullAudit> {
  const activeMatches = await scanQuery<RemediationMatchAuditRecord>({
    query: db.collection('matches')
      .where('isActive', '==', true)
      .orderBy(admin.firestore.FieldPath.documentId()),
    pageSize: options.pageSize,
    maxDocuments: options.maxDocuments,
    map: (doc) => matchAuditRecord(doc),
  });
  const chatPairs = await scanQuery<RemediationChatPairAuditRecord>({
    query: db.collection('chatPairs')
      .orderBy(admin.firestore.FieldPath.documentId()),
    pageSize: options.pageSize,
    maxDocuments: options.maxDocuments,
    map: (doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        userIds: data.userIds,
        pairKey: data.pairKey,
        activeMatchId: data.activeMatchId,
        closedMatchId: data.closedMatchId,
        closedReason: data.closedReason,
      };
    },
  });

  const participantIds = Array.from(new Set(activeMatches.records.flatMap((match) => {
    const normalized = normalizeDirectRoomParticipants(match.userIds);
    return normalized?.userIds ?? [];
  }))).sort();
  const participantSnapshots = await getAllInChunks(
    db,
    participantIds.map((uid) => db.collection('users').doc(uid))
  );
  const participantAccounts = participantSnapshots.map((snapshot) => ({
    uid: snapshot.id,
    state: participantAccountState({
      exists: snapshot.exists,
      userData: snapshot.data(),
    }),
  }));

  const closedMatchIds = Array.from(new Set(chatPairs.records.flatMap((pointer) =>
    typeof pointer.closedMatchId === 'string' && pointer.closedMatchId.length > 0
      ? [pointer.closedMatchId]
      : []
  ))).sort();
  const closedSnapshots = await getAllInChunks(
    db,
    closedMatchIds.map((id) => db.collection('matches').doc(id))
  );
  const referencedClosedMatches = closedSnapshots
    .filter((snapshot) => snapshot.exists)
    .map(matchAuditRecord);
  const classification = classifyDirectRoomRemediation({
    activeMatches: activeMatches.records,
    chatPairs: chatPairs.records,
    participantAccounts,
    referencedClosedMatches,
  });
  return {
    activeMatches,
    chatPairs,
    participantAccounts,
    participantReferencesRequested: participantIds.length,
    participantDocumentsFound: participantSnapshots.filter((snap) => snap.exists).length,
    referencedClosedMatches,
    closedMatchReferencesRequested: closedMatchIds.length,
    closedMatchDocumentsFound: referencedClosedMatches.length,
    classification,
    complete: activeMatches.complete && chatPairs.complete,
  };
}

function manifestForAudit(params: {
  projectId: string;
  audit: FullAudit;
  options: Pick<CliOptions, 'pageSize' | 'maxDocuments'>;
  protector: ReturnType<typeof createRemediationIdentifierProtector>;
}): DirectRoomRemediationManifest {
  return buildDirectRoomRemediationManifest({
    projectId: params.projectId,
    createdAt: new Date(),
    pageSize: params.options.pageSize,
    maxDocumentsPerCollection: params.options.maxDocuments,
    scanComplete: params.audit.complete,
    participantReferencesRequested: params.audit.participantReferencesRequested,
    participantDocumentsFound: params.audit.participantDocumentsFound,
    closedMatchReferencesRequested: params.audit.closedMatchReferencesRequested,
    closedMatchDocumentsFound: params.audit.closedMatchDocumentsFound,
    classification: params.audit.classification,
    protector: params.protector,
  });
}

function validateManifestForApply(params: {
  manifest: DirectRoomRemediationManifest;
  options: CliOptions;
  protector: ReturnType<typeof createRemediationIdentifierProtector>;
}): void {
  const { manifest, options } = params;
  const closeActions = manifest.actions.filter(
    (action) => action.kind === 'close-unavailable-room'
  ).length;
  const pointerActions = manifest.actions.filter(
    (action) => action.kind === 'clear-stale-closed-pointer'
  ).length;
  if (
    manifest.projectId !== options.expectedProject ||
    manifest.identifierProtection.keyId !== params.protector.keyId ||
    manifest.scan.complete !== true
  ) {
    throw new Error('Manifest target, HMAC key, or scan completeness is invalid');
  }
  if (manifest.digest !== options.manifestDigest) {
    throw new Error('--manifest-digest does not match the verified manifest');
  }
  if (
    manifest.scan.pageSize !== options.pageSize ||
    manifest.scan.maxDocumentsPerCollection !== options.maxDocuments
  ) {
    throw new Error('Apply scan bounds must exactly match the audit manifest');
  }
  if (
    closeActions !== manifest.counts.closeUnavailableRooms ||
    pointerActions !== manifest.counts.clearStaleClosedPointers ||
    closeActions !== options.confirmCloseCount ||
    pointerActions !== options.confirmPointerCleanupCount
  ) {
    throw new Error('Manifest actions do not match exact count confirmations');
  }
  if (manifest.actions.length > options.maxApplyActions) {
    throw new Error(`Manifest exceeds --max-apply-actions (${options.maxApplyActions})`);
  }
}

function exactParticipants(left: unknown, right: unknown): boolean {
  const normalizedLeft = normalizeDirectRoomParticipants(left);
  const normalizedRight = normalizeDirectRoomParticipants(right);
  return normalizedLeft !== null && normalizedRight !== null &&
    normalizedLeft.participantKey === normalizedRight.participantKey;
}

function validHiddenFor(value: unknown, requireEmpty: boolean): boolean {
  if (value === undefined) return true;
  return Array.isArray(value) &&
    value.every((entry) => typeof entry === 'string') &&
    (!requireEmpty || value.length === 0);
}

function exactClosedReason(
  value: unknown,
  expected: string | undefined
): boolean {
  return expected === undefined
    ? value === undefined
    : value === expected;
}

function accountState(snapshot: FirebaseFirestore.DocumentSnapshot) {
  return participantAccountState({
    exists: snapshot.exists,
    userData: snapshot.data(),
  });
}

async function applyCloseUnavailableRoom(params: {
  db: FirebaseFirestore.Firestore;
  candidate: CloseUnavailableRoomCandidate;
}): Promise<void> {
  const expectedParticipants = JSON.parse(params.candidate.participantKey) as unknown;
  const normalized = normalizeDirectRoomParticipants(expectedParticipants);
  if (normalized === null || normalized.pairKey !== params.candidate.pairKey) {
    throw new Error('Close candidate identity failed validation');
  }
  const matchRef = params.db.collection('matches').doc(params.candidate.matchId);
  const pointerRef = params.db.collection('chatPairs').doc(params.candidate.pairKey);
  const userRefs = normalized.userIds.map((uid) => params.db.collection('users').doc(uid));
  const activeRoomsQuery = params.db.collection('matches')
    .where('userIds', 'array-contains', normalized.userIds[0])
    .limit(PARTICIPANT_ROOM_QUERY_LIMIT);
  const participantPointersQuery = params.db.collection('chatPairs')
    .where('userIds', 'array-contains', normalized.userIds[0])
    .limit(PARTICIPANT_ROOM_QUERY_LIMIT);
  const pairPointersQuery = params.db.collection('chatPairs')
    .where('pairKey', '==', normalized.pairKey).limit(2);
  const activePointersQuery = params.db.collection('chatPairs')
    .where('activeMatchId', '==', params.candidate.matchId).limit(2);
  const closedPointersQuery = params.db.collection('chatPairs')
    .where('closedMatchId', '==', params.candidate.matchId).limit(2);

  await params.db.runTransaction(async (transaction) => {
    const [
      matchSnapshot,
      pointerSnapshot,
      firstUser,
      secondUser,
      activeRooms,
      participantPointers,
      pairPointers,
      activePointers,
      closedPointers,
    ] = await Promise.all([
      transaction.get(matchRef),
      transaction.get(pointerRef),
      transaction.get(userRefs[0]),
      transaction.get(userRefs[1]),
      transaction.get(activeRoomsQuery),
      transaction.get(participantPointersQuery),
      transaction.get(pairPointersQuery),
      transaction.get(activePointersQuery),
      transaction.get(closedPointersQuery),
    ]);
    if (!matchSnapshot.exists) throw new Error('Close candidate disappeared');
    if (
      !participantRoomScanIsComplete(activeRooms.size) ||
      !participantRoomScanIsComplete(participantPointers.size)
    ) {
      throw new Error('Close candidate transaction scan hit its safety bound');
    }
    const exactActiveRooms = activeRooms.docs.filter((doc) =>
      doc.data().isActive === true &&
      exactParticipants(doc.data().userIds, normalized.userIds)
    );
    const exactParticipantPointers = participantPointers.docs.filter((doc) =>
      exactParticipants(doc.data().userIds, normalized.userIds)
    );
    const data = matchSnapshot.data() ?? {};
    if (
      exactActiveRooms.length !== 1 ||
      exactActiveRooms[0].id !== params.candidate.matchId ||
      data.isActive !== true ||
      !exactParticipants(data.userIds, normalized.userIds) ||
      data.pairKey !== undefined && data.pairKey !== normalized.pairKey ||
      data.directRoomVersion !== undefined && data.directRoomVersion !== 1 ||
      !validHiddenFor(data.hiddenFor, false)
    ) {
      throw new Error('Close candidate room changed after live re-audit');
    }
    if (
      pointerSnapshot.exists ||
      exactParticipantPointers.length !== 0 ||
      pairPointers.size !== 0 ||
      activePointers.size !== 0 ||
      closedPointers.size !== 0
    ) {
      throw new Error('Close candidate acquired a pair pointer');
    }
    const states = [accountState(firstUser), accountState(secondUser)];
    const unavailableIndex = normalized.userIds.indexOf(
      params.candidate.unavailableUid
    );
    if (
      unavailableIndex < 0 ||
      states[unavailableIndex] !== params.candidate.unavailableState ||
      states[1 - unavailableIndex] !== 'active'
    ) {
      throw new Error('Close candidate participant state changed');
    }
    transaction.update(matchRef, {
      isActive: false,
      hiddenFor: admin.firestore.FieldValue.arrayUnion(...normalized.userIds),
      closedBy: params.candidate.unavailableUid,
      closedReason: 'account_deleted',
      closedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  });
}

async function applyClearStaleClosedPointer(params: {
  db: FirebaseFirestore.Firestore;
  candidate: ClearStaleClosedPointerCandidate;
}): Promise<void> {
  const expectedParticipants = JSON.parse(params.candidate.participantKey) as unknown;
  const normalized = normalizeDirectRoomParticipants(expectedParticipants);
  if (normalized === null || normalized.pairKey !== params.candidate.pairKey) {
    throw new Error('Pointer cleanup candidate identity failed validation');
  }
  const pointerRef = params.db.collection('chatPairs').doc(params.candidate.pointerId);
  const matchRef = params.db.collection('matches').doc(params.candidate.matchId);
  const closedMatchRef = params.db.collection('matches').doc(
    params.candidate.closedMatchId
  );
  const userRefs = normalized.userIds.map((uid) => params.db.collection('users').doc(uid));
  const activeRoomsQuery = params.db.collection('matches')
    .where('userIds', 'array-contains', normalized.userIds[0])
    .limit(PARTICIPANT_ROOM_QUERY_LIMIT);
  const participantPointersQuery = params.db.collection('chatPairs')
    .where('userIds', 'array-contains', normalized.userIds[0])
    .limit(PARTICIPANT_ROOM_QUERY_LIMIT);
  const pairPointersQuery = params.db.collection('chatPairs')
    .where('pairKey', '==', normalized.pairKey).limit(2);
  const activePointersQuery = params.db.collection('chatPairs')
    .where('activeMatchId', '==', params.candidate.matchId).limit(2);
  const closedPointersQuery = params.db.collection('chatPairs')
    .where('closedMatchId', '==', params.candidate.closedMatchId).limit(2);

  await params.db.runTransaction(async (transaction) => {
    const [
      pointerSnapshot,
      matchSnapshot,
      closedMatchSnapshot,
      firstUser,
      secondUser,
      activeRooms,
      participantPointers,
      pairPointers,
      activePointers,
      closedPointers,
    ] = await Promise.all([
      transaction.get(pointerRef),
      transaction.get(matchRef),
      transaction.get(closedMatchRef),
      transaction.get(userRefs[0]),
      transaction.get(userRefs[1]),
      transaction.get(activeRoomsQuery),
      transaction.get(participantPointersQuery),
      transaction.get(pairPointersQuery),
      transaction.get(activePointersQuery),
      transaction.get(closedPointersQuery),
    ]);
    if (!pointerSnapshot.exists || !matchSnapshot.exists || !closedMatchSnapshot.exists) {
      throw new Error('Pointer cleanup candidate disappeared');
    }
    if (
      !participantRoomScanIsComplete(activeRooms.size) ||
      !participantRoomScanIsComplete(participantPointers.size)
    ) {
      throw new Error('Pointer cleanup transaction scan hit its safety bound');
    }
    const exactActiveRooms = activeRooms.docs.filter((doc) =>
      doc.data().isActive === true &&
      exactParticipants(doc.data().userIds, normalized.userIds)
    );
    const exactParticipantPointers = participantPointers.docs.filter((doc) =>
      exactParticipants(doc.data().userIds, normalized.userIds)
    );
    const pointer = pointerSnapshot.data() ?? {};
    const match = matchSnapshot.data() ?? {};
    const closedMatch = closedMatchSnapshot.data() ?? {};
    if (
      pointerSnapshot.id !== normalized.pairKey ||
      !exactParticipants(pointer.userIds, normalized.userIds) ||
      pointer.pairKey !== normalized.pairKey ||
      pointer.activeMatchId !== params.candidate.matchId ||
      pointer.closedMatchId !== params.candidate.closedMatchId ||
      !exactClosedReason(
        pointer.closedReason,
        params.candidate.pointerClosedReason
      )
    ) {
      throw new Error('Stale pointer changed after live re-audit');
    }
    if (
      exactActiveRooms.length !== 1 ||
      exactActiveRooms[0].id !== params.candidate.matchId ||
      match.isActive !== true ||
      !exactParticipants(match.userIds, normalized.userIds) ||
      match.pairKey !== undefined && match.pairKey !== normalized.pairKey ||
      match.directRoomVersion !== undefined && match.directRoomVersion !== 1 ||
      !validHiddenFor(match.hiddenFor, true)
    ) {
      throw new Error('Current room changed after live re-audit');
    }
    if (
      closedMatch.isActive !== false ||
      !exactParticipants(closedMatch.userIds, normalized.userIds) ||
      closedMatch.pairKey !== normalized.pairKey ||
      !exactClosedReason(
        closedMatch.closedReason,
        params.candidate.historicalClosedReason
      )
    ) {
      throw new Error('Historical room changed after live re-audit');
    }
    if (
      exactParticipantPointers.length !== 1 ||
      exactParticipantPointers[0].id !== params.candidate.pointerId ||
      pairPointers.size !== 1 || pairPointers.docs[0].id !== params.candidate.pointerId ||
      activePointers.size !== 1 || activePointers.docs[0].id !== params.candidate.pointerId ||
      closedPointers.size !== 1 || closedPointers.docs[0].id !== params.candidate.pointerId
    ) {
      throw new Error('Pointer cleanup candidate is no longer unique');
    }
    if (accountState(firstUser) !== 'active' || accountState(secondUser) !== 'active') {
      throw new Error('Pointer cleanup participant state changed');
    }
    transaction.update(pointerRef, {
      closedMatchId: admin.firestore.FieldValue.delete(),
      closedReason: admin.firestore.FieldValue.delete(),
    });
  });
}

function currentCandidateMap(params: {
  classification: DirectRoomRemediationClassification;
  protector: ReturnType<typeof createRemediationIdentifierProtector>;
}): Map<string, DirectRoomRemediationCandidate> {
  const candidates: DirectRoomRemediationCandidate[] = [
    ...params.classification.closeUnavailableRooms,
    ...params.classification.clearStaleClosedPointers,
  ];
  const result = new Map<string, DirectRoomRemediationCandidate>();
  for (const candidate of candidates) {
    const key = actionKey(remediationManifestActionForCandidate(
      candidate,
      params.protector
    ));
    if (result.has(key)) {
      throw new Error('Protected identifier collision detected during re-audit');
    }
    result.set(key, candidate);
  }
  return result;
}

async function applyManifest(params: {
  db: FirebaseFirestore.Firestore;
  projectId: string;
  options: CliOptions;
  manifest: DirectRoomRemediationManifest;
  protector: ReturnType<typeof createRemediationIdentifierProtector>;
}): Promise<{ closedRooms: number; cleanedPointers: number }> {
  const audit = await auditCurrentState(params.db, params.options);
  if (!audit.complete) {
    throw new Error('Apply re-audit hit --max-documents and is incomplete');
  }
  const currentManifest = manifestForAudit({
    projectId: params.projectId,
    audit,
    options: params.options,
    protector: params.protector,
  });
  if (currentManifest.auditDigest !== params.manifest.auditDigest) {
    throw new Error('Live re-audit no longer matches the approved manifest');
  }
  const manifestKeys = new Set(params.manifest.actions.map(actionKey));
  const currentMap = currentCandidateMap({
    classification: audit.classification,
    protector: params.protector,
  });
  if (
    currentMap.size !== manifestKeys.size ||
    [...currentMap.keys()].some((key) => !manifestKeys.has(key))
  ) {
    throw new Error('Live candidate set differs from the approved manifest');
  }
  const candidates = params.manifest.actions.map((action) => {
    const candidate = currentMap.get(actionKey(action));
    if (candidate === undefined) {
      throw new Error('Manifest action is no longer safe or no longer exists');
    }
    return candidate;
  });

  let closedRooms = 0;
  let cleanedPointers = 0;
  for (let offset = 0; offset < candidates.length; offset += params.options.applyBatchSize) {
    const batch = candidates.slice(offset, offset + params.options.applyBatchSize);
    for (const candidate of batch) {
      if (candidate.kind === 'close-unavailable-room') {
        await applyCloseUnavailableRoom({ db: params.db, candidate });
        closedRooms += 1;
      } else {
        await applyClearStaleClosedPointer({ db: params.db, candidate });
        cleanedPointers += 1;
      }
    }
  }
  return { closedRooms, cleanedPointers };
}

async function run(argv: string[]): Promise<void> {
  const parsed = parseCliOptions(argv);
  if (parsed === 'help') {
    console.log(usage().trim());
    return;
  }
  const options = parsed;
  const projectId = verifyTarget(options);
  const key = await readIdentifierKey(options.hashKeyPath);
  const protector = createRemediationIdentifierProtector(key);

  let manifest: DirectRoomRemediationManifest | undefined;
  if (options.apply) {
    manifest = await readManifest(options.manifestPath);
    validateManifestForApply({ manifest, options, protector });
  }

  admin.initializeApp({ projectId });
  const db = admin.firestore();
  if (!options.apply) {
    const audit = await auditCurrentState(db, options);
    const dryRunManifest = manifestForAudit({
      projectId,
      audit,
      options,
      protector,
    });
    await writeNewManifest(options.manifestPath, dryRunManifest);
    console.log(JSON.stringify({
      mode: 'dry-run',
      projectId,
      complete: audit.complete,
      manifestDigest: dryRunManifest.digest,
      counts: dryRunManifest.counts,
    }));
    if (!audit.complete) process.exitCode = 2;
    return;
  }

  const result = await applyManifest({
    db,
    projectId,
    options,
    manifest: manifest!,
    protector,
  });
  console.log(JSON.stringify({
    mode: 'apply',
    projectId,
    manifestDigest: manifest!.digest,
    ...result,
    reAuditRequired: true,
  }));
}

if (require.main === module) {
  run(process.argv.slice(2)).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Unknown failure';
    console.error(`Direct room remediation aborted: ${message}`);
    process.exitCode = 1;
  });
}
