import 'lounge_post.dart';

class LoungeReply {
  const LoungeReply({
    required this.id,
    required this.uid,
    required this.authorName,
    required this.authorPhotoUrl,
    required this.authorNationality,
    required this.authorGender,
    required this.content,
    required this.createdAt,
  });

  final String id;
  final String uid;
  final String authorName;
  final String authorPhotoUrl;
  final String authorNationality;
  final String authorGender;
  final String content;
  final DateTime createdAt;

  factory LoungeReply.fromMap(Map<String, dynamic> data) {
    return LoungeReply(
      id: data['id'] as String? ?? data['replyId'] as String? ?? '',
      uid: data['uid'] as String? ?? '',
      authorName: data['authorName'] as String? ?? '사용자',
      authorPhotoUrl: data['authorPhotoUrl'] as String? ?? '',
      authorNationality: data['authorNationality'] as String? ?? 'KR',
      authorGender: data['authorGender'] as String? ?? 'female',
      content: data['content'] as String? ?? '',
      createdAt: loungeDateTimeFromCallable(data['createdAt']),
    );
  }
}

class LoungeComment {
  const LoungeComment({
    required this.id,
    required this.uid,
    required this.authorName,
    required this.authorPhotoUrl,
    required this.authorNationality,
    required this.authorGender,
    required this.content,
    required this.createdAt,
    required this.replies,
  });

  final String id;
  final String uid;
  final String authorName;
  final String authorPhotoUrl;
  final String authorNationality;
  final String authorGender;
  final String content;
  final DateTime createdAt;
  final List<LoungeReply> replies;

  factory LoungeComment.fromMap(Map<String, dynamic> data) {
    return LoungeComment(
      id: data['id'] as String? ?? data['commentId'] as String? ?? '',
      uid: data['uid'] as String? ?? '',
      authorName: data['authorName'] as String? ?? '사용자',
      authorPhotoUrl: data['authorPhotoUrl'] as String? ?? '',
      authorNationality: data['authorNationality'] as String? ?? 'KR',
      authorGender: data['authorGender'] as String? ?? 'female',
      content: data['content'] as String? ?? '',
      createdAt: loungeDateTimeFromCallable(data['createdAt']),
      replies: (data['replies'] as List? ?? const [])
          .whereType<Map>()
          .map((value) => LoungeReply.fromMap(Map<String, dynamic>.from(value)))
          .toList(growable: false),
    );
  }
}
