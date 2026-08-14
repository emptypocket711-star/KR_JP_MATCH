import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:hana/app/config/app_config.dart';

void main() {
  group('AppConfig Firebase environment mapping', () {
    test('defaults to staging and binds its region and bucket', () {
      expect(AppConfig.appEnv, 'staging');
      expect(AppConfig.expectedFirebaseProjectId, 'hana-e2ee6');
      expect(AppConfig.firebaseFunctionsRegion, 'us-central1');
      expect(
        AppConfig.expectedFirebaseStorageBucket,
        'hana-e2ee6.firebasestorage.app',
      );
    });

    test('maps production without merging its region into staging', () {
      expect(
        AppConfig.resolveFirebaseFunctionsRegion('production'),
        'asia-northeast1',
      );
      expect(
        AppConfig.resolveFirebaseProjectId('production'),
        'hana-production-tokyo',
      );
      expect(
        AppConfig.resolveFirebaseStorageBucket('production'),
        'hana-production-tokyo.firebasestorage.app',
      );
    });

    test('unknown environment and configured region mismatch fail closed', () {
      expect(
        () => AppConfig.resolveFirebaseFunctionsRegion('preview'),
        throwsStateError,
      );
      expect(
        () => AppConfig.resolveFirebaseStorageBucket('preview'),
        throwsStateError,
      );
      expect(
        () => AppConfig.resolveFirebaseFunctionsRegion(
          'staging',
          configuredRegion: 'asia-northeast1',
        ),
        throwsStateError,
      );
    });

    test('bootstrap rejects Firebase options from another project', () {
      final source = File(
        'lib/app/bootstrap/hana_bootstrap_app.dart',
      ).readAsStringSync();

      expect(source, contains('AppConfig.expectedFirebaseProjectId'));
      expect(source, contains('Firebase project mismatch'));
      expect(source, contains('AppConfig.useDebugAppCheck'));
    });
  });

  test('store purchases are source-locked off', () {
    expect(AppConfig.purchaseEnabled, isFalse);
  });
}
