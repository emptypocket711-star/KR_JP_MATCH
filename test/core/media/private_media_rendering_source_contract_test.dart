import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('profile-bearing surfaces use the authenticated media widget', () {
    const paths = <String>[
      'lib/features/discovery/presentation/discovery_screen.dart',
      'lib/features/profile/presentation/profile_detail_screen.dart',
      'lib/features/profile/presentation/profile_screen.dart',
      'lib/features/settings/presentation/settings_screen.dart',
      'lib/features/matches/presentation/chats_list_screen.dart',
      'lib/features/matches/presentation/matches_screen.dart',
      'lib/features/lounge/presentation/lounge_screen.dart',
      'lib/features/lounge/presentation/lounge_detail_screen.dart',
    ];

    for (final path in paths) {
      expect(
        File(path).readAsStringSync(),
        contains('AuthenticatedStorageImage'),
        reason: path,
      );
    }
  });

  test('blocked-user rows do not refetch a blocked profile photo', () {
    final source = File(
      'lib/features/settings/presentation/blocked_users_screen.dart',
    ).readAsStringSync();

    expect(source, isNot(contains("widget.data['photoUrl']")));
    expect(source, isNot(contains('NetworkImage(')));
  });
}
