import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('FCM tokens are registered through the regional server callable', () {
    final source = File(
      'lib/core/services/fcm_service.dart',
    ).readAsStringSync();

    expect(source, contains('FirebaseFunctions.instanceFor'));
    expect(source, contains('AppConfig.firebaseFunctionsRegion'));
    expect(source, contains("'updateFcmToken'"));
    expect(source, contains('prepareRegistrationAfterProfileReady()'));
    expect(source, contains('_ensureTokenRefreshSubscription('));
    expect(source, contains('_registrationFence.allows(registrationTicket)'));
    expect(source, isNot(contains('FirebaseFirestore.instance')));
    expect(source, isNot(contains("'fcmToken': token")));
  });
}
