import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:hana/features/discovery/data/discovery_repository_impl.dart';
import 'package:hana/features/discovery/domain/candidate.dart';

void main() {
  test('public profile uses server-calculated age and callable timestamp', () {
    final profile = PublicProfile.fromMap({
      ..._profileMap,
      'age': 29,
      'lastSeenAt': {
        '_seconds': 1700000000,
        '_nanoseconds': 250000000,
      },
    });

    expect(profile.age, 29);
    expect(
      profile.lastSeenAt,
      DateTime.fromMicrosecondsSinceEpoch(
        1700000000250000,
        isUtc: true,
      ),
    );
  });

  test('discovery parser accepts only the callable page contract', () {
    final page = parseDiscoveryProfilesCallableData({
      'profiles': [_profileMap],
      'hasMore': true,
    });

    expect(page.profiles.single.uid, 'target-1');
    expect(page.hasMore, isTrue);
    expect(
      () => parseDiscoveryProfilesCallableData({
        'profiles': [_profileMap],
        'hasMore': 'yes',
      }),
      throwsFormatException,
    );
  });

  test('profile detail parser requires all server-owned state flags', () {
    final detail = parseProfileDetailCallableData({
      'profile': _profileMap,
      'isOwnProfile': false,
      'hasActiveChat': true,
      'hasAlreadyRated': false,
    });

    expect(detail.profile.uid, 'target-1');
    expect(detail.isOwnProfile, isFalse);
    expect(detail.hasActiveChat, isTrue);
    expect(detail.hasAlreadyRated, isFalse);
    expect(
      () => parseProfileDetailCallableData({
        'profile': _profileMap,
        'isOwnProfile': false,
      }),
      throwsFormatException,
    );
  });

  test('strict-rules surfaces use only region-bound callables', () {
    final repositorySource = File(
      'lib/features/discovery/data/discovery_repository_impl.dart',
    ).readAsStringSync();
    final providerSource = File(
      'lib/features/discovery/presentation/discovery_provider.dart',
    ).readAsStringSync();
    final detailSource = File(
      'lib/features/profile/presentation/profile_detail_screen.dart',
    ).readAsStringSync();
    final ratingSource = File(
      'lib/features/profile/presentation/rating_bottom_sheet.dart',
    ).readAsStringSync();

    expect(repositorySource, contains('FirebaseFunctions.instanceFor('));
    expect(repositorySource, contains('AppConfig.firebaseFunctionsRegion'));
    for (final callable in [
      'listDiscoveryProfiles',
      'getProfileDetail',
      'startChat',
      'likeUser',
      'passUser',
      'submitRating',
    ]) {
      expect(repositorySource, contains("'$callable'"));
    }
    expect(repositorySource, isNot(contains('FirebaseFirestore')));
    expect(repositorySource, isNot(contains('FirebaseService')));
    expect(providerSource, contains('AppConfig.allowMockData'));
    expect(providerSource, contains("error: 'discovery-load-failed'"));
    expect(providerSource, contains("error: 'discovery-load-more-failed'"));

    final discoveryScreenSource = File(
      'lib/features/discovery/presentation/discovery_screen.dart',
    ).readAsStringSync();
    expect(
      discoveryScreenSource,
      contains("ValueKey('discovery_error_state')"),
    );
    expect(
      discoveryScreenSource,
      contains("ValueKey('discovery_empty_state')"),
    );
    expect(
      discoveryScreenSource,
      contains("ValueKey('discovery_error_retry')"),
    );

    expect(detailSource, contains('.getProfileDetail(widget.uid)'));
    expect(detailSource, isNot(contains('FirebaseFirestore')));
    expect(detailSource, isNot(contains('FirebaseAuth')));
    expect(detailSource, contains('AuthenticatedStorageImage('));
    expect(
      detailSource,
      contains('on FirebaseFunctionsException catch (error)'),
    );
    expect(
        detailSource, contains("callableError?.code == 'resource-exhausted'"));
    expect(detailSource, contains('await LowKeySheet.show(context)'));
    expect(detailSource, contains('finally {'));
    expect(detailSource, contains('setState(() => _isStartingChat = false)'));

    expect(ratingSource, contains('widget.onSubmit('));
    expect(ratingSource, isNot(contains('FirebaseFirestore')));
    expect(ratingSource, isNot(contains('FirebaseAuth')));
    expect(ratingSource, isNot(contains("collection('ratings')")));
  });
}

const _profileMap = <String, dynamic>{
  'uid': 'target-1',
  'displayName': 'Hana',
  'age': 29,
  'gender': 'female',
  'nationality': 'JP',
  'residingCountry': 'JP',
  'nativeLanguage': 'ja',
  'learningLanguage': 'ko',
  'bio': '',
  'photoUrls': <String>[],
};
