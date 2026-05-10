import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

final userPresenceProvider = Provider<void>((ref) {
  final observer = _PresenceObserver();
  WidgetsBinding.instance.addObserver(observer);
  ref.onDispose(() => WidgetsBinding.instance.removeObserver(observer));
  _updatePresence();
});

void _updatePresence() {
  final user = FirebaseAuth.instance.currentUser;
  if (user == null) return;
  FirebaseFirestore.instance
      .collection('users')
      .doc(user.uid)
      .update({'lastSeenAt': FieldValue.serverTimestamp()}).catchError((_) {});
}

class _PresenceObserver extends WidgetsBindingObserver {
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) _updatePresence();
  }
}
