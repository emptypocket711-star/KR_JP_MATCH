import { promises as fs } from 'node:fs';
import path from 'node:path';

import * as admin from 'firebase-admin';

import {
  ActiveMatchAuditRecord,
  ChatPairAuditRecord,
  DirectRoomCandidate,
  PARTICIPANT_ROOM_QUERY_LIMIT,
  ReferencedClosedMatchAuditRecord,
  classifyDirectRoomMigration,
  normalizeDirectRoomParticipants,
  participantRoomScanIsComplete,
} from '../directRoomMigrationPolicy';
import {
  DirectRoomManifest,
  DirectRoomManifestAction,
  buildDirectRoomManifest,
  createIdentifierProtector,
  directRoomManifestActionForCandidate,
  verifyDirectRoomManifest,
} from '../directRoomMigrationManifest';

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
const CLOSED_MATCH_GET_ALL_CHUNK_SIZE = 100;

interface CliOptions {
  apply: boolean;
  expectedProject: string;
  confirmProject?: string;
  confirmProductionWrite?: string;
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
  activeMatches: CollectionScan<ActiveMatchAuditRecord>;
  chatPairs: CollectionScan<ChatPairAuditRecord>;
  referencedClosedMatches: CollectionScan<ReferencedClosedMatchAuditRecord>;
  classification: ReturnType<typeof classifyDirectRoomMigration>;
  complete: boolean;
}

function usage(): string {
  return `
Direct room v1 audit/backfill (dry-run by default)

Audit:
  GOOGLE_CLOUD_PROJECT=hana-e2ee6 \\
  node lib/admin/directRoomMigration.js \\
    --expected-project hana-e2ee6 \\
    --manifest /secure/path/direct-room-audit.json \\
    --hash-key-file /secure/path/direct-room-hmac.key

Apply (writes directRoomVersion=1 only):
  GOOGLE_CLOUD_PROJECT=hana-e2ee6 \\
  node lib/admin/directRoomMigration.js \\
    --apply \\
    --expected-project hana-e2ee6 \\
    --confirm-project hana-e2ee6 \\
    --manifest /secure/path/direct-room-audit.json \\
    --manifest-digest <64-char-sha256> \\
    --hash-key-file /secure/path/direct-room-hmac.key

Required:
  --expected-project <id>      Must be hana-e2ee6 or hana-production-tokyo.
  --manifest <path>            New output path in audit mode; input in apply mode.
  --hash-key-file <path>       Private file containing at least 32 bytes.

Apply-only required:
  --apply
  --confirm-project <id>       Must exactly match --expected-project.
  --manifest-digest <digest>   Must exactly match the verified manifest digest.
  --confirm-production-write hana-production-tokyo
                               Additionally required for production apply.

Optional bounds:
  --page-size <1..500>               Default ${DEFAULT_PAGE_SIZE}.
  --max-documents <1..${HARD_MAX_DOCUMENTS}>        Per collection; default ${DEFAULT_MAX_DOCUMENTS}.
  --apply-batch-size <1..${MAX_APPLY_BATCH_SIZE}>         Default ${DEFAULT_APPLY_BATCH_SIZE}.
  --max-apply-actions <1..${HARD_MAX_APPLY_ACTIONS}>      Default ${DEFAULT_MAX_APPLY_ACTIONS}.
  --allow-emulator                    Explicitly allow audit against an emulator.
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
  if (!/^\d+$/.test(raw)) {
    throw new Error(`${flag} must be an integer`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${flag} must be between 1 and ${maximum}`);
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
    manifestPath: path.resolve(manifestPath),
    manifestDigest: values.get('--manifest-digest'),
    hashKeyPath: path.resolve(hashKeyPath),
    pageSize: boundedInteger(
      values.get('--page-size'),
      DEFAULT_PAGE_SIZE,
      '--page-size',
      MAX_PAGE_SIZE
    ),
    maxDocuments: boundedInteger(
      values.get('--max-documents'),
      DEFAULT_MAX_DOCUMENTS,
      '--max-documents',
      HARD_MAX_DOCUMENTS
    ),
    applyBatchSize: boundedInteger(
      values.get('--apply-batch-size'),
      DEFAULT_APPLY_BATCH_SIZE,
      '--apply-batch-size',
      MAX_APPLY_BATCH_SIZE
    ),
    maxApplyActions: boundedInteger(
      values.get('--max-apply-actions'),
      DEFAULT_MAX_APPLY_ACTIONS,
      '--max-apply-actions',
      HARD_MAX_APPLY_ACTIONS
    ),
    allowEmulator: booleans.has('--allow-emulator'),
  };
}

function runtimeProjectId(): string | null {
  const direct =
    process.env.GOOGLE_CLOUD_PROJECT ?? process.env.GCLOUD_PROJECT ?? null;
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
      'FIRESTORE_EMULATOR_HOST is set; pass --allow-emulator for an explicit emulator audit'
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
    if (!options.manifestDigest) {
      throw new Error('--manifest-digest is required in apply mode');
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
    let pageQuery = params.query.limit(requestSize);
    if (cursor !== undefined) pageQuery = pageQuery.startAfter(cursor);
    const snapshot = await pageQuery.get();

    if (snapshot.empty) return { records, complete: true };
    if (snapshot.docs.length > remaining) {
      return { records, complete: false };
    }

    records.push(...snapshot.docs.map(params.map));
    cursor = snapshot.docs[snapshot.docs.length - 1];
    if (snapshot.docs.length < requestSize) {
      return { records, complete: true };
    }
  }
}

async function auditCurrentState(
  db: FirebaseFirestore.Firestore,
  options: Pick<CliOptions, 'pageSize' | 'maxDocuments'>
): Promise<FullAudit> {
  const activeMatches = await scanQuery<ActiveMatchAuditRecord>({
    query: db
      .collection('matches')
      .where('isActive', '==', true)
      .orderBy(admin.firestore.FieldPath.documentId()),
    pageSize: options.pageSize,
    maxDocuments: options.maxDocuments,
    map: (doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        userIds: data.userIds,
        pairKey: data.pairKey,
        directRoomVersion: data.directRoomVersion,
        hiddenFor: data.hiddenFor,
      };
    },
  });

  const chatPairs = await scanQuery<ChatPairAuditRecord>({
    query: db.collection('chatPairs').orderBy(admin.firestore.FieldPath.documentId()),
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

  const closedMatchIds = Array.from(new Set(chatPairs.records.flatMap((pointer) =>
    typeof pointer.closedMatchId === 'string' &&
    pointer.closedMatchId.length > 0
      ? [pointer.closedMatchId]
      : []
  ))).sort();
  const referencedClosedMatchRecords: ReferencedClosedMatchAuditRecord[] = [];
  for (
    let offset = 0;
    offset < closedMatchIds.length;
    offset += CLOSED_MATCH_GET_ALL_CHUNK_SIZE
  ) {
    const refs = closedMatchIds
      .slice(offset, offset + CLOSED_MATCH_GET_ALL_CHUNK_SIZE)
      .map((id) => db.collection('matches').doc(id));
    const snapshots = await db.getAll(...refs);
    for (const snapshot of snapshots) {
      if (!snapshot.exists) continue;
      const data = snapshot.data() ?? {};
      referencedClosedMatchRecords.push({
        id: snapshot.id,
        userIds: data.userIds,
        pairKey: data.pairKey,
        isActive: data.isActive,
        closedReason: data.closedReason,
      });
    }
  }
  const referencedClosedMatches: CollectionScan<ReferencedClosedMatchAuditRecord> = {
    records: referencedClosedMatchRecords,
    complete: true,
  };

  return {
    activeMatches,
    chatPairs,
    referencedClosedMatches,
    classification: classifyDirectRoomMigration(
      activeMatches.records,
      chatPairs.records,
      referencedClosedMatches.records
    ),
    complete:
      activeMatches.complete &&
      chatPairs.complete &&
      referencedClosedMatches.complete,
  };
}

async function writeNewManifest(
  filePath: string,
  manifest: DirectRoomManifest
): Promise<void> {
  await fs.writeFile(filePath, `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });
}

async function readManifest(filePath: string): Promise<DirectRoomManifest> {
  const raw = await fs.readFile(filePath, 'utf8');
  const parsed = JSON.parse(raw) as DirectRoomManifest;
  if (!verifyDirectRoomManifest(parsed)) {
    throw new Error('Manifest schema or digest verification failed');
  }
  return parsed;
}

function actionKey(action: DirectRoomManifestAction): string {
  return [
    action.matchHash,
    action.pairHash,
    action.participantHash,
    action.pointerHash,
  ].join(':');
}

function currentActionMap(params: {
  candidates: readonly DirectRoomCandidate[];
  healthy: readonly DirectRoomCandidate[];
  protector: ReturnType<typeof createIdentifierProtector>;
}): Map<string, DirectRoomCandidate> {
  const result = new Map<string, DirectRoomCandidate>();
  for (const candidate of [...params.candidates, ...params.healthy]) {
    const key = actionKey(
      directRoomManifestActionForCandidate(candidate, params.protector)
    );
    if (result.has(key)) {
      throw new Error('Protected identifier collision detected during re-audit');
    }
    result.set(key, candidate);
  }
  return result;
}

function exactParticipants(left: unknown, right: unknown): boolean {
  const normalizedLeft = normalizeDirectRoomParticipants(left);
  const normalizedRight = normalizeDirectRoomParticipants(right);
  return (
    normalizedLeft !== null &&
    normalizedRight !== null &&
    normalizedLeft.participantKey === normalizedRight.participantKey
  );
}

async function applyCandidate(params: {
  db: FirebaseFirestore.Firestore;
  candidate: DirectRoomCandidate;
}): Promise<'updated' | 'already-marked'> {
  const expectedParticipants = JSON.parse(params.candidate.participantKey) as unknown;
  const normalized = normalizeDirectRoomParticipants(expectedParticipants);
  if (normalized === null || normalized.pairKey !== params.candidate.pairKey) {
    throw new Error('In-memory candidate identity failed validation');
  }

  const matchRef = params.db.collection('matches').doc(params.candidate.matchId);
  const pointerRef = params.db
    .collection('chatPairs')
    .doc(params.candidate.pointerId);
  const participantRoomsQuery = params.db
    .collection('matches')
    .where('userIds', 'array-contains', normalized.userIds[0])
    .limit(PARTICIPANT_ROOM_QUERY_LIMIT);
  const pairKeyPointersQuery = params.db
    .collection('chatPairs')
    .where('pairKey', '==', params.candidate.pairKey)
    .limit(2);
  const roomPointersQuery = params.db
    .collection('chatPairs')
    .where('activeMatchId', '==', params.candidate.matchId)
    .limit(2);

  return params.db.runTransaction(async (transaction) => {
    const [
      matchSnapshot,
      pointerSnapshot,
      participantRoomsSnapshot,
      pairKeyPointersSnapshot,
      roomPointersSnapshot,
    ] = await Promise.all([
      transaction.get(matchRef),
      transaction.get(pointerRef),
      transaction.get(participantRoomsQuery),
      transaction.get(pairKeyPointersQuery),
      transaction.get(roomPointersQuery),
    ]);

    if (!matchSnapshot.exists || !pointerSnapshot.exists) {
      throw new Error('Candidate or pointer disappeared during apply');
    }

    const matchData = matchSnapshot.data() ?? {};
    const pointerData = pointerSnapshot.data() ?? {};
    if (!participantRoomScanIsComplete(participantRoomsSnapshot.size)) {
      throw new Error('Participant room scan hit its transaction safety bound');
    }
    const exactActiveMatches = participantRoomsSnapshot.docs.filter(
      (doc) =>
        doc.data().isActive === true &&
        exactParticipants(doc.data().userIds, normalized.userIds)
    );
    if (
      exactActiveMatches.length !== 1 ||
      exactActiveMatches[0].id !== params.candidate.matchId
    ) {
      throw new Error('Pair no longer has exactly one valid active room');
    }
    if (
      matchData.isActive !== true ||
      !exactParticipants(matchData.userIds, normalized.userIds) ||
      (matchData.pairKey !== undefined &&
        matchData.pairKey !== params.candidate.pairKey) ||
      !Array.isArray(matchData.hiddenFor) ||
      matchData.hiddenFor.length !== 0
    ) {
      throw new Error('Candidate room changed after the re-audit');
    }
    if (
      !exactParticipants(pointerData.userIds, normalized.userIds) ||
      pointerSnapshot.id !== params.candidate.pairKey ||
      pointerData.pairKey !== params.candidate.pairKey ||
      pointerData.activeMatchId !== params.candidate.matchId ||
      pointerData.closedMatchId !== undefined ||
      pointerData.closedReason !== undefined
    ) {
      throw new Error('Pair pointer changed after the re-audit');
    }
    if (
      pairKeyPointersSnapshot.size !== 1 ||
      pairKeyPointersSnapshot.docs[0].id !== params.candidate.pointerId ||
      roomPointersSnapshot.size !== 1 ||
      roomPointersSnapshot.docs[0].id !== params.candidate.pointerId
    ) {
      throw new Error('Pair pointer is no longer unique during apply');
    }

    if (
      matchData.directRoomVersion === 1 &&
      matchData.pairKey === params.candidate.pairKey
    ) return 'already-marked';
    if (
      matchData.directRoomVersion !== undefined &&
      matchData.directRoomVersion !== 1
    ) {
      throw new Error('Candidate acquired an unsupported marker');
    }

    transaction.update(matchRef, {
      directRoomVersion: 1,
      pairKey: params.candidate.pairKey,
    });
    return 'updated';
  });
}

async function applyManifest(params: {
  db: FirebaseFirestore.Firestore;
  options: CliOptions;
  manifest: DirectRoomManifest;
  protector: ReturnType<typeof createIdentifierProtector>;
}): Promise<{ updated: number; alreadyMarked: number }> {
  const { manifest, options } = params;
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
  if (manifest.actions.length > options.maxApplyActions) {
    throw new Error(
      `Manifest has more than --max-apply-actions (${options.maxApplyActions})`
    );
  }

  const current = await auditCurrentState(params.db, options);
  if (!current.complete) {
    throw new Error('Apply re-audit hit --max-documents and is incomplete');
  }

  const manifestKeys = new Set(manifest.actions.map(actionKey));
  if (manifestKeys.size !== manifest.actions.length) {
    throw new Error('Manifest contains duplicate actions');
  }

  const currentMap = currentActionMap({
    candidates: current.classification.candidates,
    healthy: current.classification.healthy,
    protector: params.protector,
  });
  for (const candidate of current.classification.candidates) {
    const key = actionKey(
      directRoomManifestActionForCandidate(candidate, params.protector)
    );
    if (!manifestKeys.has(key)) {
      throw new Error('Re-audit found an unapproved marker candidate');
    }
  }

  const approvedCandidates: DirectRoomCandidate[] = [];
  for (const action of manifest.actions) {
    const candidate = currentMap.get(actionKey(action));
    if (candidate === undefined) {
      throw new Error('A manifest action is no longer safe or no longer exists');
    }
    approvedCandidates.push(candidate);
  }

  let updated = 0;
  let alreadyMarked = 0;
  for (
    let offset = 0;
    offset < approvedCandidates.length;
    offset += options.applyBatchSize
  ) {
    const batch = approvedCandidates.slice(
      offset,
      offset + options.applyBatchSize
    );
    for (const candidate of batch) {
      const result = await applyCandidate({ db: params.db, candidate });
      if (result === 'updated') updated += 1;
      else alreadyMarked += 1;
    }
  }

  return { updated, alreadyMarked };
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
  const protector = createIdentifierProtector(key);

  admin.initializeApp({ projectId });
  const db = admin.firestore();

  if (!options.apply) {
    const audit = await auditCurrentState(db, options);
    const manifest = buildDirectRoomManifest({
      projectId,
      createdAt: new Date(),
      pageSize: options.pageSize,
      maxDocumentsPerCollection: options.maxDocuments,
      scanComplete: audit.complete,
      classification: audit.classification,
      protector,
    });
    await writeNewManifest(options.manifestPath, manifest);
    console.log(
      JSON.stringify({
        mode: 'dry-run',
        projectId,
        complete: audit.complete,
        manifestDigest: manifest.digest,
        counts: manifest.counts,
      })
    );
    if (!audit.complete) process.exitCode = 2;
    return;
  }

  const manifest = await readManifest(options.manifestPath);
  const result = await applyManifest({
    db,
    options,
    manifest,
    protector,
  });
  console.log(
    JSON.stringify({
      mode: 'apply',
      projectId,
      manifestDigest: manifest.digest,
      ...result,
    })
  );
}

if (require.main === module) {
  run(process.argv.slice(2)).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Unknown failure';
    console.error(`Direct room migration aborted: ${message}`);
    process.exitCode = 1;
  });
}
