import { promises as fs } from 'node:fs';
import path from 'node:path';

import * as admin from 'firebase-admin';

import {
  PointBalanceAuditAction,
  PointBalanceAuditManifest,
  PointBalanceUserAuditRecord,
  PointEventAuditRecord,
  buildPointBalanceAuditManifest,
  classifyPointBalanceAudit,
  pointBalanceAuditActionKey,
  pointBalanceAuditMatchesManifest,
  pointBalanceTrustVersion,
  verifyPointBalanceAuditManifest,
} from '../pointBalanceAuditPolicy';

const STAGING_PROJECT_ID = 'hana-e2ee6';
const DEFAULT_MAX_USERS = 10_000;
const HARD_MAX_USERS = 100_000;
const DEFAULT_MAX_POINT_EVENTS = 100_000;
const HARD_MAX_POINT_EVENTS = 1_000_000;
const DEFAULT_MAX_EVENTS_PER_USER = 1_000;
const HARD_MAX_EVENTS_PER_USER = 10_000;
const DEFAULT_MAX_APPLY_ACTIONS = 500;
const HARD_MAX_APPLY_ACTIONS = 5_000;
const PAGE_SIZE = 500;

interface Options {
  apply: boolean;
  expectedProject: string;
  confirmProject?: string;
  confirmTrustCount?: number;
  confirmQuarantineCount?: number;
  manifestPath: string;
  manifestDigest?: string;
  maxUsers: number;
  maxPointEvents: number;
  maxEventsPerUser: number;
  maxApplyActions: number;
  allowEmulator: boolean;
}

interface CollectionScan<T> {
  records: T[];
  complete: boolean;
}

interface AuditResult {
  users: CollectionScan<PointBalanceUserAuditRecord>;
  pointEvents: CollectionScan<PointEventAuditRecord>;
  complete: boolean;
  classification: ReturnType<typeof classifyPointBalanceAudit>;
}

function usage(): string {
  return `
Point balance trust audit/quarantine (read-only by default; staging only)

Audit:
  GOOGLE_CLOUD_PROJECT=hana-e2ee6 \\
  node lib/admin/pointBalanceAudit.js \\
    --expected-project hana-e2ee6 \\
    --manifest /secure/path/point-balance-audit.json

Apply reviewed manifest:
  GOOGLE_CLOUD_PROJECT=hana-e2ee6 \\
  node lib/admin/pointBalanceAudit.js \\
    --apply \\
    --expected-project hana-e2ee6 \\
    --confirm-project hana-e2ee6 \\
    --manifest /secure/path/point-balance-audit.json \\
    --manifest-digest <64-char-sha256> \\
    --confirm-trust-count <N> \\
    --confirm-quarantine-count <N>

Audit is bounded by --max-users, --max-point-events, and
--max-events-per-user. Apply re-audits those exact bounds and rejects any
user/event drift before writing. Production and emulator apply are refused.
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
  maximum: number,
  allowZero = false
): number {
  if (raw === undefined) return fallback;
  if (!/^\d+$/.test(raw)) throw new Error(`${flag} must be an integer`);
  const value = Number(raw);
  const minimum = allowZero ? 0 : 1;
  if (
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new Error(`${flag} must be between ${minimum} and ${maximum}`);
  }
  return value;
}

export function parseOptions(argv: string[]): Options | 'help' {
  const values = new Map<string, string>();
  const booleans = new Set<string>();
  const valueFlags = new Set([
    '--expected-project',
    '--confirm-project',
    '--confirm-trust-count',
    '--confirm-quarantine-count',
    '--manifest',
    '--manifest-digest',
    '--max-users',
    '--max-point-events',
    '--max-events-per-user',
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
  if (!expectedProject || !manifestPath) {
    throw new Error('--expected-project and --manifest are required');
  }

  return {
    apply: booleans.has('--apply'),
    expectedProject,
    confirmProject: values.get('--confirm-project'),
    confirmTrustCount: values.has('--confirm-trust-count')
      ? boundedInteger(
          values.get('--confirm-trust-count'),
          0,
          '--confirm-trust-count',
          HARD_MAX_APPLY_ACTIONS,
          true
        )
      : undefined,
    confirmQuarantineCount: values.has('--confirm-quarantine-count')
      ? boundedInteger(
          values.get('--confirm-quarantine-count'),
          0,
          '--confirm-quarantine-count',
          HARD_MAX_APPLY_ACTIONS,
          true
        )
      : undefined,
    manifestPath: path.resolve(manifestPath),
    manifestDigest: values.get('--manifest-digest'),
    maxUsers: boundedInteger(
      values.get('--max-users'),
      DEFAULT_MAX_USERS,
      '--max-users',
      HARD_MAX_USERS
    ),
    maxPointEvents: boundedInteger(
      values.get('--max-point-events'),
      DEFAULT_MAX_POINT_EVENTS,
      '--max-point-events',
      HARD_MAX_POINT_EVENTS
    ),
    maxEventsPerUser: boundedInteger(
      values.get('--max-events-per-user'),
      DEFAULT_MAX_EVENTS_PER_USER,
      '--max-events-per-user',
      HARD_MAX_EVENTS_PER_USER
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
  if (!process.env.FIREBASE_CONFIG) return null;
  let decoded: unknown;
  try {
    decoded = JSON.parse(process.env.FIREBASE_CONFIG);
  } catch {
    throw new Error('FIREBASE_CONFIG is not valid JSON');
  }
  if (decoded === null || typeof decoded !== 'object') return null;
  const projectId = (decoded as Record<string, unknown>).projectId;
  return typeof projectId === 'string' ? projectId : null;
}

export function verifyTarget(options: Options): string {
  if (options.expectedProject !== STAGING_PROJECT_ID) {
    throw new Error('This rollout tool is source-locked to hana-e2ee6 staging');
  }
  const runtimeProject = runtimeProjectId();
  if (runtimeProject !== options.expectedProject) {
    throw new Error('Runtime project must exactly match --expected-project');
  }
  const emulator = process.env.FIRESTORE_EMULATOR_HOST !== undefined;
  if (emulator && !options.allowEmulator) {
    throw new Error('Emulator audit requires --allow-emulator');
  }
  if (emulator && options.apply) {
    throw new Error('Apply mode is refused while FIRESTORE_EMULATOR_HOST is set');
  }

  if (!options.apply) {
    if (
      options.confirmProject !== undefined ||
      options.confirmTrustCount !== undefined ||
      options.confirmQuarantineCount !== undefined ||
      options.manifestDigest !== undefined
    ) {
      throw new Error('Apply confirmation flags are invalid without --apply');
    }
    return runtimeProject;
  }

  if (
    options.confirmProject !== options.expectedProject ||
    options.confirmTrustCount === undefined ||
    options.confirmQuarantineCount === undefined ||
    options.manifestDigest === undefined
  ) {
    throw new Error(
      'Apply requires exact project, digest, trust-count, and quarantine-count confirmations'
    );
  }
  if (!/^[a-f0-9]{64}$/.test(options.manifestDigest)) {
    throw new Error('--manifest-digest must be an exact lowercase SHA-256 digest');
  }
  if (
    options.confirmTrustCount + options.confirmQuarantineCount >
    options.maxApplyActions
  ) {
    throw new Error('Confirmed action counts exceed --max-apply-actions');
  }
  return runtimeProject;
}

function timestampNanos(value: unknown): string | null {
  if (!(value instanceof admin.firestore.Timestamp)) return null;
  return (
    BigInt(value.seconds) * 1_000_000_000n + BigInt(value.nanoseconds)
  ).toString();
}

function snapshotUpdateTime(
  snapshot: FirebaseFirestore.QueryDocumentSnapshot | FirebaseFirestore.DocumentSnapshot
): string {
  const updateTime = snapshot.updateTime;
  if (updateTime === undefined) {
    throw new Error(`Document ${snapshot.ref.path} has no updateTime`);
  }
  return timestampNanos(updateTime)!;
}

function userRecord(
  snapshot: FirebaseFirestore.QueryDocumentSnapshot | FirebaseFirestore.DocumentSnapshot
): PointBalanceUserAuditRecord {
  const data = snapshot.data() ?? {};
  return {
    uid: snapshot.id,
    keyCount: data.keyCount,
    pointBalanceTrustVersion: data.pointBalanceTrustVersion,
    pointBalanceQuarantined: data.pointBalanceQuarantined,
    pointBalanceQuarantineReason: data.pointBalanceQuarantineReason,
    updateTime: snapshotUpdateTime(snapshot),
  };
}

function eventRecord(
  snapshot: FirebaseFirestore.QueryDocumentSnapshot
): PointEventAuditRecord {
  const data = snapshot.data();
  return {
    id: snapshot.id,
    uid: data.uid,
    eventType: data.eventType,
    amount: data.amount,
    balanceBefore: data.balanceBefore,
    balanceAfter: data.balanceAfter,
    source: data.source,
    migrationMarker: data.migrationMarker,
    legacyBalancePreserved: data.legacyBalancePreserved,
    timestampNanos: timestampNanos(data.timestamp),
    updateTime: snapshotUpdateTime(snapshot),
  };
}

async function scanCollection<T>(params: {
  query: FirebaseFirestore.Query;
  maximum: number;
  map: (snapshot: FirebaseFirestore.QueryDocumentSnapshot) => T;
}): Promise<CollectionScan<T>> {
  const records: T[] = [];
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  while (true) {
    const remaining = params.maximum - records.length;
    const requestSize = Math.min(PAGE_SIZE, remaining + 1);
    let query = params.query.limit(requestSize);
    if (cursor !== undefined) query = query.startAfter(cursor);
    const snapshot = await query.get();
    if (snapshot.empty) return { records, complete: true };
    if (snapshot.size > remaining) return { records, complete: false };
    records.push(...snapshot.docs.map(params.map));
    cursor = snapshot.docs[snapshot.docs.length - 1];
    if (snapshot.size < requestSize) return { records, complete: true };
  }
}

async function auditCurrentState(
  db: FirebaseFirestore.Firestore,
  options: Pick<
    Options,
    'maxUsers' | 'maxPointEvents' | 'maxEventsPerUser'
  >
): Promise<AuditResult> {
  const [users, pointEvents] = await Promise.all([
    scanCollection({
      query: db.collection('users').orderBy(admin.firestore.FieldPath.documentId()),
      maximum: options.maxUsers,
      map: userRecord,
    }),
    scanCollection({
      query: db.collection('pointEvents').orderBy(admin.firestore.FieldPath.documentId()),
      maximum: options.maxPointEvents,
      map: eventRecord,
    }),
  ]);
  const perUserEventCounts = new Map<string, number>();
  for (const event of pointEvents.records) {
    if (typeof event.uid !== 'string') continue;
    perUserEventCounts.set(
      event.uid,
      (perUserEventCounts.get(event.uid) ?? 0) + 1
    );
  }
  const withinPerUserBound = [...perUserEventCounts.values()].every(
    (count) => count <= options.maxEventsPerUser
  );
  const complete = users.complete && pointEvents.complete && withinPerUserBound;
  return {
    users,
    pointEvents,
    complete,
    classification: classifyPointBalanceAudit({
      users: users.records,
      pointEvents: pointEvents.records,
    }),
  };
}

export async function writeNewManifest(
  filePath: string,
  manifest: PointBalanceAuditManifest
): Promise<void> {
  await fs.writeFile(filePath, `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });
}

export async function readManifest(
  filePath: string
): Promise<PointBalanceAuditManifest> {
  const stat = await fs.stat(filePath);
  if (!stat.isFile() || (stat.mode & 0o777) !== 0o600) {
    throw new Error('Manifest must be a private mode-0600 file');
  }
  const parsed = JSON.parse(await fs.readFile(filePath, 'utf8')) as unknown;
  if (!verifyPointBalanceAuditManifest(parsed)) {
    throw new Error('Manifest schema or digest verification failed');
  }
  return parsed;
}

async function applyAction(params: {
  db: FirebaseFirestore.Firestore;
  action: PointBalanceAuditAction;
  maxEventsPerUser: number;
  manifestDigest: string;
}): Promise<void> {
  const userRef = params.db.collection('users').doc(params.action.uid);
  const eventsQuery = params.db
    .collection('pointEvents')
    .where('uid', '==', params.action.uid)
    .limit(params.maxEventsPerUser + 1);

  await params.db.runTransaction(async (tx) => {
    const [userSnapshot, eventSnapshot] = await Promise.all([
      tx.get(userRef),
      tx.get(eventsQuery),
    ]);
    if (!userSnapshot.exists) {
      throw new Error(`User ${params.action.uid} disappeared during apply`);
    }
    if (eventSnapshot.size > params.maxEventsPerUser) {
      throw new Error(`User ${params.action.uid} exceeded the event safety bound`);
    }
    const fresh = classifyPointBalanceAudit({
      users: [userRecord(userSnapshot)],
      pointEvents: eventSnapshot.docs.map(eventRecord),
    });
    if (
      fresh.actions.length !== 1 ||
      pointBalanceAuditActionKey(fresh.actions[0]) !==
        pointBalanceAuditActionKey(params.action)
    ) {
      throw new Error(`User ${params.action.uid} drifted after manifest review`);
    }

    if (params.action.action === 'trust') {
      tx.update(userRef, {
        pointBalanceTrustVersion,
        pointBalanceTrustSource: 'server_point_events_v1',
        pointBalanceTrustedAt: admin.firestore.FieldValue.serverTimestamp(),
        pointBalanceQuarantined: admin.firestore.FieldValue.delete(),
        pointBalanceQuarantineReason: admin.firestore.FieldValue.delete(),
        pointBalanceQuarantinedAt: admin.firestore.FieldValue.delete(),
        pointBalanceAuditManifestDigest: params.manifestDigest,
      });
      return;
    }

    tx.update(userRef, {
      pointBalanceTrustVersion: admin.firestore.FieldValue.delete(),
      pointBalanceQuarantined: true,
      pointBalanceQuarantineReason: params.action.reason,
      pointBalanceQuarantinedAt: admin.firestore.FieldValue.serverTimestamp(),
      pointBalanceAuditManifestDigest: params.manifestDigest,
    });
  });
}

async function applyManifest(params: {
  db: FirebaseFirestore.Firestore;
  options: Options;
  manifest: PointBalanceAuditManifest;
}): Promise<{ trusted: number; quarantined: number }> {
  const { manifest, options } = params;
  if (
    manifest.projectId !== options.expectedProject ||
    manifest.scan.complete !== true ||
    manifest.scan.maxUsers !== options.maxUsers ||
    manifest.scan.maxPointEvents !== options.maxPointEvents ||
    manifest.scan.maxEventsPerUser !== options.maxEventsPerUser ||
    manifest.digest !== options.manifestDigest
  ) {
    throw new Error('Manifest target, bounds, completeness, or digest mismatch');
  }
  if (
    manifest.counts.trustActions !== options.confirmTrustCount ||
    manifest.counts.quarantineActions !== options.confirmQuarantineCount
  ) {
    throw new Error('Manifest action counts differ from explicit confirmations');
  }
  if (manifest.actions.length > options.maxApplyActions) {
    throw new Error('Manifest exceeds --max-apply-actions');
  }

  const current = await auditCurrentState(params.db, options);
  if (!current.complete) {
    throw new Error('Apply re-audit exceeded a configured safety bound');
  }
  if (!pointBalanceAuditMatchesManifest(manifest, current.classification)) {
    throw new Error('Live users or point events drifted after manifest review');
  }

  let trusted = 0;
  let quarantined = 0;
  for (const action of manifest.actions) {
    await applyAction({
      db: params.db,
      action,
      maxEventsPerUser: options.maxEventsPerUser,
      manifestDigest: manifest.digest,
    });
    if (action.action === 'trust') trusted += 1;
    else quarantined += 1;
  }
  return { trusted, quarantined };
}

async function run(argv: string[]): Promise<void> {
  const parsed = parseOptions(argv);
  if (parsed === 'help') {
    console.log(usage().trim());
    return;
  }
  const options = parsed;
  const projectId = verifyTarget(options);
  admin.initializeApp({ projectId });
  const db = admin.firestore();

  if (!options.apply) {
    const audit = await auditCurrentState(db, options);
    const manifest = buildPointBalanceAuditManifest({
      projectId,
      createdAt: new Date(),
      complete: audit.complete,
      maxUsers: options.maxUsers,
      maxPointEvents: options.maxPointEvents,
      maxEventsPerUser: options.maxEventsPerUser,
      classification: audit.classification,
    });
    await writeNewManifest(options.manifestPath, manifest);
    console.log(JSON.stringify({
      mode: 'dry-run',
      projectId,
      complete: audit.complete,
      manifestDigest: manifest.digest,
      counts: manifest.counts,
    }));
    if (!audit.complete) process.exitCode = 2;
    return;
  }

  const manifest = await readManifest(options.manifestPath);
  const result = await applyManifest({ db, options, manifest });
  console.log(JSON.stringify({
    mode: 'apply',
    projectId,
    manifestDigest: manifest.digest,
    ...result,
    reAuditRequired: true,
  }));
}

if (require.main === module) {
  run(process.argv.slice(2)).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Point balance audit aborted: ${message}`);
    process.exitCode = 1;
  });
}
