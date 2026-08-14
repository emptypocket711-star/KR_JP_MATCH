import 'package:flutter_test/flutter_test.dart';
import 'package:hana/core/media/media_upload_reservation.dart';

void main() {
  test('parses a valid callable reservation payload', () {
    final reservation = MediaUploadReservation.fromCallableData({
      'authorizationId': 'auth-1',
      'path': 'profile_media/alice/auth-1/image.jpg',
      'expiresAtMillis': 1800000000000,
      'maxBytes': 5 * 1024 * 1024,
      'uploadProtocolVersion': 2,
    });

    expect(reservation.authorizationId, 'auth-1');
    expect(reservation.path, 'profile_media/alice/auth-1/image.jpg');
    expect(reservation.expiresAt.isUtc, isTrue);
    expect(reservation.maxBytes, 5 * 1024 * 1024);
  });

  test('rejects malformed reservation payloads', () {
    expect(
      () => MediaUploadReservation.fromCallableData({'path': 'x'}),
      throwsFormatException,
    );
    expect(
      () => MediaUploadReservation.fromCallableData(null),
      throwsFormatException,
    );
    expect(
      () => MediaUploadReservation.fromCallableData({
        'authorizationId': 'auth-1',
        'path': 'profile_media/alice/different-auth/image.jpg',
        'expiresAtMillis': 1800000000000,
        'maxBytes': 5 * 1024 * 1024,
        'uploadProtocolVersion': 2,
      }),
      throwsFormatException,
    );
    expect(
      () => MediaUploadReservation.fromCallableData({
        'authorizationId': 'auth-1',
        'path': 'profile_media/alice/auth-1/image.jpg',
        'expiresAtMillis': 1800000000000,
        'maxBytes': 5 * 1024 * 1024,
      }),
      throwsFormatException,
    );
    expect(
      () => MediaUploadReservation.fromCallableData({
        'authorizationId': 'auth-1',
        'path': 'profile_media/alice/auth-1/image.jpg',
        'expiresAtMillis': 1800000000000,
        'maxBytes': 5 * 1024 * 1024 + 1,
        'uploadProtocolVersion': 2,
      }),
      throwsFormatException,
    );
  });

  test('confirmed uploads retain only the canonical path', () {
    final upload = ConfirmedMediaUpload.fromCallableData({
      'authorizationId': 'auth-1',
      'path': 'profile_media/alice/auth-1/image.jpg',
      'imageUrl':
          'https://firebasestorage.googleapis.com/v0/b/bucket/o/path?alt=media',
    });
    expect(upload.path, 'profile_media/alice/auth-1/image.jpg');
    final privateUpload = ConfirmedMediaUpload.fromCallableData({
      'authorizationId': 'auth-2',
      'path': 'profile_media/alice/auth-2/image.jpg',
    });
    expect(privateUpload.path, 'profile_media/alice/auth-2/image.jpg');
    // The legacy imageUrl response member is intentionally ignored instead of
    // retained or persisted by the new client.
    expect(
      () => ConfirmedMediaUpload.fromCallableData({
        'authorizationId': 'auth-1',
        'path': '',
      }),
      throwsFormatException,
    );
  });
}
