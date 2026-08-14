# Private media path and token migration

This runbook removes durable Firebase download URLs from new profile and chat
media. The durable application value becomes the first-party Storage object
path. Flutter sends that path to the Auth + App Check protected
`getPrivateMediaBytes` callable. The callable revalidates account, visibility,
block, current-reference, and active-room state before and after a
generation-pinned download, then returns at most one 5 MiB JPEG in memory.

No live Firebase audit, write, or deployment was performed while preparing this
runbook or its admin tool.

## Non-negotiable rollout order

1. Complete the direct-room v1 audit/backfill first. Every healthy active chat
   room must have the server-owned `directRoomVersion == 1` marker, and the
   `startChat`/room-creation backend must be READY to write it on every new room.
2. Integrate `profileMediaVisibilityVersion == 1` into successful onboarding
   and profile-update server transactions, and clear it whenever the profile
   ceases to satisfy the full server `isPublicUserProfile` predicate. Audit and
   backfill only profiles that pass that same exact server predicate with
   `profileMediaVisibilityBackfill.js`.
3. Do **not** deploy the strict private-media Storage Rules before steps 1-2.
4. Integrate and locally verify the path-only Functions contract, private-media
   read callable, protocol V2 reservation callable, and server-owned byte-upload
   callable listed below. Do not deploy these V2 Functions over staging rules
   that still permit client canonical create.
5. Prepare a client that reads canonical paths through the callable, reads
   legacy Hana Firebase URLs only when no path exists, writes paths only, and
   uploads through the V2 callables only.
6. In staging only, schedule one destructive maintenance window after backfills
   and minimum-version enforcement prove no supported staging legacy/V1 writer
   remains. Announce temporary media unavailability, deploy indexes and wait for
   `READY`, deploy strict Firestore+Storage Rules with canonical create=false,
   verify the live rule hashes read-only against the reviewed local strict
   candidate, immediately deploy V1+V2 Functions, install the V2 APK, then run
   full E2E. Only afterward enable the exact staging project's server-owned
   `privateMediaRolloutControls/legacyFinalizeCleanup` control and run the
   reviewed migration/drain sequence below.
7. Keep production on its existing transitional rules while the reviewed
   canonical path-only V2-equivalent client is prepared for distribution.
   Functions and indexes may be prepared and validated locally, but the guarded
   production Functions deploy remains blocked until the separately reviewed
   transitional artifact and executable V1/V2 matrix exist. Do not deploy this
   repository's strict `storage.rules`, run a destructive migration apply, or
   enable legacy-finalize cleanup during that transition.
8. Only after production V2-equivalent adoption is enforced by the supported-
   version gate may a separately reviewed and explicitly approved production
   cutover deploy strict Storage Rules, enable legacy-finalize cleanup for the
   exact production project, and run audit/apply/re-audit plus the access
   matrix.
9. Complete the legacy resumable-session drain for each environment after its
   strict cutover. Staging completion never authorizes or proves production
   cutover readiness.

Here, "V2-equivalent" means the canonical path-only client and callable
read/upload contract: reserve through `reserveMediaUploadV2`, transmit the JPEG
only to `uploadPrivateMediaBytes`, and persist only the confirmed
canonical path. It does not mean Storage Rules `rules_version = '2'`.

The legacy `reserveMediaUpload` + direct client Storage create +
`confirmMediaUpload` protocol is V1. Its Functions endpoints must remain
available during the production transition for supported old clients, but it
is not permitted by this repository's strict `firebase/storage.rules` because
canonical `create` is `false`. There is no reviewed production transitional
Storage Rules artifact in this repository. Therefore production Functions may
not currently be deployed by the guarded script: it requires the separately
reviewed `firebase/storage.production.transitional.rules`, executable
`firebase/test/storage.production.transitional.rules.test.js` V1/V2 matrix,
and `firebase/production-transitional-media-contract.json` SHA-256 manifest.
Do not populate these files by blindly exporting live rules. Production Storage
Rules must remain untouched until that reviewed evidence exists, or until the
minimum-version gate excludes every V1 writer and the destructive strict
cutover is explicitly approved.

The legacy URL renderer is a rollout bridge, not a fallback after an
authorization failure. If a document has a canonical path and the callable
read is denied, the UI must fail closed rather than retrying a bearer URL.

## Required `index.ts` integration

The following backend integration must land atomically before a new V2 client
sends image messages:

- `reserveMediaUploadV2`: perform the full account/room/block/pair and daily
  count checks, create a random authorization-bound canonical path, mark the
  ledger `uploadProtocolVersion: 2`, and return only non-secret reservation
  data. It must never make the reservation a client Storage capability.
- `uploadPrivateMediaBytes`: accept only the exact reserved
  authorization and bounded canonical base64 JPEG, take a Firestore upload
  lease, decode/re-encode pixels, write the canonical object with a generation
  precondition, no download token, exact private/no-store metadata, and exact
  protocol/lease/digest markers, then re-read and verify the immutable
  generation before marking it confirmed. The callable returns only
  `{authorizationId, path}`.
- Configure replay protection on `uploadPrivateMediaBytes` with
  `consumeAppCheckToken: true`, require the Flutter caller to request a
  limited-use App Check token, and grant `roles/firebaseappcheck.tokenVerifier`
  to the exact Gen 1 App Engine default runtime service account before deploy.
  The staging and production deploy scripts must verify that binding read-only
  and fail closed when it is absent.
- Keep legacy `reserveMediaUpload` and `confirmMediaUpload` V1 endpoints
  behaviorally stable only for a reviewed production compatibility interval.
  New V2 clients must not call either endpoint and must never invoke Storage
  SDK `putFile`/`putData` for canonical paths.
- `mediaUploadConfirmationLeaseIssue` and
  `confirmedMediaUploadAuthorizationIssue`: bind owner, object path,
  generation, and size; remove URL equality from the lease contract.
- `consumeMediaAuthorization`: bind the confirmed path/generation/size only.
- `protectedProfileMediaEntries`: accept caller-owned canonical
  `profile_media/{uid}/{authorizationId}/image.jpg` paths and stop carrying an
  `imageUrl` member. The transitional `photoUrls` Firestore field may contain
  paths; its name must not cause URL validation to be reintroduced.
- `completeOnboarding` and `updateMyProfile`: write canonical path values only.
  In the same successful transaction, set
  `profileMediaVisibilityVersion: 1`; never accept this marker from client
  input. Any administrative/profile mutation that makes the full public-profile
  predicate false must clear the marker.
- `sendMessage`: accept `imagePath`, consume its authorization, and write
  `imagePath`; do not accept or write `imageUrl` for a new message.
- `getPrivateMediaBytes`: require Auth and App Check. Profile reads must verify
  active viewer/owner, current `photoUrls`, public visibility for non-owners,
  and bilateral blocks. Chat reads must verify the durable image-message
  reference, exact active direct-room participants, both accounts, hidden
  state, and bilateral blocks. Validate private token-free metadata and the
  full JPEG, download the inspected immutable generation only, re-run the
  access predicate after Storage I/O, and return bounded base64 bytes.
  Charge each request attempt before metadata access at 60 attempts per minute
  and 2,000 attempts per UTC day. After validated metadata supplies the object
  size, reserve bytes separately up to 250 MiB per UTC day before download.
  Keep both updates transactional and bound concurrent instances so denied
  callers cannot continue consuming Storage metadata or full-object egress.
- Public profile and chat DTOs: expose canonical paths. Existing stored HTTPS
  fields may be returned read-only during the rollout, but no callable may copy
  a legacy URL into a new write.
- `deleteMyProfilePhoto` and account deletion: resolve canonical object paths
  directly. Continue accepting a verified first-party legacy URL only for
  deletion/backfill, never for a new profile write.

## Storage Rules contract

Direct `profile_media` and `chat_images` get/list/create/update/delete operations
are always denied in the strict rules. Reading these relationships directly in
Storage Rules is not a safe substitute: one evaluation may access at most two
Firestore documents, while Hana must prove viewer and owner accounts plus
bilateral blocks (and, for chat, the room and both participants). The callable
performs the full read check, and the Admin SDK inside the server-owned upload
callable is the only canonical writer.

`reserveMediaUploadV2` issues a short-lived ledger and random path, not a
Storage bearer capability. `uploadPrivateMediaBytes` and the final
profile/message transaction each revalidate live account, deletion, room,
pair, and block state. An upload racing a block, leave, or deletion therefore
cannot become visible. Strict canonical create=false is intentional and must
not be weakened to restore V1 client uploads.

Legacy V1 Cloud Storage resumable sessions can outlive the five-minute
application reservation. An expired reservation with no object therefore becomes a
non-consumable tombstone instead of remaining in the first cleanup page, and
that tombstone is retained for 15 days. A delayed finalize for a missing,
expired, rejected, or account-deletion-revoked authorization claims and deletes
only the event's exact immutable generation. Consumed objects are preserved
only when the current active profile or active direct-room image message still
provides the durable publication proof.

Account deletion uses the same safety window. Its authorization documents are
rewritten as `account_deletion_revoked` tombstones and retained for 15 days so a
late immutable generation still has server-owned denial/cleanup evidence.
Therefore total `mediaUploadAuthorizations` is not a zero gate during that
window. Every remaining document must be an expected revoked tombstone with no
download-token or URL fields, no `expiresAt`, and a bounded `expireAt`. Every
other state must be zero, including `reserved`, `uploaded`, `confirming`,
`confirmed`, `consumed`, and `cleanup_required`; owned Storage objects and
private quota/FCM state must still be exactly zero.

The daily/minute quota ledgers are intentionally separate from authorization
tombstones. Firestore `expireAt` TTL policies must be deployed and verified for
`mediaUploadQuotas`, `mediaUploadRequestQuotas`, and
`privateMediaReadQuotas` in each exact environment. The scheduled worker's
bounded deletion pages are defense-in-depth for delayed TTL processing, not a
replacement for those policies; index `READY` plus all three enabled TTL
policies is a rollout gate in staging and production.

The server-owned V2 upload writes and then verifies the real object
`cacheControl` header and the exact custom private/protocol/lease/digest
markers. Strict Storage Rules do not authorize canonical create at all, so
those markers are server integrity and crash-recovery evidence rather than a
client-write permission check.

### Legacy resumable-session cutover and drain

The environment-specific server control is the Firestore document
`privateMediaRolloutControls/legacyFinalizeCleanup`. It is accepted only when
`enabled == true` and its exact `projectId` and `environment` match the loaded
Functions deployment tuple. Keep it disabled or absent while any legacy writer
is supported. Enabling it early makes the finalize trigger delete objects
written to legacy prefixes, so never copy a staging control into production.

At an environment's strict cutover:

1. Record the UTC time of the last accepted legacy write and verify that the
   minimum-version gate excludes legacy writers.
2. Deploy and verify strict Storage Rules that deny new legacy-prefix writes.
3. Through the reviewed environment-bound admin procedure, set that exact
   project's control to `{enabled:true, projectId:<exact>, environment:<exact>}`
   and verify the existing regional `onReservedMediaUploaded` trigger reads it.
   The control does not require a Functions redeploy.
4. Because the rules/control transition is not atomic, immediately re-run the
   complete bucket/media audit after the control is effective.
5. Keep cleanup enabled for at least 15 days from the last accepted legacy
   write. This covers the one-week resumable-session lifetime, the Gen 1 event
   retry window, and the safety margin used by authorization tombstones.

The drain is complete only when repeated checks show no pending
`mediaUploadGenerationCleanups`, no unresolved legacy-finalize cleanup errors,
and a stable zero-action bucket/media audit. Prefer leaving the control enabled
while strict rules continue to forbid every legacy prefix; disabling it is not
part of the normal rollback path.

## Audit tool

Before strict rules, audit profile visibility markers (dry-run only by default):

```bash
cd firebase/functions
npm run build
GOOGLE_CLOUD_PROJECT=hana-e2ee6 \
node lib/admin/profileMediaVisibilityBackfill.js \
  --expected-project hana-e2ee6
```

Apply requires exact live `setCount` and `clearCount` confirmations printed by
the immediately preceding dry-run, plus project confirmation (and the
production confirmation flag in production). Re-run dry-run and require both
counts to be zero before strict Storage Rules deploy.

Build first:

```bash
cd firebase/functions
npm run build
```

The tool scans user photo references, every message document, denormalized
profile-photo snapshots in rooms/posts/comments/replies/block entries, all
canonical objects under `profile_media/` and `chat_images/`, and historical
profile objects under `users/` and `profile_photos/`. These snapshots are
changed to paths before token revocation so existing avatars do not silently
break. Historical objects remain blocked by Storage Rules, but their bearer
tokens and public cache headers are still removed so a copied old URL cannot
bypass those rules. The tool writes a new mode-0600 manifest, never overwrites
an existing file, and is dry-run unless `--apply` is supplied.

```bash
umask 077
GOOGLE_CLOUD_PROJECT=hana-e2ee6 \
node lib/admin/privateMediaMigration.js \
  --expected-project hana-e2ee6 \
  --manifest /secure/private-media-staging.json
```

Review only summary counts in normal logs. The manifest contains document and
object paths and must remain in an encrypted/private location. Apply is refused
when a scan is bounded/incomplete or any finding remains.

Typical blocking findings:

- `legacy-profile-object-requires-copy`: an old `users/{uid}/...` or
  `profile_photos/{uid}/...` object cannot simply become a canonical path. Copy
  it through the trusted JPEG decode/re-encode sanitizer into a new reserved
  `profile_media` object, update the document, then revoke/delete the old
  object.
- `invalid-profile-references`: external, malformed, or wrong-owner reference.
- `invalid-image-message-reference`: malformed or wrong room/sender reference.
- `conflicting-image-message-reference`: stored path and URL identify different
  objects; resolve from authorization/audit evidence rather than guessing.
- `missing-referenced-object`: repair/remove the stale document reference.

After manual remediation, create a new audit manifest. Never edit a manifest by
hand.

### Preserving an actively referenced legacy profile photo

Never copy a legacy object byte-for-byte. The operator-only preservation tool
downloads only a currently referenced, first-party owner object, decodes its
pixels with `sharp`, applies orientation, resizes to Hana's dimension/pixel
budget, and writes a new metadata-free JPEG beneath `profile_media/`. The
result is checked again with the same strict JPEG marker policy used by the
server. Audit is the default; its manifest is mode 0600 and cannot be
overwritten. This preservation manifest contains the exact current
`photoUrls` values, including any legacy bearer URL and download token. Keep it
in an encrypted/private location, never paste it into logs or tickets, and
destroy it through the approved secret-file process after the rollout evidence
has been retained. Apply refuses a symlink, a non-regular file, any permission
mode other than 0600, a manifest older than 24 hours, or any schema, project,
bucket, count, path, fingerprint, or digest drift.

```bash
cd firebase/functions
npm run build
umask 077
GOOGLE_CLOUD_PROJECT=hana-e2ee6 \
/opt/homebrew/opt/node@22/bin/node \
  lib/admin/legacyProfileMediaPreservation.js \
  --expected-project hana-e2ee6 \
  --manifest /secure/legacy-profile-preservation-staging.json
```

Apply requires the exact project, digest, and action count from that dry-run.
When a non-default `--max-users` was used for audit, repeat the same exact value
for apply. The manifest must still be less than 24 hours old.

```bash
GOOGLE_CLOUD_PROJECT=hana-e2ee6 \
/opt/homebrew/opt/node@22/bin/node \
  lib/admin/legacyProfileMediaPreservation.js \
  --apply \
  --expected-project hana-e2ee6 \
  --confirm-project hana-e2ee6 \
  --confirm-action-count <exact-actions-from-dry-run> \
  --manifest /secure/legacy-profile-preservation-staging.json \
  --manifest-digest <exact-digest-from-dry-run>
```

Production also requires
`--confirm-production-write hana-production-tokyo`. Apply revalidates the
source generation and metadata,
the sanitized output digest, and the exact current user state. If a later media
write or the final user transaction fails, it deletes and zero-verifies only
the exact object generations newly created by that action; a verified object
that existed before the action is never deleted. Any cleanup verification
failure is fatal.

Re-audit immediately afterward with a new no-overwrite manifest and require
zero preservation actions/findings. Preservation does **not** revoke the old
legacy object's bearer token; do not treat this pass as privacy migration
completion or pause the sequence. Continue through stale-reference remediation
and then `privateMediaMigration.js`, which removes legacy/canonical download
tokens and normalizes private cache metadata. The preservation tool
deliberately does not restore a photo that is present only in a historical room,
post, comment, reply, or block snapshot; those stale references must be cleared
by the separate remediation pass.

### Clearing stale profile-photo snapshots

Run `staleProfileMediaReferenceRemediation.js` **after** the trusted
preservation/re-encode pass and **before** the general token/path migration.
This ordering is mandatory:

1. Trusted preservation gives a real current legacy owner a sanitized canonical
   `profile_media/{uid}/...` photo.
2. Stale-reference remediation clears snapshots whose exact owner has no
   canonical/current photo and handles narrowly proven missing owners.
3. `privateMediaMigration.js` converts the remaining exact first-party legacy
   snapshots to the preserved canonical path and revokes tokens/cache metadata.

The stale-reference tool never copies a snapshot photo back into a user
profile. A user whose sole current `photoUrls` value is legacy remains the
blocking `legacy-current-photo-requires-trusted-reupload` finding; do not
auto-clear, auto-copy, or remove that current photo. Run the trusted
preservation tool first and create a new stale-reference audit manifest.

The bounded audit covers all user documents, posts, comments, replies, block
entries, and matches. It preserves the legacy positional match contract:
`photoUrl` belongs to `userIds[1]`, `myPhotoUrl` belongs to `userIds[0]`, and
`partnerFor.{viewerUid}.photoUrl` belongs to the other exact participant. It
also batch-checks Firebase Auth only for referenced UIDs whose Firestore user
document is absent. An Auth lookup error or incomplete Firestore scan aborts or
produces no applyable actions.

For an existing owner with an exact empty/absent current photo list, the tool
sets only the audited snapshot field to `''`. For a missing Firestore owner:

- match, comment, reply, and block snapshots are cleared only after Auth
  absence and the exact owner/value relation are revalidated;
- a post tree is deleted only when both the user document and Auth record are
  absent and the unchanged audited `authorPhotoUrl` is strict HTTPS external
  or non-first-party media;
- `reports` and unrelated documents remain untouched. Only the exact post
  subtree and its same-ID `post_likes` subtree are recursively removed and
  zero-verified.

An exact target-project Firebase legacy URL for an owner who already has a
canonical current photo is deliberately not rewritten by this tool. It is
counted as `scan.counts.deferredFirstPartyReferences` and left for the next
`privateMediaMigration.js` pass. This informational count prevents a circular
block between the two tools. Cross-project, external, malformed, wrong-owner,
and stale canonical-path mismatches remain blocking findings.

Staging dry-run (default, no writes):

```bash
cd firebase/functions
npm run build
umask 077
GOOGLE_CLOUD_PROJECT=hana-e2ee6 \
/opt/homebrew/opt/node@22/bin/node \
  lib/admin/staleProfileMediaReferenceRemediation.js \
  --expected-project hana-e2ee6 \
  --manifest /secure/stale-profile-media-staging.json
```

Normal output contains counts and the digest, not UIDs, document paths, or
photo URLs. The new manifest is a no-overwrite mode-0600 file and may contain
sensitive exact paths/values, so keep it encrypted/private and never edit it.
Apply is refused for an incomplete scan, any blocking finding, a manifest older
than 24 hours, an action count above the configured cap, an emulator, or any
project/digest/count drift.

Staging apply syntax (documented only; review the immediately preceding dry-run
manifest first):

```bash
GOOGLE_CLOUD_PROJECT=hana-e2ee6 \
/opt/homebrew/opt/node@22/bin/node \
  lib/admin/staleProfileMediaReferenceRemediation.js \
  --apply \
  --expected-project hana-e2ee6 \
  --confirm-project hana-e2ee6 \
  --confirm-action-count <exact-actions-from-dry-run> \
  --manifest /secure/stale-profile-media-staging.json \
  --manifest-digest <exact-digest-from-dry-run>
```

Production additionally requires this exact phrase:

```text
--confirm-production-write "I UNDERSTAND HANA PRODUCTION STALE MEDIA WRITES"
```

Apply performs a fresh complete live re-audit, rejects every newly discovered
or changed action, groups fields for one document in one Firestore transaction,
and checks missing Auth owners before and after each mutation. It finishes with
another complete audit that must have zero blocking findings and zero actions.
Because Auth and Firestore cannot share one transaction, operators must still
create a fresh no-overwrite dry-run manifest after apply and require zero
findings/actions before proceeding to `privateMediaMigration.js`.

Staging apply example:

```bash
GOOGLE_CLOUD_PROJECT=hana-e2ee6 \
node lib/admin/privateMediaMigration.js \
  --apply \
  --expected-project hana-e2ee6 \
  --confirm-project hana-e2ee6 \
  --manifest /secure/private-media-staging.json \
  --manifest-digest <digest-printed-by-audit>
```

Production additionally requires the exact explicit confirmation:

```text
--confirm-production-write hana-production-tokyo
```

Apply operations are idempotent. Firestore transactions compare the audited
reference before updating it. Storage metadata updates compare both generation
and metageneration before removing tokens and setting private cache metadata.
Any drift aborts the run; create a fresh audit manifest rather than bypassing a
precondition.

## Post-apply verification

Create a new audit manifest and require:

- `scan.complete == true`;
- zero findings;
- zero profile, message, and Storage actions;
- no `firebaseStorageDownloadTokens` on canonical or historical profile media;
- exact private/no-store cache header and marker on every scanned media object.

For an account-deletion UID, do not require the total authorization-document
count to be zero during the 15-day late-finalize window. Require zero active,
consumable, or pending-cleanup states and allow only the verified
`account_deletion_revoked` tombstones described above.

Then verify with two real staging accounts:

1. Active, unblocked participants can load the room image through the
   callable.
2. A non-participant cannot read or list the room prefix.
3. After block, leave/close, hide, ban, or deletion start, the affected callable read
   is denied.
4. A visible profile image is readable by an active unblocked signed-in user;
   signed-out, blocked, banned, deleting, and hidden-profile viewers are denied
   as specified.
5. A copied pre-migration token URL no longer retrieves the object. Do not put
   the token URL itself in logs, screenshots, tickets, or chat.

Token revocation prevents future bearer-URL requests but cannot recall bytes
already downloaded to another device. This is why new path reads use in-memory
callable bytes and new objects use `private, no-store, max-age=0`; restoring durable
download tokens is not an acceptable rollback.
