import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:hana/app/router/app_router.dart';

void main() {
  test('legacy main-tab routes redirect to current destinations', () {
    expect(
      legacyMainTabRedirects,
      const {
        '/matches': '/chats',
        '/profile': '/settings',
      },
    );
  });

  test('legacy screen implementations are no longer imported by the router',
      () {
    final source = File('lib/app/router/app_router.dart').readAsStringSync();

    expect(source, isNot(contains("matches/presentation/matches_screen.dart")));
    expect(source, isNot(contains("profile/presentation/profile_screen.dart")));
    expect(source, contains("path: '/matches'"));
    expect(source, contains("legacyMainTabRedirects['/matches']"));
    expect(source, contains("path: '/profile'"));
    expect(source, contains("legacyMainTabRedirects['/profile']"));
  });
}
