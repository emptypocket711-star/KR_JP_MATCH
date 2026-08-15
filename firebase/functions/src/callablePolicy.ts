export type CallableIdentityIssue = 'app-check' | 'authentication' | null;

export function callableIdentityIssue(input: {
  hasAppCheck: boolean;
  uid: unknown;
}): CallableIdentityIssue {
  if (!input.hasAppCheck) return 'app-check';
  if (typeof input.uid !== 'string' || input.uid.length === 0) {
    return 'authentication';
  }
  return null;
}

export function isAccountDeletedOrDeleting(
  userData: Record<string, unknown> | undefined
): boolean {
  if (userData == null) return false;

  const status = typeof userData.status === 'string' ? userData.status : '';
  const accountStatus =
    typeof userData.accountStatus === 'string' ? userData.accountStatus : '';

  return (
    userData.isDeleted === true ||
    userData.deleted === true ||
    userData.deletionRequested === true ||
    userData.deletedAt != null ||
    status === 'deleted' ||
    status === 'deactivated' ||
    accountStatus === 'deleting' ||
    accountStatus === 'deleted' ||
    accountStatus === 'deactivated'
  );
}

export type ActiveAccountIssue = 'missing' | 'banned' | 'deleted' | null;

export function activeAccountIssue(input: {
  exists: boolean;
  userData: Record<string, unknown> | undefined;
}): ActiveAccountIssue {
  if (!input.exists) return 'missing';
  if (
    input.userData?.isBanned === true ||
    input.userData?.status === 'banned' ||
    input.userData?.accountStatus === 'banned'
  ) {
    return 'banned';
  }
  if (isAccountDeletedOrDeleting(input.userData)) return 'deleted';
  return null;
}
