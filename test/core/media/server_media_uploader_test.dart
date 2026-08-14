import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:hana/core/media/media_upload_reservation.dart';
import 'package:hana/core/media/server_media_uploader.dart';

void main() {
  final reservation = MediaUploadReservation(
    authorizationId: 'auth-1',
    path: 'profile_media/alice/auth-1/image.jpg',
    expiresAt: _future,
    maxBytes: MediaUploadReservation.absoluteMaxBytes,
  );
  final confirmed = {
    'authorizationId': reservation.authorizationId,
    'path': reservation.path,
  };

  test('rejects more than 5 MiB before any callable', () async {
    var uploadCalls = 0;
    var statusCalls = 0;
    await expectLater(
      uploadReservedJpegBytes(
        reservation: reservation,
        bytes: Uint8List(MediaUploadReservation.absoluteMaxBytes + 1),
        sizeErrorMessage: 'too large',
        uploadCall: (_) async {
          uploadCalls += 1;
          return confirmed;
        },
        statusCall: (_) async {
          statusCalls += 1;
          return confirmed;
        },
      ),
      throwsException,
    );
    expect(uploadCalls, 0);
    expect(statusCalls, 0);
  });

  test('rejects an authorization/path response mismatch', () async {
    await expectLater(
      uploadReservedJpegBytes(
        reservation: reservation,
        bytes: Uint8List.fromList([1]),
        sizeErrorMessage: 'too large',
        uploadCall: (_) async => {
          'authorizationId': reservation.authorizationId,
          'path': 'profile_media/alice/auth-1/other.jpg',
        },
        statusCall: (_) async => confirmed,
      ),
      throwsFormatException,
    );
  });

  test(
      'ambiguous response checks status and sends the payload zero more times '
      'when already confirmed', () async {
    var uploadCalls = 0;
    var statusCalls = 0;
    final result = await uploadReservedJpegBytes(
      reservation: reservation,
      bytes: Uint8List.fromList([1, 2, 3]),
      sizeErrorMessage: 'too large',
      uploadCall: (_) async {
        uploadCalls += 1;
        throw const ServerMediaCallFailure('unavailable');
      },
      statusCall: (_) async {
        statusCalls += 1;
        return confirmed;
      },
    );
    expect(result.path, reservation.path);
    expect(uploadCalls, 1);
    expect(statusCalls, 1);
  });

  test(
      'ambiguous response waits for lease-aware status then retries the full '
      'payload at most once', () async {
    var uploadCalls = 0;
    var statusCalls = 0;
    final delays = <Duration>[];
    final result = await uploadReservedJpegBytes(
      reservation: reservation,
      bytes: Uint8List.fromList([1, 2, 3]),
      sizeErrorMessage: 'too large',
      uploadCall: (_) async {
        uploadCalls += 1;
        if (uploadCalls == 1) {
          throw const ServerMediaCallFailure('deadline-exceeded');
        }
        return confirmed;
      },
      statusCall: (_) async {
        statusCalls += 1;
        if (statusCalls == 1) {
          throw const ServerMediaCallFailure(
            'aborted',
            details: {
              'uploadState': 'server_uploading',
              'retryAfterMillis': 1250,
            },
          );
        }
        throw const ServerMediaCallFailure('failed-precondition');
      },
      delay: (duration) async => delays.add(duration),
    );
    expect(result.path, reservation.path);
    expect(statusCalls, 2);
    expect(uploadCalls, 2);
    expect(delays, [const Duration(milliseconds: 1500)]);
  });

  test('non-ambiguous failures never poll status or retry payload', () async {
    var uploadCalls = 0;
    var statusCalls = 0;
    await expectLater(
      uploadReservedJpegBytes(
        reservation: reservation,
        bytes: Uint8List.fromList([1]),
        sizeErrorMessage: 'too large',
        uploadCall: (_) async {
          uploadCalls += 1;
          throw const ServerMediaCallFailure('permission-denied');
        },
        statusCall: (_) async {
          statusCalls += 1;
          return confirmed;
        },
      ),
      throwsA(isA<ServerMediaCallFailure>()),
    );
    expect(uploadCalls, 1);
    expect(statusCalls, 0);
  });

  test(
      'lost response from the sole payload retry is recovered by final status '
      'without a third payload', () async {
    var uploadCalls = 0;
    var statusCalls = 0;
    final result = await uploadReservedJpegBytes(
      reservation: reservation,
      bytes: Uint8List.fromList([1, 2, 3]),
      sizeErrorMessage: 'too large',
      uploadCall: (_) async {
        uploadCalls += 1;
        throw const ServerMediaCallFailure('unavailable');
      },
      statusCall: (_) async {
        statusCalls += 1;
        if (statusCalls == 1) {
          throw const ServerMediaCallFailure('failed-precondition');
        }
        return confirmed;
      },
    );
    expect(result.path, reservation.path);
    expect(uploadCalls, 2);
    expect(statusCalls, 2);
  });

  test('all repositories use only the V2 reservation and shared uploader', () {
    const paths = [
      'lib/features/onboarding/data/onboarding_repository_impl.dart',
      'lib/features/profile/data/profile_repository_impl.dart',
      'lib/features/chat/data/chat_repository_impl.dart',
    ];
    for (final path in paths) {
      final source = File(path).readAsStringSync();
      expect(source, contains("'reserveMediaUploadV2'"), reason: path);
      expect(source, contains('uploadReservedJpegFile('), reason: path);
      expect(source, isNot(contains('putFile(')), reason: path);
      expect(source, isNot(contains('getDownloadURL(')), reason: path);
      expect(source, isNot(contains('SettableMetadata')), reason: path);
      expect(source, isNot(contains("'confirmMediaUpload'")), reason: path);
      expect(source, isNot(contains("'reserveMediaUpload'")), reason: path);
    }
  });

  test('the client has no direct Firebase Storage service dependency', () {
    final serviceSource = File(
      'lib/core/services/firebase_service.dart',
    ).readAsStringSync();
    final pubspecSource = File('pubspec.yaml').readAsStringSync();

    expect(serviceSource, isNot(contains('FirebaseStorage')));
    expect(serviceSource, isNot(contains('package:firebase_storage')));
    expect(pubspecSource, isNot(contains('firebase_storage:')));
  });
}

final _future = DateTime.fromMillisecondsSinceEpoch(
  1893456000000,
  isUtc: true,
);
