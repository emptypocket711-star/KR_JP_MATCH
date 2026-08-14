import 'package:flutter_test/flutter_test.dart';
import 'package:hana/features/lounge/domain/lounge_comment.dart';
import 'package:hana/features/lounge/domain/lounge_post.dart';

void main() {
  test('post parses callable timestamp and server-owned like state', () {
    final post = LoungePost.fromMap({
      'id': 'post-1',
      'uid': 'author-1',
      'content': '안녕하세요',
      'createdAt': {'_seconds': 1700000000, '_nanoseconds': 123000000},
      'isLikedByMe': true,
      'likeCount': 4,
    });

    expect(post.id, 'post-1');
    expect(post.isLikedByMe, isTrue);
    expect(post.likeCount, 4);
    expect(
      post.createdAt.microsecondsSinceEpoch,
      1700000000123000,
    );
  });

  test('comments parse the replies returned by listLoungeComments', () {
    final comment = LoungeComment.fromMap({
      'id': 'comment-1',
      'uid': 'commenter-1',
      'content': '반가워요',
      'createdAt': {'seconds': 1700000000, 'nanoseconds': 0},
      'replies': [
        {
          'id': 'reply-1',
          'uid': 'replier-1',
          'content': '저도요',
          'createdAt': {'_seconds': 1700000001, '_nanoseconds': 0},
        },
      ],
    });

    expect(comment.id, 'comment-1');
    expect(comment.replies, hasLength(1));
    expect(comment.replies.single.id, 'reply-1');
    expect(comment.replies.single.content, '저도요');
  });
}
