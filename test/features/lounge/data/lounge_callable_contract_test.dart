import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('lounge repository uses every strict-rules callable in app region', () {
    final source = File(
      'lib/features/lounge/data/lounge_repository_impl.dart',
    ).readAsStringSync();

    expect(source, contains('FirebaseFunctions.instanceFor'));
    expect(source, contains('AppConfig.firebaseFunctionsRegion'));
    for (final name in const [
      'listLoungePosts',
      'getLoungePost',
      'listLoungeComments',
      'createLoungePost',
      'addPostComment',
      'addPostReply',
      'togglePostLike',
      'translateText',
    ]) {
      expect(source, contains("'$name'"), reason: name);
    }
  });

  test('lounge presentation has no direct Firebase data access', () {
    for (final path in const [
      'lib/features/lounge/presentation/lounge_screen.dart',
      'lib/features/lounge/presentation/lounge_detail_screen.dart',
      'lib/features/lounge/presentation/lounge_compose_screen.dart',
      'lib/features/lounge/presentation/lounge_provider.dart',
    ]) {
      final source = File(path).readAsStringSync();
      expect(source, isNot(contains('FirebaseFirestore')), reason: path);
      expect(source, isNot(contains('FirebaseFunctions')), reason: path);
      expect(source, isNot(contains('FirebaseAuth')), reason: path);
    }
  });
}
