import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:firebase_auth/firebase_auth.dart';
import '../domain/match.dart';
import 'matches_provider.dart';
import '../../../app/theme/app_theme.dart';
import '../../../core/widgets/bottom_nav_bar.dart';
import '../../../core/widgets/nationality_badge.dart';
import '../../../core/widgets/default_avatar.dart';
import '../../../core/widgets/user_name_text.dart';

class MatchesScreen extends ConsumerWidget {
  const MatchesScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final matchesAsync = ref.watch(matchesStreamProvider);
    final currentUid = FirebaseAuth.instance.currentUser?.uid ?? '';

    return PopScope(
      canPop: false,
      child: Scaffold(
        backgroundColor: AppTheme.background,
        appBar: _MatchesAppBar(),
        body: matchesAsync.when(
          data: (matches) => matches.isEmpty
              ? const _EmptyMatches()
              : _MatchList(matches: matches, currentUid: currentUid),
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (e, _) => Center(
              child: Text('$e',
                  style: const TextStyle(color: AppTheme.textSecondary))),
        ),
        bottomNavigationBar: const BottomNavBar(currentIndex: 2),
      ),
    );
  }
}

class _MatchesAppBar extends StatelessWidget implements PreferredSizeWidget {
  @override
  Size get preferredSize => const Size.fromHeight(56);

  @override
  Widget build(BuildContext context) {
    return AppBar(
      backgroundColor: AppTheme.background,
      title: Row(
        children: [
          const Text('매칭',
              style: TextStyle(
                  fontFamily: 'MaruBuri',
                  fontSize: 21,
                  fontWeight: FontWeight.w700,
                  color: AppTheme.textPrimary)),
          const SizedBox(width: 2),
          const Text('✦',
              style: TextStyle(fontSize: 14, color: AppTheme.primary)),
        ],
      ),
    );
  }
}

class _EmptyMatches extends StatelessWidget {
  const _EmptyMatches();

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const Text('💝', style: TextStyle(fontSize: 56)),
          const SizedBox(height: 16),
          const Text('아직 매칭이 없어요',
              style: TextStyle(
                  fontSize: 18,
                  fontWeight: FontWeight.w700,
                  color: AppTheme.textPrimary)),
          const SizedBox(height: 8),
          const Text('발견 탭에서 마음에 드는 사람에게\n좋아요를 눌러보세요!',
              textAlign: TextAlign.center,
              style: TextStyle(
                  fontSize: 14, color: AppTheme.textSecondary, height: 1.5)),
          const SizedBox(height: 28),
          ElevatedButton(
            onPressed: () => context.go('/discovery'),
            child: const Text('발견하러 가기'),
          ),
        ],
      ),
    );
  }
}

class _MatchList extends StatelessWidget {
  final List<Match> matches;
  final String currentUid;
  const _MatchList({required this.matches, required this.currentUid});

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(20, 12, 20, 6),
          child: Text('${matches.length}명과 매칭됐어요',
              style:
                  const TextStyle(fontSize: 13, color: AppTheme.textSecondary)),
        ),
        Expanded(
          child: ListView.separated(
            padding: const EdgeInsets.fromLTRB(16, 4, 16, 20),
            itemCount: matches.length,
            separatorBuilder: (_, __) => const SizedBox(height: 10),
            itemBuilder: (_, i) =>
                _MatchCard(match: matches[i], currentUid: currentUid),
          ),
        ),
      ],
    );
  }
}

class _MatchCard extends StatelessWidget {
  final Match match;
  final String currentUid;
  const _MatchCard({required this.match, required this.currentUid});

  @override
  Widget build(BuildContext context) {
    final name = match.partnerName(currentUid);
    final partnerUid =
        match.userIds.firstWhere((id) => id != currentUid, orElse: () => name);
    final photoUrl = match.partnerPhoto(currentUid);
    final nationality = match.partnerNationality(currentUid);
    final lastMsg = match.lastMessagePreview ?? '대화를 시작해보세요!';

    return GestureDetector(
      onTap: () => context.push('/chat/${match.matchId}'),
      child: Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: AppTheme.cardBg,
          borderRadius: BorderRadius.circular(16),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.05),
              blurRadius: 8,
              offset: const Offset(0, 2),
            ),
          ],
        ),
        child: Row(
          children: [
            Stack(
              children: [
                if (photoUrl.isNotEmpty)
                  CircleAvatar(
                    radius: 28,
                    backgroundColor: AppTheme.surface,
                    backgroundImage: NetworkImage(photoUrl),
                  )
                else
                  DefaultAvatarCircle(
                    nationality: nationality,
                    gender: match.partnerGender(currentUid),
                    radius: 28,
                  ),
                Positioned(
                  bottom: 0,
                  right: 0,
                  child: NationalityBadge(
                    nationality: nationality,
                    fontSize: 8,
                    padding:
                        const EdgeInsets.symmetric(horizontal: 5, vertical: 2),
                  ),
                ),
              ],
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  UserNameText(
                      name: name,
                      seed: partnerUid,
                      style: const TextStyle(
                          fontSize: 15,
                          fontWeight: FontWeight.w700,
                          color: AppTheme.textPrimary)),
                  const SizedBox(height: 3),
                  Text(lastMsg,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                          fontSize: 13, color: AppTheme.textSecondary)),
                ],
              ),
            ),
            const SizedBox(width: 8),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
              decoration: BoxDecoration(
                gradient: const LinearGradient(
                  colors: [AppTheme.primary, AppTheme.gradientEnd],
                ),
                borderRadius: BorderRadius.circular(12),
              ),
              child: const Text('대화하기',
                  style: TextStyle(
                      color: Colors.white,
                      fontSize: 12,
                      fontWeight: FontWeight.w700)),
            ),
          ],
        ),
      ),
    );
  }
}
