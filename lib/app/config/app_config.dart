import 'package:flutter/foundation.dart';

class AppConfig {
  const AppConfig._();

  static const appEnv =
      String.fromEnvironment('APP_ENV', defaultValue: 'staging');

  static const stagingFirebaseProjectId = 'hana-e2ee6';
  static const productionFirebaseProjectId = 'hana-production-tokyo';
  static const stagingFirebaseFunctionsRegion = 'us-central1';
  static const productionFirebaseFunctionsRegion = 'asia-northeast1';

  static const isProduction = appEnv == 'production';
  static const isStaging = appEnv == 'staging';

  static String resolveFirebaseProjectId(String environment) =>
      switch (environment) {
        'staging' => stagingFirebaseProjectId,
        'production' => productionFirebaseProjectId,
        _ => throw StateError(
            'Unsupported APP_ENV "$environment". Use exactly "staging" or '
            '"production".',
          ),
      };

  static String get expectedFirebaseProjectId =>
      resolveFirebaseProjectId(appEnv);

  static String resolveFirebaseStorageBucket(String environment) {
    final projectId = resolveFirebaseProjectId(environment);
    return '$projectId.firebasestorage.app';
  }

  static String get expectedFirebaseStorageBucket =>
      resolveFirebaseStorageBucket(appEnv);

  static const _configuredFirebaseFunctionsRegion = String.fromEnvironment(
    'FIREBASE_FUNCTIONS_REGION',
  );

  static String resolveFirebaseFunctionsRegion(
    String environment, {
    String configuredRegion = '',
  }) {
    final expected = switch (environment) {
      'staging' => stagingFirebaseFunctionsRegion,
      'production' => productionFirebaseFunctionsRegion,
      _ => throw StateError(
          'Unsupported APP_ENV "$environment". Use exactly "staging" or '
          '"production".',
        ),
    };
    if (configuredRegion.isNotEmpty && configuredRegion != expected) {
      throw StateError(
        'Firebase Functions region mismatch: expected "$expected", found '
        '"$configuredRegion".',
      );
    }
    return expected;
  }

  static String get firebaseFunctionsRegion => resolveFirebaseFunctionsRegion(
        appEnv,
        configuredRegion: _configuredFirebaseFunctionsRegion,
      );

  static const useDebugAppCheck = !kReleaseMode &&
      !kProfileMode &&
      bool.fromEnvironment('USE_DEBUG_APP_CHECK', defaultValue: true);

  static const allowMockData = !kReleaseMode &&
      !kProfileMode &&
      bool.fromEnvironment('ALLOW_MOCK_DATA', defaultValue: false);

  static const allowQaEmailLogin = !kReleaseMode &&
      !kProfileMode &&
      bool.fromEnvironment('ALLOW_QA_EMAIL_LOGIN', defaultValue: false);

  static const allowQaPointGrant = !kReleaseMode &&
      !kProfileMode &&
      bool.fromEnvironment('ALLOW_QA_POINT_GRANT', defaultValue: false);

  /// Store purchases stay source-locked until the verified client and backend
  /// purchase flow is approved for release. This must not be build-configurable.
  static const purchaseEnabled = false;

  static const qaEmail = String.fromEnvironment('QA_EMAIL');
  static const qaPassword = String.fromEnvironment('QA_PASSWORD');

  static const defaultUiLocale =
      String.fromEnvironment('DEFAULT_UI_LOCALE', defaultValue: 'ko');

  static const legalTermsUrl = String.fromEnvironment('LEGAL_TERMS_URL');
  static const legalPrivacyUrl = String.fromEnvironment('LEGAL_PRIVACY_URL');
  static const legalCommunitySafetyUrl =
      String.fromEnvironment('LEGAL_COMMUNITY_SAFETY_URL');
  static const legalAccountDeletionUrl =
      String.fromEnvironment('LEGAL_ACCOUNT_DELETION_URL');
}
