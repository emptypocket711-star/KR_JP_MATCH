import 'package:cloud_functions/cloud_functions.dart';

import '../../../app/config/app_config.dart';
import '../domain/lounge_comment.dart';
import '../domain/lounge_post.dart';
import '../domain/lounge_repository.dart';

class LoungeRepositoryImpl implements LoungeRepository {
  LoungeRepositoryImpl({FirebaseFunctions? functions})
      : _functions = functions ??
            FirebaseFunctions.instanceFor(
              region: AppConfig.firebaseFunctionsRegion,
            );

  final FirebaseFunctions _functions;

  @override
  Future<LoungeFeedResult> listPosts({int limit = 50}) async {
    final data = await _call('listLoungePosts', {'limit': limit});
    return LoungeFeedResult(
      myNationality: data['myNationality'] as String? ?? 'KR',
      posts: _mapList(data['posts'], LoungePost.fromMap),
    );
  }

  @override
  Future<LoungePostResult> getPost(String postId) async {
    final data = await _call('getLoungePost', {'postId': postId});
    final rawPost = data['post'];
    if (rawPost is! Map) throw const FormatException('Invalid lounge post');
    return LoungePostResult(
      myNationality: data['myNationality'] as String? ?? 'KR',
      post: LoungePost.fromMap(Map<String, dynamic>.from(rawPost)),
    );
  }

  @override
  Future<List<LoungeComment>> listComments(String postId) async {
    final data = await _call('listLoungeComments', {'postId': postId});
    return _mapList(data['comments'], LoungeComment.fromMap);
  }

  @override
  Future<String> createPost({
    required String content,
    required String category,
  }) async {
    final data = await _call('createLoungePost', {
      'content': content,
      'category': category,
    });
    return _requiredId(data, 'postId');
  }

  @override
  Future<String> addComment({
    required String postId,
    required String content,
  }) async {
    final data = await _call('addPostComment', {
      'postId': postId,
      'content': content,
    });
    return _requiredId(data, 'commentId');
  }

  @override
  Future<String> addReply({
    required String postId,
    required String commentId,
    required String content,
  }) async {
    final data = await _call('addPostReply', {
      'postId': postId,
      'commentId': commentId,
      'content': content,
    });
    return _requiredId(data, 'replyId');
  }

  @override
  Future<LoungeLikeResult> toggleLike(String postId) async {
    final data = await _call('togglePostLike', {'postId': postId});
    final liked = data['liked'];
    final likeCount = data['likeCount'];
    if (liked is! bool || likeCount is! num) {
      throw const FormatException('Invalid lounge like response');
    }
    return LoungeLikeResult(
      liked: liked,
      likeCount: likeCount.toInt(),
    );
  }

  @override
  Future<String> translate({
    required String text,
    required String targetLang,
  }) async {
    final data = await _call('translateText', {
      'text': text,
      'targetLang': targetLang,
    });
    final translated = data['translatedText'];
    if (translated is! String || translated.isEmpty) {
      throw const FormatException('Invalid translation response');
    }
    return translated;
  }

  Future<Map<String, dynamic>> _call(
    String name,
    Map<String, dynamic> payload,
  ) async {
    final result = await _functions
        .httpsCallable(
          name,
          options: HttpsCallableOptions(timeout: const Duration(seconds: 20)),
        )
        .call(payload);
    if (result.data is! Map) {
      throw FormatException('Invalid $name response');
    }
    return Map<String, dynamic>.from(result.data as Map);
  }

  List<T> _mapList<T>(Object? raw, T Function(Map<String, dynamic>) parse) {
    if (raw is! List) throw const FormatException('Invalid lounge list');
    return raw
        .whereType<Map>()
        .map((value) => parse(Map<String, dynamic>.from(value)))
        .toList(growable: false);
  }

  String _requiredId(Map<String, dynamic> data, String key) {
    final value = data[key];
    if (value is! String || value.isEmpty) {
      throw FormatException('Invalid $key response');
    }
    return value;
  }
}
