import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../domain/lounge_post.dart';

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
  }) {
    return LoungeState(
      posts: posts ?? this.posts,
      selectedCategory: selectedCategory ?? this.selectedCategory,
      isLoading: isLoading ?? this.isLoading,
      error: error,
      myNationality: myNationality ?? this.myNationality,
    );
  }
}

class LoungeNotifier extends Notifier<LoungeState> {
  @override
  LoungeState build() {
    Future.microtask(_loadPosts);
    return LoungeState(posts: _mockPosts(), isLoading: true);
  }

  Future<void> _loadPosts() async {
    state = state.copyWith(isLoading: true);

    try {
      final uid = FirebaseAuth.instance.currentUser?.uid;
      Set<String> blockedUids = {};

      if (uid != null) {
        final results = await Future.wait([
          FirebaseFirestore.instance.collection('users').doc(uid).get(),
          FirebaseFirestore.instance
              .collection('users')
              .doc(uid)
              .collection('blocks')
              .get(),
        ]).timeout(const Duration(seconds: 8));

        final myDoc = results[0] as DocumentSnapshot<Map<String, dynamic>>;
        final blocksSnap = results[1] as QuerySnapshot<Map<String, dynamic>>;
        blockedUids = blocksSnap.docs.map((doc) => doc.id).toSet();
        state = state.copyWith(
          myNationality: myDoc.data()?['nationality'] as String? ?? 'KR',
        );
      }

      final snap = await FirebaseFirestore.instance
          .collection('posts')
          .orderBy('createdAt', descending: true)
          .limit(50)
          .get()
          .timeout(const Duration(seconds: 8));

      var posts = snap.docs
          .map((d) => LoungePost.fromDoc(d))
          .where((p) => !blockedUids.contains(p.uid))
          .toList();

      if (posts.length < 4) {
        posts = [
          ...posts,
          ..._mockPosts().where((p) => !blockedUids.contains(p.uid)),
        ];
      }

      if (uid != null) {
        try {
          final likedSnap = await Future.wait(
            posts.map(
              (p) => FirebaseFirestore.instance
                  .collection('post_likes')
                  .doc(p.id)
                  .collection('likes')
                  .doc(uid)
                  .get(),
            ),
          ).timeout(const Duration(seconds: 8));

          final likedIds = {
            for (int i = 0; i < posts.length; i++)
              if (likedSnap[i].exists) posts[i].id,
          };

          posts = posts
              .map((p) => p.copyWith(isLikedByMe: likedIds.contains(p.id)))
              .toList();
        } catch (_) {}
      }

      state = state.copyWith(
        posts: posts,
        selectedCategory: LoungePost.allCategory,
        isLoading: false,
      );
    } catch (e) {
      state = state.copyWith(
        posts: _mockPosts(),
        selectedCategory: LoungePost.allCategory,
        isLoading: false,
        error: e.toString(),
      );
    }
  }

  Future<void> refresh() => _loadPosts();

  void selectCategory(String category) {
    state = state.copyWith(selectedCategory: category);
  }

  Future<void> toggleLike(String postId) async {
    final uid = FirebaseAuth.instance.currentUser?.uid;
    if (uid == null) return;

    final idx = state.posts.indexWhere((p) => p.id == postId);
    if (idx == -1 || postId.startsWith('mock_')) return;

    final post = state.posts[idx];
    final isLiked = post.isLikedByMe;
    final updated = List<LoungePost>.from(state.posts);
    updated[idx] = post.copyWith(
      isLikedByMe: !isLiked,
      likeCount: isLiked ? post.likeCount - 1 : post.likeCount + 1,
    );
    state = state.copyWith(posts: updated);

    try {
      final ref = FirebaseFirestore.instance
          .collection('post_likes')
          .doc(postId)
          .collection('likes')
          .doc(uid);

      if (isLiked) {
        await ref.delete();
        await FirebaseFirestore.instance
            .collection('posts')
            .doc(postId)
            .update({'likeCount': FieldValue.increment(-1)});
      } else {
        await ref.set({'uid': uid, 'createdAt': FieldValue.serverTimestamp()});
        await FirebaseFirestore.instance
            .collection('posts')
            .doc(postId)
            .update({'likeCount': FieldValue.increment(1)});
      }
    } catch (_) {
      final rollback = List<LoungePost>.from(state.posts);
      rollback[idx] = post;
      state = state.copyWith(posts: rollback);
    }
  }

  Future<void> createPost({
    required String content,
    required String category,
  }) async {
    final user = FirebaseAuth.instance.currentUser;
    if (user == null) return;

    final myDoc = await FirebaseFirestore.instance
        .collection('users')
        .doc(user.uid)
        .get()
        .timeout(const Duration(seconds: 8));
    final myData = myDoc.data() ?? {};
    final photoUrls = myData['photoUrls'] as List?;

    await FirebaseFirestore.instance.collection('posts').add({
      'uid': user.uid,
      'authorName': myData['displayName'] ?? user.displayName ?? 'User',
      'authorPhotoUrl': (photoUrls?.isNotEmpty ?? false)
          ? photoUrls!.first
          : user.photoURL ?? '',
      'authorNationality': myData['nationality'] ?? 'KR',
      'authorGender': myData['gender'] ?? 'female',
      'category': category,
      'content': content,
      'imageUrls': [],
      'likeCount': 0,
      'commentCount': 0,
      'createdAt': FieldValue.serverTimestamp(),
    });

    // onPostCreated 트리거가 번역을 자동 처리함
    await _loadPosts();
  }
}

final loungeProvider =
    NotifierProvider<LoungeNotifier, LoungeState>(LoungeNotifier.new);

List<LoungePost> _mockPosts() {
  final now = DateTime.now();
  return [
    LoungePost(
      id: 'mock_01',
      uid: 'mock_lounge_01',
      authorName: 'Jiyu',
      authorPhotoUrl: '',
      authorNationality: 'KR',
      authorGender: 'female',
      category: '\uC5B8\uC5B4\uAD50\uD658',
      content:
          '\uC624\uB298\uB3C4 \uC77C\uBCF8\uC5B4 \uD45C\uD604 \uD558\uB098\uB97C \uBC30\uC6E0\uC5B4\uC694. \uC11C\uB85C \uC790\uC5F0\uC2A4\uB7FD\uAC8C \uC5F0\uC2B5\uD574\uC694!',
      imageUrls: const [],
      likeCount: 32,
      commentCount: 8,
      createdAt: now.subtract(const Duration(hours: 2)),
    ),
    LoungePost(
      id: 'mock_02',
      uid: 'mock_lounge_02',
      authorName: 'Haruto',
      authorPhotoUrl: '',
      authorNationality: 'JP',
      authorGender: 'male',
      category: '\uC5B8\uC5B4\uAD50\uD658',
      content:
          '\u97D3\u56FD\u8A9E\u3092\u4E00\u7DD2\u306B\u52C9\u5F37\u3057\u307E\u305B\u3093\u304B\uFF1F 30\u5206\u305A\u3064\u7DF4\u7FD2\u3067\u304D\u308B\u4EBA\u3092\u63A2\u3057\u3066\u3044\u307E\u3059\u3002',
      imageUrls: const [],
      likeCount: 45,
      commentCount: 12,
      createdAt: now.subtract(const Duration(hours: 5)),
    ),
    LoungePost(
      id: 'mock_03',
      uid: 'mock_lounge_03',
      authorName: 'Sora',
      authorPhotoUrl: '',
      authorNationality: 'KR',
      authorGender: 'female',
      category: '\uB9DB\uC9D1',
      content:
          '\uC624\uC0AC\uCE74 \uC5EC\uD589 \uAC00\uB294\uB370 \uD604\uC9C0\uC778\uC774 \uCD94\uCC9C\uD558\uB294 \uB9DB\uC9D1\uC774 \uC788\uC73C\uBA74 \uC54C\uB824\uC8FC\uC138\uC694.',
      imageUrls: const [],
      likeCount: 18,
      commentCount: 24,
      createdAt: now.subtract(const Duration(hours: 6)),
    ),
    LoungePost(
      id: 'mock_04',
      uid: 'mock_lounge_04',
      authorName: 'Yuna',
      authorPhotoUrl: '',
      authorNationality: 'JP',
      authorGender: 'female',
      category: '\uC77C\uC0C1',
      content:
          '\u97D3\u56FD\u30C9\u30E9\u30DE\u3092\u898B\u306A\u304C\u3089\u52C9\u5F37\u3057\u3066\u3044\u307E\u3059\u3002\u5C11\u3057\u305A\u3064\u805E\u304D\u53D6\u308C\u308B\u3088\u3046\u306B\u306A\u3063\u3066\u304D\u307E\u3057\u305F\u3002',
      imageUrls: const [],
      likeCount: 56,
      commentCount: 15,
      createdAt: now.subtract(const Duration(days: 1)),
    ),
  ];
}
