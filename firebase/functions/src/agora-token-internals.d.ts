declare module 'agora-token/src/AccessToken2' {
  export class ServiceRtc {
    static readonly kPrivilegeJoinChannel: number;
    static readonly kPrivilegePublishAudioStream: number;
    static readonly kPrivilegePublishVideoStream: number;
    static readonly kPrivilegePublishDataStream: number;

    constructor(channelName: string, uid: string | number);
    add_privilege(privilege: number, expire: number): void;
  }

  export class AccessToken2 {
    constructor(
      appId: string,
      appCertificate: string,
      issueTimestamp: number,
      expiresInSeconds: number
    );
    add_service(service: ServiceRtc): void;
    build(): string;
  }
}
