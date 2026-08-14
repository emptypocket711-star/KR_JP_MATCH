import 'dart:async';

import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';

import '../../app/config/app_config.dart';

class FcmService {
  static final FcmService _instance = FcmService._internal();
  factory FcmService() => _instance;
  FcmService._internal();

  final _messaging = FirebaseMessaging.instance;
  StreamSubscription<String>? _tokenRefreshSubscription;
  final _registrationFence = FcmTokenRegistrationFence();

  Future<void> init() async {
    final registrationTicket = _registrationFence.issueTicket();
    if (registrationTicket == null) return;
    try {
      final settings = await _messaging.requestPermission(
        alert: true,
        badge: true,
        sound: true,
      );

      if (_registrationFence.allows(registrationTicket) &&
          (settings.authorizationStatus == AuthorizationStatus.authorized ||
              settings.authorizationStatus ==
                  AuthorizationStatus.provisional)) {
        _ensureTokenRefreshSubscription(registrationTicket);
        await _saveToken(ticket: registrationTicket);
      }
    } catch (_) {
      // Permission and token registration remain retryable on the next auth
      // transition or token refresh; app bootstrap must stay available.
    }
  }

  /// Opens registration again only after Firebase Auth has emitted signed-out.
  /// `init` itself must never clear the fence while detach is in progress.
  void onFirebaseAuthCleared() {
    _registrationFence.reopen();
  }

  /// Captures the current auth-session fence before profile creation begins.
  /// The returned callback is safe to invoke only after that creation succeeds;
  /// a sign-out in between invalidates the captured ticket.
  Future<void> Function() prepareRegistrationAfterProfileReady() {
    final registrationTicket = _registrationFence.issueTicket();
    if (registrationTicket == null) {
      return () async {};
    }
    return () async {
      try {
        _ensureTokenRefreshSubscription(registrationTicket);
        await _saveToken(ticket: registrationTicket);
      } catch (_) {
        // Notification registration is best effort. A future auth transition
        // or token refresh can retry without turning a saved profile into an
        // onboarding failure.
      }
    };
  }

  void _ensureTokenRefreshSubscription(
    FcmTokenRegistrationTicket registrationTicket,
  ) {
    if (!_registrationFence.allows(registrationTicket)) return;
    _tokenRefreshSubscription ??= _messaging.onTokenRefresh.listen(
      (token) => unawaited(_saveTokenBestEffort(token)),
    );
  }

  Future<void> _saveToken({
    String? refreshedToken,
    FcmTokenRegistrationTicket? ticket,
  }) {
    final registrationTicket = ticket ?? _registrationFence.issueTicket();
    if (registrationTicket == null) return Future<void>.value();
    return _registrationFence.run(
      () => _performTokenRegistration(refreshedToken, registrationTicket),
      ticket: registrationTicket,
    );
  }

  Future<void> _performTokenRegistration(
    String? refreshedToken,
    FcmTokenRegistrationTicket registrationTicket,
  ) async {
    if (!_registrationFence.allows(registrationTicket)) return;
    final uid = FirebaseAuth.instance.currentUser?.uid;
    if (uid == null) return;
    final token = refreshedToken ?? await _messaging.getToken();
    if (token == null || !_registrationFence.allows(registrationTicket)) return;
    await FirebaseFunctions.instanceFor(
      region: AppConfig.firebaseFunctionsRegion,
    ).httpsCallable('updateFcmToken').call({'token': token});
  }

  Future<void> _saveTokenBestEffort(String token) async {
    final registrationTicket = _registrationFence.issueTicket();
    if (registrationTicket == null) return;
    try {
      await _saveToken(
        refreshedToken: token,
        ticket: registrationTicket,
      );
    } catch (_) {
      // A later refresh or auth transition retries registration.
    }
  }

  /// Detaches the current installation before Auth is cleared so a signed-out
  /// device cannot keep receiving private notification previews.
  Future<void> detachForSignOut() async {
    _registrationFence.close();
    try {
      await _tokenRefreshSubscription?.cancel();
    } catch (_) {
      // The closed fence below still prevents an in-flight refresh from
      // registering another token.
    }
    _tokenRefreshSubscription = null;

    final registrationWritesDrained = await _registrationFence.drain();

    var serverDetached = false;
    var localTokenDeleted = false;
    try {
      final uid = FirebaseAuth.instance.currentUser?.uid;
      if (uid == null) {
        serverDetached = true;
      } else {
        final token = await _messaging.getToken();
        if (token == null || token.isEmpty) {
          serverDetached = true;
        } else {
          await FirebaseFunctions.instanceFor(
            region: AppConfig.firebaseFunctionsRegion,
          ).httpsCallable('detachFcmToken').call({'token': token});
          serverDetached = true;
        }
      }
    } catch (_) {
      // Deleting the local FCM registration below is an independent privacy
      // fallback when the callable cannot be reached.
    }

    try {
      await _messaging.deleteToken();
      localTokenDeleted = true;
    } catch (_) {
      // The final safety check decides whether Auth may be cleared.
    }

    if (!isSafeToClearAuthAfterFcmDetach(
      serverDetached: serverDetached,
      localTokenDeleted: localTokenDeleted,
      registrationWritesDrained: registrationWritesDrained,
    )) {
      throw StateError(
        'Notification registration could not be detached safely.',
      );
    }
  }
}

@visibleForTesting
class FcmTokenRegistrationTicket {
  const FcmTokenRegistrationTicket._(this.generation);

  final int generation;
}

@visibleForTesting
class FcmTokenRegistrationFence {
  final Set<Future<void>> _pending = <Future<void>>{};
  bool _closed = false;
  int _generation = 0;

  bool get isClosed => _closed;

  FcmTokenRegistrationTicket? issueTicket() =>
      _closed ? null : FcmTokenRegistrationTicket._(_generation);

  bool allows(FcmTokenRegistrationTicket ticket) =>
      !_closed && ticket.generation == _generation;

  Future<void> run(
    Future<void> Function() action, {
    FcmTokenRegistrationTicket? ticket,
  }) {
    final registrationTicket = ticket ?? issueTicket();
    if (registrationTicket == null || !allows(registrationTicket)) {
      return Future<void>.value();
    }
    late final Future<void> pending;
    pending = Future<void>.sync(action);
    _pending.add(pending);
    return pending.whenComplete(
      () => _pending.remove(pending),
    );
  }

  void close() {
    _closed = true;
    _generation += 1;
  }

  Future<bool> drain() async {
    final pending = List<Future<void>>.of(_pending);
    if (pending.isEmpty) return true;
    try {
      await Future.wait(pending);
      return true;
    } catch (_) {
      return false;
    }
  }

  void reopen() {
    _generation += 1;
    _closed = false;
  }
}

@visibleForTesting
bool isSafeToClearAuthAfterFcmDetach({
  required bool serverDetached,
  required bool localTokenDeleted,
  required bool registrationWritesDrained,
}) =>
    localTokenDeleted || (serverDetached && registrationWritesDrained);
