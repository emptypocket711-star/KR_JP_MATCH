import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../app/config/app_config.dart';
import '../data/discovery_repository_impl.dart';
import '../data/mock_candidates.dart';
import '../domain/discovery_repository.dart';
import '../domain/candidate.dart';

final discoveryRepositoryProvider = Provider<DiscoveryRepository>((ref) {
  return DiscoveryRepositoryImpl();
});

final discoveryStateProvider =
    NotifierProvider<DiscoveryNotifier, DiscoveryState>(() {
  return DiscoveryNotifier();
});

class DiscoveryNotifier extends Notifier<DiscoveryState> {
  late DiscoveryRepository _repository;

  @override
  DiscoveryState build() {
    _repository = ref.watch(discoveryRepositoryProvider);
    Future.microtask(_loadCandidates);
    return DiscoveryState(
      candidates: AppConfig.allowMockData
          ? List<PublicProfile>.from(mockCandidates)
          : const [],
    );
  }

  Future<void> _loadCandidates({bool showSpinner = false}) async {
    if (state.isLoading) return;
    // 기존 데이터가 있으면 스피너 없이 백그라운드 갱신
    final hasCandidates = state.candidates.isNotEmpty;
    state = state.copyWith(isLoading: showSpinner || !hasCandidates);

    try {
      final users = await _repository.fetchUsers(reset: true);
      final hasMore = _repository.hasMore;
      final finalCandidates = users.isEmpty && AppConfig.allowMockData
          ? List<PublicProfile>.from(mockCandidates)
          : users;
      state = state.copyWith(
        candidates: finalCandidates,
        isLoading: false,
        hasMore: hasMore,
        clearError: true,
      );
    } catch (_) {
      state = state.copyWith(
        isLoading: false,
        error: 'discovery-load-failed',
      );
    }
  }

  Future<void> loadMore() async {
    if (state.isLoadingMore || !state.hasMore || state.isLoading) return;
    state = state.copyWith(isLoadingMore: true);

    try {
      final users = await _repository.fetchUsers(reset: false);
      final hasMore = _repository.hasMore;
      state = state.copyWith(
        candidates: [...state.candidates, ...users],
        isLoadingMore: false,
        hasMore: hasMore,
        clearError: true,
      );
    } catch (_) {
      state = state.copyWith(
        isLoadingMore: false,
        error: 'discovery-load-more-failed',
      );
    }
  }

  Future<void> refresh() async => _loadCandidates(showSpinner: true);

  void updateFilter(DiscoveryFilter filter) {
    state = state.copyWith(filter: filter);
  }

  Future<void> likeUser(String targetUid) async {
    final newLiked = {...state.likedUids, targetUid};
    state = state.copyWith(likedUids: newLiked);

    try {
      final result = await _repository.likeUser(targetUid);
      final matched = result['matched'] as bool? ?? false;
      final matchId = result['matchId'] as String?;

      if (matched && matchId != null) {
        final matchedUser = state.candidates.firstWhere(
          (c) => c.uid == targetUid,
          orElse: () => state.candidates.first,
        );
        state = state.copyWith(matchedUser: matchedUser, matchId: matchId);
      }
    } catch (e) {
      final rollback = {...state.likedUids}..remove(targetUid);
      state = state.copyWith(likedUids: rollback, error: e.toString());
    }
  }

  Future<bool> passUser(String targetUid) async {
    try {
      await _repository.passUser(targetUid);
      state = state.copyWith(
        candidates: state.candidates.where((c) => c.uid != targetUid).toList(),
      );
      if (state.candidates.isEmpty) {
        await _loadCandidates();
      }
      return true;
    } catch (e) {
      state = state.copyWith(error: e.toString());
      return false;
    }
  }

  Future<void> submitRating({
    required String ratedUid,
    required int stars,
    required List<String> tags,
  }) {
    return _repository.submitRating(
      ratedUid: ratedUid,
      stars: stars,
      tags: tags,
    );
  }

  Future<String> startDirectChat(String targetUid) =>
      _repository.startDirectChat(targetUid);

  void clearMatch() {
    state = state.copyWith(clearMatch: true);
  }

  void removeCandidate(String uid) {
    state = state.copyWith(
      candidates: state.candidates.where((c) => c.uid != uid).toList(),
    );
  }

  PublicProfile? findCandidate(String uid) {
    try {
      return state.candidates.firstWhere((c) => c.uid == uid);
    } catch (_) {
      if (!AppConfig.allowMockData) return null;
      try {
        return mockCandidates.firstWhere((c) => c.uid == uid);
      } catch (_) {
        return null;
      }
    }
  }
}
