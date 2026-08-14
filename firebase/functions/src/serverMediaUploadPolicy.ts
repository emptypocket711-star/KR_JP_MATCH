import { createHash } from 'crypto';
import sharp from 'sharp';
import {
  isSafeMediaUploadAuthorizationId,
  mediaUploadMaxBytes,
  mediaUploadMaxDimension,
  mediaUploadMaxPixels,
  privateMediaCacheControl,
  safeJpegUploadIssue,
} from './mediaUploadPolicy';

export const mediaUploadProtocolVersion = 2;
export const mediaUploadMaxBase64Length = 4 * Math.ceil(mediaUploadMaxBytes / 3);
export const serverMediaUploadLeaseMillis = 3 * 60 * 1000;
export const mediaUploadPublicationTtlMillis = 60 * 60 * 1000;

export interface ServerMediaUploadRequest {
  authorizationId: string;
  jpegBase64: string;
  decodedByteLength: number;
}

export type ServerMediaUploadRequestValidation =
  | { ok: true; value: ServerMediaUploadRequest }
  | { ok: false; reason: string };

export interface ServerMediaUploadMarker {
  leaseOwner: string;
  payloadDigest: string;
}

/**
 * Only deterministic authorization/content/lifecycle failures may destroy an
 * already-created immutable object. Transport, deadline, and transaction
 * contention failures retain the fenced object for idempotent recovery.
 */
export function shouldCleanupServerMediaAfterFailure(
  callableCode: string | null
): boolean {
  return callableCode === 'invalid-argument' ||
    callableCode === 'failed-precondition' ||
    callableCode === 'permission-denied' ||
    callableCode === 'not-found' ||
    callableCode === 'unauthenticated' ||
    callableCode === 'resource-exhausted' ||
    callableCode === 'out-of-range';
}

export function validateServerMediaUploadRequest(
  input: unknown
): ServerMediaUploadRequestValidation {
  if (!isPlainRecord(input)) {
    return { ok: false, reason: 'request must be an object' };
  }
  if (
    Object.keys(input).length !== 2 ||
    !Object.prototype.hasOwnProperty.call(input, 'authorizationId') ||
    !Object.prototype.hasOwnProperty.call(input, 'jpegBase64')
  ) {
    return {
      ok: false,
      reason: 'request must contain only authorizationId and jpegBase64',
    };
  }
  if (!isSafeMediaUploadAuthorizationId(input.authorizationId)) {
    return { ok: false, reason: 'authorizationId is invalid' };
  }
  const jpegBase64 = input.jpegBase64;
  if (
    typeof jpegBase64 !== 'string' ||
    jpegBase64.length === 0 ||
    jpegBase64.length > mediaUploadMaxBase64Length ||
    jpegBase64.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(jpegBase64)
  ) {
    return { ok: false, reason: 'jpegBase64 is invalid or exceeds 5 MiB' };
  }
  const padding = jpegBase64.endsWith('==')
    ? 2
    : jpegBase64.endsWith('=')
      ? 1
      : 0;
  const decodedByteLength = (jpegBase64.length / 4) * 3 - padding;
  if (
    !Number.isSafeInteger(decodedByteLength) ||
    decodedByteLength <= 0 ||
    decodedByteLength > mediaUploadMaxBytes
  ) {
    return { ok: false, reason: 'jpegBase64 is invalid or exceeds 5 MiB' };
  }
  return {
    ok: true,
    value: {
      authorizationId: input.authorizationId,
      jpegBase64,
      decodedByteLength,
    },
  };
}

export function serverMediaUploadPayloadDigest(jpegBase64: string): string {
  return createHash('sha256').update(jpegBase64, 'ascii').digest('hex');
}

export function serverMediaUploadCustomMetadata(
  marker: ServerMediaUploadMarker
): Record<string, string> {
  assertServerMediaUploadMarker(marker);
  return {
    hanaCacheControl: privateMediaCacheControl,
    hanaUploadProtocolVersion: String(mediaUploadProtocolVersion),
    hanaServerUploadLeaseOwner: marker.leaseOwner,
    hanaServerUploadDigest: marker.payloadDigest,
  };
}

export function hasExactServerMediaUploadMarker(
  metadata: Record<string, unknown> | undefined,
  marker: ServerMediaUploadMarker
): boolean {
  if (!isValidServerMediaUploadMarker(marker)) return false;
  return metadata?.hanaCacheControl === privateMediaCacheControl &&
    metadata.hanaUploadProtocolVersion === String(mediaUploadProtocolVersion) &&
    metadata.hanaServerUploadLeaseOwner === marker.leaseOwner &&
    metadata.hanaServerUploadDigest === marker.payloadDigest &&
    metadata.firebaseStorageDownloadTokens == null;
}

/**
 * Decodes and fully parses the image only after Firestore grants the upload
 * lease. Sharp performs a real pixel decode (not merely marker inspection),
 * and the second encode strips all source metadata. The encoded result is
 * checked again against Hana's deliberately narrow baseline-JPEG contract.
 */
export async function decodeAndSanitizeServerJpeg(
  jpegBase64: string,
  expectedDecodedByteLength: number
): Promise<Buffer> {
  const input = Buffer.from(jpegBase64, 'base64');
  if (
    input.length !== expectedDecodedByteLength ||
    input.length <= 0 ||
    input.length > mediaUploadMaxBytes ||
    input.toString('base64') !== jpegBase64 ||
    safeJpegUploadIssue(input) != null
  ) {
    throw new Error('JPEG payload is not canonical safe base64');
  }

  const decoderOptions = {
    failOn: 'error' as const,
    limitInputPixels: mediaUploadMaxPixels,
    sequentialRead: true,
  };
  const metadata = await sharp(input, decoderOptions).metadata();
  const width = metadata.width;
  const height = metadata.height;
  if (
    metadata.format !== 'jpeg' ||
    metadata.pages != null && metadata.pages !== 1 ||
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width == null ||
    height == null ||
    width <= 0 ||
    height <= 0 ||
    width > mediaUploadMaxDimension ||
    height > mediaUploadMaxDimension ||
    width > Math.floor(mediaUploadMaxPixels / height)
  ) {
    throw new Error('JPEG dimensions or format are invalid');
  }

  const sanitized = await sharp(input, decoderOptions)
    .jpeg({
      quality: 90,
      progressive: false,
      chromaSubsampling: '4:2:0',
      optimiseScans: false,
    })
    .toBuffer();
  if (
    sanitized.length <= 0 ||
    sanitized.length > mediaUploadMaxBytes ||
    safeJpegUploadIssue(sanitized) != null
  ) {
    throw new Error('Sanitized JPEG is outside the private-media contract');
  }
  return sanitized;
}

function assertServerMediaUploadMarker(marker: ServerMediaUploadMarker): void {
  if (!isValidServerMediaUploadMarker(marker)) {
    throw new RangeError('Server media upload marker is invalid');
  }
}

function isValidServerMediaUploadMarker(marker: ServerMediaUploadMarker): boolean {
  return /^[a-zA-Z0-9-]{16,128}$/.test(marker.leaseOwner) &&
    /^[a-f0-9]{64}$/.test(marker.payloadDigest);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
