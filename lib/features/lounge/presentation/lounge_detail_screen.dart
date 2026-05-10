import 'package:cached_network_image/cached_network_image.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../domain/lounge_post.dart';
import '../../../app/theme/app_theme.dart';
import '../../../core/widgets/default_avatar.dart';
import '../../../core/widgets/nationality_badge.dart';
import '../../../core/widgets/user_name_text.dart';

class LoungeDetailScreen extends StatefulWidget {
  final String postId;

  const LoungeDetailScreen({required this.postId, super.key});

  @override
  State<LoungeDetailScreen> createState() => _LoungeDetailScreenState();
}

class _LoungeDetailScreenState extends State<LoungeDetailScreen> {
  final _commentController = TextEditingController();
  bool _submitting = false;
  String _myNationality = 'KR';
  String? _replyingToCommentId;
  String? _replyingToName;

  @override
  void initState() {
    super.initState();
    final uid = FirebaseAuth.instance.currentUser?.uid;
    if (uid != null) {
      FirebaseFirestore.instance.collection('users').doc(uid).get().then((doc) {
        if (mounted) {
          setState(() =>
              _myNationality = (doc.data()?['nationality'] as String?) ?? 'KR');
        }
      });
    }
  }

  @override
  void dispose() {
    _commentController.dispose();
    super.dispose();
  }

  Future<void> _submitComment() async {
    final text = _commentController.text.trim();
    if (text.isEmpty || _submitting) return;

    setState(() => _submitting = true);
    try {
      final replyCommentId = _replyingToCommentId;
      if (replyCommentId == null) {
        await FirebaseFunctions.instance.httpsCallable('addPostComment').call({
          'postId': widget.postId,
          'content': text,
        });
      } else {
        await FirebaseFunctions.instance.httpsCallable('addPostReply').call({
          'postId': widget.postId,
          'commentId': replyCommentId,
          'content': text,
        });
      }

      _commentController.clear();
      setState(() {
        _replyingToCommentId = null;
        _replyingToName = null;
      });
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('댓글 등록 실패: $e')),
        );
      }
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  Future<void> _togglePostLike(LoungePost post, bool isLiked) async {
    final uid = FirebaseAuth.instance.currentUser?.uid;
    if (uid == null) return;

    final likeRef = FirebaseFirestore.instance
        .collection('post_likes')
        .doc(post.id)
        .collection('likes')
        .doc(uid);
    final postRef = FirebaseFirestore.instance.collection('posts').doc(post.id);

    try {
      final batch = FirebaseFirestore.instance.batch();
      if (isLiked) {
        batch.delete(likeRef);
        batch.update(postRef, {'likeCount': FieldValue.increment(-1)});
      } else {
        batch.set(likeRef, {
          'uid': uid,
          'createdAt': FieldValue.serverTimestamp(),
        });
        batch.update(postRef, {'likeCount': FieldValue.increment(1)});
      }
      await batch.commit();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('좋아요 처리 실패: $e')),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final postRef =
        FirebaseFirestore.instance.collection('posts').doc(widget.postId);

    return Scaffold(
      backgroundColor: AppTheme.background,
      appBar: AppBar(
        backgroundColor: AppTheme.background,
        title: const Text('라운지'),
      ),
      body: StreamBuilder<DocumentSnapshot<Map<String, dynamic>>>(
        stream: postRef.snapshots(),
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator());
          }
          if (!snapshot.hasData || !snapshot.data!.exists) {
            return const Center(child: Text('글을 찾을 수 없습니다.'));
          }

          final post = LoungePost.fromDoc(snapshot.data!);
          return Column(
            children: [
              Expanded(
                child: CustomScrollView(
                  slivers: [
                    SliverToBoxAdapter(
                      child: _ThreadPost(
                        post: post,
                        myNationality: _myNationality,
                        onLikeChanged: (isLiked) =>
                            _togglePostLike(post, isLiked),
                      ),
                    ),
                    const SliverToBoxAdapter(
                      child: Padding(
                        padding: EdgeInsets.fromLTRB(20, 18, 20, 8),
                        child: Text(
                          '댓글',
                          style: TextStyle(
                            fontSize: 15,
                            fontWeight: FontWeight.w800,
                            color: AppTheme.textPrimary,
                          ),
                        ),
                      ),
                    ),
                    _CommentsList(
                      postId: widget.postId,
                      myNationality: _myNationality,
                      onReply: (commentId, authorName) {
                        setState(() {
                          _replyingToCommentId = commentId;
                          _replyingToName = authorName;
                        });
                      },
                    ),
                  ],
                ),
              ),
              _CommentInput(
                controller: _commentController,
                submitting: _submitting,
                replyingToName: _replyingToName,
                onCancelReply: () {
                  setState(() {
                    _replyingToCommentId = null;
                    _replyingToName = null;
                  });
                },
                onSubmit: _submitComment,
              ),
            ],
          );
        },
      ),
    );
  }
}

class _ThreadPost extends StatefulWidget {
  final LoungePost post;
  final String myNationality;
  final void Function(bool isLiked) onLikeChanged;

  const _ThreadPost({
    required this.post,
    required this.myNationality,
    required this.onLikeChanged,
  });

  @override
  State<_ThreadPost> createState() => _ThreadPostState();
}

class _ThreadPostState extends State<_ThreadPost> {
  bool _showTranslation = false;
  bool _isTranslating = false;
  String? _localTranslation;

  Future<void> _handleTranslate() async {
    final post = widget.post;
    final existing =
        post.translationFor(widget.myNationality) ?? _localTranslation;
    if (existing != null) {
      setState(() => _showTranslation = !_showTranslation);
      return;
    }
    setState(() => _isTranslating = true);
    try {
      final result =
          await FirebaseFunctions.instance.httpsCallable('translateText').call({
        'text': post.content,
        'targetLang': widget.myNationality == 'KR' ? 'ko' : 'ja',
      });
      final translated = (result.data as Map)['translatedText'] as String?;
      if (mounted) {
        setState(() {
          _localTranslation = translated;
          _showTranslation = true;
        });
      }
    } catch (_) {
    } finally {
      if (mounted) setState(() => _isTranslating = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final post = widget.post;
    final translation =
        post.translationFor(widget.myNationality) ?? _localTranslation;
    final canTranslate = post.needsTranslation(widget.myNationality);

    return Container(
      margin: const EdgeInsets.fromLTRB(16, 12, 16, 0),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppTheme.cardBg,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppTheme.divider),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _AuthorRow(
            uid: post.uid,
            name: post.authorName,
            photoUrl: post.authorPhotoUrl,
            nationality: post.authorNationality,
            gender: post.authorGender,
            trailing: Text(
              post.category,
              style: const TextStyle(
                fontSize: 12,
                color: AppTheme.textSecondary,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
          const SizedBox(height: 14),
          Text(
            post.content,
            style: const TextStyle(
              fontSize: 15,
              color: AppTheme.textPrimary,
              height: 1.5,
            ),
          ),
          if (canTranslate && _showTranslation && translation != null) ...[
            const SizedBox(height: 8),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: AppTheme.primary.withValues(alpha: 0.06),
                borderRadius: BorderRadius.circular(10),
                border: Border.all(
                  color: AppTheme.primary.withValues(alpha: 0.18),
                ),
              ),
              child: Text(
                translation,
                style: const TextStyle(
                  fontSize: 14,
                  color: AppTheme.textPrimary,
                  height: 1.5,
                ),
              ),
            ),
          ],
          if (canTranslate) ...[
            const SizedBox(height: 6),
            if (_isTranslating)
              const SizedBox(
                width: 12,
                height: 12,
                child: CircularProgressIndicator(
                  strokeWidth: 1.5,
                  color: AppTheme.primary,
                ),
              )
            else
              GestureDetector(
                onTap: _handleTranslate,
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(
                      Icons.translate,
                      size: 13,
                      color: AppTheme.primary,
                    ),
                    const SizedBox(width: 4),
                    Text(
                      _showTranslation && translation != null
                          ? '원문 보기'
                          : '번역 보기',
                      style: const TextStyle(
                        fontSize: 12,
                        color: AppTheme.primary,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                ),
              ),
          ],
          if (post.imageUrls.isNotEmpty) ...[
            const SizedBox(height: 12),
            ClipRRect(
              borderRadius: BorderRadius.circular(12),
              child: CachedNetworkImage(
                imageUrl: post.imageUrls.first,
                width: double.infinity,
                height: 220,
                fit: BoxFit.cover,
              ),
            ),
          ],
          const SizedBox(height: 12),
          Row(
            children: [
              _PostLikeButton(
                post: post,
                onLikeChanged: widget.onLikeChanged,
              ),
              const SizedBox(width: 16),
              const Icon(
                Icons.chat_bubble_outline,
                size: 18,
                color: AppTheme.textSecondary,
              ),
              const SizedBox(width: 4),
              Text(
                '${post.commentCount}',
                style: const TextStyle(color: AppTheme.textSecondary),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _PostLikeButton extends StatelessWidget {
  final LoungePost post;
  final void Function(bool isLiked) onLikeChanged;

  const _PostLikeButton({required this.post, required this.onLikeChanged});

  @override
  Widget build(BuildContext context) {
    final uid = FirebaseAuth.instance.currentUser?.uid;
    if (uid == null) {
      return _PostLikeContent(isLiked: false, likeCount: post.likeCount);
    }

    return StreamBuilder<DocumentSnapshot<Map<String, dynamic>>>(
      stream: FirebaseFirestore.instance
          .collection('post_likes')
          .doc(post.id)
          .collection('likes')
          .doc(uid)
          .snapshots(),
      builder: (context, snapshot) {
        final isLiked = snapshot.data?.exists ?? false;
        return GestureDetector(
          behavior: HitTestBehavior.opaque,
          onTap: () => onLikeChanged(isLiked),
          child: _PostLikeContent(
            isLiked: isLiked,
            likeCount: post.likeCount,
          ),
        );
      },
    );
  }
}

class _PostLikeContent extends StatelessWidget {
  final bool isLiked;
  final int likeCount;

  const _PostLikeContent({required this.isLiked, required this.likeCount});

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        AnimatedSwitcher(
          duration: const Duration(milliseconds: 180),
          child: Icon(
            isLiked ? Icons.favorite : Icons.favorite_border,
            key: ValueKey(isLiked),
            size: 18,
            color: isLiked ? AppTheme.primary : AppTheme.textSecondary,
          ),
        ),
        const SizedBox(width: 4),
        Text(
          '$likeCount',
          style: TextStyle(
            color: isLiked ? AppTheme.primary : AppTheme.textSecondary,
            fontWeight: FontWeight.w600,
          ),
        ),
      ],
    );
  }
}

class _CommentsList extends StatelessWidget {
  final String postId;
  final String myNationality;
  final void Function(String commentId, String authorName) onReply;

  const _CommentsList({
    required this.postId,
    required this.myNationality,
    required this.onReply,
  });

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
      stream: FirebaseFirestore.instance
          .collection('posts')
          .doc(postId)
          .collection('comments')
          .orderBy('createdAt')
          .snapshots(),
      builder: (context, snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting) {
          return const SliverToBoxAdapter(
            child: Center(child: CircularProgressIndicator()),
          );
        }

        final comments = snapshot.data?.docs ?? [];
        if (comments.isEmpty) {
          return const SliverToBoxAdapter(
            child: Padding(
              padding: EdgeInsets.all(24),
              child: Center(
                child: Text(
                  '첫 댓글을 남겨보세요.',
                  style: TextStyle(color: AppTheme.textSecondary),
                ),
              ),
            ),
          );
        }

        return SliverList.separated(
          itemCount: comments.length,
          separatorBuilder: (_, __) => const Divider(
            height: 1,
            color: AppTheme.divider,
            indent: 72,
          ),
          itemBuilder: (context, index) {
            final comment = comments[index];
            return _CommentTile(
              postId: postId,
              commentId: comment.id,
              myNationality: myNationality,
              data: comment.data(),
              onReply: onReply,
            );
          },
        );
      },
    );
  }
}

class _CommentTile extends StatefulWidget {
  final String postId;
  final String commentId;
  final String myNationality;
  final Map<String, dynamic> data;
  final void Function(String commentId, String authorName) onReply;

  const _CommentTile({
    required this.postId,
    required this.commentId,
    required this.myNationality,
    required this.data,
    required this.onReply,
  });

  @override
  State<_CommentTile> createState() => _CommentTileState();
}

class _CommentTileState extends State<_CommentTile> {
  bool _showTranslation = false;
  bool _isTranslating = false;
  String? _translatedText;

  Future<void> _translate() async {
    if (_translatedText != null) {
      setState(() => _showTranslation = !_showTranslation);
      return;
    }
    setState(() => _isTranslating = true);
    try {
      final result =
          await FirebaseFunctions.instance.httpsCallable('translateText').call({
        'text': widget.data['content'] as String? ?? '',
        'targetLang': widget.myNationality == 'KR' ? 'ko' : 'ja',
      });
      final translated = (result.data as Map)['translatedText'] as String?;
      if (mounted) {
        setState(() {
          _translatedText = translated;
          _showTranslation = true;
        });
      }
    } catch (_) {
    } finally {
      if (mounted) setState(() => _isTranslating = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final createdAt = (widget.data['createdAt'] as Timestamp?)?.toDate();
    final authorName = widget.data['authorName'] as String? ?? '사용자';
    final authorNationality =
        widget.data['authorNationality'] as String? ?? 'KR';
    final canTranslate = authorNationality != widget.myNationality;

    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _AuthorRow(
            uid: widget.data['uid'] as String? ?? '',
            name: authorName,
            photoUrl: widget.data['authorPhotoUrl'] as String? ?? '',
            nationality: authorNationality,
            gender: widget.data['authorGender'] as String? ?? 'female',
            trailing: createdAt == null
                ? null
                : Text(
                    _timeAgo(createdAt),
                    style: const TextStyle(
                      fontSize: 11,
                      color: AppTheme.textSecondary,
                    ),
                  ),
          ),
          Padding(
            padding: const EdgeInsets.only(left: 56, top: 4),
            child: Text(
              widget.data['content'] as String? ?? '',
              style: const TextStyle(
                fontSize: 14,
                color: AppTheme.textPrimary,
                height: 1.45,
              ),
            ),
          ),
          if (_showTranslation && _translatedText != null)
            Padding(
              padding: const EdgeInsets.only(left: 56),
              child: Container(
                padding: const EdgeInsets.all(10),
                margin: const EdgeInsets.only(top: 4),
                decoration: BoxDecoration(
                  color: AppTheme.primary.withValues(alpha: 0.06),
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(
                    color: AppTheme.primary.withValues(alpha: 0.18),
                  ),
                ),
                child: Text(
                  _translatedText!,
                  style: const TextStyle(
                    fontSize: 13,
                    color: AppTheme.textPrimary,
                    height: 1.4,
                  ),
                ),
              ),
            ),
          if (_isTranslating)
            const Padding(
              padding: EdgeInsets.only(left: 56, top: 4),
              child: SizedBox(
                width: 12,
                height: 12,
                child: CircularProgressIndicator(
                  strokeWidth: 1.5,
                  color: AppTheme.primary,
                ),
              ),
            )
          else if (canTranslate)
            Padding(
              padding: const EdgeInsets.only(left: 56, top: 2),
              child: GestureDetector(
                onTap: _translate,
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(
                      Icons.translate,
                      size: 12,
                      color: AppTheme.primary,
                    ),
                    const SizedBox(width: 3),
                    Text(
                      _showTranslation ? '원문 보기' : '번역 보기',
                      style: const TextStyle(
                        fontSize: 11,
                        color: AppTheme.primary,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          Padding(
            padding: const EdgeInsets.only(left: 56, top: 4),
            child: TextButton(
              onPressed: () => widget.onReply(widget.commentId, authorName),
              style: TextButton.styleFrom(
                padding: EdgeInsets.zero,
                minimumSize: const Size(48, 28),
                tapTargetSize: MaterialTapTargetSize.shrinkWrap,
              ),
              child: const Text('답글'),
            ),
          ),
          _RepliesList(
            postId: widget.postId,
            commentId: widget.commentId,
            myNationality: widget.myNationality,
          ),
        ],
      ),
    );
  }
}

class _RepliesList extends StatelessWidget {
  final String postId;
  final String commentId;
  final String myNationality;

  const _RepliesList({
    required this.postId,
    required this.commentId,
    required this.myNationality,
  });

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
      stream: FirebaseFirestore.instance
          .collection('posts')
          .doc(postId)
          .collection('comments')
          .doc(commentId)
          .collection('replies')
          .orderBy('createdAt')
          .snapshots(),
      builder: (context, snapshot) {
        final replies = snapshot.data?.docs ?? [];
        if (replies.isEmpty) return const SizedBox.shrink();

        return Padding(
          padding: const EdgeInsets.only(left: 56, top: 4),
          child: Column(
            children: replies
                .map((reply) => _ReplyTile(
                      data: reply.data(),
                      myNationality: myNationality,
                    ))
                .toList(growable: false),
          ),
        );
      },
    );
  }
}

class _ReplyTile extends StatefulWidget {
  final Map<String, dynamic> data;
  final String myNationality;

  const _ReplyTile({
    required this.data,
    required this.myNationality,
  });

  @override
  State<_ReplyTile> createState() => _ReplyTileState();
}

class _ReplyTileState extends State<_ReplyTile> {
  bool _showTranslation = false;
  bool _isTranslating = false;
  String? _translatedText;

  Future<void> _translate() async {
    if (_translatedText != null) {
      setState(() => _showTranslation = !_showTranslation);
      return;
    }
    setState(() => _isTranslating = true);
    try {
      final result =
          await FirebaseFunctions.instance.httpsCallable('translateText').call({
        'text': widget.data['content'] as String? ?? '',
        'targetLang': widget.myNationality == 'KR' ? 'ko' : 'ja',
      });
      final translated = (result.data as Map)['translatedText'] as String?;
      if (mounted) {
        setState(() {
          _translatedText = translated;
          _showTranslation = true;
        });
      }
    } catch (_) {
    } finally {
      if (mounted) setState(() => _isTranslating = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final createdAt = (widget.data['createdAt'] as Timestamp?)?.toDate();
    final authorNationality =
        widget.data['authorNationality'] as String? ?? 'KR';
    final canTranslate = authorNationality != widget.myNationality;

    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(top: 8),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppTheme.surface,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _AuthorRow(
            uid: widget.data['uid'] as String? ?? '',
            name: widget.data['authorName'] as String? ?? '사용자',
            photoUrl: widget.data['authorPhotoUrl'] as String? ?? '',
            nationality: authorNationality,
            gender: widget.data['authorGender'] as String? ?? 'female',
            trailing: createdAt == null
                ? null
                : Text(
                    _timeAgo(createdAt),
                    style: const TextStyle(
                      fontSize: 11,
                      color: AppTheme.textSecondary,
                    ),
                  ),
          ),
          Padding(
            padding: const EdgeInsets.only(left: 50, top: 4),
            child: Text(
              widget.data['content'] as String? ?? '',
              style: const TextStyle(
                fontSize: 14,
                color: AppTheme.textPrimary,
                height: 1.45,
              ),
            ),
          ),
          if (_showTranslation && _translatedText != null)
            Padding(
              padding: const EdgeInsets.only(left: 50),
              child: Container(
                padding: const EdgeInsets.all(10),
                margin: const EdgeInsets.only(top: 4),
                decoration: BoxDecoration(
                  color: AppTheme.primary.withValues(alpha: 0.06),
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(
                    color: AppTheme.primary.withValues(alpha: 0.18),
                  ),
                ),
                child: Text(
                  _translatedText!,
                  style: const TextStyle(
                    fontSize: 13,
                    color: AppTheme.textPrimary,
                    height: 1.4,
                  ),
                ),
              ),
            ),
          if (_isTranslating)
            const Padding(
              padding: EdgeInsets.only(left: 50, top: 4),
              child: SizedBox(
                width: 12,
                height: 12,
                child: CircularProgressIndicator(
                  strokeWidth: 1.5,
                  color: AppTheme.primary,
                ),
              ),
            )
          else if (canTranslate)
            Padding(
              padding: const EdgeInsets.only(left: 50, top: 2),
              child: GestureDetector(
                onTap: _translate,
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(
                      Icons.translate,
                      size: 12,
                      color: AppTheme.primary,
                    ),
                    const SizedBox(width: 3),
                    Text(
                      _showTranslation ? '원문 보기' : '번역 보기',
                      style: const TextStyle(
                        fontSize: 11,
                        color: AppTheme.primary,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _AuthorRow extends StatelessWidget {
  final String uid;
  final String name;
  final String photoUrl;
  final String nationality;
  final String gender;
  final Widget? trailing;

  const _AuthorRow({
    required this.uid,
    required this.name,
    required this.photoUrl,
    required this.nationality,
    required this.gender,
    this.trailing,
  });

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        GestureDetector(
          onTap:
              uid.isEmpty ? null : () => context.push('/profile/detail/$uid'),
          child: photoUrl.isNotEmpty
              ? CircleAvatar(
                  radius: 20,
                  backgroundImage: NetworkImage(photoUrl),
                )
              : DefaultAvatarCircle(
                  nationality: nationality,
                  gender: gender,
                  radius: 20,
                ),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: GestureDetector(
            onTap:
                uid.isEmpty ? null : () => context.push('/profile/detail/$uid'),
            child: Row(
              children: [
                Flexible(
                  child: UserNameText(
                    name: name,
                    seed: uid,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w700,
                      color: AppTheme.textPrimary,
                    ),
                  ),
                ),
                const SizedBox(width: 6),
                NationalityBadge(nationality: nationality, fontSize: 10),
              ],
            ),
          ),
        ),
        if (trailing != null) trailing!,
      ],
    );
  }
}

class _CommentInput extends StatelessWidget {
  final TextEditingController controller;
  final bool submitting;
  final String? replyingToName;
  final VoidCallback onCancelReply;
  final VoidCallback onSubmit;

  const _CommentInput({
    required this.controller,
    required this.submitting,
    required this.replyingToName,
    required this.onCancelReply,
    required this.onSubmit,
  });

  @override
  Widget build(BuildContext context) {
    final isReplying = replyingToName != null;

    return Container(
      decoration: const BoxDecoration(
        color: AppTheme.cardBg,
        border: Border(top: BorderSide(color: AppTheme.divider)),
      ),
      padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
      child: SafeArea(
        top: false,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (isReplying)
              Container(
                margin: const EdgeInsets.only(bottom: 8),
                padding:
                    const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                decoration: BoxDecoration(
                  color: AppTheme.surface,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        '$replyingToName님에게 답글',
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontSize: 13,
                          color: AppTheme.textSecondary,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                    IconButton(
                      onPressed: onCancelReply,
                      icon: const Icon(Icons.close, size: 18),
                      visualDensity: VisualDensity.compact,
                      padding: EdgeInsets.zero,
                      constraints: const BoxConstraints.tightFor(
                        width: 32,
                        height: 32,
                      ),
                    ),
                  ],
                ),
              ),
            Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: controller,
                    maxLength: 500,
                    minLines: 1,
                    maxLines: 4,
                    textInputAction: TextInputAction.send,
                    onSubmitted: (_) => submitting ? null : onSubmit(),
                    decoration: InputDecoration(
                      hintText: isReplying ? '답글을 입력하세요' : '댓글을 입력하세요',
                      counterText: '',
                      filled: true,
                      fillColor: AppTheme.surface,
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(22),
                        borderSide: BorderSide.none,
                      ),
                      contentPadding: const EdgeInsets.symmetric(
                        horizontal: 14,
                        vertical: 10,
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                IconButton.filled(
                  onPressed: submitting ? null : onSubmit,
                  icon: submitting
                      ? const SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: Colors.white,
                          ),
                        )
                      : const Icon(Icons.send, size: 18),
                  style: IconButton.styleFrom(
                    backgroundColor: AppTheme.primary,
                    foregroundColor: Colors.white,
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

String _timeAgo(DateTime dt) {
  final diff = DateTime.now().difference(dt);
  if (diff.inMinutes < 1) return '방금';
  if (diff.inHours < 1) return '${diff.inMinutes}분 전';
  if (diff.inDays < 1) return '${diff.inHours}시간 전';
  return '${diff.inDays}일 전';
}
