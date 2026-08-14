import 'dart:async';

import 'package:firebase_app_check/firebase_app_check.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/services/fcm_service.dart';
import '../../core/services/firebase_service.dart';
import '../../firebase_options.dart';
import '../app.dart';
import '../config/app_config.dart';

/// Keeps every callable-backed surface closed until Firebase and App Check are
/// ready. A failed attestation must never look like a usable signed-in app.
class HanaBootstrapApp extends StatefulWidget {
  const HanaBootstrapApp({
    super.key,
    @visibleForTesting this.bootstrapOverride,
    @visibleForTesting this.applicationOverride,
  });

  final Future<void> Function()? bootstrapOverride;
  final Widget? applicationOverride;

  @override
  State<HanaBootstrapApp> createState() => _HanaBootstrapAppState();
}

class _HanaBootstrapAppState extends State<HanaBootstrapApp> {
  late Future<void> _bootstrap;
  StreamSubscription<User?>? _authSubscription;

  @override
  void initState() {
    super.initState();
    _bootstrap = _startBootstrap();
  }

  Future<void> _startBootstrap() async {
    // Let FutureBuilder subscribe before a synchronous test double or platform
    // channel failure can complete the attempt.
    await Future<void>.delayed(Duration.zero);
    await (widget.bootstrapOverride?.call() ?? _initialize());
  }

  Future<void> _initialize() async {
    final options = DefaultFirebaseOptions.currentPlatform;
    if (options.projectId != AppConfig.expectedFirebaseProjectId) {
      throw StateError(
        'Firebase project mismatch: expected '
        '"${AppConfig.expectedFirebaseProjectId}", found '
        '"${options.projectId}".',
      );
    }

    final firebaseApp = Firebase.apps.isEmpty
        ? await Firebase.initializeApp(options: options)
        : Firebase.app();
    if (firebaseApp.options.projectId != AppConfig.expectedFirebaseProjectId) {
      throw StateError('The initialized Firebase project is not allowed.');
    }

    await FirebaseAppCheck.instance.activate(
      providerAndroid: AppConfig.useDebugAppCheck
          ? const AndroidDebugProvider()
          : const AndroidPlayIntegrityProvider(),
    );
    final appCheckToken = await FirebaseAppCheck.instance.getToken();
    if (appCheckToken == null || appCheckToken.isEmpty) {
      throw StateError('App Check did not issue an attestation token.');
    }

    FirebaseService().initialize();
    await _authSubscription?.cancel();
    _authSubscription = FirebaseAuth.instance.authStateChanges().listen((user) {
      if (user != null) {
        unawaited(FcmService().init());
      } else {
        FcmService().onFirebaseAuthCleared();
      }
    });
  }

  void _retry() {
    final nextBootstrap = _startBootstrap();
    setState(() {
      _bootstrap = nextBootstrap;
    });
  }

  @override
  void dispose() {
    unawaited(_authSubscription?.cancel());
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<void>(
      future: _bootstrap,
      builder: (context, snapshot) {
        if (snapshot.connectionState != ConnectionState.done) {
          return const _BootstrapFrame(
            child: CircularProgressIndicator(),
          );
        }
        if (snapshot.hasError) {
          return _BootstrapFrame(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.cloud_off_outlined, size: 44),
                const SizedBox(height: 16),
                const Text(
                  '보안 연결을 확인하지 못했어요.',
                  textAlign: TextAlign.center,
                  style: TextStyle(fontSize: 17, fontWeight: FontWeight.w700),
                ),
                const SizedBox(height: 8),
                const Text(
                  '네트워크 상태를 확인한 뒤 다시 시도해주세요.',
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 20),
                FilledButton(onPressed: _retry, child: const Text('다시 시도')),
              ],
            ),
          );
        }
        return widget.applicationOverride ??
            const ProviderScope(child: HanaApp());
      },
    );
  }
}

class _BootstrapFrame extends StatelessWidget {
  const _BootstrapFrame({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      home: Scaffold(
        body: SafeArea(
          child: Center(
            child: Padding(
              padding: const EdgeInsets.all(32),
              child: child,
            ),
          ),
        ),
      ),
    );
  }
}
