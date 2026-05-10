import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
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
      candidates: List<PublicProfile>.from(mockCandidates),
    );
  }

  Future<void> _loadCandidates({bool showSpinner = false}) async {
    if (state.isLoading) return;
    // 기존 데이터가 있으면 스피너 없이 백그라운드 갱신
    final hasCandidates = state.candidates.isNotEmpty;
    state = state.copyWith(isLoading: showSpinner || !hasCandidates);

    try {
      final users = await _repository
          .fetchUsers(reset: true)
          .timeout(const Duration(seconds: 8));
      final hasMore = _repository.hasMore;
      final finalCandidates =
          users.isEmpty ? List<PublicProfile>.from(mockCandidates) : users;
      state = state.copyWith(
        candidates: finalCandidates,
        isLoading: false,
        hasMore: hasMore,
      );
    } catch (_) {
      state = state.copyWith(
        candidates: hasCandidates
            ? state.candidates
            : List<PublicProfile>.from(mockCandidates),
        isLoading: false,
        hasMore: false,
      );
    }
  }

  Future<void> loadMore() async {
    if (state.isLoadingMore || !state.hasMore || state.isLoading) return;
    state = state.copyWith(isLoadingMore: true);

    try {
      final users = await _repository
          .fetchUsers(reset: false)
          .timeout(const Duration(seconds: 8));
      final hasMore = _repository.hasMore;
      state = state.copyWith(
        candidates: [...state.candidates, ...users],
        isLoadingMore: false,
        hasMore: hasMore,
      );
    } catch (_) {
      state = state.copyWith(isLoadingMore: false);
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

  Future<void> passUser(String targetUid) async {
    state = state.copyWith(
      candidates: state.candidates.where((c) => c.uid != targetUid).toList(),
    );

    try {
      await _repository.passUser(targetUid);
      if (state.candidates.isEmpty) {
        await _loadCandidates();
      }
    } catch (e) {
      state = state.copyWith(error: e.toString());
    }
  }

  /// 반환값: matchId 또는 null
  /// FirebaseFunctionsException code=='resource-exhausted' → 열쇠 부족
  Future<String?> startDirectChat(String targetUid) async {
    try {
      return await _repository.startDirectChat(targetUid);
    } on FirebaseFunctionsException catch (e) {
      if (e.code == 'resource-exhausted') rethrow;
      state = state.copyWith(error: e.message ?? e.toString());
      return null;
    } catch (e) {
      state = state.copyWith(error: e.toString());
      return null;
    }
  }

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
      try {
        return mockCandidates.firstWhere((c) => c.uid == uid);
      } catch (_) {
        return null;
      }
    }
  }
}
