import 'dart:ui';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../features/auth/presentation/auth_provider.dart';
import '../config/app_config.dart';
import '../data/firebase_app_user_state_repository.dart';
import '../domain/app_user_state_repository.dart';

const _storeDefaultLocale =
    AppConfig.defaultUiLocale == 'ja' ? Locale('ja') : Locale('ko');

final appUserStateRepositoryProvider = Provider<AppUserStateRepository>((ref) {
  return FirebaseAppUserStateRepository();
});

final appLocaleProvider = StreamProvider<Locale>((ref) {
  final user = ref.watch(authStateProvider).asData?.value;
  if (user == null) return Stream.value(_storeDefaultLocale);
  return ref.watch(appUserStateRepositoryProvider).watchLocale(user.uid);
});
