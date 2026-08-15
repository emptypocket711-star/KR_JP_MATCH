import { parseMediaUploadObjectPath } from './mediaUploadPolicy';

const firebaseStorageHost = 'firebasestorage.googleapis.com';
const allowedProfilePhotoBuckets = new Set([
  'hana-e2ee6.firebasestorage.app',
  'hana-production-tokyo.firebasestorage.app',
]);

function runtimeAllowedProfilePhotoBuckets(): ReadonlySet<string> {
  const projectId =
    process.env.GCLOUD_PROJECT ??
    process.env.GOOGLE_CLOUD_PROJECT ??
    process.env.GCP_PROJECT;
  if (projectId === 'hana-e2ee6') {
    return new Set(['hana-e2ee6.firebasestorage.app']);
  }
  if (projectId === 'hana-production-tokyo') {
    return new Set(['hana-production-tokyo.firebasestorage.app']);
  }
  return allowedProfilePhotoBuckets;
}

/** Canonical value accepted from every new profile-media write. */
export function isOwnedProfileMediaPath(
  value: unknown,
  uid?: string
): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512) {
    return false;
  }
  const parsed = parseMediaUploadObjectPath(value);
  return parsed != null &&
    parsed.kind === 'profile' &&
    (uid == null || parsed.uid === uid);
}

function verifiedProfilePhotoObjectPath(value: string): string | null {
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.hostname !== firebaseStorageHost ||
    url.username.length > 0 ||
    url.password.length > 0
  ) {
    return null;
  }

  // Firebase download URLs have exactly
  // /v0/b/{first-party-bucket}/o/{percent-encoded-object-path}.
  const pathSegments = url.pathname.split('/');
  if (
    pathSegments.length !== 6 ||
    pathSegments[0] !== '' ||
    pathSegments[1] !== 'v0' ||
    pathSegments[2] !== 'b' ||
    !runtimeAllowedProfilePhotoBuckets().has(pathSegments[3]) ||
    pathSegments[4] !== 'o' ||
    pathSegments[5].length === 0 ||
    pathSegments[5].includes('/')
  ) {
    return null;
  }

  const objectPath = decodeURIComponent(pathSegments[5]);
  if (
    objectPath.includes('..') ||
    (!objectPath.startsWith('users/') &&
      !objectPath.startsWith('profile_photos/') &&
      !objectPath.startsWith('profile_media/'))
  ) {
    return null;
  }
  if (objectPath.startsWith('profile_media/')) {
    const parsed = parseMediaUploadObjectPath(objectPath);
    if (parsed == null || parsed.kind !== 'profile') return null;
  }
  return objectPath;
}

export function isOwnedFirebaseProfilePhotoUrl(
  value: unknown,
  uid?: string
): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) {
    return false;
  }
  try {
    const objectPath = verifiedProfilePhotoObjectPath(value);
    if (objectPath == null) return false;
    if (uid == null) return true;
    return (
      objectPath.startsWith(`users/${uid}/`) ||
      objectPath.startsWith(`profile_photos/${uid}/`) ||
      objectPath.startsWith(`profile_media/${uid}/`)
    );
  } catch (_) {
    return false;
  }
}

export function profilePhotoObjectPath(
  value: unknown,
  uid: string
): string | null {
  if (isOwnedProfileMediaPath(value, uid)) return value;
  if (!isOwnedFirebaseProfilePhotoUrl(value, uid)) return null;
  return verifiedProfilePhotoObjectPath(value);
}
