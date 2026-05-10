import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:firebase_auth/firebase_auth.dart';
import '../../matches/domain/match.dart' as m;
import '../../matches/presentation/matches_provider.dart';
import '../../chat/presentation/chat_provider.dart';
import '../../../app/theme/app_theme.dart';
import '../../../core/widgets/bottom_nav_bar.dart';
import '../../../core/widgets/nationality_badge.dart';
import '../../../core/widgets/default_avatar.dart';
import '../../../core/i18n/ui_text.dart';

class ChatsListScreen extends ConsumerWidget {
  const ChatsListScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final matchesAsync = ref.watch(matchesStreamProvider);
    final currentUid = FirebaseAuth.instance.currentUser?.uid ?? '';

    return Scaffold(
      backgroundColor: AppTheme.background,
      body: NestedScrollView(
        headerSliverBuilder: (_, __) => [
          const SliverToBoxAdapter(child: _ChatImageHeader()),
          SliverPersistentHeader(
            pinned: true,
            delegate: _ChatsHeaderDelegate(
              topPadding: MediaQuery.paddingOf(context).top,
              child: const _ChatsPinnedHeader(),
            ),
          ),
        ],
        body: matchesAsync.when(
          data: (matches) => _Body(matches: matches, currentUid: currentUid),
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (e, _) => _ErrorBody(error: e.toString()),
        ),
      ),
      bottomNavigationBar: const BottomNavBar(currentIndex: 2),
    );
  }
}

class _ChatImageHeader extends StatelessWidget {
  const _ChatImageHeader();

  @override
  Widget build(BuildContext context) {
    return AspectRatio(
      aspectRatio: 2172 / 724,
      child: Image.asset(
        context.headerAsset('chat'),
        width: double.infinity,
        fit: BoxFit.contain,
      ),
    );
  }
}

class _ChatsHeaderDelegate extends SliverPersistentHeaderDelegate {
  final double topPadding;
  final Widget child;

  const _ChatsHeaderDelegate({
    required this.topPadding,
    required this.child,
  });

  @override
  double get minExtent => 56 + topPadding;

  @override
  double get maxExtent => 56 + topPadding;

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
  bool shouldRebuild(covariant _ChatsHeaderDelegate oldDelegate) {
    return oldDelegate.topPadding != topPadding || oldDelegate.child != child;
  }
}

class _ChatsPinnedHeader extends StatelessWidget {
  const _ChatsPinnedHeader();

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 56,
      child: Row(
        children: [
          const SizedBox(width: 16),
          Text(
            context.t('\uBA54\uC2DC\uC9C0', '\u30E1\u30C3\u30BB\u30FC\u30B8'),
            style: const TextStyle(
              fontFamily: 'MaruBuri',
              fontSize: 19,
              fontWeight: FontWeight.w700,
              color: AppTheme.textPrimary,
            ),
          ),
          const Spacer(),
          IconButton(
            icon: const Icon(Icons.search, color: AppTheme.textPrimary),
            onPressed: () {},
          ),
          IconButton(
            icon: const Icon(Icons.tune, color: AppTheme.textPrimary),
            onPressed: () {},
          ),
          const SizedBox(width: 4),
        ],
      ),
    );
  }
}

class _Body extends StatelessWidget {
  final List<m.Match> matches;
  final String currentUid;

  const _Body({required this.matches, required this.currentUid});

  @override
  Widget build(BuildContext context) {
    return CustomScrollView(
      slivers: [
        // Chat rows.
        if (matches.isEmpty)
          const SliverFillRemaining(child: _EmptyChats())
        else
          SliverPadding(
            padding: const EdgeInsets.symmetric(horizontal: 0, vertical: 4),
            sliver: SliverList(
              delegate: SliverChildBuilderDelegate(
                (_, i) => _SwipeableChatItem(
                  match: matches[i],
                  currentUid: currentUid,
                ),
                childCount: matches.length,
              ),
            ),
          ),
      ],
    );
  }
}

// Swipeable chat row.
class _SwipeableChatItem extends ConsumerStatefulWidget {
  final m.Match match;
  final String currentUid;

  const _SwipeableChatItem({
    required this.match,
    required this.currentUid,
  });

  @override
  ConsumerState<_SwipeableChatItem> createState() => _SwipeableChatItemState();
}

class _SwipeableChatItemState extends ConsumerState<_SwipeableChatItem> {
  static const double _actionWidth = 176;
  double _offset = 0;

  Future<void> _toggleFavorite() async {
    final next = !widget.match.isFavoriteFor(widget.currentUid);
    await ref.read(setChatFavoriteProvider((widget.match.id, next)).future);
    if (mounted) setState(() => _offset = 0);
  }

  Future<void> _leaveChat() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: Text(context.t('채팅방 나가기', 'チャットを退出')),
        content: Text(
          context.t(
            '채팅방을 나가면 채팅 목록에서 사라집니다. 계속할까요?',
            '退出するとチャット一覧から削除されます。続けますか？',
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: Text(context.t('취소', 'キャンセル')),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            child: Text(
              context.t('나가기', '退出'),
              style: const TextStyle(color: Colors.red),
            ),
          ),
        ],
      ),
    );

    if (confirmed != true) return;
    await ref.read(leaveChatProvider(widget.match.id).future);
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(context.t('채팅방에서 나갔습니다.', 'チャットから退出しました。')),
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final isFavorite = widget.match.isFavoriteFor(widget.currentUid);

    return ClipRect(
      child: Stack(
        children: [
          Positioned.fill(
            child: Align(
              alignment: Alignment.centerRight,
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  _SwipeAction(
                    color: AppTheme.primary,
                    icon: isFavorite ? Icons.star : Icons.star_border,
                    label: isFavorite
                        ? context.t('해제', '解除')
                        : context.t('즐겨찾기', 'お気に入り'),
                    onTap: _toggleFavorite,
                  ),
                  _SwipeAction(
                    color: Colors.red,
                    icon: Icons.exit_to_app,
                    label: context.t('나가기', '退出'),
                    onTap: _leaveChat,
                  ),
                ],
              ),
            ),
          ),
          GestureDetector(
            onHorizontalDragUpdate: (details) {
              setState(() {
                _offset = (_offset + details.delta.dx).clamp(-_actionWidth, 0);
              });
            },
            onHorizontalDragEnd: (_) {
              setState(() {
                _offset = _offset < -48 ? -_actionWidth : 0;
              });
            },
            child: Transform.translate(
              offset: Offset(_offset, 0),
              child: _ChatItem(
                match: widget.match,
                currentUid: widget.currentUid,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _SwipeAction extends StatelessWidget {
  final Color color;
  final IconData icon;
  final String label;
  final VoidCallback onTap;

  const _SwipeAction({
    required this.color,
    required this.icon,
    required this.label,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        width: 88,
        height: double.infinity,
        color: color,
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(icon, color: Colors.white, size: 20),
            const SizedBox(height: 4),
            Text(
              label,
              style: const TextStyle(
                color: Colors.white,
                fontSize: 12,
                fontWeight: FontWeight.w700,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ChatItem extends StatelessWidget {
  final m.Match match;
  final String currentUid;

  const _ChatItem({required this.match, required this.currentUid});

  @override
  Widget build(BuildContext context) {
    final otherName = match.partnerName(currentUid);
    final otherNationality = match.partnerNationality(currentUid);
    final photoUrl = match.partnerPhoto(currentUid);
    final lastMsg = match.lastMessage ?? '';
    final unread = match.unreadCountFor(currentUid);
    final isFavorite = match.isFavoriteFor(currentUid);

    return InkWell(
      onTap: () => context.push('/chat/${match.id}'),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        decoration: const BoxDecoration(
          color: AppTheme.background,
          border: Border(
            bottom: BorderSide(color: AppTheme.divider, width: 1),
          ),
        ),
        child: Row(
          children: [
            // Profile photo.
            if (photoUrl.isNotEmpty)
              CircleAvatar(
                radius: 26,
                backgroundColor: AppTheme.surface,
                backgroundImage: NetworkImage(photoUrl),
              )
            else
              DefaultAvatarCircle(
                nationality: otherNationality,
                gender: match.partnerGender(currentUid),
                radius: 26,
              ),
            const SizedBox(width: 14),
            // Name and latest message.
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Text(otherName,
                          style: const TextStyle(
                              fontSize: 15,
                              fontWeight: FontWeight.w700,
                              color: AppTheme.textPrimary)),
                      const SizedBox(width: 6),
                      NationalityBadge(nationality: otherNationality),
                    ],
                  ),
                  const SizedBox(height: 3),
                  Text(
                    lastMsg.isNotEmpty
                        ? lastMsg
                        : '\uB300\uD654\uB97C \uC2DC\uC791\uD574\uBCF4\uC138\uC694!',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                        fontSize: 13,
                        color: unread > 0
                            ? AppTheme.textPrimary
                            : AppTheme.textSecondary,
                        fontWeight:
                            unread > 0 ? FontWeight.w600 : FontWeight.w400),
                  ),
                ],
              ),
            ),
            const SizedBox(width: 8),
            // Timestamp and unread badge.
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                if (isFavorite)
                  const Icon(Icons.star, size: 15, color: AppTheme.primary),
                if (match.lastMessageAt != null)
                  Text(
                    _timeLabel(context, match.lastMessageAt!),
                    style: const TextStyle(
                        fontSize: 11, color: AppTheme.textSecondary),
                  ),
                const SizedBox(height: 4),
                if (unread > 0)
                  Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
                    decoration: BoxDecoration(
                      color: AppTheme.primary,
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Text('$unread',
                        style: const TextStyle(
                            color: Colors.white,
                            fontSize: 11,
                            fontWeight: FontWeight.w700)),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  String _timeLabel(BuildContext context, DateTime dt) {
    final diff = DateTime.now().difference(dt);
    if (diff.inMinutes < 1) return context.t('방금', 'たった今');
    if (diff.inHours < 1) {
      return context.t('${diff.inMinutes}분 전', '${diff.inMinutes}分前');
    }
    if (diff.inDays < 1) {
      return context.t('${diff.inHours}시간 전', '${diff.inHours}時間前');
    }
    return context.t('${diff.inDays}일 전', '${diff.inDays}日前');
  }
}

class _EmptyChats extends StatelessWidget {
  const _EmptyChats();

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const Text('\uD83D\uDCAC', style: TextStyle(fontSize: 48)),
          const SizedBox(height: 16),
          Text(context.t('아직 채팅이 없어요', 'まだチャットがありません'),
              style: TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w600,
                  color: AppTheme.textSecondary)),
          const SizedBox(height: 8),
          Text(
              context.t(
                '발견 탭에서 마음에 드는 사람에게\n먼저 좋아요를 눌러보세요',
                '発見タブで気になる人に\nまずいいねしてみましょう',
              ),
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 13, color: AppTheme.textSecondary)),
          const SizedBox(height: 24),
          ElevatedButton(
            onPressed: () => context.go('/discovery'),
            child: Text(context.t('발견하러 가기', '発見へ')),
          ),
        ],
      ),
    );
  }
}

class _ErrorBody extends StatelessWidget {
  final String error;
  const _ErrorBody({required this.error});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Text(error, style: const TextStyle(color: AppTheme.textSecondary)),
    );
  }
}
