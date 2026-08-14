import 'lounge_comment.dart';
import 'lounge_post.dart';

class LoungeFeedResult {
  const LoungeFeedResult({required this.myNationality, required this.posts});

  final String myNationality;
  final List<LoungePost> posts;
}

class LoungePostResult {
  const LoungePostResult({required this.myNationality, required this.post});

  final String myNationality;
  final LoungePost post;
}

class LoungeLikeResult {
  const LoungeLikeResult({required this.liked, required this.likeCount});

  final bool liked;
  final int likeCount;
}

abstract class LoungeRepository {
  Future<LoungeFeedResult> listPosts({int limit = 50});

  Future<LoungePostResult> getPost(String postId);

  Future<List<LoungeComment>> listComments(String postId);

  Future<String> createPost(
      {required String content, required String category});

  Future<String> addComment({required String postId, required String content});

  Future<String> addReply({
    required String postId,
    required String commentId,
    required String content,
  });

  Future<LoungeLikeResult> toggleLike(String postId);

  Future<String> translate({required String text, required String targetLang});
}
