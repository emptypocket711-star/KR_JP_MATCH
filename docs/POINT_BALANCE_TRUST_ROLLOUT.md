# Point Balance Trust Rollout

This document is the staging rollout gate for the server-owned `keyCount`
balance. It does not authorize a production read, write, deploy, or migration.
The audit/apply tool is source-locked to `hana-e2ee6`.

## Runtime Contract

- `pointBalanceTrustVersion == 1` and a valid integer `keyCount` from 0 through
  100,000 are required before any balance is returned or consumed.
- `pointBalanceQuarantined == true` always fails closed, even if a trust marker
  is also present.
- A missing, fractional, negative, non-finite, oversized, untrusted, or
  quarantined balance is never converted to zero.
- A new server grant may establish trust only from an exact stored zero balance.
  New onboarding may initialize a missing balance only when the user document
  does not exist or is the exact server-created V2 profile-upload shell. That
  shell carries a one-use provenance marker, has no point/trust/quarantine
  state, and loses the marker in the successful onboarding transaction.
- A deterministic onboarding event alone never upgrades an existing untrusted
  positive balance. Existing untrusted balances, including wrong or future
  trust versions, must pass the full manifest evidence audit.
- An existing balance may gain the trust marker only when server-owned
  `pointEvents` form a complete, unambiguous chronological chain from zero to
  the exact current balance.
- Unexplained legacy positive balances are quarantined without changing
  `keyCount`. The tool never invents a grant, guesses an opening balance, or
  edits a point event.

These checks cover onboarding grant/retry, daily lounge grant/retry, direct-chat
create/reuse, call start/accept/extension, and Apple/Google store grant/retry
paths.

## Build And Audit

Build with the repository's Node 22 runtime before invoking the admin tool:

```bash
cd firebase/functions
npm run build
```

Audit is read-only in Firestore and writes a new private local manifest. It
refuses to overwrite an existing manifest. Choose explicit bounds large enough
to complete both collection scans:

```bash
GOOGLE_CLOUD_PROJECT=hana-e2ee6 \
node lib/admin/pointBalanceAudit.js \
  --expected-project hana-e2ee6 \
  --manifest /secure/private/point-balance-audit.json \
  --max-users 10000 \
  --max-point-events 100000 \
  --max-events-per-user 1000
```

The manifest is mode `0600`, SHA-256 digest-bound, exact-project-bound, and
contains the user snapshot update time plus a digest of every supporting point
event. It also contains the affected Firebase UIDs, so keep it outside the
repository and do not attach it to tickets or commits. A scan that reaches any
bound is marked incomplete and contains no applyable actions.

Review these counts before considering apply:

- `trustActions`: exact event chains eligible for the trust marker.
- `quarantineActions`: invalid or unexplained balances that will remain
  unchanged but unusable.
- `orphanPointEvents`: events whose user document no longer exists; these do
  not justify another user's balance.
- `healthyTrusted` and `healthyQuarantined`: already-stable states.

## Apply A Reviewed Manifest

Apply requires the separately reviewed manifest digest and exact action counts:

```bash
GOOGLE_CLOUD_PROJECT=hana-e2ee6 \
node lib/admin/pointBalanceAudit.js \
  --apply \
  --expected-project hana-e2ee6 \
  --confirm-project hana-e2ee6 \
  --manifest /secure/private/point-balance-audit.json \
  --manifest-digest <reviewed-64-character-digest> \
  --confirm-trust-count <reviewed-count> \
  --confirm-quarantine-count <reviewed-count> \
  --max-users 10000 \
  --max-point-events 100000 \
  --max-events-per-user 1000 \
  --max-apply-actions <reviewed-upper-bound>
```

Apply refuses production and Firestore emulator targets. Before writing, it
repeats the full bounded audit and requires the counts and every action digest
to match the reviewed manifest. Each user is then re-read with all of that
user's point events inside a transaction; user/event drift aborts that action.
If a run stops after any action, discard the old manifest and perform a fresh
audit rather than retrying stale input.

Trust actions set `pointBalanceTrustVersion`, record the manifest digest, and
clear quarantine metadata. Quarantine actions remove the trust marker, record
the exact failure reason, and preserve `keyCount` byte-for-byte.

## Required Re-Audit And Staging Gate

Run audit again to a new manifest path after apply. Before deploying the
fail-closed Functions to staging, require all of the following:

1. The re-audit is complete and reports `trustActions == 0` and
   `quarantineActions == 0`.
2. Every staging E2E account used for onboarding, lounge, chat, calls, and store
   retry tests is in `healthyTrusted`, not `healthyQuarantined`.
3. Every remaining `healthyQuarantined` account has an explicit owner and
   authoritative reconciliation plan. A quarantine is not evidence that its
   balance is correct.
4. No operator has manually set the trust marker, rewritten `keyCount`, or
   fabricated `pointEvents` to make the counts green.
5. Full Functions tests pass on Node 22, followed by staging E2E for every point
   grant, consume, and idempotent retry path.

Production remains blocked until a separate production manifest, review,
authorization, and rollout procedure are added. Do not weaken or reuse this
staging-only tool for production.
