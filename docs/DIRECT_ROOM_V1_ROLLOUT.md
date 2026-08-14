# Direct Room V1 Audit And Backfill Runbook

This runbook prepares the `directRoomVersion: 1` transition without guessing or
repairing ambiguous chat data. The Admin tool is dry-run by default. Nothing in
this document authorizes a Firebase deployment or a production write.

## Safety Contract

The tool marks an active `matches/{matchId}` document only when all of these are
true at audit time and again immediately before the write:

- `userIds` contains exactly two unique, non-empty string UIDs.
- There is exactly one valid active room for that exact participant tuple.
- The underscore-joined normalized pair key does not collide with another
  participant tuple.
- `chatPairs/{normalizedPairKey}` exists.
- The pointer document's ID, `pairKey`, and exact two participants agree.
- `activeMatchId` points to that one active room.
- A `chatPairs` document represents exactly one state: a non-empty
  `activeMatchId`, or a non-empty `closedMatchId`, never both and never neither.
- A closed pointer is healthy only when its referenced `matches` document still
  exists, has `isActive == false`, has the exact same two participants and
  normalized `pairKey`, and has no active room for that participant tuple.
  `closedReason` must agree on both documents when either document contains it.
- The room's optional `pairKey` is absent or agrees with the normalized key.
- `directRoomVersion` is absent. `null`, `0`, string values, and future versions
  are treated as conflicts and are never overwritten.

Duplicate rooms, malformed rooms, dangling active or closed pointers, empty
pointers, simultaneous active/closed IDs, inactive-state or participant/pair
mismatches, close-reason mismatches, pair-key collisions, and conflicting
markers are audit findings. A valid historical `closedMatchId` is counted as a
healthy closed pointer rather than an orphan. The marker tool does not close,
merge, relink, or otherwise repair findings. The narrowly reviewed repairs in
[Fail-Closed Finding Remediation](#fail-closed-finding-remediation) must run as
a separate manifest and operator decision before marker backfill.

Apply is idempotent. A room already marked `directRoomVersion: 1` is revalidated
and counted as an `alreadyMarked` no-op. Each write is a transaction that reads
the room and pointer again and performs a bounded participant-room scan with a
201st sentinel read. If the participant has more than 200 room documents,
automatic apply fails closed for that candidate instead of assuming the scan is
complete.

After the bounded `chatPairs` scan, the audit deduplicates every non-empty
`closedMatchId` and fetches those exact match documents in bounded Admin SDK
`getAll` chunks. The manifest records both references requested and documents
found. Missing documents remain explicit findings; they are never treated as a
normal historical pointer. The apply re-audit repeats the same closed-reference
fetch and classification, and each candidate transaction additionally requires
`closedMatchId` to remain absent on its active pointer.

## Privacy And Manifest Integrity

The JSON manifest contains counts, finding codes, and HMAC-SHA256 identifiers.
It does not contain raw UIDs, participant arrays, pair keys, pointer IDs, or room
IDs. This also protects legacy deterministic room IDs that may embed UIDs.

The HMAC key is external to the manifest. Keep it in a private operator
directory, never commit it, and retain the same key through audit, apply, and
the final invariant audit. The tool rejects group/world-readable key files.

Create a 32-byte key:

```bash
openssl rand -out /secure/operator/path/direct-room-hmac.key 32
chmod 600 /secure/operator/path/direct-room-hmac.key
```

The manifest is created with mode `0600` and exclusive-create semantics. The
tool will not overwrite an existing manifest path. Its SHA-256 digest covers the
full canonical manifest. Apply requires both a valid embedded digest and the
same digest supplied separately with `--manifest-digest`.

## Build And Local Verification

Use Node 22, then build and run the policy and CLI guard tests:

```bash
cd firebase/functions
npm run build
node --test test/directRoomMigrationPolicy.test.js test/directRoomMigrationCli.test.js
npm run lint
```

The compiled standalone entry point is:

```text
firebase/functions/lib/admin/directRoomMigration.js
```

It is not exported from `index.ts` and is not a deployed Cloud Function.

The separate finding-remediation entry point and its targeted tests are:

```bash
node --test test/directRoomRemediationPolicy.test.js test/directRoomRemediationCli.test.js
```

```text
firebase/functions/lib/admin/directRoomRemediation.js
```

It is also an operator-only Admin CLI and is not exported from `index.ts`.

## Staging Dry-Run Audit

Use a read-only staging operator credential where practical. Explicitly set the
runtime project and expected project; the tool requires them to match. Its
hardcoded allowlist contains only `hana-e2ee6` and `hana-production-tokyo`.

```bash
cd firebase/functions
npm run build
GOOGLE_CLOUD_PROJECT=hana-e2ee6 \
node lib/admin/directRoomMigration.js \
  --expected-project hana-e2ee6 \
  --manifest /secure/operator/path/staging-direct-room-audit.json \
  --hash-key-file /secure/operator/path/direct-room-hmac.key \
  --page-size 200 \
  --max-documents 10000
```

There is no write flag in this command. If either collection exceeds
`--max-documents`, the manifest records `scan.complete: false`, contains no
apply actions, and the process exits non-zero. Increase the explicit bound and
create a new manifest; do not edit the old file.

Review at minimum:

```bash
jq '{digest, scan, counts, findingCount: (.findings | length), actionCount: (.actions | length)}' \
  /secure/operator/path/staging-direct-room-audit.json
```

Finding hashes support comparison across runs made with the same HMAC key. They
are not an invitation to infer or publish user identities.

## Fail-Closed Finding Remediation

Run this separate tool before the marker apply when the audit contains either
of the two reviewed legacy states below. It selects no other repair:

1. It may close an active exact-two-participant room only when exactly one
   participant is currently active, the other participant's `users/{uid}`
   document is missing or carries a recognized account-deletion state, there
   is exactly one active room for the pair, the normalized pair key is
   unambiguous, and no `chatPairs` document or active/closed pointer claim is
   associated with the pair or room. The transaction sets `isActive: false`,
   ensures both UIDs are in `hiddenFor`, sets `closedBy` to the unavailable UID,
   and sets `closedReason: account_deleted` with server timestamps. It does not
   delete the room or touch `matches/{matchId}/messages`, so historical messages
   remain preserved and hidden.
2. It may remove `closedMatchId` and `closedReason` from an otherwise exact
   active pointer only when the pointer and active room are unique and valid,
   both current participants are active, and the referenced historical room is
   inactive and belongs to the exact same pair. Supported reason shapes are an
   exact matching non-empty string on both documents, exact field absence
   (`undefined`) on both documents, or the reviewed legacy shape where the
   pointer reason is absent while the historical room retains a non-empty
   string. A present pointer reason with an absent historical reason, unequal
   present strings, `null`, an empty string, or another type remains a finding.
   Those two stale pointer fields are the only fields removed.

Missing prerequisites, multiple active rooms, any pointer claim on an orphan
room, malformed identities, pair-key collisions, unsupported markers, hidden
current rooms, missing or mismatched history, ineligible current users, and
duplicate pointer claims remain findings and are never written.

The manifest records pointer and historical reason state separately, and
protects each reason with a separately domain-separated HMAC over its state
sentinel. Therefore pointer/history state cannot be interchanged and an absent
reason cannot collide with a literal reason string. The apply transaction
rechecks the pointer's exact absence or exact string and the historical room's
independently approved exact absence or string before deleting the stale
pointer fields. Manifests created by an older remediation policy version are
rejected; always create a fresh dry-run manifest after updating the tool.

Create a new private manifest path; the CLI refuses to overwrite any existing
file. It is dry-run by default and uses the same external HMAC-key requirements
described above:

```bash
cd firebase/functions
npm run build
GOOGLE_CLOUD_PROJECT=hana-e2ee6 \
node lib/admin/directRoomRemediation.js \
  --expected-project hana-e2ee6 \
  --manifest /secure/operator/path/staging-direct-room-remediation.json \
  --hash-key-file /secure/operator/path/direct-room-hmac.key \
  --page-size 200 \
  --max-documents 10000
```

The manifest contains only counts, finding codes, HMAC-protected identifiers,
an audit fingerprint, and tamper-evident digests. An incomplete bounded scan
contains zero actions and exits non-zero. Review both action kinds and all
remaining finding codes before considering apply:

```bash
jq '{
  digest,
  auditDigest,
  scan,
  counts,
  findingsByCode: (.findings | group_by(.code) | map({code: .[0].code, count: length})),
  actionsByKind: (.actions | group_by(.kind) | map({kind: .[0].kind, count: length}))
}' /secure/operator/path/staging-direct-room-remediation.json
```

On the latest 2026-08-13 read-only staging snapshot, the expected reviewed
action counts were five unavailable-participant room closures and one
stale-pointer cleanup whose pointer omitted `closedReason` while its validated
inactive historical room retained a non-empty reason. This is only a staleable
comparison point: copy the exact counts and digest from the newly generated
manifest, and stop if the current result is not reconciled with a fresh audit.

Apply requires exact project, per-action counts, manifest digest, scan bounds,
and HMAC key confirmations. Before any transaction, it performs a full live
re-audit and requires the audit fingerprint and entire candidate set to remain
identical to the approved manifest. Every action then has its own transaction
that re-reads the affected room, pointer, participants, historical room, and
bounded uniqueness queries:

```bash
GOOGLE_CLOUD_PROJECT=hana-e2ee6 \
node lib/admin/directRoomRemediation.js \
  --apply \
  --expected-project hana-e2ee6 \
  --confirm-project hana-e2ee6 \
  --confirm-close-count <exact-close-count> \
  --confirm-pointer-cleanup-count <exact-pointer-cleanup-count> \
  --manifest /secure/operator/path/staging-direct-room-remediation.json \
  --manifest-digest <copy-the-64-character-digest> \
  --hash-key-file /secure/operator/path/direct-room-hmac.key \
  --page-size 200 \
  --max-documents 10000 \
  --apply-batch-size 20 \
  --max-apply-actions 2000
```

Production apply additionally requires:

```text
--confirm-production-write hana-production-tokyo
```

Do not run it without separate production approval and a production-generated
manifest. Apply is always refused against the Firestore emulator. Emulator
audit requires the explicit `--allow-emulator` flag.

If an action succeeds and a later action fails, do not retry the original
manifest. The state fingerprint has correctly changed. Generate and review a
new manifest for only the remaining current candidates. After any successful
apply, generate a new remediation manifest at a new path with the same key and
require both action counts to be zero. Then run the normal direct-room audit
again. Only proceed to marker backfill after every residual finding is reviewed
and the normal audit reports the expected healthy/candidate state.

## Staging Apply

Apply requires all of the following independently:

- `--apply`
- allowlisted `--expected-project`
- matching runtime `GOOGLE_CLOUD_PROJECT`
- exact matching `--confirm-project`
- verified manifest file and matching HMAC key
- the manifest digest copied into `--manifest-digest`
- a complete live re-audit within the configured document bounds

```bash
GOOGLE_CLOUD_PROJECT=hana-e2ee6 \
node lib/admin/directRoomMigration.js \
  --apply \
  --expected-project hana-e2ee6 \
  --confirm-project hana-e2ee6 \
  --manifest /secure/operator/path/staging-direct-room-audit.json \
  --manifest-digest <copy-the-64-character-digest> \
  --hash-key-file /secure/operator/path/direct-room-hmac.key \
  --page-size 200 \
  --max-documents 10000 \
  --apply-batch-size 20 \
  --max-apply-actions 2000
```

The re-audit may accept a manifest action that is already safely marked, which
makes a retry safe after a partial operator or network failure. It rejects a
manifest action that became missing or ambiguous, and rejects any newly found
unapproved backfill candidate.

Production apply additionally requires the exact phrase-like confirmation:

```text
--confirm-production-write hana-production-tokyo
```

Do not run production apply without explicit production approval. A successful
staging run is not that approval.

## Required Invariant Re-Audit

After apply, write a new manifest path with the same key and the dry-run command.
Do not proceed to client/rules rollout unless:

- `scan.complete` is `true`.
- `counts.candidateBackfills` is `0`.
- every valid active room is counted as healthy.
- `scan.closedMatchReferencesRequested` equals
  `scan.closedMatchDocumentsFound`, and every verified historical pointer is
  counted in `counts.healthyClosedPointers`.
- duplicate, malformed, collision, marker, and pointer findings are `0`.
- any unexpected count change has been reconciled against deployment timing.

Keep the before/after manifests and their digests in restricted operational
storage. Do not commit them to the repository.

## Rollout Order

Use this order per environment. Stop at any failed gate:

1. Deploy the new-write Functions code that sets `directRoomVersion: 1` on every
   newly created or safely reused room. Keep the environment's existing single
   trigger region: staging `hana-e2ee6` uses `us-central1`, while production
   `hana-production-tokyo` uses `asia-northeast1`. Never duplicate the trigger
   set across regions in one project.
2. Run the complete dry-run audit and review every finding class. If and only
   if either reviewed legacy state is present, run the separate remediation
   dry-run, explicitly confirmed apply, fresh zero-action remediation audit,
   and a fresh normal audit.
3. Preserve the new normal-audit manifest digest, run the explicitly confirmed
   marker backfill, then run a fresh invariant re-audit.
4. Deploy the `userIds + isActive + directRoomVersion` composite index and wait
   until Firebase reports it as `READY`. Do not infer readiness from deploy
   command success alone.
5. Release an internal app build and verify active chat lists, room reuse,
   leave/restart behavior, unread state, and direct chat on real staging data.
6. Only after internal verification and supported-version gating, enable the
   marker-dependent query and tightened rules for the wider rollout.

Do not deploy rules or the marker-dependent public client before the backfill
and index gates. Existing unmarked valid rooms would otherwise disappear from
active chat lists.

## Rollback Boundary

The backfill only adds `directRoomVersion: 1` to records that satisfy the strict
invariant. Do not mass-remove the marker as an automatic rollback. If client or
rule rollout fails, first roll back the client/rules/query dependency while
preserving audited server data, then investigate. Any data mutation beyond this
single marker requires its own reviewed migration and manifest.
