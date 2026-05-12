import 'dart:ui';

import 'package:cloud_firestore/cloud_firestore.dart';

import '../config/app_config.dart';
import '../domain/app_user_state_repository.dart';

const _storeDefaultLocale =
    AppConfig.defaultUiLocale == 'ja' ? Locale('ja') : Locale('ko');

class FirebaseAppUserStateRepository implements AppUserStateRepository {
  FirebaseAppUserStateRepository({FirebaseFirestore? firestore})
      : _firestore = firestore ?? FirebaseFirestore.instance;

  final FirebaseFirestore _firestore;

  @override
  Stream<Locale> watchLocale(String uid) {
    return _firestore.collection('users').doc(uid).snapshots().map((doc) {
      final data = doc.data();
      final uiLanguage = data?['uiLanguage'] as String?;
      if (uiLanguage == 'ko') return const Locale('ko');
      if (uiLanguage == 'ja') return const Locale('ja');

      final nationality = data?['nationality'] as String?;
      if (nationality == 'KR') return const Locale('ko');
      if (nationality == 'JP') return const Locale('ja');
      return _storeDefaultLocale;
    }).distinct();
  }

  @override
  Future<void> updateLastSeen(String uid) {
    return _firestore.collection('users').doc(uid).update({
      'lastSeenAt': FieldValue.serverTimestamp(),
    });
  }
}
