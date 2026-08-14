import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('chat writes use regional callables and V2 server media upload', () {
    final source = File(
      'lib/features/chat/data/chat_repository_impl.dart',
    ).readAsStringSync();

    expect(source, contains('FirebaseFunctions.instanceFor'));
    expect(source, contains('AppConfig.firebaseFunctionsRegion'));
    expect(source, contains("'sendMessage'"));
    expect(source, contains("'reserveMediaUploadV2'"));
    expect(source, contains('uploadReservedJpegFile'));
    expect(source, contains('_pendingImagePathsByRequestId'));
    expect(source, isNot(contains('messageRef.set')));
    expect(source, isNot(contains('FieldValue.serverTimestamp')));
    expect(source, isNot(contains('putFile')));
    expect(source, isNot(contains('getDownloadURL')));
  });

  test('chat presentation has no direct Firebase access', () {
    final source = File(
      'lib/features/chat/presentation/chat_screen.dart',
    ).readAsStringSync();

    expect(source, isNot(contains('package:cloud_firestore')));
    expect(source, isNot(contains('package:cloud_functions')));
    expect(source, isNot(contains('package:firebase_auth')));
    expect(source, isNot(contains('FirebaseFirestore.instance')));
    expect(source, isNot(contains('FirebaseFunctions.instance')));
    expect(source, isNot(contains('FirebaseAuth.instance')));
  });
}
