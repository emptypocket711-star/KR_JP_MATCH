import 'package:cached_network_image/cached_network_image.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../domain/lounge_post.dart';
import 'lounge_provider.dart';
import '../../../app/theme/app_theme.dart';
import '../../../core/widgets/bottom_nav_bar.dart';
import '../../../core/widgets/nationality_badge.dart';
import '../../../core/widgets/default_avatar.dart';
import '../../../core/widgets/user_name_text.dart';
import '../../../core/i18n/ui_text.dart';

class LoungeScreen extends ConsumerWidget {
  const LoungeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(loungeProvider);
    final notifier = ref.read(loungeProvider.notifier);

    return Scaffold(
      backgroundColor: AppTheme.background,
      body: NestedScrollView(
        headerSliverBuilder: (_, __) => [
          const SliverToBoxAdapter(child: _LoungeImageHeader()),
          SliverPersistentHeader(
            pinned: true,
            delegate: _CategoryHeaderDelegate(
              topPadding: MediaQuery.paddingOf(context).top,
              child: _CategoryTabBar(
                selected: state.selectedCategory,
                onSelect: notifier.selectCategory,
              ),
            ),
          ),
        ],
        body: _PostList(state: state, notifier: notifier),
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: () => context.push('/lounge/compose'),
        child: const Icon(Icons.edit_outlined),
      ),
      bottomNavigationBar: const BottomNavBar(currentIndex: 1),
    );
  }
}

class _LoungeImageHeader extends StatelessWidget {
  const _LoungeImageHeader();

  @override
  Widget build(BuildContext context) {
    return AspectRatio(
      aspectRatio: 2172 / 724,
      child: Image.asset(
        context.headerAsset('lounge'),
        width: double.infinity,
        fit: BoxFit.contain,
      ),
    );
  }
}

class _CategoryHeaderDelegate extends SliverPersistentHeaderDelegate {
  final double topPadding;
  final Widget child;

  const _CategoryHeaderDelegate({
    required this.topPadding,
    required this.child,
  });

  @override
  double get minExtent => 44 + topPadding;

  @override
  double get maxExtent => 44 + topPadding;

  @override
  Widget build(
    BuildContext context,
    double shrinkOffset,
    bool overlapsContent,
  ) {
    return ColoredBox(
      color: AppTheme.background,
      child: Padding(
        padding: EdgeInsets.only(top: topPadding),
        child: child,
      ),
    );
  }

  @override
  bool shouldRebuild(covariant _CategoryHeaderDelegate oldDelegate) {
    return oldDelegate.topPadding != topPadding || oldDelegate.child != child;
  }
}

class _CategoryTabBar extends StatelessWidget {
  final String selected;
  final void Function(String) onSelect;

  const _CategoryTabBar({required this.selected, required this.onSelect});

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 44,
      child: ListView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
        children: loungeCategories.map((cat) {
          final isSelected = cat == selected;
          return GestureDetector(
            onTap: () => onSelect(cat),
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 150),
              margin: const EdgeInsets.only(right: 8),
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 5),
              decoration: BoxDecoration(
                color: isSelected ? AppTheme.primary : AppTheme.surface,
                borderRadius: BorderRadius.circular(20),
                border: Border.all(
                    color: isSelected ? AppTheme.primary : AppTheme.divider),
              ),
              child: Text(loungeCategoryLabel(context, cat),
                  style: TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                      color: isSelected ? Colors.white : AppTheme.textPrimary)),
            ),
          );
        }).toList(),
      ),
    );
  }
}

// Post list.
class _PostList extends StatelessWidget {
  final LoungeState state;
  final LoungeNotifier notifier;

  const _PostList({required this.state, required this.notifier});

  @override
  Widget build(BuildContext context) {
    if (state.isLoading && state.posts.isEmpty) {
      return const Center(child: CircularProgressIndicator());
    }

    final posts = state.filteredPosts;

    if (posts.isEmpty) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Text('\uD83D\uDCAC', style: TextStyle(fontSize: 40)),
            const SizedBox(height: 12),
            Text(context.t('아직 글이 없어요', 'まだ投稿がありません'),
                style: TextStyle(fontSize: 15, color: AppTheme.textSecondary)),
            const SizedBox(height: 6),
            Text(
                context.t(
                  '첫 번째 글을 작성해보세요!',
                  '最初の投稿を書いてみましょう！',
                ),
                style: TextStyle(fontSize: 13, color: AppTheme.textSecondary)),
          ],
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: notifier.refresh,
      color: AppTheme.primary,
      child: ListView.separated(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 100),
        itemCount: posts.length,
        separatorBuilder: (_, __) => const SizedBox(height: 12),
        itemBuilder: (_, i) => _PostCard(
          post: posts[i],
          myNationality: state.myNationality,
          onLike: () => notifier.toggleLike(posts[i].id),
          onOpen: () {
            if (posts[i].id.startsWith('mock_')) {
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(
                  content: Text(
                    context.t('샘플 글은 열 수 없습니다.', 'サンプル投稿は開けません。'),
                  ),
                ),
              );
              return;
            }
            context.push('/lounge/post/${posts[i].id}');
          },
        ),
      ),
    );
  }
}

// Lounge post card.
class _PostCard extends StatefulWidget {
  final LoungePost post;
  final String myNationality;
  final VoidCallback onLike;
  final VoidCallback onOpen;

  const _PostCard({
    required this.post,
    required this.myNationality,
    required this.onLike,
    required this.onOpen,
  });

  @override
  State<_PostCard> createState() => _PostCardState();
}

class _PostCardState extends State<_PostCard> {
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
    final myNationality = widget.myNationality;
    final boxAsset = post.authorNationality == 'KR'
        ? 'assets/images/Krbox.png'
        : 'assets/images/Jpbox.png';

    final translation = post.translationFor(myNationality) ?? _localTranslation;
    final canTranslate = post.needsTranslation(myNationality);

    return GestureDetector(
      onTap: widget.onOpen,
      child: Container(
        decoration: BoxDecoration(
          color: AppTheme.cardBg,
          borderRadius: BorderRadius.circular(16),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.04),
              blurRadius: 8,
              offset: const Offset(0, 2),
            ),
          ],
        ),
        child: Stack(
          children: [
            Positioned(
              right: 0,
              top: 0,
              bottom: 0,
              width: 140,
              child: ClipRRect(
                borderRadius: const BorderRadius.only(
                  topRight: Radius.circular(16),
                  bottomRight: Radius.circular(16),
                ),
                child: Opacity(
                  opacity: 0.55,
                  child: Image.asset(boxAsset, fit: BoxFit.cover),
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Author profile and metadata.
                  Row(
                    children: [
                      GestureDetector(
                        onTap: () =>
                            context.push('/profile/detail/${post.uid}'),
                        child: post.authorPhotoUrl.isNotEmpty
                            ? CircleAvatar(
                                radius: 20,
                                backgroundImage:
                                    NetworkImage(post.authorPhotoUrl),
                              )
                            : DefaultAvatarCircle(
                                nationality: post.authorNationality,
                                gender: post.authorGender,
                                radius: 20,
                              ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: GestureDetector(
                          onTap: () =>
                              context.push('/profile/detail/${post.uid}'),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Row(
                                children: [
                                  Flexible(
                                    child: UserNameText(
                                        name: post.authorName,
                                        seed: post.uid,
                                        style: const TextStyle(
                                            fontSize: 14,
                                            fontWeight: FontWeight.w700,
                                            color: AppTheme.textPrimary)),
                                  ),
                                  const SizedBox(width: 6),
                                  NationalityBadge(
                                      nationality: post.authorNationality,
                                      fontSize: 10),
                                ],
                              ),
                              Text(_timeAgo(context, post.createdAt),
                                  style: const TextStyle(
                                      fontSize: 11,
                                      color: AppTheme.textSecondary)),
                            ],
                          ),
                        ),
                      ),
                      // Category badge.
                      Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 10, vertical: 4),
                        decoration: BoxDecoration(
                          color: AppTheme.surface,
                          borderRadius: BorderRadius.circular(20),
                          border: Border.all(color: AppTheme.primaryLight),
                        ),
                        child: Text(loungeCategoryLabel(context, post.category),
                            style: const TextStyle(
                                fontSize: 11,
                                fontWeight: FontWeight.w700,
                                color: AppTheme.primary)),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  // Post content.
                  Text(post.content,
                      style: const TextStyle(
                          fontSize: 14,
                          color: AppTheme.textPrimary,
                          height: 1.5)),
                  // Translation preview.
                  if (canTranslate &&
                      _showTranslation &&
                      translation != null) ...[
                    const SizedBox(height: 8),
                    Container(
                      width: double.infinity,
                      padding: const EdgeInsets.all(10),
                      decoration: BoxDecoration(
                        color: AppTheme.primary.withValues(alpha: 0.06),
                        borderRadius: BorderRadius.circular(10),
                        border: Border.all(
                            color: AppTheme.primary.withValues(alpha: 0.18)),
                      ),
                      child: Text(translation,
                          style: const TextStyle(
                              fontSize: 13,
                              color: AppTheme.textPrimary,
                              height: 1.5)),
                    ),
                  ],
                  // Translation toggle.
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
                            const Icon(Icons.translate,
                                size: 13, color: AppTheme.primary),
                            const SizedBox(width: 4),
                            Text(
                              _showTranslation && translation != null
                                  ? context.t('원문 보기', '原文を見る')
                                  : context.t('번역 보기', '翻訳を見る'),
                              style: const TextStyle(
                                  fontSize: 12,
                                  color: AppTheme.primary,
                                  fontWeight: FontWeight.w600),
                            ),
                          ],
                        ),
                      ),
                  ],
                  // Attached image.
                  if (post.imageUrls.isNotEmpty) ...[
                    const SizedBox(height: 10),
                    ClipRRect(
                      borderRadius: BorderRadius.circular(12),
                      child: CachedNetworkImage(
                          imageUrl: post.imageUrls.first,
                          width: double.infinity,
                          height: 180,
                          fit: BoxFit.cover),
                    ),
                  ],
                  const SizedBox(height: 12),
                  // Like and comment counts.
                  Row(
                    children: [
                      GestureDetector(
                        onTap: widget.onLike,
                        child: AnimatedContainer(
                          duration: const Duration(milliseconds: 150),
                          padding: const EdgeInsets.symmetric(
                              horizontal: 12, vertical: 5),
                          decoration: BoxDecoration(
                            color: post.isLikedByMe
                                ? AppTheme.surface
                                : Colors.transparent,
                            borderRadius: BorderRadius.circular(20),
                            border: Border.all(
                              color: post.isLikedByMe
                                  ? AppTheme.primaryLight
                                  : AppTheme.divider,
                            ),
                          ),
                          child: Row(
                            children: [
                              Text(
                                post.isLikedByMe ? '♥' : '♡',
                                style: TextStyle(
                                    fontSize: 15,
                                    color: post.isLikedByMe
                                        ? AppTheme.primary
                                        : AppTheme.textSecondary),
                              ),
                              const SizedBox(width: 5),
                              Text('${post.likeCount}',
                                  style: TextStyle(
                                      fontSize: 13,
                                      fontWeight: FontWeight.w600,
                                      color: post.isLikedByMe
                                          ? AppTheme.primary
                                          : AppTheme.textSecondary)),
                            ],
                          ),
                        ),
                      ),
                      const SizedBox(width: 12),
                      const Icon(Icons.chat_bubble_outline,
                          size: 18, color: AppTheme.textSecondary),
                      const SizedBox(width: 4),
                      Text('${post.commentCount}',
                          style: const TextStyle(
                              fontSize: 13, color: AppTheme.textSecondary)),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

String _timeAgo(BuildContext context, DateTime createdAt) {
  final diff = DateTime.now().difference(createdAt);
  if (diff.inMinutes < 1) return context.t('방금 전', 'たった今');
  if (diff.inMinutes < 60) {
    return context.t('${diff.inMinutes}분 전', '${diff.inMinutes}分前');
  }
  if (diff.inHours < 24) {
    return context.t('${diff.inHours}시간 전', '${diff.inHours}時間前');
  }
  return context.t('${diff.inDays}일 전', '${diff.inDays}日前');
}
