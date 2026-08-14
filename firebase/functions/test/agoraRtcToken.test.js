const assert = require('node:assert/strict');
const test = require('node:test');

const { buildScopedAgoraRtcToken } = require('../lib/agoraRtcToken');
const {
  AccessToken2,
  ServiceRtc,
} = require('agora-token/src/AccessToken2');

const appId = 'a'.repeat(32);
const appCertificate = 'b'.repeat(32);

function decodeRtcToken(token) {
  const decoded = new AccessToken2(appId, appCertificate, 1, 1);
  assert.notEqual(decoded.from_string(token), false);
  const rtc = decoded.services[1];
  assert.ok(rtc, 'decoded token must contain one RTC service');
  return {
    issuedAtSeconds: decoded.issueTs,
    expiresInSeconds: decoded.expire,
    privilegeMap: rtc.__privileges,
    channelName: rtc.__channel_name.toString('utf8'),
    uid: rtc.__uid.toString('utf8'),
  };
}

test('voice token decodes to join and publish-audio privileges only', () => {
  const decoded = decodeRtcToken(buildScopedAgoraRtcToken({
    appId,
    appCertificate,
    channelName: 'hana_voice',
    uid: 123,
    callType: 'voice',
    lifetimeSeconds: 60,
  }));
  assert.deepEqual(decoded, {
    issuedAtSeconds: decoded.issuedAtSeconds,
    expiresInSeconds: 60,
    privilegeMap: {
      [ServiceRtc.kPrivilegeJoinChannel]: 60,
      [ServiceRtc.kPrivilegePublishAudioStream]: 60,
    },
    channelName: 'hana_voice',
    uid: '123',
  });
  assert.ok(Number.isSafeInteger(decoded.issuedAtSeconds));
  assert.ok(decoded.issuedAtSeconds > 0);
  assert.equal(
    ServiceRtc.kPrivilegePublishVideoStream in decoded.privilegeMap,
    false
  );
  assert.equal(
    ServiceRtc.kPrivilegePublishDataStream in decoded.privilegeMap,
    false
  );
});

test('video token adds video but still omits data-stream privilege', () => {
  const decoded = decodeRtcToken(buildScopedAgoraRtcToken({
    appId,
    appCertificate,
    channelName: 'hana_video',
    uid: 456,
    callType: 'video',
    lifetimeSeconds: 41,
  }));
  assert.deepEqual(decoded.privilegeMap, {
    [ServiceRtc.kPrivilegeJoinChannel]: 41,
    [ServiceRtc.kPrivilegePublishAudioStream]: 41,
    [ServiceRtc.kPrivilegePublishVideoStream]: 41,
  });
  assert.equal(decoded.expiresInSeconds, 41);
  assert.equal(
    ServiceRtc.kPrivilegePublishDataStream in decoded.privilegeMap,
    false
  );
});

test('scoped builder rejects invalid lease and uid boundaries', () => {
  for (const lifetimeSeconds of [0, -1, 1.5, 61, NaN, Infinity]) {
    assert.throws(() => buildScopedAgoraRtcToken({
      appId,
      appCertificate,
      channelName: 'hana_voice',
      uid: 123,
      callType: 'voice',
      lifetimeSeconds,
    }));
  }
  for (const uid of [0, -1, 1.5, 0x100000000]) {
    assert.throws(() => buildScopedAgoraRtcToken({
      appId,
      appCertificate,
      channelName: 'hana_voice',
      uid,
      callType: 'voice',
      lifetimeSeconds: 60,
    }));
  }
  assert.throws(() => buildScopedAgoraRtcToken({
    appId,
    appCertificate,
    channelName: 'hana_voice',
    uid: 123,
    callType: 'data',
    lifetimeSeconds: 60,
  }));
});

test('agora-token remains exact-pinned while internal primitives are used', () => {
  const manifest = require('../package.json');
  const lockfile = require('../package-lock.json');
  assert.equal(manifest.dependencies['agora-token'], '2.0.5');
  assert.equal(lockfile.packages[''].dependencies['agora-token'], '2.0.5');
  assert.equal(
    lockfile.packages['node_modules/agora-token'].version,
    '2.0.5'
  );
});
