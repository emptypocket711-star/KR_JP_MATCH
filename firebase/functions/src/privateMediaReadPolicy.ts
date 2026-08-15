import { isExactDirectChatParticipants } from './chatPolicy';
import {
  isEligibleExternalProfileViewer,
  isDeletedOrUnavailableUser,
  isPublicUserProfile,
} from './profileExposurePolicy';

export type PrivateMediaReadIssue =
  | 'invalid-path-owner'
  | 'viewer-unavailable'
  | 'viewer-ineligible'
  | 'owner-unavailable'
  | 'owner-not-public'
  | 'profile-reference-missing'
  | 'blocked'
  | 'match-missing'
  | 'invalid-direct-room'
  | 'not-participant'
  | 'uploader-not-participant'
  | 'inactive-room'
  | 'hidden-room'
  | null;

type Data = Record<string, unknown> | undefined;

function isUnavailable(exists: boolean, data: Data): boolean {
  return !exists || isDeletedOrUnavailableUser(data);
}

export function profileMediaReadIssue(input: {
  viewerUid: string;
  ownerUid: string;
  objectPath: string;
  viewerExists: boolean;
  viewerData: Data;
  ownerExists: boolean;
  ownerData: Data;
  ownerPreviewAuthorized: boolean;
  viewerBlockedOwner: boolean;
  ownerBlockedViewer: boolean;
  referenceDate?: Date;
}): PrivateMediaReadIssue {
  if (!input.objectPath.startsWith(`profile_media/${input.ownerUid}/`)) {
    return 'invalid-path-owner';
  }
  if (isUnavailable(input.viewerExists, input.viewerData)) {
    return 'viewer-unavailable';
  }
  if (isUnavailable(input.ownerExists, input.ownerData)) {
    return 'owner-unavailable';
  }

  if (input.viewerUid === input.ownerUid && input.ownerPreviewAuthorized) {
    return null;
  }
  if (
    input.viewerUid !== input.ownerUid &&
    !isEligibleExternalProfileViewer(input.viewerData, input.referenceDate)
  ) {
    return 'viewer-ineligible';
  }
  const photoUrls = input.ownerData?.photoUrls;
  if (!Array.isArray(photoUrls) || !photoUrls.includes(input.objectPath)) {
    return 'profile-reference-missing';
  }
  if (input.viewerUid === input.ownerUid) return null;
  if (
    input.ownerData?.profileMediaVisibilityVersion !== 1 ||
    !isPublicUserProfile(input.ownerData, input.referenceDate)
  ) {
    return 'owner-not-public';
  }
  if (input.viewerBlockedOwner || input.ownerBlockedViewer) return 'blocked';
  return null;
}

export function chatMediaReadIssue(input: {
  viewerUid: string;
  uploaderUid: string;
  viewerExists: boolean;
  viewerData: Data;
  firstParticipantExists: boolean;
  firstParticipantData: Data;
  secondParticipantExists: boolean;
  secondParticipantData: Data;
  viewerBlockedOther: boolean;
  otherBlockedViewer: boolean;
  matchExists: boolean;
  matchData: Data;
  messageReferenceExists: boolean;
}): PrivateMediaReadIssue {
  if (isUnavailable(input.viewerExists, input.viewerData)) {
    return 'viewer-unavailable';
  }
  if (!isEligibleExternalProfileViewer(input.viewerData)) {
    return 'viewer-ineligible';
  }
  if (!input.matchExists) return 'match-missing';

  const userIds = input.matchData?.userIds;
  if (!isExactDirectChatParticipants(userIds)) return 'invalid-direct-room';
  if (!userIds.includes(input.viewerUid)) return 'not-participant';
  if (!userIds.includes(input.uploaderUid)) return 'uploader-not-participant';
  if (!input.messageReferenceExists) return 'profile-reference-missing';
  if (
    isUnavailable(input.firstParticipantExists, input.firstParticipantData) ||
    isUnavailable(input.secondParticipantExists, input.secondParticipantData)
  ) {
    return 'owner-unavailable';
  }
  if (
    input.matchData?.directRoomVersion !== 1 ||
    input.matchData?.isActive !== true
  ) {
    return 'inactive-room';
  }
  const hiddenFor = input.matchData?.hiddenFor;
  if (!Array.isArray(hiddenFor) || hiddenFor.length !== 0) {
    return 'hidden-room';
  }
  if (input.viewerBlockedOther || input.otherBlockedViewer) return 'blocked';
  return null;
}
