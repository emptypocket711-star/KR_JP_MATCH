import 'dart:ui';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

final appLocaleProvider = StreamProvider<Locale>((ref) {
  return FirebaseAuth.instance.authStateChanges().asyncExpand((user) {
    if (user == null) {
      return Stream.value(const Locale('ko'));
    }

    return FirebaseFirestore.instance
        .collection('users')
        .doc(user.uid)
        .snapshots()
        .map((doc) {
      final data = doc.data();
      final uiLanguage = data?['uiLanguage'] as String?;
      if (uiLanguage == 'ko') {
        return const Locale('ko');
      }
      if (uiLanguage == 'ja') {
        return const Locale('ja');
      }

      final nationality = data?['nationality'] as String?;
      return Locale(nationality == 'JP' ? 'ja' : 'ko');
    }).distinct();
  });
});
