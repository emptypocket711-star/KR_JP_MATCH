import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hana/core/media/authenticated_storage_image.dart';

void main() {
  const stagingBucket = 'hana-e2ee6.firebasestorage.app';
  test('derives bounded decode sizes from parent constraints', () {
    expect(
      resolvedMediaDecodeDimension(
        explicitLogicalPixels: null,
        constrainedLogicalPixels: 40,
        devicePixelRatio: 3,
      ),
      120,
    );
    expect(
      resolvedMediaDecodeDimension(
        explicitLogicalPixels: 72,
        constrainedLogicalPixels: 40,
        devicePixelRatio: 2,
      ),
      144,
    );
    expect(
      resolvedMediaDecodeDimension(
        explicitLogicalPixels: null,
        constrainedLogicalPixels: double.infinity,
        devicePixelRatio: 3,
      ),
      1200,
    );
  });

  test('validates bounded callable JPEG byte envelopes', () {
    final bytes = Uint8List.fromList([0xff, 0xd8, 0xff, 0xd9]);
    expect(
      parsePrivateMediaBytesResponse({
        'bytesBase64': base64Encode(bytes),
        'contentType': 'image/jpeg',
        'byteLength': bytes.length,
      }),
      bytes,
    );
    expect(
      () => parsePrivateMediaBytesResponse({
        'bytesBase64': base64Encode(bytes),
        'contentType': 'image/png',
        'byteLength': bytes.length,
      }),
      throwsFormatException,
    );
    expect(
      () => parsePrivateMediaBytesResponse({
        'bytesBase64': base64Encode(bytes),
        'contentType': 'image/jpeg',
        'byteLength': bytes.length + 1,
      }),
      throwsFormatException,
    );
  });

  test('coalesces only in-flight loads and revalidates later loads', () async {
    var currentUid = 'user-a';
    final pending = Completer<Uint8List>();
    var calls = 0;
    Future<Uint8List> fetch(String _) {
      calls += 1;
      return pending.future;
    }

    final first = loadPrivateMediaBytesCoalesced(
      'profile_media/a/x/image.jpg',
      fetch,
      currentUid: () => currentUid,
    );
    final concurrent = loadPrivateMediaBytesCoalesced(
      'profile_media/a/x/image.jpg',
      fetch,
      currentUid: () => currentUid,
    );
    expect(identical(first, concurrent), isTrue);
    expect(calls, 1);
    pending.complete(Uint8List.fromList([1, 2, 3]));
    await first;
    await Future<void>.delayed(Duration.zero);

    final later = loadPrivateMediaBytesCoalesced(
      'profile_media/a/x/image.jpg',
      (_) async {
        calls += 1;
        throw StateError('access revoked');
      },
      currentUid: () => currentUid,
    );
    await expectLater(later, throwsStateError);
    expect(calls, 2);

    final afterFailure = loadPrivateMediaBytesCoalesced(
      'profile_media/a/x/image.jpg',
      (_) async {
        calls += 1;
        return Uint8List.fromList([4, 5, 6]);
      },
      currentUid: () => currentUid,
    );
    expect(await afterFailure, Uint8List.fromList([4, 5, 6]));
    expect(calls, 3);
  });

  test('isolates same-path in-flight loads across authenticated users',
      () async {
    var currentUid = 'user-a';
    final userALoad = Completer<Uint8List>();
    final userBLoad = Completer<Uint8List>();
    var calls = 0;

    Future<Uint8List> fetch(String _) {
      calls += 1;
      return calls == 1 ? userALoad.future : userBLoad.future;
    }

    final first = loadPrivateMediaBytesCoalesced(
      'profile_media/shared/auth/image.jpg',
      fetch,
      currentUid: () => currentUid,
    );

    currentUid = 'user-b';
    final second = loadPrivateMediaBytesCoalesced(
      'profile_media/shared/auth/image.jpg',
      fetch,
      currentUid: () => currentUid,
    );

    expect(identical(first, second), isFalse);
    expect(calls, 2);

    final userBBytes = Uint8List.fromList([2]);
    userBLoad.complete(userBBytes);
    expect(await second, userBBytes);

    userALoad.complete(Uint8List.fromList([1]));
    await expectLater(
      first,
      throwsA(
        isA<StateError>().having(
          (error) => error.message,
          'message',
          contains('session changed'),
        ),
      ),
    );
  });

  test('recognizes only canonical first-party media object paths', () {
    expect(
      isCanonicalStorageMediaPath('profile_media/alice/auth-1/image.jpg'),
      isTrue,
    );
    expect(
      isCanonicalStorageMediaPath(
        'chat_images/room-1/alice/auth-1/image.jpg',
      ),
      isTrue,
    );
    expect(isCanonicalStorageMediaPath('profile_media/alice/x.png'), isFalse);
    expect(
      isCanonicalStorageMediaPath('profile_media/alice/./image.jpg'),
      isFalse,
    );
    expect(
      isCanonicalStorageMediaPath(
        'chat_images/__reserved__/alice/auth/image.jpg',
      ),
      isFalse,
    );
    expect(
      isCanonicalStorageMediaPath(
        'chat_images/room/alice/auth\u0000/image.jpg',
      ),
      isFalse,
    );
    expect(
      isCanonicalStorageMediaPath('chat_images/room/../auth/image.jpg'),
      isFalse,
    );
    expect(
      isCanonicalStorageMediaPath('https://example.com/image.jpg'),
      isFalse,
    );
  });

  test('legacy compatibility is HTTPS display-only', () {
    const legacy =
        'https://firebasestorage.googleapis.com/v0/b/hana-e2ee6.firebasestorage.app/o/profile_media%2Falice%2Fauth-1%2Fimage.jpg?alt=media&token=legacy-token';
    expect(
      isLegacyHttpsMediaReference(legacy, expectedBucket: stagingBucket),
      isTrue,
    );
    expect(
      isLegacyHttpsMediaReference(
        'https://firebasestorage.googleapis.com/v0/b/hana-production-tokyo.firebasestorage.app/o/users%2Falice%2Fphoto.jpg?alt=media&token=legacy-token',
        expectedBucket: stagingBucket,
      ),
      isFalse,
    );
    expect(
      isLegacyHttpsMediaReference(
        'https://example.com/image.jpg',
        expectedBucket: stagingBucket,
      ),
      isFalse,
    );
    expect(
      isLegacyHttpsMediaReference(
        'http://example.com/image.jpg',
        expectedBucket: stagingBucket,
      ),
      isFalse,
    );
    expect(
      isLegacyHttpsMediaReference(
        'https://firebasestorage.googleapis.com/v0/b/attacker.firebasestorage.app/o/profile_media%2Falice%2Fauth-1%2Fimage.jpg?alt=media&token=legacy-token',
        expectedBucket: stagingBucket,
      ),
      isFalse,
    );
    expect(
      isLegacyHttpsMediaReference(
        'https://user:pass@firebasestorage.googleapis.com/v0/b/hana-e2ee6.firebasestorage.app/o/profile_media%2Falice%2Fauth-1%2Fimage.jpg?alt=media&token=legacy-token',
        expectedBucket: stagingBucket,
      ),
      isFalse,
    );
    expect(
      isLegacyHttpsMediaReference(
        'https://firebasestorage.googleapis.com/v0/b/hana-e2ee6.firebasestorage.app/o/unrelated%2Ftracking.gif?alt=media&token=legacy-token',
        expectedBucket: stagingBucket,
      ),
      isFalse,
    );
    expect(
      isLegacyHttpsMediaReference(
        'https://firebasestorage.googleapis.com/v0/b/hana-e2ee6.firebasestorage.app/o/profile_media%2Falice%2Fauth-1%2Fimage.jpg?alt=media&token=legacy-token&redirect=https%3A%2F%2Fexample.com',
        expectedBucket: stagingBucket,
      ),
      isFalse,
    );
  });

  testWidgets('canonical path is loaded through injected authenticated reader',
      (tester) async {
    String? requestedPath;
    await tester.pumpWidget(
      MaterialApp(
        home: AuthenticatedStorageImage(
          reference: 'profile_media/alice/auth-1/image.jpg',
          legacyUrl:
              'https://firebasestorage.googleapis.com/v0/b/hana-e2ee6.firebasestorage.app/o/profile_media%2Falice%2Fold%2Fimage.jpg?alt=media&token=legacy-token',
          loadBytes: (path) async {
            requestedPath = path;
            return Uint8List.fromList(const [1, 2, 3]);
          },
          errorWidget: const Text('denied'),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(requestedPath, 'profile_media/alice/auth-1/image.jpg');
    // Invalid image bytes fail closed. They do not fall back to the legacy URL.
    expect(find.text('denied'), findsOneWidget);
  });
}
