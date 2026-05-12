import 'dart:ui';

abstract class AppUserStateRepository {
  Stream<Locale> watchLocale(String uid);

  Future<void> updateLastSeen(String uid);
}
