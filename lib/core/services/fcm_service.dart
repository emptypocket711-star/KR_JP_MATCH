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
    if (_registrationFence.isClosed) return;
    try {
      final settings = await _messaging.requestPermission(
        alert: true,
        badge: true,
        sound: true,
      );

      if (!_registrationFence.isClosed &&
          (settings.authorizationStatus == AuthorizationStatus.authorized ||
              settings.authorizationStatus ==
                  AuthorizationStatus.provisional)) {
        await _saveToken();
        _tokenRefreshSubscription ??= _messaging.onTokenRefresh.listen(
          (token) => unawaited(_saveTokenBestEffort(token)),
        );
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

  Future<void> _saveToken([String? refreshedToken]) => _registrationFence.run(
        () => _performTokenRegistration(refreshedToken),
      );

  Future<void> _performTokenRegistration(String? refreshedToken) async {
    if (_registrationFence.isClosed) return;
    final uid = FirebaseAuth.instance.currentUser?.uid;
    if (uid == null) return;
    final token = refreshedToken ?? await _messaging.getToken();
    if (token == null || _registrationFence.isClosed) return;
    await FirebaseFunctions.instanceFor(
      region: AppConfig.firebaseFunctionsRegion,
    ).httpsCallable('updateFcmToken').call({'token': token});
  }

  Future<void> _saveTokenBestEffort(String token) async {
    try {
      await _saveToken(token);
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
class FcmTokenRegistrationFence {
  final Set<Future<void>> _pending = <Future<void>>{};
  bool _closed = false;

  bool get isClosed => _closed;

  Future<void> run(Future<void> Function() action) {
    if (_closed) return Future<void>.value();
    late final Future<void> pending;
    pending = Future<void>.sync(action);
    _pending.add(pending);
    return pending.whenComplete(
      () => _pending.remove(pending),
    );
  }

  void close() {
    _closed = true;
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
