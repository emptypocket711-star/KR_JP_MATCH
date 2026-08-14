#!/usr/bin/env bash
set -euo pipefail

TARGET="${1:-<missing>}"

cat <<ERROR >&2
Production Firebase deployment is disabled in this repository snapshot.

Refused target: $TARGET

The reviewed production transitional Storage Rules, executable V1/V2 matrix,
SHA-256 contract manifest, environment validator, and approved deploy workflow
are not present. Staging completion does not authorize production. A separate
reviewed transition PR must replace this deny-only sentinel before any
production Firebase CLI or cloud lookup is allowed.
ERROR

exit 64
