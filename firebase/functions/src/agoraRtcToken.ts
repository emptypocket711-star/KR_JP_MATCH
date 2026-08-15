import {
  AccessToken2,
  ServiceRtc,
} from 'agora-token/src/AccessToken2';
import { callTokenMaxLeaseSeconds } from './callEntitlementPolicy';

type AgoraCallType = 'voice' | 'video';

// The public builder always inserts audio, video, and data privilege keys for
// publisher tokens. Passing zero for an unwanted key is ambiguous in Agora's
// token protocol, so use the reviewed AccessToken2 service primitives and omit
// unwanted privileges entirely. package.json pins agora-token to 2.0.5 because
// this internal path and shape are part of the server security contract.
export function buildScopedAgoraRtcToken(params: {
  appId: string;
  appCertificate: string;
  channelName: string;
  uid: number;
  callType: AgoraCallType;
  lifetimeSeconds: number;
}): string {
  if (
    !Number.isSafeInteger(params.lifetimeSeconds) ||
    params.lifetimeSeconds <= 0 ||
    params.lifetimeSeconds > callTokenMaxLeaseSeconds ||
    !Number.isSafeInteger(params.uid) ||
    params.uid <= 0 ||
    params.uid > 0xffffffff ||
    (params.callType !== 'voice' && params.callType !== 'video')
  ) {
    throw new Error('Invalid Agora RTC token scope');
  }

  const issuedAtSeconds = Math.floor(Date.now() / 1000);
  const token = new AccessToken2(
    params.appId,
    params.appCertificate,
    issuedAtSeconds,
    params.lifetimeSeconds
  );
  const rtc = new ServiceRtc(params.channelName, params.uid);
  rtc.add_privilege(
    ServiceRtc.kPrivilegeJoinChannel,
    params.lifetimeSeconds
  );
  rtc.add_privilege(
    ServiceRtc.kPrivilegePublishAudioStream,
    params.lifetimeSeconds
  );
  if (params.callType === 'video') {
    rtc.add_privilege(
      ServiceRtc.kPrivilegePublishVideoStream,
      params.lifetimeSeconds
    );
  }
  token.add_service(rtc);
  const encoded = token.build();
  if (encoded.length === 0) {
    throw new Error('Failed to build Agora RTC token');
  }
  return encoded;
}
