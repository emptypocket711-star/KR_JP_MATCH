import * as admin from 'firebase-admin';

import {
  profileMediaVisibilityDecision,
  profileMediaVisibilityVersion,
} from '../profileMediaVisibilityPolicy';

const ALLOWED_PROJECTS = new Set(['hana-e2ee6', 'hana-production-tokyo']);
const PRODUCTION_PROJECT = 'hana-production-tokyo';
const DEFAULT_LIMIT = 20_000;
const HARD_LIMIT = 1_000_000;

interface Options {
  apply: boolean;
  expectedProject: string;
  confirmProject?: string;
  confirmProductionWrite?: string;
  confirmSetCount?: number;
  confirmClearCount?: number;
  maxDocuments: number;
}

function valueAfter(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return value;
}

function integer(raw: string | undefined, fallback: number, flag: string): number {
  if (raw === undefined) return fallback;
  if (!/^\d+$/.test(raw)) throw new Error(`${flag} must be an integer`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0 || value > HARD_LIMIT) {
    throw new Error(`${flag} must be between 0 and ${HARD_LIMIT}`);
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
      '--confirm-set-count',
      '--confirm-clear-count',
      '--max-documents',
    ].includes(flag)) {
      throw new Error(`Unknown argument: ${flag}`);
    }
    if (values.has(flag)) throw new Error(`${flag} was provided more than once`);
    values.set(flag, valueAfter(argv, index, flag));
    index += 1;
  }
  const expectedProject = values.get('--expected-project');
  if (!expectedProject) throw new Error('--expected-project is required');
  return {
    apply,
    expectedProject,
    confirmProject: values.get('--confirm-project'),
    confirmProductionWrite: values.get('--confirm-production-write'),
    confirmSetCount: values.has('--confirm-set-count')
      ? integer(values.get('--confirm-set-count'), 0, '--confirm-set-count')
      : undefined,
    confirmClearCount: values.has('--confirm-clear-count')
      ? integer(values.get('--confirm-clear-count'), 0, '--confirm-clear-count')
      : undefined,
    maxDocuments: integer(
      values.get('--max-documents'),
      DEFAULT_LIMIT,
      '--max-documents'
    ),
  };
}

function runtimeProject(): string | null {
  return process.env.GOOGLE_CLOUD_PROJECT ?? process.env.GCLOUD_PROJECT ?? null;
}

function verifyOptions(options: Options): void {
  if (!ALLOWED_PROJECTS.has(options.expectedProject)) {
    throw new Error('Project is not in the Hana allowlist');
  }
  if (runtimeProject() !== options.expectedProject) {
    throw new Error('Runtime project must exactly match --expected-project');
  }
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error('Emulator environments are refused');
  }
  if (!options.apply) {
    if (
      options.confirmProject !== undefined ||
      options.confirmProductionWrite !== undefined ||
      options.confirmSetCount !== undefined ||
      options.confirmClearCount !== undefined
    ) {
      throw new Error('Confirmation flags require --apply');
    }
    return;
  }
  if (
    options.confirmProject !== options.expectedProject ||
    options.confirmSetCount === undefined ||
    options.confirmClearCount === undefined
  ) {
    throw new Error('Apply requires exact project, set-count, and clear-count confirmations');
  }
  if (
    options.expectedProject === PRODUCTION_PROJECT &&
    options.confirmProductionWrite !== PRODUCTION_PROJECT
  ) {
    throw new Error('Production apply requires the exact production confirmation');
  }
}

async function scan(db: FirebaseFirestore.Firestore, maxDocuments: number) {
  const snapshot = await db.collection('users')
    .orderBy(admin.firestore.FieldPath.documentId())
    .limit(maxDocuments + 1)
    .get();
  if (snapshot.size > maxDocuments) {
    throw new Error('User scan is incomplete; increase --max-documents');
  }
  const set: string[] = [];
  const clear: string[] = [];
  for (const doc of snapshot.docs) {
    const decision = profileMediaVisibilityDecision(doc.data());
    if (decision === 'set') set.push(doc.id);
    if (decision === 'clear') clear.push(doc.id);
  }
  return { scanned: snapshot.size, set, clear };
}

async function apply(
  db: FirebaseFirestore.Firestore,
  candidates: { set: string[]; clear: string[] }
): Promise<void> {
  for (const uid of candidates.set) {
    const ref = db.collection('users').doc(uid);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (profileMediaVisibilityDecision(snap.data()) !== 'set') return;
      tx.update(ref, { profileMediaVisibilityVersion });
    });
  }
  for (const uid of candidates.clear) {
    const ref = db.collection('users').doc(uid);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (profileMediaVisibilityDecision(snap.data()) !== 'clear') return;
      tx.update(ref, {
        profileMediaVisibilityVersion: admin.firestore.FieldValue.delete(),
      });
    });
  }
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  if (options === 'help') {
    console.log(
      'Dry-run: --expected-project <id> [--max-documents N]\n' +
      'Apply: --apply --expected-project <id> --confirm-project <id> ' +
      '--confirm-set-count N --confirm-clear-count N'
    );
    return;
  }
  verifyOptions(options);
  admin.initializeApp({ projectId: options.expectedProject });
  const db = admin.firestore();
  const candidates = await scan(db, options.maxDocuments);
  const summary = {
    scanned: candidates.scanned,
    setCount: candidates.set.length,
    clearCount: candidates.clear.length,
  };
  if (!options.apply) {
    console.log(JSON.stringify(summary));
    return;
  }
  if (
    candidates.set.length !== options.confirmSetCount ||
    candidates.clear.length !== options.confirmClearCount
  ) {
    throw new Error('Live candidate counts differ from explicit confirmations');
  }
  await apply(db, candidates);
  console.log(JSON.stringify({ ...summary, applied: true, reAuditRequired: true }));
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
