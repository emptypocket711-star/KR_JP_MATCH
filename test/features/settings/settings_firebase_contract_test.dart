import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('direct settings updates stay inside the Firestore Rules allowlist', () {
    final settingsSource = File(
      'lib/features/settings/presentation/settings_screen.dart',
    ).readAsStringSync();
    final rulesSource = File('firebase/firestore.rules').readAsStringSync();

    expect(
      settingsSource,
      contains("_updateNotificationSetting('notificationsEnabled', v)"),
    );
    expect(
      settingsSource,
      contains("_updateNotificationSetting('nightQuietEnabled', v)"),
    );
    expect(
      RegExp(r'_updateNotificationSetting\(').allMatches(settingsSource),
      hasLength(3),
    );
    expect(settingsSource, contains("update({'uiLanguage': languageCode})"));
    expect(settingsSource, contains("'uiLanguage': FieldValue.delete()"));

    expect(rulesSource, contains('"notificationsEnabled"'));
    expect(rulesSource, contains('next.notificationsEnabled is bool'));
    expect(rulesSource, contains('"nightQuietEnabled"'));
    expect(rulesSource, contains('next.nightQuietEnabled is bool'));
    expect(rulesSource, contains('next.uiLanguage in ["ko", "ja"]'));
    expect(
      rulesSource,
      contains('!next.keys().hasAny(["uiLanguage"])'),
    );
  });

  test('deleteAccount uses the environment-bound Functions region', () {
    final source = File(
      'lib/features/settings/presentation/settings_screen.dart',
    ).readAsStringSync();

    expect(source, contains('FirebaseFunctions.instanceFor('));
    expect(source, contains('region: AppConfig.firebaseFunctionsRegion'));
    expect(source, contains("httpsCallable('deleteAccount')"));
    expect(
      source,
      isNot(
        contains("FirebaseFunctions.instance.httpsCallable('deleteAccount')"),
      ),
    );
  });
}
