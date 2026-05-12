import 'package:flutter/foundation.dart';

class AppConfig {
  const AppConfig._();

  static const appEnv =
      String.fromEnvironment('APP_ENV', defaultValue: 'staging');

  static const isProduction = appEnv == 'production' || appEnv == 'prod';
  static const isStaging = !isProduction;

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
