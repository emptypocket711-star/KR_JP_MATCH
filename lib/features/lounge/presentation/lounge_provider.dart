import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/lounge_repository_impl.dart';
import '../domain/lounge_post.dart';
import '../domain/lounge_repository.dart';

final loungeRepositoryProvider = Provider<LoungeRepository>((ref) {
  return LoungeRepositoryImpl();
});

class LoungeState {
  final List<LoungePost> posts;
  final String selectedCategory;
  final bool isLoading;
  final String? error;
  final String myNationality;

  LoungeState({
    this.posts = const [],
    this.selectedCategory = LoungePost.allCategory,
    this.isLoading = false,
    this.error,
    this.myNationality = 'KR',
  });

  List<LoungePost> get filteredPosts {
    if (selectedCategory == LoungePost.allCategory ||
        !loungeCategories.contains(selectedCategory)) {
      return posts;
    }
    return posts.where((p) => p.category == selectedCategory).toList();
  }

  LoungeState copyWith({
    List<LoungePost>? posts,
    String? selectedCategory,
    bool? isLoading,
    String? error,
    String? myNationality,
    bool clearError = false,
  }) {
    return LoungeState(
      posts: posts ?? this.posts,
      selectedCategory: selectedCategory ?? this.selectedCategory,
      isLoading: isLoading ?? this.isLoading,
      error: clearError ? null : (error ?? this.error),
      myNationality: myNationality ?? this.myNationality,
    );
  }
}

class LoungeNotifier extends Notifier<LoungeState> {
  LoungeRepository get _repository => ref.read(loungeRepositoryProvider);

  @override
  LoungeState build() {
    Future.microtask(_loadPosts);
    return LoungeState(isLoading: true);
  }

  Future<void> _loadPosts() async {
    state = state.copyWith(isLoading: true, clearError: true);
    try {
      final result = await _repository.listPosts();
      state = state.copyWith(
        posts: result.posts,
        myNationality: result.myNationality,
        isLoading: false,
        clearError: true,
      );
    } catch (error) {
      state = state.copyWith(
        isLoading: false,
        error: error.toString(),
      );
    }
  }

  Future<void> refresh() => _loadPosts();

  void selectCategory(String category) {
    state = state.copyWith(selectedCategory: category);
  }

  Future<void> toggleLike(String postId) async {
    final index = state.posts.indexWhere((post) => post.id == postId);
    if (index == -1) return;

    final previous = state.posts[index];
    final optimistic = List<LoungePost>.from(state.posts);
    optimistic[index] = previous.copyWith(
      isLikedByMe: !previous.isLikedByMe,
      likeCount: previous.isLikedByMe
          ? (previous.likeCount - 1).clamp(0, 1 << 31)
          : previous.likeCount + 1,
    );
    state = state.copyWith(posts: optimistic);

    try {
      final result = await _repository.toggleLike(postId);
      final currentIndex = state.posts.indexWhere((post) => post.id == postId);
      if (currentIndex == -1) return;
      final reconciled = List<LoungePost>.from(state.posts);
      reconciled[currentIndex] = reconciled[currentIndex].copyWith(
        isLikedByMe: result.liked,
        likeCount: result.likeCount,
      );
      state = state.copyWith(posts: reconciled);
    } catch (_) {
      final currentIndex = state.posts.indexWhere((post) => post.id == postId);
      if (currentIndex == -1) return;
      final rollback = List<LoungePost>.from(state.posts);
      rollback[currentIndex] = previous;
      state = state.copyWith(posts: rollback);
    }
  }

  Future<void> createPost({
    required String content,
    required String category,
  }) async {
    await _repository.createPost(content: content, category: category);
    await _loadPosts();
  }

  Future<String> translate(String text) {
    return _repository.translate(
      text: text,
      targetLang: state.myNationality == 'KR' ? 'ko' : 'ja',
    );
  }
}

final loungeProvider =
    NotifierProvider<LoungeNotifier, LoungeState>(LoungeNotifier.new);
