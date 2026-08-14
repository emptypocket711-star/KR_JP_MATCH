import 'dart:async';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:hana/core/services/fcm_service.dart';

void main() {
  test('sign-out detaches the exact FCM token before clearing Firebase Auth',
      () {
    final authSource = File(
      'lib/features/auth/data/auth_repository_impl.dart',
    ).readAsStringSync();
    final fcmSource = File(
      'lib/core/services/fcm_service.dart',
    ).readAsStringSync();

    final detachIndex = authSource.indexOf('detachForSignOut()');
    final signOutIndex = authSource.indexOf('_firebaseService.auth.signOut()');
    expect(detachIndex, greaterThanOrEqualTo(0));
    expect(signOutIndex, greaterThan(detachIndex));
    expect(fcmSource, contains("httpsCallable('detachFcmToken')"));
    expect(fcmSource, contains('AppConfig.firebaseFunctionsRegion'));
    expect(fcmSource, contains('_messaging.deleteToken()'));
    expect(fcmSource, contains('_tokenRefreshSubscription?.cancel()'));
    expect(fcmSource, contains('FcmTokenRegistrationFence'));
    expect(fcmSource, contains('_registrationFence.close()'));
    expect(fcmSource, contains('await _registrationFence.drain()'));
    expect(fcmSource, contains('_registrationFence.issueTicket()'));
    expect(
        fcmSource, contains('_registrationFence.allows(registrationTicket)'));
    expect(fcmSource, contains('void onFirebaseAuthCleared()'));
    expect(
      fcmSource,
      isNot(
        contains(
          'Future<void> init() async {\n    try {\n      _signingOut = false',
        ),
      ),
    );
    expect(
      authSource,
      isNot(contains('try {\n      await FcmService().detachForSignOut()')),
    );
  });

  test('Auth is cleared only after either remote or local token revocation',
      () {
    expect(
      isSafeToClearAuthAfterFcmDetach(
        serverDetached: true,
        localTokenDeleted: false,
        registrationWritesDrained: true,
      ),
      isTrue,
    );
    expect(
      isSafeToClearAuthAfterFcmDetach(
        serverDetached: false,
        localTokenDeleted: true,
        registrationWritesDrained: false,
      ),
      isTrue,
    );
    expect(
      isSafeToClearAuthAfterFcmDetach(
        serverDetached: false,
        localTokenDeleted: false,
        registrationWritesDrained: true,
      ),
      isFalse,
    );
    expect(
      isSafeToClearAuthAfterFcmDetach(
        serverDetached: true,
        localTokenDeleted: false,
        registrationWritesDrained: false,
      ),
      isFalse,
    );
  });

  test('registration fence drains an in-flight write before detach continues',
      () async {
    final fence = FcmTokenRegistrationFence();
    final release = Completer<void>();
    final events = <String>[];

    final registration = fence.run(() async {
      events.add('registration-started');
      await release.future;
      events.add('registration-finished');
    });
    fence.close();
    final drain = fence.drain().then((value) {
      events.add('drained');
      return value;
    });

    await Future<void>.delayed(Duration.zero);
    expect(events, ['registration-started']);
    release.complete();
    await registration;
    expect(await drain, isTrue);
    expect(
      events,
      ['registration-started', 'registration-finished', 'drained'],
    );

    var blockedActionRan = false;
    await fence.run(() async => blockedActionRan = true);
    expect(blockedActionRan, isFalse);
    fence.reopen();
    await fence.run(() async => blockedActionRan = true);
    expect(blockedActionRan, isTrue);
  });

  test('profile-ready retry ticket cannot register after sign-out and reopen',
      () async {
    final fence = FcmTokenRegistrationFence();
    final staleTicket = fence.issueTicket();
    expect(staleTicket, isNotNull);

    fence.close();
    fence.reopen();

    var staleRegistrationRan = false;
    await fence.run(
      () async => staleRegistrationRan = true,
      ticket: staleTicket,
    );
    expect(staleRegistrationRan, isFalse);

    final nextSessionTicket = fence.issueTicket();
    expect(nextSessionTicket, isNotNull);
    var nextSessionRegistrationRan = false;
    await fence.run(
      () async => nextSessionRegistrationRan = true,
      ticket: nextSessionTicket,
    );
    expect(nextSessionRegistrationRan, isTrue);
  });

  test('failed registration drain requires local token deletion', () async {
    final fence = FcmTokenRegistrationFence();
    final registration = fence.run(() async => throw StateError('failed'));
    final registrationExpectation = expectLater(
      registration,
      throwsStateError,
    );
    fence.close();

    expect(await fence.drain(), isFalse);
    await registrationExpectation;
    expect(
      isSafeToClearAuthAfterFcmDetach(
        serverDetached: true,
        localTokenDeleted: false,
        registrationWritesDrained: false,
      ),
      isFalse,
    );
  });
}
