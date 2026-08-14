import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('active room list query includes every Firestore Rules predicate', () {
    final source = File(
      'lib/features/matches/data/matches_repository_impl.dart',
    ).readAsStringSync();

    final participant = source.indexOf(
      ".where('userIds', arrayContains: currentUid)",
    );
    final active = source.indexOf(".where('isActive', isEqualTo: true)");
    final version = source.indexOf(
      ".where('directRoomVersion', isEqualTo: 1)",
    );
    final snapshots = source.indexOf('.snapshots()');

    expect(participant, greaterThanOrEqualTo(0));
    expect(active, greaterThan(participant));
    expect(version, greaterThan(active));
    expect(snapshots, greaterThan(version));

    // Favorites and recency remain client-owned ordering, so this Rules-bound
    // query does not require another Firestore orderBy field.
    expect(source, isNot(contains('.orderBy(')));
    expect(source, contains('a.isFavoriteFor(currentUid)'));
    expect(source, contains('a.lastMessageAt ?? a.createdAt'));
  });

  test('deployed index manifest supports the strict active-room query', () {
    final manifest = jsonDecode(
      File('firebase/firestore.indexes.json').readAsStringSync(),
    ) as Map<String, dynamic>;
    final indexes = manifest['indexes'] as List<dynamic>;

    final hasRequiredIndex = indexes.whereType<Map>().any((rawIndex) {
      final index = Map<String, dynamic>.from(rawIndex);
      if (index['collectionGroup'] != 'matches' ||
          index['queryScope'] != 'COLLECTION') {
        return false;
      }
      final fields = (index['fields'] as List<dynamic>? ?? const [])
          .whereType<Map>()
          .map((field) => Map<String, dynamic>.from(field))
          .toList();
      return fields.any(
            (field) =>
                field['fieldPath'] == 'userIds' &&
                field['arrayConfig'] == 'CONTAINS',
          ) &&
          fields.any(
            (field) =>
                field['fieldPath'] == 'isActive' &&
                field['order'] == 'ASCENDING',
          ) &&
          fields.any(
            (field) =>
                field['fieldPath'] == 'directRoomVersion' &&
                field['order'] == 'ASCENDING',
          );
    });

    expect(hasRequiredIndex, isTrue);
  });
}
