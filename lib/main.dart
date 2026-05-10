import 'package:firebase_app_check/firebase_app_check.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'firebase_options.dart';
import 'core/services/firebase_service.dart';
import 'core/services/fcm_service.dart';
import 'app/app.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  await Firebase.initializeApp(options: DefaultFirebaseOptions.currentPlatform);

  try {
    await FirebaseAppCheck.instance.activate(
      providerAndroid: kDebugMode
          ? const AndroidDebugProvider()
          : const AndroidPlayIntegrityProvider(),
    );
  } catch (_) {
    // App Check 초기화 실패해도 앱은 계속 실행
  }

  FirebaseService().initialize();

  // FCM init when user is authenticated
  FirebaseAuth.instance.authStateChanges().listen((user) {
    if (user != null) FcmService().init();
  });

  runApp(const ProviderScope(child: HanaApp()));
}
