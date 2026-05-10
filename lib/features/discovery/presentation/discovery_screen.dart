import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/theme/app_theme.dart';
import '../../../core/i18n/ui_text.dart';
import '../../../core/widgets/bottom_nav_bar.dart';
import '../../../core/widgets/default_avatar.dart';
import '../../../core/widgets/nationality_badge.dart';
import '../../../core/widgets/user_name_text.dart';
import '../domain/candidate.dart';
import 'discovery_provider.dart';

class DiscoveryScreen extends ConsumerWidget {
  const DiscoveryScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(discoveryStateProvider);
    final notifier = ref.read(discoveryStateProvider.notifier);

    if (state.matchedUser != null && state.matchId != null) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        showDialog(
          context: context,
          barrierDismissible: false,
          builder: (_) => _MatchDialog(
            user: state.matchedUser!,
            matchId: state.matchId!,
            onClose: notifier.clearMatch,
          ),
        );
      });
    }

    return PopScope(
      canPop: false,
      child: Scaffold(
        backgroundColor: AppTheme.background,
        body: NestedScrollView(
          headerSliverBuilder: (_, __) => [
            const SliverToBoxAdapter(child: _DiscoveryImageHeader()),
            SliverPersistentHeader(
              pinned: true,
              delegate: _DiscoveryFilterHeaderDelegate(
                topPadding: MediaQuery.paddingOf(context).top,
                child: _FilterBar(
                  filter: state.filter,
                  onChanged: notifier.updateFilter,
                ),
              ),
            ),
          ],
          body: _CandidateList(state: state, notifier: notifier),
        ),
        bottomNavigationBar: const BottomNavBar(currentIndex: 0),
      ),
    );
  }
}

class _DiscoveryImageHeader extends StatelessWidget {
  const _DiscoveryImageHeader();

  @override
  Widget build(BuildContext context) {
    return AspectRatio(
      aspectRatio: 2172 / 724,
      child: Image.asset(
        context.headerAsset('discovery'),
        width: double.infinity,
        fit: BoxFit.contain,
      ),
    );
  }
}

class _DiscoveryFilterHeaderDelegate extends SliverPersistentHeaderDelegate {
  final double topPadding;
  final Widget child;

  const _DiscoveryFilterHeaderDelegate({
    required this.topPadding,
    required this.child,
  });

  @override
  double get minExtent => 54 + topPadding;

  @override
  double get maxExtent => 54 + topPadding;

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
  bool shouldRebuild(covariant _DiscoveryFilterHeaderDelegate oldDelegate) {
    return oldDelegate.topPadding != topPadding || oldDelegate.child != child;
  }
}

class _FilterBar extends StatelessWidget {
  final DiscoveryFilter filter;
  final void Function(DiscoveryFilter) onChanged;

  const _FilterBar({required this.filter, required this.onChanged});

  @override
  Widget build(BuildContext context) {
    const all = DiscoveryFilter.all;
    return SizedBox(
      height: 54,
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 10),
        child: Row(
          children: [
            _FilterChip(
              label: filter.region == all
                  ? context.t('지역', '地域')
                  : _regionLabel(context, filter.region),
              active: filter.region != all,
              options: const [all, 'KR', 'JP'],
              displayLabels: [
                context.t('전체', 'すべて'),
                context.t('한국', '韓国'),
                context.t('일본', '日本'),
              ],
              onSelect: (v) => onChanged(filter.copyWith(region: v)),
            ),
            const SizedBox(width: 8),
            _FilterChip(
              label: filter.relationship == all
                  ? context.t('관계', '目的')
                  : _relationshipLabel(context, filter.relationship),
              active: filter.relationship != all,
              options: const [all, '친구', '언어교환', '연애', '결혼'],
              displayLabels: [
                context.t('전체', 'すべて'),
                context.t('친구', '友達'),
                context.t('언어교환', '言語交換'),
                context.t('연애', '恋愛'),
                context.t('결혼', '結婚'),
              ],
              onSelect: (v) => onChanged(filter.copyWith(relationship: v)),
            ),
            const SizedBox(width: 8),
            _FilterChip(
              label: filter.ageRange == all
                  ? context.t('나이', '年齢')
                  : filter.ageRange,
              active: filter.ageRange != all,
              options: const [all, '20-25', '26-30', '31-35', '36+'],
              displayLabels: [
                context.t('전체', 'すべて'),
                '20-25',
                '26-30',
                '31-35',
                '36+',
              ],
              onSelect: (v) => onChanged(filter.copyWith(ageRange: v)),
            ),
            const SizedBox(width: 8),
            _FilterChip(
              label: filter.gender == all
                  ? context.t('성별', '性別')
                  : genderLabel(context, filter.gender),
              active: filter.gender != all,
              options: const [all, 'male', 'female'],
              displayLabels: [
                context.t('전체', 'すべて'),
                context.t('남성', '男性'),
                context.t('여성', '女性'),
              ],
              onSelect: (v) => onChanged(filter.copyWith(gender: v)),
            ),
          ],
        ),
      ),
    );
  }

  String _regionLabel(BuildContext context, String value) {
    if (value == 'KR') return context.t('한국', '韓国');
    if (value == 'JP') return context.t('일본', '日本');
    return value;
  }

  String _relationshipLabel(BuildContext context, String value) {
    switch (value) {
      case '친구':
        return context.t('친구', '友達');
      case '언어교환':
        return context.t('언어교환', '言語交換');
      case '연애':
        return context.t('연애', '恋愛');
      case '결혼':
        return context.t('결혼', '結婚');
    }
    return value;
  }
}

class _FilterChip extends StatelessWidget {
  final String label;
  final bool active;
  final List<String> options;
  final List<String> displayLabels;
  final void Function(String) onSelect;

  const _FilterChip({
    required this.label,
    required this.active,
    required this.options,
    required this.displayLabels,
    required this.onSelect,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: () async {
        final chosen = await showModalBottomSheet<String>(
          context: context,
          builder: (_) => SafeArea(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: List.generate(options.length, (i) {
                return ListTile(
                  title: Text(displayLabels[i]),
                  onTap: () => Navigator.pop(context, options[i]),
                );
              }),
            ),
          ),
        );
        if (chosen != null) onSelect(chosen);
      },
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 150),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 7),
        decoration: BoxDecoration(
          color: active ? AppTheme.primary : AppTheme.surface,
          borderRadius: BorderRadius.circular(20),
          border:
              Border.all(color: active ? AppTheme.primary : AppTheme.divider),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              label,
              style: TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w600,
                color: active ? Colors.white : AppTheme.textPrimary,
              ),
            ),
            const SizedBox(width: 4),
            Icon(
              Icons.keyboard_arrow_down,
              size: 15,
              color: active ? Colors.white : AppTheme.textSecondary,
            ),
          ],
        ),
      ),
    );
  }
}

class _CandidateList extends StatefulWidget {
  final DiscoveryState state;
  final DiscoveryNotifier notifier;

  const _CandidateList({required this.state, required this.notifier});

  @override
  State<_CandidateList> createState() => _CandidateListState();
}

class _CandidateListState extends State<_CandidateList> {
  bool _onScroll(ScrollNotification notification) {
    if (notification.metrics.pixels >=
        notification.metrics.maxScrollExtent - 400) {
      widget.notifier.loadMore();
    }
    return false;
  }

  @override
  Widget build(BuildContext context) {
    final state = widget.state;
    final notifier = widget.notifier;

    if (state.isLoading && state.candidates.isEmpty) {
      return const Center(child: CircularProgressIndicator());
    }

    final candidates = state.filteredCandidates;

    if (candidates.isEmpty) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Text('🌸', style: TextStyle(fontSize: 48)),
            const SizedBox(height: 16),
            Text(
              context.t('아직 등록된 사용자가 없어요', 'まだ登録されたユーザーがいません'),
              style: const TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w600,
                color: AppTheme.textSecondary,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              context.t('곧 새로운 사람들이 함께할 거예요', 'まもなく新しい人が参加します'),
              style: Theme.of(context).textTheme.bodyMedium,
            ),
            const SizedBox(height: 24),
            OutlinedButton(
              onPressed: notifier.refresh,
              child: Text(context.t('새로고침', '更新')),
            ),
          ],
        ),
      );
    }

    return NotificationListener<ScrollNotification>(
      onNotification: _onScroll,
      child: RefreshIndicator(
        onRefresh: notifier.refresh,
        color: AppTheme.primary,
        child: ListView.separated(
          padding: const EdgeInsets.fromLTRB(16, 4, 16, 20),
          itemCount: candidates.length +
              (state.isLoading || state.isLoadingMore ? 1 : 0),
          separatorBuilder: (_, __) => const SizedBox(height: 12),
          itemBuilder: (context, i) {
            if (i == candidates.length) {
              return const Padding(
                padding: EdgeInsets.symmetric(vertical: 20),
                child: Center(
                  child: CircularProgressIndicator(color: AppTheme.primary),
                ),
              );
            }
            final candidate = candidates[i];
            return _CandidateCard(
              profile: candidate,
              onTap: () => context.push('/profile/detail/${candidate.uid}'),
            );
          },
        ),
      ),
    );
  }
}

class _CandidateCard extends StatelessWidget {
  final PublicProfile profile;
  final VoidCallback onTap;

  const _CandidateCard({
    required this.profile,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final boxAsset = profile.nationality == 'KR'
        ? 'assets/images/Krbox.png'
        : 'assets/images/Jpbox.png';
    final langArrow =
        '${_languageLabel(context, profile.nativeLanguage)} → ${_languageLabel(context, profile.learningLanguage)}';

    return GestureDetector(
      onTap: onTap,
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
              width: 150,
              child: ClipRRect(
                borderRadius: const BorderRadius.only(
                  topRight: Radius.circular(16),
                  bottomRight: Radius.circular(16),
                ),
                child: Opacity(
                  opacity: 0.5,
                  child: Image.asset(boxAsset, fit: BoxFit.cover),
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.all(16),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Stack(
                    clipBehavior: Clip.none,
                    children: [
                      _ProfilePhoto(
                        photoUrls: profile.photoUrls,
                        nationality: profile.nationality,
                        gender: profile.gender,
                      ),
                      if (profile.isOnlineNow || profile.isRecentlyActive)
                        Positioned(
                          bottom: 3,
                          right: 3,
                          child: Container(
                            width: 12,
                            height: 12,
                            decoration: BoxDecoration(
                              color: profile.isOnlineNow
                                  ? const Color(0xFF4CAF50)
                                  : const Color(0xFFFFC107),
                              shape: BoxShape.circle,
                              border: Border.all(color: Colors.white, width: 2),
                            ),
                          ),
                        ),
                    ],
                  ),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Flexible(
                              child: UserNameText(
                                name: profile.displayName,
                                seed: profile.uid,
                                style: const TextStyle(
                                  fontSize: 18,
                                  fontWeight: FontWeight.w700,
                                  color: AppTheme.textPrimary,
                                ),
                              ),
                            ),
                            const SizedBox(width: 6),
                            Text(
                              '${profile.age}',
                              style: const TextStyle(
                                fontSize: 14,
                                color: AppTheme.textSecondary,
                              ),
                            ),
                            const Text(' · ',
                                style:
                                    TextStyle(color: AppTheme.textSecondary)),
                            NationalityBadge(nationality: profile.nationality),
                          ],
                        ),
                        if (profile.city.isNotEmpty) ...[
                          const SizedBox(height: 3),
                          Text(
                            profile.city,
                            style: const TextStyle(
                              fontSize: 13,
                              color: AppTheme.textSecondary,
                            ),
                          ),
                        ],
                        if (profile.occupation.isNotEmpty) ...[
                          const SizedBox(height: 6),
                          Text(
                            profile.occupation,
                            style: const TextStyle(
                              fontSize: 13,
                              fontWeight: FontWeight.w600,
                              color: AppTheme.textPrimary,
                            ),
                          ),
                        ],
                        const SizedBox(height: 8),
                        Row(
                          children: [
                            const Icon(Icons.translate,
                                size: 15, color: AppTheme.primary),
                            const SizedBox(width: 4),
                            Flexible(
                              child: Text(
                                langArrow,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(
                                  fontSize: 12,
                                  color: AppTheme.textSecondary,
                                ),
                              ),
                            ),
                            if (profile.relationshipType.isNotEmpty) ...[
                              const SizedBox(width: 8),
                              Container(
                                padding: const EdgeInsets.symmetric(
                                    horizontal: 8, vertical: 3),
                                decoration: BoxDecoration(
                                  color: AppTheme.surface,
                                  borderRadius: BorderRadius.circular(20),
                                  border:
                                      Border.all(color: AppTheme.primaryLight),
                                ),
                                child: Text(
                                  profile.relationshipType,
                                  style: const TextStyle(
                                    fontSize: 11,
                                    fontWeight: FontWeight.w600,
                                    color: AppTheme.primary,
                                  ),
                                ),
                              ),
                            ],
                          ],
                        ),
                        if (profile.bio.isNotEmpty) ...[
                          const SizedBox(height: 10),
                          Text(
                            profile.bio,
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              fontSize: 13,
                              color: AppTheme.textPrimary,
                              height: 1.4,
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  String _languageLabel(BuildContext context, String value) {
    switch (value) {
      case 'ko':
      case 'KR':
      case '한국어':
        return context.t('한국어', '韓国語');
      case 'ja':
      case 'JP':
      case '일본어':
        return context.t('일본어', '日本語');
    }
    return value;
  }
}

class _ProfilePhoto extends StatelessWidget {
  final List<String> photoUrls;
  final String nationality;
  final String gender;

  const _ProfilePhoto({
    required this.photoUrls,
    required this.nationality,
    required this.gender,
  });

  @override
  Widget build(BuildContext context) {
    if (photoUrls.isEmpty) {
      return ClipRRect(
        borderRadius: BorderRadius.circular(14),
        child: SizedBox(
          width: 94,
          height: 124,
          child: DefaultAvatar(nationality: nationality, gender: gender),
        ),
      );
    }

    return ClipRRect(
      borderRadius: BorderRadius.circular(14),
      child: CachedNetworkImage(
        imageUrl: photoUrls.first,
        width: 94,
        height: 124,
        fit: BoxFit.cover,
        placeholder: (_, __) => DefaultAvatar(
          nationality: nationality,
          gender: gender,
        ),
        errorWidget: (_, __, ___) => DefaultAvatar(
          nationality: nationality,
          gender: gender,
        ),
      ),
    );
  }
}

class _MatchDialog extends StatelessWidget {
  final PublicProfile user;
  final String matchId;
  final VoidCallback onClose;

  const _MatchDialog({
    required this.user,
    required this.matchId,
    required this.onClose,
  });

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Text('🎉', style: TextStyle(fontSize: 48)),
          const SizedBox(height: 12),
          Text(
            context.t('매칭됐어요!', 'マッチしました！'),
            style: const TextStyle(
              fontSize: 22,
              fontWeight: FontWeight.w800,
              color: AppTheme.textPrimary,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            context.t(
              '${user.displayName}님과 서로 좋아해요',
              '${user.displayName}さんとお互いにいいねしました',
            ),
            textAlign: TextAlign.center,
            style: const TextStyle(color: AppTheme.textSecondary),
          ),
          const SizedBox(height: 20),
          SizedBox(
            width: double.infinity,
            child: ElevatedButton(
              onPressed: () {
                onClose();
                Navigator.pop(context);
                context.push('/chat/$matchId');
              },
              child: Text(context.t('대화 시작하기', '会話を始める')),
            ),
          ),
          TextButton(
            onPressed: () {
              onClose();
              Navigator.pop(context);
            },
            child: Text(context.t('나중에', '後で')),
          ),
        ],
      ),
    );
  }
}
