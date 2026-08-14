export const reportReasons = [
  'spam',
  'harassment',
  'inappropriate_photo',
  'fake_profile',
  'other',
] as const;

export type ReportReason = (typeof reportReasons)[number];

export const reportContentTypes = ['post', 'comment', 'reply'] as const;
export type ReportContentType = (typeof reportContentTypes)[number];

export interface ReportContentContext {
  contentType: ReportContentType;
  postId: string;
  commentId?: string;
  replyId?: string;
}

export interface ReportContentEvidence {
  authorUid: string;
  body: string;
  bodyTruncated: boolean;
  createdAt: unknown | null;
}

export interface ReportContentDocumentState {
  exists: boolean;
  deleted: boolean;
}

export type ReportContentStateIssue = 'content-unavailable' | 'author-mismatch';

export const reportEvidenceVersion = 1;
export const maxReportContentIdLength = 128;
export const maxReportEvidenceBodyLength = 2000;
export const maxReportNoteLength = 1000;

const reportRequestFields = new Set([
  'targetUid',
  'reason',
  'note',
  'matchId',
  'contentContext',
]);

const contentContextFields = new Set([
  'contentType',
  'postId',
  'commentId',
  'replyId',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidContentId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= maxReportContentIdLength &&
    /^[A-Za-z0-9_-]+$/.test(value)
  );
}

function isValidReferenceId(value: unknown, allowEmpty = false): value is string {
  return (
    typeof value === 'string' &&
    (allowEmpty || value.length > 0) &&
    value.length <= maxReportContentIdLength &&
    !value.includes('/')
  );
}

export function reportRequestShapeIssue(data: unknown): string | null {
  if (!isRecord(data)) return 'request must be an object';

  const unknownField = Object.keys(data).find(
    (field) => !reportRequestFields.has(field)
  );
  if (unknownField) return `unsupported report field: ${unknownField}`;

  if (!isValidReferenceId(data.targetUid)) {
    return 'targetUid must be a valid user id';
  }
  if (!isValidReportReason(data.reason)) {
    return 'reason is not supported';
  }
  if (
    data.note !== undefined &&
    (typeof data.note !== 'string' || data.note.length > maxReportNoteLength)
  ) {
    return 'note must be a string within the size limit';
  }
  if (
    data.matchId !== undefined &&
    !isValidReferenceId(data.matchId, true)
  ) {
    return 'matchId must be a valid document id';
  }
  return reportContentContextIssue(data.contentContext);
}

export function reportContentContextIssue(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  if (!isRecord(raw)) return 'contentContext must be an object';

  const unknownField = Object.keys(raw).find(
    (field) => !contentContextFields.has(field)
  );
  if (unknownField) {
    return `unsupported contentContext field: ${unknownField}`;
  }

  if (
    typeof raw.contentType !== 'string' ||
    !(reportContentTypes as readonly string[]).includes(raw.contentType)
  ) {
    return 'contentType must be post, comment, or reply';
  }
  if (!isValidContentId(raw.postId)) {
    return 'postId must be a valid content id';
  }

  const keys = new Set(Object.keys(raw));
  if (raw.contentType === 'post') {
    if (keys.size !== 2 || !keys.has('contentType') || !keys.has('postId')) {
      return 'post context must contain only contentType and postId';
    }
    return null;
  }

  if (!isValidContentId(raw.commentId)) {
    return 'commentId must be a valid content id';
  }
  if (raw.contentType === 'comment') {
    if (
      keys.size !== 3 ||
      !keys.has('contentType') ||
      !keys.has('postId') ||
      !keys.has('commentId')
    ) {
      return 'comment context has an invalid field combination';
    }
    return null;
  }

  if (!isValidContentId(raw.replyId)) {
    return 'replyId must be a valid content id';
  }
  if (
    keys.size !== 4 ||
    !keys.has('contentType') ||
    !keys.has('postId') ||
    !keys.has('commentId') ||
    !keys.has('replyId')
  ) {
    return 'reply context has an invalid field combination';
  }
  return null;
}

export function normalizeReportContentContext(
  raw: unknown
): ReportContentContext | null {
  if (raw === undefined || raw === null) return null;
  if (reportContentContextIssue(raw) !== null || !isRecord(raw)) return null;

  const contentType = raw.contentType as ReportContentType;
  return {
    contentType,
    postId: raw.postId as string,
    ...(contentType !== 'post' ? { commentId: raw.commentId as string } : {}),
    ...(contentType === 'reply' ? { replyId: raw.replyId as string } : {}),
  };
}

export function buildReportContentEvidence(input: {
  authorUid: unknown;
  content: unknown;
  createdAt: unknown;
}): ReportContentEvidence {
  const authorUid = typeof input.authorUid === 'string' ? input.authorUid : '';
  const content = typeof input.content === 'string' ? input.content : '';
  const bodyTruncated = content.length > maxReportEvidenceBodyLength;

  return {
    authorUid,
    body: bodyTruncated
      ? content.substring(0, maxReportEvidenceBodyLength)
      : content,
    bodyTruncated,
    createdAt: input.createdAt ?? null,
  };
}

export function reportContentStateIssue(input: {
  expectedDocumentCount: number;
  documentStates: ReportContentDocumentState[];
  authorUid: unknown;
  targetUid: string;
}): ReportContentStateIssue | null {
  if (
    input.documentStates.length !== input.expectedDocumentCount ||
    input.documentStates.some((state) => !state.exists || state.deleted)
  ) {
    return 'content-unavailable';
  }
  return input.authorUid === input.targetUid ? null : 'author-mismatch';
}

export interface MatchSafetyInput {
  exists: boolean;
  isActive: boolean;
  userIds?: unknown;
  actorUid: string;
  targetUid: string;
}

export function isValidReportReason(reason: unknown): reason is ReportReason {
  return (
    typeof reason === 'string' &&
    (reportReasons as readonly string[]).includes(reason)
  );
}

export function canUseRequestedMatchForSafety(
  input: MatchSafetyInput
): boolean {
  if (!input.exists || !input.isActive || !Array.isArray(input.userIds)) {
    return false;
  }

  return (
    input.userIds.includes(input.actorUid) &&
    input.userIds.includes(input.targetUid)
  );
}

export function closedChatHiddenParticipants(
  actorUid: string,
  targetUid: string
): string[] {
  return Array.from(new Set([actorUid, targetUid]));
}

export interface ClientReportIntakeDecision {
  status: 'open';
  shouldBanTarget: false;
  shouldCloseAllTargetMatches: false;
  shouldWriteReportCounters: false;
  shouldExposeModerationCounters: false;
}

export function clientReportIntakeDecision(): ClientReportIntakeDecision {
  return {
    status: 'open',
    shouldBanTarget: false,
    shouldCloseAllTargetMatches: false,
    shouldWriteReportCounters: false,
    shouldExposeModerationCounters: false,
  };
}
