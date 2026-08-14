import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hana/features/discovery/domain/candidate.dart';
import 'package:hana/features/discovery/domain/discovery_repository.dart';
import 'package:hana/features/discovery/presentation/discovery_provider.dart';

void main() {
  test('initial callable failure remains retryable error state', () async {
    final repository = _DiscoveryRepositoryFake()..failFetch = true;
    final container = ProviderContainer(
      overrides: [
        discoveryRepositoryProvider.overrideWithValue(repository),
      ],
    );
    addTearDown(container.dispose);
    final subscription = container.listen(
      discoveryStateProvider,
      (_, __) {},
      fireImmediately: true,
    );
    addTearDown(subscription.close);

    await _waitFor(
      () => container.read(discoveryStateProvider).error != null,
    );

    final failedState = container.read(discoveryStateProvider);
    expect(failedState.candidates, isEmpty);
    expect(failedState.error, 'discovery-load-failed');
    expect(failedState.hasMore, isTrue);

    container
        .read(discoveryStateProvider.notifier)
        .updateFilter(const DiscoveryFilter(gender: 'female'));
    expect(
      container.read(discoveryStateProvider).error,
      'discovery-load-failed',
    );

    repository
      ..failFetch = false
      ..nextProfiles = [_profile];
    await container.read(discoveryStateProvider.notifier).refresh();

    final recoveredState = container.read(discoveryStateProvider);
    expect(recoveredState.candidates, [_profile]);
    expect(recoveredState.error, isNull);
  });

  test('load-more failure preserves profiles and pagination retry', () async {
    final repository = _DiscoveryRepositoryFake()
      ..nextProfiles = [_profile]
      ..nextHasMore = true;
    final container = ProviderContainer(
      overrides: [
        discoveryRepositoryProvider.overrideWithValue(repository),
      ],
    );
    addTearDown(container.dispose);
    final subscription = container.listen(
      discoveryStateProvider,
      (_, __) {},
      fireImmediately: true,
    );
    addTearDown(subscription.close);

    await _waitFor(
      () => container.read(discoveryStateProvider).candidates.isNotEmpty,
    );
    repository.failFetch = true;

    await container.read(discoveryStateProvider.notifier).loadMore();

    final state = container.read(discoveryStateProvider);
    expect(state.candidates, [_profile]);
    expect(state.error, 'discovery-load-more-failed');
    expect(state.hasMore, isTrue);
  });
}

Future<void> _waitFor(bool Function() condition) async {
  for (var attempt = 0; attempt < 20; attempt++) {
    if (condition()) return;
    await Future<void>.delayed(Duration.zero);
  }
  fail('Timed out waiting for discovery state');
}

final _profile = PublicProfile(
  uid: 'target-1',
  displayName: 'Hana',
  birthYear: 1997,
  gender: 'female',
  nationality: 'JP',
  residingCountry: 'JP',
  nativeLanguage: 'ja',
  learningLanguage: 'ko',
  bio: '',
  photoUrls: const [],
);

class _DiscoveryRepositoryFake implements DiscoveryRepository {
  bool failFetch = false;
  bool nextHasMore = true;
  List<PublicProfile> nextProfiles = const [];

  @override
  bool get hasMore => nextHasMore;

  @override
  Future<List<PublicProfile>> fetchUsers({bool reset = false}) async {
    if (failFetch) throw StateError('callable unavailable');
    return nextProfiles;
  }

  @override
  Future<ProfileDetailResult> getProfileDetail(String targetUid) {
    throw UnimplementedError();
  }

  @override
  Future<Map<String, dynamic>> likeUser(String targetUid) {
    throw UnimplementedError();
  }

  @override
  Future<Map<String, dynamic>> passUser(String targetUid) {
    throw UnimplementedError();
  }

  @override
  Future<Map<String, dynamic>> requestCandidates({int limit = 10}) {
    throw UnimplementedError();
  }

  @override
  Future<String> startDirectChat(String targetUid) {
    throw UnimplementedError();
  }

  @override
  Future<void> submitRating({
    required String ratedUid,
    required int stars,
    required List<String> tags,
  }) {
    throw UnimplementedError();
  }
}
