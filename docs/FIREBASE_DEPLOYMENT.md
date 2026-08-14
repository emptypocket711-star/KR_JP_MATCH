# Firebase Deployment Guide

Use this guide when deploying Hana backend changes.

## Firebase Environments

Current aliases in `.firebaserc`:

- `staging`: `hana-e2ee6`
- `default`: `hana-e2ee6`
- `production`: `hana-production-tokyo`

Treat `hana-e2ee6` as staging and `hana-production-tokyo` as production. Client
builds select these projects through explicit Android flavors as documented in
`docs/FIREBASE_CLIENT_ENVIRONMENTS.md`. Do not use staging for a real store
production launch, and do not deploy to production without explicit approval.

Functions use an environment-specific single-region contract:

| Environment | Project | Functions region | 2026-08-13 read-only inventory |
| --- | --- | --- | --- |
| Staging | `hana-e2ee6` | `us-central1` | 37/37 Functions |
| Production | `hana-production-tokyo` | `asia-northeast1` | 47/47 Functions |

Never copy Firestore, Auth, Storage, or scheduled triggers between these
regions. Each project owns one trigger set in its existing region.

## Current Project

```bash
firebase use
```

The repository's `default` alias is staging (`hana-e2ee6`). However,
`firebase use` is mutable local state and may show a previously selected
project. Treat its output as diagnostic only. Every maintained deploy script
uses an explicit project ID and never relies on the active CLI selection.

Repository default:

```text
hana-e2ee6
```

Prefer the guarded scripts in `scripts/` instead of manually typing deploy
commands.

Before deploy work, verify the rollout contract and the hermetic deploy-guard
tests:

```bash
node scripts/validate_private_media_rollout_contract.js
scripts/test_firebase_deploy_guards.sh
```

There is no production environment validator or production deploy
implementation in this change set. `scripts/deploy_prod_firebase.sh` is an
executable deny-only sentinel and rejects every target before any CLI or cloud
lookup. Production stays NO-GO until a separately reviewed transition PR
replaces that sentinel and adds its executable artifact matrix.

## Pre-Deploy Checks

When a Functions change touches `keyCount`, point grants, or point consumes,
complete the staging-only trust audit and re-audit gate in
`docs/POINT_BALANCE_TRUST_ROLLOUT.md` before deploying those Functions.

Run from the repository root:

```bash
cd firebase/functions
npm run build
cd ../..
cd firebase/test
npm test
cd ../..
flutter analyze
flutter test
git diff --check
```

The rules test script uses the Firestore emulator. On this Mac it falls back to
Android Studio's bundled JBR if `JAVA_HOME` is not already set.

For an Android release build:

```bash
scripts/build_prod_aab.sh
```

Mock data is off by default and `ALLOW_MOCK_DATA=true` is intentionally ignored
in release/profile builds.

Release App Bundles fail closed unless upload signing is configured. Set these
environment variables before building an AAB intended for Play Console:

```bash
export HANA_UPLOAD_KEYSTORE=/absolute/path/to/upload-keystore.jks
export HANA_UPLOAD_STORE_PASSWORD=...
export HANA_UPLOAD_KEY_ALIAS=...
export HANA_UPLOAD_KEY_PASSWORD=...
scripts/build_prod_aab.sh
```

By default, store builds use these GitHub Pages legal URLs:

```text
https://emptypocket711-star.github.io/KR_JP_MATCH/legal/terms/
https://emptypocket711-star.github.io/KR_JP_MATCH/legal/privacy/
https://emptypocket711-star.github.io/KR_JP_MATCH/legal/community-safety/
https://emptypocket711-star.github.io/KR_JP_MATCH/legal/account-deletion/
```

Override them with `HANA_TERMS_URL`, `HANA_PRIVACY_URL`,
`HANA_COMMUNITY_SAFETY_URL`, and `HANA_ACCOUNT_DELETION_URL` if the published
location changes.

For local compile-only QA, the automated QA script may opt into debug signing
with `HANA_ALLOW_DEBUG_RELEASE_SIGNING=true`. Do not upload that AAB to Play
Console.

## Android Run And Build

Run a staging debug build on the default connected Android device:

```bash
scripts/run_staging_android.sh
```

Run a staging debug build on a specific Android device:

```bash
scripts/run_staging_android.sh <android-device-id>
```

Build a production-mode Android App Bundle:

```bash
scripts/build_prod_aab.sh
```

The production AAB script uses release mode and disables mock data and QA email
login. It requires upload signing variables unless
`HANA_ALLOW_DEBUG_RELEASE_SIGNING=true` is explicitly set for local compile-only
QA.

## App Check

Debug or QA devices must have their App Check debug token registered in Firebase
Console before testing callable functions.

The Android debug token appears in runtime logs like:

```text
Enter this debug secret into the allow list in the Firebase Console for your project: <token>
```

## Deploy Order

For ordinary callable migrations such as profile editing, deploy the compatible
Functions before tightening the corresponding client Firestore writes. Private
media is the explicit exception: staging uses the destructive strict-Rules-first
maintenance sequence below, and production Functions remain blocked until the
reviewed transitional artifact and V1/V2 matrix exist. The current Flutter app
depends on new callables such as:

- `listDiscoveryProfiles`
- `getPublicProfile`
- `retryMessageTranslation`
- `listLoungePosts`
- `getLoungePost`
- `listLoungeComments`
- `togglePostLike`
- `updateMyProfile`
- `reserveMediaUpload`
- `reserveMediaUploadV2`
- `uploadPrivateMediaBytes`
- `confirmMediaUpload`

`updateMyProfile` requires a compatibility rollout because older app builds
write profile fields directly to `users/{uid}`. Deploying the tightened
Firestore rule before users have a callable-capable app would break profile
editing for those builds. Use this order in each environment:

1. Deploy Functions with `updateMyProfile` while the existing rules are still in
   place.
2. Release and verify the callable-capable app, including App Check, profile
   editing, display-name conflict handling, and legacy adult-profile editing.
3. Enforce the project's minimum supported app version or otherwise confirm the
   old direct-write build is no longer served.
4. Only then deploy the tightened Firestore rules that reject direct profile and
   identity writes.

For production, repeat the same sequence only after explicit production
approval. A staging pass or static test result does not prove production rollout
readiness.

### Media upload compatibility rollout

New app builds reserve every profile/chat JPEG through `reserveMediaUploadV2`
and send the bounded base64 JPEG only to `uploadPrivateMediaBytes`.
The server takes an authorization lease, decodes/re-encodes pixels, creates the
canonical object with an immutable-generation precondition and token-free
private metadata, re-reads it, and confirms the ledger. Strict Storage Rules
deny direct canonical `create` as well as get/list/update/delete; the client
must never call Storage SDK `putFile`/`putData` for a canonical path. The
profile/chat save callable then consumes the authorization. Private
APP1-APP15/comment metadata, malformed/trailing markers, dimensions above
2400px, and images above four megapixels are rejected before publication.

`uploadPrivateMediaBytes` consumes a limited-use App Check token to prevent
replay. Because these are Gen 1 Functions with default Admin SDK credentials,
the exact environment's App Engine default service account
(`<project-id>@appspot.gserviceaccount.com`) must already have
`roles/firebaseappcheck.tokenVerifier`. The staging deploy script fails before
a Functions deploy when that project IAM binding is absent; do not replace this
read-only preflight with a local-source assertion. The production deny-only
sentinel performs no IAM lookup; its future reviewed replacement must add the
same exact-project check.
A generation-fenced scheduled cleanup deletes expired unconsumed objects only
after a fresh transaction claim, so a stale query cannot delete consumed media.

Reservations are capped per UTC day at 12 profile uploads / 60 MiB and 20 chat
uploads / 100 MiB. Count is charged at reservation time, and upload attempts and
confirmed bytes are charged transactionally around the server-owned write so
retrying the callable cannot bypass the ingress budget. Private reads charge
attempts before metadata access at 60/minute and 2,000/UTC day, then separately
reserve the validated object size up to 250 MiB/UTC day before download.
The upload uses an owner lease and immutable Storage generation, creates no
download token, normalizes private/no-store metadata, and returns only a
canonical first-party path. Only `confirmed + byteCharged` authorizations whose
owner, canonical path, generation, and inspected size all match can be consumed.
New uploads never create, return, or persist a bearer download URL.

The legacy `reserveMediaUpload` + direct Storage create + `confirmMediaUpload`
flow is protocol V1. The Functions endpoints remain during the reviewed
production transition, but this repository's strict Storage Rules deliberately
break its direct canonical create. Old binaries also write legacy profile/chat
paths. No reviewed production transitional Storage Rules artifact exists in
this repository, so production Storage Rules must remain untouched until a
separate reviewed artifact exists or the minimum-version gate excludes every
V1/legacy writer and destructive cutover is explicitly approved.
`docs/PRIVATE_MEDIA_MIGRATION.md` is the source of truth for this ordering.

#### Staging destructive cutover

1. Complete direct-room/profile-media audits and backfills. Enforce that no
   supported staging legacy/V1 writer remains, then announce a destructive
   maintenance window with temporary media unavailability.
2. Deploy required indexes and the `expireAt` TTL field policies for
   `mediaUploadQuotas`, `mediaUploadRequestQuotas`, and
   `privateMediaReadQuotas`. Wait until every index reports `READY` and verify
   all three TTL policies are enabled for the exact staging project.
3. Deploy strict Firestore+Storage Rules first. Canonical profile/chat
   create/get/list/update/delete must all be false.
4. Fetch the live staging Rules read-only through the supported Firebase API,
   compare reviewed hashes with the local strict candidate, and verify both
   canonical create=false blocks. Only after that evidence may the operator set
   `HANA_CONFIRM_STAGING_STRICT_MEDIA_RULES_LIVE=hana-e2ee6-strict-private-media-live`.
   Local file inspection alone is not sufficient.
5. Confirm `hana-e2ee6@appspot.gserviceaccount.com` has
   `roles/firebaseappcheck.tokenVerifier`. Immediately deploy the V1+V2
   Functions during the same maintenance window,
   using both staging acknowledgements shown below. Then install the V2 APK and
   verify uploads use only `reserveMediaUploadV2` +
   `uploadPrivateMediaBytes`, reads use the byte proxy, and direct canonical
   Storage access is denied.
6. Enable the exact staging project's server-owned
   `privateMediaRolloutControls/legacyFinalizeCleanup` control, run migration
   apply/re-audit, and repeat media E2E including expired reservation, block
   during reservation, quota boundaries, and denial after block/leave/delete.

The Functions deploy also changes the failure policy for the Storage finalize
trigger. Before acknowledging
`HANA_CONFIRM_STAGING_FUNCTION_RETRY_POLICY=hana-e2ee6-onreservedmediauploaded-retry-only`,
the deploy script builds and executes `functionRuntimeIsolation.test.js`. Its
generated manifest must contain exactly one retry-enabled export
(`onReservedMediaUploaded`), zero HTTPS failure policies, and no leaked
timeout/memory/maxInstances options. Only that exact standalone Functions path
adds Firebase CLI `--force`; never add it to a combined or deploy-all command.

#### Production transitional rollout and cutover

Production must initially keep its currently deployed transitional Storage
Rules untouched while V1 Functions endpoints remain available. Functions,
indexes, and the canonical path-only V2 client may be prepared locally, but the
guarded Functions rollout cannot start until the reviewed transition artifact
and executable V1/V2 matrix described below exist.
"V2-equivalent" means `reserveMediaUploadV2` plus
`uploadPrivateMediaBytes` and no client canonical Storage write; it does not mean Storage Rules
`rules_version = '2'`. This repository has no reviewed production transitional
rules artifact. Do not claim otherwise and do not deploy the strict
`firebase/storage.rules` during the transition.

This is a current production Functions deployment blocker, not a documentation
placeholder. The deny-only `scripts/deploy_prod_firebase.sh` exits before live
inventory or deployment for every target. A future reviewed replacement must
also refuse Functions until all three separately reviewed files exist and their
SHA-256 bindings validate:

- `firebase/storage.production.transitional.rules`
- `firebase/test/storage.production.transitional.rules.test.js`
- `firebase/production-transitional-media-contract.json`

Do not create those files by blindly exporting or committing live production
rules. The executable matrix must prove supported legacy/V1 creation still
works, V2 direct canonical creation fails, and strict-cutover direct creation
fails.

Only after V2-equivalent adoption is verified and enforced by the production
minimum-version gate may a separately reviewed, explicitly approved destructive
cutover deploy strict Storage Rules, enable the exact production project's
environment-bound legacy-finalize cleanup control, and run migration
audit/apply/re-audit plus the
same access matrix. Staging completion is evidence for review, not production
cutover authorization.

The control is `privateMediaRolloutControls/legacyFinalizeCleanup`. It must have
`enabled == true` plus the exact Functions `projectId` and `environment`; keep
it disabled or absent while legacy writers are supported. At strict cutover,
record the UTC time of the last accepted legacy write, deny new legacy writes
first, then enable the control for the exact project and verify the existing
regional finalize trigger reads it. Immediately re-audit because the
rules/control transition is not atomic. Keep the control enabled for at least
15 days from that recorded time. A
completed drain requires no pending `mediaUploadGenerationCleanups`, no
unresolved legacy-finalize cleanup errors, and repeated stable zero-action
bucket/media audits. Never copy this runtime setting between environments.

Keep `onReservedMediaUploaded` and `cleanupExpiredMediaUploads` in the same
single Functions region as the rest of Hana's triggers. Do not duplicate these
triggers in a compatibility region.

### Account deletion worker rollout

`deleteAccount` now tombstones the caller first and records leased,
idempotent phases in `accountDeletionJobs/{uid}`. The
`processAccountDeletionJobs` schedule resumes crashes and Storage/Auth retry
states. Do not deploy the callable without its scheduled worker and the
`accountDeletionJobs(status, nextAttemptAt)` Firestore index: otherwise an
accepted request can remain permanently pending or the runnable queue can be
hidden behind backoff jobs.

For staging, verify at least these cases before production approval:

1. Crash or terminate after each phase and confirm the scheduled worker resumes
   with a new lease without recreating `users/{uid}`.
2. Include active and closed rooms with objects under
   `chat_images/{matchId}/{uid}/`; confirm every exact prefix is empty before
   the user and Auth identity disappear.
3. Force one Firestore or Storage delete failure and confirm the phase stays
   retryable, then completes after the failure is removed.
4. Confirm authored posts are zero, image-message references are scrubbed, and
   private quota state and FCM ownership records are zero while financial and
   safety audit ledgers remain. `mediaUploadAuthorizations` totals may remain
   non-zero for 15 days: every remaining row must be an expected
   `account_deletion_revoked` tombstone with token/URL fields removed,
   `expiresAt` absent, and bounded `expireAt`. All active, consumable, and
   pending-cleanup authorization states must be zero.

Deploy indexes and wait for every required index to report `READY` before
deploying Functions that depend on them. The same environment's deployed
Firestore field configuration must enable `expireAt` TTL for
`mediaUploadQuotas`, `mediaUploadRequestQuotas`, and
`privateMediaReadQuotas`; verify all three policies against the exact target
project before leaving this gate. Scheduled quota cleanup is bounded
defense-in-depth and is not a substitute for those TTL policies. Index or TTL
configuration alone does not change client behavior. Deploying is a release
action and still requires the normal explicit environment and production
approvals below.

After confirming no supported staging legacy/V1 client remains and announcing
the destructive maintenance outage, deploy the required indexes first:

```bash
scripts/deploy_staging_firebase.sh firestore:indexes
```

After Firebase reports every required index `READY` and all three quota TTL
policies are enabled on `hana-e2ee6`, continue the staging maintenance window
by deploying strict rules first:

```bash
HANA_CONFIRM_PRIVATE_MEDIA_STRICT_CUTOVER=hana-e2ee6-private-media-strict-cutover \
  scripts/deploy_staging_firebase.sh firestore:rules,storage
```

Fetch and hash the live staging Rules read-only. After they match the reviewed
local strict candidate and canonical create=false is confirmed, immediately
deploy Functions:

```bash
HANA_FUNCTIONS_LIVE_REGION_CONFIRMED=us-central1 \
HANA_CONFIRM_STAGING_STRICT_MEDIA_FUNCTIONS=hana-e2ee6-private-media-strict-functions \
HANA_CONFIRM_STAGING_STRICT_MEDIA_RULES_LIVE=hana-e2ee6-strict-private-media-live \
  scripts/deploy_staging_firebase.sh functions
```

The staging script intentionally has no deploy-all default. Do not reverse this
order: V2 Functions on permissive old rules would allow a protocol-V2
authorization to become a direct client Storage capability. Between strict
Rules and Functions, old media flows may be unavailable; that outage is an
accepted boundary of the staging destructive maintenance window.

The strict Rules command is therefore not repeated after Functions. Continue
with V2 APK installation, E2E, then the environment-bound legacy-finalize
control and migration/drain.

Production deploys are currently blocked unconditionally by the deny-only
sentinel. The following commands document the intended future sequence; they
all exit with code 64 in this change set and must not be treated as executable
release instructions. After the separate production transition PR is reviewed,
deploy the reviewed index/TTL configuration first, wait for every index to
report `READY`, and read-only verify the same three `expireAt` quota TTL
policies are enabled on `hana-production-tokyo`:

```bash
HANA_PROD_FIREBASE_PROJECT=hana-production-tokyo \
HANA_CONFIRM_PRODUCTION_PROJECT=hana-production-tokyo \
  scripts/deploy_prod_firebase.sh firestore:indexes
```

Only after index readiness, deploy production Functions:

```bash
HANA_PROD_FIREBASE_PROJECT=hana-production-tokyo \
HANA_CONFIRM_PRODUCTION_PROJECT=hana-production-tokyo \
HANA_FUNCTIONS_LIVE_REGION_CONFIRMED=asia-northeast1 \
HANA_CONFIRM_PRODUCTION_V2_FUNCTIONS_COMPATIBILITY=hana-production-tokyo-v2-compatible-functions \
  scripts/deploy_prod_firebase.sh functions
```

The command above is intentionally blocked in the current repository because
the reviewed transitional artifact and matrix are absent. Once those artifacts
exist, that confirmation attests that the candidate still exports the exact V1
reservation/confirmation endpoints while adding the V2 server-upload flow. It
does not approve, select, or deploy any Storage Rules artifact.

Do not run the command below while production remains on the transitional
rollout. Only after the documented backfill, index `READY`, staging E2E,
V2-equivalent production client adoption, supported-version enforcement, fresh
live inventory, reviewed migration dry-run, and explicit production cutover
approval may strict resources be deployed as a separate destructive operation:

```bash
HANA_PROD_FIREBASE_PROJECT=hana-production-tokyo \
HANA_CONFIRM_PRODUCTION_PROJECT=hana-production-tokyo \
HANA_CONFIRM_PRIVATE_MEDIA_STRICT_CUTOVER=hana-production-tokyo-private-media-strict-cutover \
  scripts/deploy_prod_firebase.sh firestore:rules,storage
```

The staging deploy script resolves the Firebase Storage service agent for the
exact staging project and fails before deployment unless it has
`roles/firebaserules.firestoreServiceAgent`. The current production sentinel
performs no cloud lookup at all. Its eventual reviewed replacement must add the
same exact-project IAM preflight. That cross-service IAM check only proves
Storage Rules can read Firestore; it does not satisfy any rollout or production
approval gate above.

Do not set `HANA_PROD_FIREBASE_PROJECT` to `hana-e2ee6`; that project is
staging.

## Post-Deploy Checks

### Callable region compatibility hold

The 2026-08-13 read-only inventories found staging exclusively in
`us-central1` and production exclusively in `asia-northeast1`. Reauthenticate
and repeat inventory immediately before every deployment; the recorded counts
are not proof of later live state.

The staging deploy script runs
`firebase functions:list --project hana-e2ee6 --json` and fails closed when the
live set is empty, mixed, belongs to another project, or includes any region
other than `us-central1`. It also requires the matching manual inventory
acknowledgement and exports the exact staging environment/project/region tuple
while loading Functions source. The production sentinel intentionally performs
no inventory lookup. Its future reviewed replacement must implement the
equivalent `hana-production-tokyo` / `asia-northeast1` guard. An inventory
acknowledgement is not permission to deploy.

Confirm new functions exist with the explicit project:

```bash
firebase functions:list --project hana-e2ee6
```

Confirm callable functions that are invoked from the mobile app allow public
invocation at the Cloud Functions IAM layer. Firebase Auth and App Check are
still enforced inside the callable request verification and function code, but
the HTTPS entrypoint itself must have `roles/cloudfunctions.invoker` for
`allUsers`.

Audit every deployed callable used by the current client or retained source,
not just onboarding. The 2026-08-13 read-only staging audit found missing
`allUsers` invoker bindings on `blockUser`, `likeUser`, `passUser`,
`purchaseExtraQuota`, `reportUser`, and `requestCandidates`; block/report E2E is
therefore blocked until a separately authorized IAM repair. Legacy/deprecated
or code-locked callables still need an explicit keep/remove/expose decision.

Example read-only audit:

```bash
firebase functions:list --project hana-e2ee6 --json \
  | jq -r '.result[] | select(.callableTrigger != null) | .id' \
  | while read -r fn; do
      printf '%s: ' "$fn"
      gcloud functions get-iam-policy "$fn" \
        --project=hana-e2ee6 \
        --region=us-central1 \
        --format='value(bindings.members)' \
        | grep -q 'allUsers' && echo OK || echo MISSING
    done
```

If a callable should remain client-invokable but is missing the binding, obtain
explicit IAM-write approval and add only the one binding. Never POST a partial
`setIamPolicy` document: that can overwrite unrelated bindings and conditions.

```bash
gcloud functions add-iam-policy-binding blockUser \
  --project=hana-e2ee6 \
  --region=us-central1 \
  --member=allUsers \
  --role=roles/cloudfunctions.invoker
```

Re-run the full read-only callable audit after every repair. The HTTPS IAM
binding permits request arrival only; Firebase Auth, App Check, account state,
and callable authorization must still fail closed inside the function.

Then run the manual QA checklist:

```text
docs/E2E_QA_CHECKLIST.md
```

Minimum smoke path:

- Sign in
- Complete onboarding
- Open Discovery
- Open profile detail
- Create a direct chat
- Send Korean and Japanese messages
- Verify additive translation
- Verify block/report removes future contact and exposure
- Upload an onboarding/profile JPEG and confirm profile save consumes its
  V2 reservation after `uploadPrivateMediaBytes`
- Send a chat JPEG and confirm a second write to the same path is rejected
- Confirm a direct client Storage create to both canonical prefixes is denied

## Rollback Notes

If the new app build has not been distributed yet, avoid deploying stricter
Firestore rules alone. Older app builds that directly read `users`, `posts`, or
`post_likes` can break after the stricter rules are deployed.

If rollback is needed:

```bash
firebase functions:list --project hana-e2ee6
firebase functions:delete <functionName> --project hana-e2ee6
```

For rules rollback, redeploy the previous known-good rules file.
