import 'package:cached_network_image/cached_network_image.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../discovery/domain/candidate.dart';
import '../../discovery/presentation/discovery_provider.dart';
import '../../../app/theme/app_theme.dart';
import '../../../core/widgets/nationality_badge.dart';
import '../../../core/widgets/default_avatar.dart';
import '../../../core/widgets/user_name_text.dart';
import 'rating_bottom_sheet.dart';

class ProfileDetailScreen extends ConsumerStatefulWidget {
  final String uid;
  const ProfileDetailScreen({required this.uid, super.key});

  @override
  ConsumerState<ProfileDetailScreen> createState() =>
      _ProfileDetailScreenState();
}

class _ProfileDetailScreenState extends ConsumerState<ProfileDetailScreen> {
  int _photoIndex = 0;
  final _pageController = PageController();
  bool _isStartingChat = false;
  PublicProfile? _loadedProfile;
  bool _isLoadingProfile = false;
  bool _hasChatHistory = false;
  bool _hasAlreadyRated = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _loadLiveData());
  }

  Future<void> _loadLiveData() async {
    if (_isLoadingProfile) return;
    setState(() => _isLoadingProfile = true);
    final currentUid = FirebaseAuth.instance.currentUser?.uid;
    try {
      final matchId = currentUid != null
          ? ([currentUid, widget.uid]..sort()).join('_')
          : null;
      final ratingId =
          currentUid != null ? '${currentUid}_${widget.uid}' : null;

      final futures = <Future>[
        FirebaseFirestore.instance.collection('users').doc(widget.uid).get(),
        if (matchId != null)
          FirebaseFirestore.instance.collection('matches').doc(matchId).get(),
        if (ratingId != null)
          FirebaseFirestore.instance.collection('ratings').doc(ratingId).get(),
      ];
      final results = await Future.wait(futures);
      if (!mounted) return;

      final doc = results[0] as DocumentSnapshot;
      if (doc.exists) {
        final data = Map<String, dynamic>.from(doc.data()! as Map);
        data['uid'] = doc.id;
        final hasMatch =
            results.length > 1 && (results[1] as DocumentSnapshot).exists;
        final hasRated =
            results.length > 2 && (results[2] as DocumentSnapshot).exists;
        setState(() {
          _loadedProfile = PublicProfile.fromMap(data);
          _isLoadingProfile = false;
          _hasChatHistory = hasMatch;
          _hasAlreadyRated = hasRated;
        });
      } else {
        setState(() => _isLoadingProfile = false);
      }
    } catch (_) {
      if (mounted) setState(() => _isLoadingProfile = false);
    }
  }

  bool get _isOwnProfile =>
      widget.uid == FirebaseAuth.instance.currentUser?.uid;

  Future<void> _startChat() async {
    if (_isStartingChat) return;
    setState(() => _isStartingChat = true);

    final notifier = ref.read(discoveryStateProvider.notifier);
    final matchId = await notifier.startDirectChat(widget.uid);

    if (!mounted) return;
    setState(() => _isStartingChat = false);

    if (matchId != null) {
      context.push('/chat/$matchId');
    } else {
      ScaffoldMessenger.of(context)
          .showSnackBar(const SnackBar(content: Text('채팅방 생성에 실패했어요.')));
    }
  }

  @override
  Widget build(BuildContext context) {
    final notifier = ref.read(discoveryStateProvider.notifier);
    // Prefer live Firestore data (_loadedProfile) for accurate stats;
    // fall back to discovery cache for immediate first-render.
    final profile = _loadedProfile ?? notifier.findCandidate(widget.uid);

    if (profile == null) {
      return Scaffold(
        backgroundColor: Colors.black,
        appBar: AppBar(
          backgroundColor: Colors.transparent,
          leading: IconButton(
            icon: const Icon(Icons.arrow_back, color: Colors.white),
            onPressed: () => context.pop(),
          ),
        ),
        body: Center(
          child: _isLoadingProfile
              ? const CircularProgressIndicator(color: Colors.white)
              : const Text('프로필을 찾을 수 없어요',
                  style: TextStyle(color: Colors.white)),
        ),
      );
    }

    return Scaffold(
      backgroundColor: Colors.black,
      body: Stack(
        children: [
          // 사진 캐러셀 (풀스크린)
          Positioned.fill(
            child: _PhotoCarousel(
              photoUrls: profile.photoUrls,
              nationality: profile.nationality,
              gender: profile.gender,
              pageController: _pageController,
              onPageChanged: (i) => setState(() => _photoIndex = i),
            ),
          ),
          // 상단 오버레이
          _TopOverlay(
            profile: profile,
            photoIndex: _photoIndex,
            totalPhotos:
                profile.photoUrls.isEmpty ? 1 : profile.photoUrls.length,
          ),
          // 하단 정보 패널 — 아래로 스와이프하면 접힘
          DraggableScrollableSheet(
            initialChildSize: 0.45,
            minChildSize: 0.08,
            maxChildSize: 0.92,
            snap: true,
            snapSizes: const [0.08, 0.45, 0.92],
            builder: (ctx, scrollController) => _InfoPanel(
              profile: profile,
              isStartingChat: _isStartingChat,
              isOwnProfile: _isOwnProfile,
              hasChatHistory: _hasChatHistory,
              hasAlreadyRated: _hasAlreadyRated,
              scrollController: scrollController,
              onPass: () {
                notifier.passUser(widget.uid);
                context.pop();
              },
              onStartChat: _startChat,
              onRatingSubmitted: () {
                setState(() => _hasAlreadyRated = true);
                _loadLiveData();
              },
            ),
          ),
        ],
      ),
    );
  }
}

// ── 사진 캐러셀 ───────────────────────────────────────────
class _PhotoCarousel extends StatelessWidget {
  final List<String> photoUrls;
  final String nationality;
  final String gender;
  final PageController pageController;
  final void Function(int) onPageChanged;

  const _PhotoCarousel({
    required this.photoUrls,
    required this.nationality,
    required this.gender,
    required this.pageController,
    required this.onPageChanged,
  });

  @override
  Widget build(BuildContext context) {
    // 기본 이미지: 탭하면 전체화면
    if (photoUrls.isEmpty) {
      final assetPath =
          defaultAvatarAsset(nationality: nationality, gender: gender);
      return GestureDetector(
        onTap: () => _openAssetFullscreen(context, assetPath),
        child: SizedBox.expand(
          child: Stack(
            children: [
              const Positioned.fill(child: ColoredBox(color: Colors.black)),
              Positioned.fill(
                child: Image.asset(assetPath, fit: BoxFit.contain),
              ),
            ],
          ),
        ),
      );
    }

    return PageView.builder(
      controller: pageController,
      itemCount: photoUrls.length,
      onPageChanged: onPageChanged,
      itemBuilder: (_, i) => GestureDetector(
        onTap: () => _openNetworkFullscreen(context, i),
        child: _PhotoItem(
          url: photoUrls[i],
          nationality: nationality,
          gender: gender,
        ),
      ),
    );
  }

  void _openAssetFullscreen(BuildContext context, String assetPath) {
    Navigator.of(context).push(PageRouteBuilder(
      opaque: false,
      barrierColor: Colors.black,
      pageBuilder: (_, __, ___) => _AssetFullscreenViewer(assetPath: assetPath),
    ));
  }

  void _openNetworkFullscreen(BuildContext context, int initialIndex) {
    Navigator.of(context).push(PageRouteBuilder(
      opaque: false,
      barrierColor: Colors.black,
      pageBuilder: (_, __, ___) => _NetworkFullscreenViewer(
        photoUrls: photoUrls,
        initialIndex: initialIndex,
      ),
    ));
  }
}

class _PhotoItem extends StatelessWidget {
  final String url;
  final String nationality;
  final String gender;

  const _PhotoItem({
    required this.url,
    required this.nationality,
    required this.gender,
  });

  @override
  Widget build(BuildContext context) {
    return SizedBox.expand(
      child: CachedNetworkImage(
        imageUrl: url,
        fit: BoxFit.cover,
        errorWidget: (_, __, ___) => Image.asset(
          defaultAvatarAsset(nationality: nationality, gender: gender),
          fit: BoxFit.cover,
        ),
      ),
    );
  }
}

// ── 기본 이미지 전체화면 뷰어 ─────────────────────────────
class _AssetFullscreenViewer extends StatelessWidget {
  final String assetPath;
  const _AssetFullscreenViewer({required this.assetPath});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      body: GestureDetector(
        onTap: () => Navigator.of(context).pop(),
        child: Stack(
          children: [
            Positioned.fill(
              child: InteractiveViewer(
                child: Center(
                  child: Image.asset(assetPath, fit: BoxFit.contain),
                ),
              ),
            ),
            Positioned(
              top: MediaQuery.of(context).padding.top + 8,
              right: 16,
              child: GestureDetector(
                onTap: () => Navigator.of(context).pop(),
                child: Container(
                  padding: const EdgeInsets.all(8),
                  decoration: const BoxDecoration(
                    color: Colors.black54,
                    shape: BoxShape.circle,
                  ),
                  child: const Icon(Icons.close, color: Colors.white, size: 22),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ── 네트워크 사진 전체화면 뷰어 (스와이프 가능) ───────────
class _NetworkFullscreenViewer extends StatefulWidget {
  final List<String> photoUrls;
  final int initialIndex;

  const _NetworkFullscreenViewer({
    required this.photoUrls,
    required this.initialIndex,
  });

  @override
  State<_NetworkFullscreenViewer> createState() =>
      _NetworkFullscreenViewerState();
}

class _NetworkFullscreenViewerState extends State<_NetworkFullscreenViewer> {
  late final PageController _ctrl;
  late int _current;

  @override
  void initState() {
    super.initState();
    _current = widget.initialIndex;
    _ctrl = PageController(initialPage: widget.initialIndex);
  }

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      body: GestureDetector(
        onTap: () => Navigator.of(context).pop(),
        child: Stack(
          children: [
            PageView.builder(
              controller: _ctrl,
              itemCount: widget.photoUrls.length,
              onPageChanged: (i) => setState(() => _current = i),
              itemBuilder: (_, i) => InteractiveViewer(
                child: Center(
                  child: CachedNetworkImage(
                    imageUrl: widget.photoUrls[i],
                    fit: BoxFit.contain,
                    placeholder: (_, __) => const Center(
                        child:
                            CircularProgressIndicator(color: Colors.white54)),
                    errorWidget: (_, __, ___) => const Center(
                        child: Icon(Icons.broken_image_outlined,
                            color: Colors.white54)),
                  ),
                ),
              ),
            ),
            Positioned(
              top: MediaQuery.of(context).padding.top + 8,
              right: 16,
              child: GestureDetector(
                onTap: () => Navigator.of(context).pop(),
                child: Container(
                  padding: const EdgeInsets.all(8),
                  decoration: const BoxDecoration(
                    color: Colors.black54,
                    shape: BoxShape.circle,
                  ),
                  child: const Icon(Icons.close, color: Colors.white, size: 22),
                ),
              ),
            ),
            if (widget.photoUrls.length > 1)
              Positioned(
                bottom: MediaQuery.of(context).padding.bottom + 24,
                left: 0,
                right: 0,
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: List.generate(
                    widget.photoUrls.length,
                    (i) => Container(
                      margin: const EdgeInsets.symmetric(horizontal: 3),
                      width: _current == i ? 18 : 6,
                      height: 6,
                      decoration: BoxDecoration(
                        color: _current == i
                            ? Colors.white
                            : Colors.white.withValues(alpha: 0.4),
                        borderRadius: BorderRadius.circular(3),
                      ),
                    ),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

// ── 상단 오버레이 ─────────────────────────────────────────
class _TopOverlay extends StatelessWidget {
  final PublicProfile profile;
  final int photoIndex;
  final int totalPhotos;

  const _TopOverlay({
    required this.profile,
    required this.photoIndex,
    required this.totalPhotos,
  });

  @override
  Widget build(BuildContext context) {
    final topPad = MediaQuery.of(context).padding.top;

    return Positioned(
      top: 0,
      left: 0,
      right: 0,
      child: Container(
        padding: EdgeInsets.fromLTRB(16, topPad + 8, 16, 16),
        decoration: const BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
            colors: [Color(0xCC000000), Colors.transparent],
          ),
        ),
        child: Column(
          children: [
            Row(
              children: List.generate(totalPhotos, (i) {
                return Expanded(
                  child: Container(
                    margin: const EdgeInsets.symmetric(horizontal: 2),
                    height: 3,
                    decoration: BoxDecoration(
                      color: i == photoIndex
                          ? Colors.white
                          : Colors.white.withValues(alpha: 0.4),
                      borderRadius: BorderRadius.circular(2),
                    ),
                  ),
                );
              }),
            ),
            const SizedBox(height: 10),
            Row(
              children: [
                GestureDetector(
                  onTap: () => context.pop(),
                  child: Container(
                    width: 36,
                    height: 36,
                    decoration: BoxDecoration(
                      color: Colors.black.withValues(alpha: 0.3),
                      shape: BoxShape.circle,
                    ),
                    child: const Icon(Icons.arrow_back,
                        color: Colors.white, size: 20),
                  ),
                ),
                const Spacer(),
                if (profile.isOnline)
                  Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                    decoration: BoxDecoration(
                      color: AppTheme.success.withValues(alpha: 0.9),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: const Row(
                      children: [
                        Icon(Icons.circle, color: Colors.white, size: 7),
                        SizedBox(width: 4),
                        Text('온라인',
                            style: TextStyle(
                                color: Colors.white,
                                fontSize: 12,
                                fontWeight: FontWeight.w600)),
                      ],
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

// ── 하단 정보 패널 (드래그 가능) ──────────────────────────
class _InfoPanel extends StatelessWidget {
  final PublicProfile profile;
  final bool isStartingChat;
  final bool isOwnProfile;
  final bool hasChatHistory;
  final bool hasAlreadyRated;
  final ScrollController scrollController;
  final VoidCallback onPass;
  final VoidCallback onStartChat;
  final VoidCallback onRatingSubmitted;

  const _InfoPanel({
    required this.profile,
    required this.isStartingChat,
    required this.isOwnProfile,
    required this.hasChatHistory,
    required this.hasAlreadyRated,
    required this.scrollController,
    required this.onPass,
    required this.onStartChat,
    required this.onRatingSubmitted,
  });

  @override
  Widget build(BuildContext context) {
    final nativeLang = profile.nativeLanguage == 'ko' ? '🇰🇷 한국어' : '🇯🇵 日本語';
    final learningLang =
        profile.learningLanguage == 'ko' ? '🇰🇷 한국어' : '🇯🇵 日本語';
    final hasRating = profile.ratingCount > 0;

    return DecoratedBox(
      decoration: const BoxDecoration(
        color: AppTheme.background,
        borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
      ),
      child: ListView(
        controller: scrollController,
        padding: EdgeInsets.zero,
        children: [
          // ── 드래그 핸들 ──────────────────────────────────
          Center(
            child: Container(
              margin: const EdgeInsets.symmetric(vertical: 12),
              width: 36,
              height: 4,
              decoration: BoxDecoration(
                color: AppTheme.divider,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
          ),

          Padding(
            padding: const EdgeInsets.fromLTRB(20, 0, 20, 24),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // ── 이름 · 나이 · 국적 배지 ───────────────
                Row(
                  crossAxisAlignment: CrossAxisAlignment.center,
                  children: [
                    Expanded(
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.end,
                        children: [
                          UserNameText(
                              name: profile.displayName,
                              seed: profile.uid,
                              style: const TextStyle(
                                  fontSize: 26,
                                  fontWeight: FontWeight.w800,
                                  color: AppTheme.textPrimary,
                                  letterSpacing: -0.5)),
                          const SizedBox(width: 6),
                          Padding(
                            padding: const EdgeInsets.only(bottom: 3),
                            child: Text('${profile.age}',
                                style: const TextStyle(
                                    fontSize: 18,
                                    color: AppTheme.textSecondary,
                                    fontWeight: FontWeight.w500)),
                          ),
                        ],
                      ),
                    ),
                    NationalityBadge(nationality: profile.nationality),
                  ],
                ),

                // ── 도시 · 직업 ────────────────────────────
                if (profile.city.isNotEmpty || profile.occupation.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 5),
                    child: Row(
                      children: [
                        if (profile.city.isNotEmpty) ...[
                          const Icon(Icons.location_on_outlined,
                              size: 13, color: AppTheme.textSecondary),
                          const SizedBox(width: 2),
                          Text(profile.city,
                              style: const TextStyle(
                                  fontSize: 13, color: AppTheme.textSecondary)),
                        ],
                        if (profile.city.isNotEmpty &&
                            profile.occupation.isNotEmpty)
                          const Text('  ·  ',
                              style: TextStyle(
                                  fontSize: 13, color: AppTheme.textSecondary)),
                        if (profile.occupation.isNotEmpty)
                          Text(profile.occupation,
                              style: const TextStyle(
                                  fontSize: 13, color: AppTheme.textSecondary)),
                      ],
                    ),
                  ),

                const SizedBox(height: 14),

                // ── 스탯 배지 행 (좋아요 · 평점 · 번역 가능) ─
                Wrap(
                  spacing: 8,
                  runSpacing: 6,
                  children: [
                    if (profile.likeCount > 0)
                      _StatBadge(
                        icon: Icons.favorite_rounded,
                        iconColor: const Color(0xFFE8826A),
                        label: '${profile.likeCount}',
                      ),
                    if (hasRating)
                      _StatBadge(
                        icon: Icons.star_rounded,
                        iconColor: const Color(0xFFFFC107),
                        label:
                            '${profile.avgRating.toStringAsFixed(1)} (${profile.ratingCount})',
                      ),
                    if (profile.canTranslate)
                      _StatBadge(
                        icon: Icons.translate_rounded,
                        iconColor: AppTheme.primary,
                        label: '번역 가능',
                      ),
                  ],
                ),

                const SizedBox(height: 16),

                // ── 언어교환 배너 ──────────────────────────
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                  decoration: BoxDecoration(
                    gradient: LinearGradient(
                      colors: [
                        AppTheme.primary.withValues(alpha: 0.08),
                        AppTheme.primaryLight.withValues(alpha: 0.06),
                      ],
                    ),
                    borderRadius: BorderRadius.circular(14),
                    border: Border.all(
                        color: AppTheme.primary.withValues(alpha: 0.15)),
                  ),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Text(nativeLang,
                          style: const TextStyle(
                              fontSize: 14,
                              fontWeight: FontWeight.w600,
                              color: AppTheme.textPrimary)),
                      Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 12),
                        child: Icon(Icons.swap_vert_rounded,
                            size: 18,
                            color: AppTheme.primary.withValues(alpha: 0.7)),
                      ),
                      Text(learningLang,
                          style: const TextStyle(
                              fontSize: 14,
                              fontWeight: FontWeight.w600,
                              color: AppTheme.textPrimary)),
                    ],
                  ),
                ),

                // ── 관심사 키워드 ──────────────────────────
                if (profile.keywords.isNotEmpty) ...[
                  const SizedBox(height: 16),
                  _SectionLabel('관심사'),
                  const SizedBox(height: 8),
                  Wrap(
                    spacing: 7,
                    runSpacing: 7,
                    children:
                        profile.keywords.map((kw) => _KeywordChip(kw)).toList(),
                  ),
                ],

                // ── 자기소개 ───────────────────────────────
                if (profile.bio.isNotEmpty) ...[
                  const SizedBox(height: 20),
                  _SectionLabel('소개'),
                  const SizedBox(height: 8),
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(14),
                    decoration: BoxDecoration(
                      color: AppTheme.surface,
                      borderRadius: BorderRadius.circular(14),
                    ),
                    child: Text(profile.bio,
                        style: const TextStyle(
                            fontSize: 14,
                            color: AppTheme.textPrimary,
                            height: 1.65)),
                  ),
                ],

                // ── 관계 유형 ──────────────────────────────
                if (profile.relationshipType.isNotEmpty) ...[
                  const SizedBox(height: 20),
                  _SectionLabel('찾고 있는 관계'),
                  const SizedBox(height: 8),
                  _RelationshipChip(profile.relationshipType),
                ],

                // ── 프로필 Q&A ─────────────────────────────
                if (profile.qaItems.isNotEmpty) ...[
                  const SizedBox(height: 20),
                  _SectionLabel('나에게 물어봐요'),
                  const SizedBox(height: 10),
                  ...profile.qaItems.map((qa) => _QaCard(qa)),
                ],

                const SizedBox(height: 24),

                // ── CTA 버튼 ───────────────────────────────
                if (!isOwnProfile) ...[
                  Container(
                    decoration: BoxDecoration(
                      gradient: AppTheme.primaryGradient,
                      borderRadius: BorderRadius.circular(16),
                      boxShadow: [
                        BoxShadow(
                          color: AppTheme.primary.withValues(alpha: 0.40),
                          blurRadius: 20,
                          offset: const Offset(0, 6),
                        ),
                      ],
                    ),
                    child: Material(
                      color: Colors.transparent,
                      child: InkWell(
                        onTap: isStartingChat ? null : onStartChat,
                        borderRadius: BorderRadius.circular(16),
                        child: Padding(
                          padding: const EdgeInsets.symmetric(vertical: 16),
                          child: isStartingChat
                              ? const Center(
                                  child: SizedBox(
                                    width: 22,
                                    height: 22,
                                    child: CircularProgressIndicator(
                                        color: Colors.white, strokeWidth: 2.5),
                                  ),
                                )
                              : const Row(
                                  mainAxisAlignment: MainAxisAlignment.center,
                                  children: [
                                    Icon(Icons.chat_bubble_rounded,
                                        size: 18, color: Colors.white),
                                    SizedBox(width: 8),
                                    Text('대화하기',
                                        style: TextStyle(
                                            fontSize: 16,
                                            fontWeight: FontWeight.w700,
                                            color: Colors.white,
                                            letterSpacing: 0.2)),
                                  ],
                                ),
                        ),
                      ),
                    ),
                  ),

                  // ── 평가하기 버튼 (채팅 기록 있을 때만) ───
                  if (hasChatHistory) ...[
                    const SizedBox(height: 10),
                    SizedBox(
                      width: double.infinity,
                      child: hasAlreadyRated
                          ? OutlinedButton.icon(
                              onPressed: null,
                              icon: const Icon(Icons.star_rounded,
                                  size: 17, color: AppTheme.textSecondary),
                              label: const Text('평가 완료',
                                  style: TextStyle(
                                      fontSize: 15,
                                      fontWeight: FontWeight.w600,
                                      color: AppTheme.textSecondary)),
                              style: OutlinedButton.styleFrom(
                                padding:
                                    const EdgeInsets.symmetric(vertical: 13),
                                side: const BorderSide(color: AppTheme.divider),
                                shape: RoundedRectangleBorder(
                                    borderRadius: BorderRadius.circular(16)),
                              ),
                            )
                          : OutlinedButton.icon(
                              onPressed: () async {
                                await showModalBottomSheet(
                                  context: context,
                                  isScrollControlled: true,
                                  backgroundColor: Colors.transparent,
                                  builder: (_) => RatingBottomSheet(
                                    ratedUid: profile.uid,
                                    ratedName: profile.displayName,
                                    onSubmitted: onRatingSubmitted,
                                  ),
                                );
                              },
                              icon: const Icon(Icons.star_outline_rounded,
                                  size: 17, color: AppTheme.primary),
                              label: const Text('평가하기',
                                  style: TextStyle(
                                      fontSize: 15,
                                      fontWeight: FontWeight.w600,
                                      color: AppTheme.primary)),
                              style: OutlinedButton.styleFrom(
                                padding:
                                    const EdgeInsets.symmetric(vertical: 13),
                                side: BorderSide(
                                    color: AppTheme.primary
                                        .withValues(alpha: 0.5)),
                                shape: RoundedRectangleBorder(
                                    borderRadius: BorderRadius.circular(16)),
                              ),
                            ),
                    ),
                  ],
                ],

                SizedBox(height: MediaQuery.of(context).padding.bottom + 8),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

// ── 스탯 배지 ─────────────────────────────────────────────
class _StatBadge extends StatelessWidget {
  final IconData icon;
  final Color iconColor;
  final String label;

  const _StatBadge({
    required this.icon,
    required this.iconColor,
    required this.label,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: AppTheme.surface,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: AppTheme.divider),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 13, color: iconColor),
          const SizedBox(width: 4),
          Text(label,
              style: const TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                  color: AppTheme.textSecondary)),
        ],
      ),
    );
  }
}

// ── 섹션 라벨 ─────────────────────────────────────────────
class _SectionLabel extends StatelessWidget {
  final String text;
  const _SectionLabel(this.text);

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Container(
          width: 3,
          height: 14,
          decoration: BoxDecoration(
            color: AppTheme.primary,
            borderRadius: BorderRadius.circular(2),
          ),
        ),
        const SizedBox(width: 8),
        Text(text,
            style: const TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w700,
                color: AppTheme.textSecondary,
                letterSpacing: 0.3)),
      ],
    );
  }
}

// ── 키워드 칩 ─────────────────────────────────────────────
class _KeywordChip extends StatelessWidget {
  final String label;
  const _KeywordChip(this.label);

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 7),
      decoration: BoxDecoration(
        color: AppTheme.surface,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: AppTheme.primary.withValues(alpha: 0.2)),
      ),
      child: Text(label,
          style: const TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w600,
              color: AppTheme.primary)),
    );
  }
}

// ── 관계유형 칩 ───────────────────────────────────────────
class _RelationshipChip extends StatelessWidget {
  final String label;
  const _RelationshipChip(this.label);

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 9),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: [
            AppTheme.primary.withValues(alpha: 0.12),
            AppTheme.primaryLight.withValues(alpha: 0.08),
          ],
        ),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: AppTheme.primary.withValues(alpha: 0.2)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Text('💝', style: TextStyle(fontSize: 14)),
          const SizedBox(width: 6),
          Text(label,
              style: const TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w600,
                  color: AppTheme.primary)),
        ],
      ),
    );
  }
}

// ── Q&A 카드 ─────────────────────────────────────────────
class _QaCard extends StatelessWidget {
  final Map<String, String> qa;
  const _QaCard(this.qa);

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      decoration: BoxDecoration(
        color: AppTheme.surface,
        borderRadius: BorderRadius.circular(16),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // 질문 헤더
          Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
            decoration: BoxDecoration(
              gradient: LinearGradient(
                colors: [
                  AppTheme.primary.withValues(alpha: 0.1),
                  AppTheme.primaryLight.withValues(alpha: 0.06),
                ],
              ),
              borderRadius:
                  const BorderRadius.vertical(top: Radius.circular(16)),
            ),
            child: Row(
              children: [
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                  decoration: BoxDecoration(
                    color: AppTheme.primary,
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: const Text('Q',
                      style: TextStyle(
                          fontSize: 11,
                          fontWeight: FontWeight.w800,
                          color: Colors.white)),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(qa['question'] ?? '',
                      style: const TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w600,
                          color: AppTheme.primary)),
                ),
              ],
            ),
          ),
          // 답변
          Padding(
            padding: const EdgeInsets.all(14),
            child: Text(qa['answer'] ?? '',
                style: const TextStyle(
                    fontSize: 14, color: AppTheme.textPrimary, height: 1.55)),
          ),
        ],
      ),
    );
  }
}
