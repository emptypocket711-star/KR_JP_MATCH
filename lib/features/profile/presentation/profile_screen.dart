import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import '../../../app/theme/app_theme.dart';
import '../../../core/widgets/bottom_nav_bar.dart';
import '../../../core/widgets/default_avatar.dart';
import '../../../core/widgets/user_name_text.dart';

class ProfileScreen extends ConsumerWidget {
  const ProfileScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final currentUser = FirebaseAuth.instance.currentUser;

    if (currentUser == null) {
      return Scaffold(
        appBar: AppBar(title: const Text('프로필')),
        body: const Center(child: Text('로그인이 필요합니다')),
        bottomNavigationBar: const BottomNavBar(currentIndex: 3),
      );
    }

    return Scaffold(
      backgroundColor: AppTheme.surface,
      body: FutureBuilder<DocumentSnapshot>(
        future: FirebaseFirestore.instance
            .collection('users')
            .doc(currentUser.uid)
            .get(),
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator());
          }

          if (!snapshot.hasData ||
              snapshot.data == null ||
              !(snapshot.data!.exists)) {
            return _EmptyProfile();
          }

          final data = snapshot.data!.data() as Map<String, dynamic>? ?? {};
          return _ProfileBody(data: data);
        },
      ),
      bottomNavigationBar: const BottomNavBar(currentIndex: 3),
    );
  }
}

class _EmptyProfile extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Container(
            width: 80,
            height: 80,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: AppTheme.primaryLight.withOpacity(0.3),
            ),
            child: const Icon(Icons.person_outline,
                size: 40, color: AppTheme.primary),
          ),
          const SizedBox(height: 16),
          const Text('프로필이 없습니다',
              style: TextStyle(fontSize: 16, color: AppTheme.textSecondary)),
          const SizedBox(height: 20),
          ElevatedButton(
            onPressed: () => context.go('/profile/edit'),
            child: const Text('프로필 만들기'),
          ),
        ],
      ),
    );
  }
}

class _ProfileBody extends StatelessWidget {
  final Map<String, dynamic> data;

  const _ProfileBody({required this.data});

  @override
  Widget build(BuildContext context) {
    final displayName = data['displayName'] as String? ?? '사용자';
    final birthYear = data['birthYear'] as int? ?? 2000;
    final nationality = data['nationality'] as String? ?? 'KR';
    final gender = data['gender'] as String? ?? 'female';
    final bio = data['bio'] as String? ?? '';
    final photoUrls = (data['photoUrls'] as List?)?.cast<String>() ?? [];
    final keywords = (data['keywords'] as List?)?.cast<String>() ?? [];
    final relationshipType = data['relationshipType'] as String? ?? '';
    final nativeLanguage = data['nativeLanguage'] as String? ?? '';
    final learningLanguage = data['learningLanguage'] as String? ?? '';

    final age = DateTime.now().year - birthYear;
    final flag =
        nationality == 'KR' ? '🇰🇷' : (nationality == 'JP' ? '🇯🇵' : '');
    final nativeLangLabel = nativeLanguage == 'ko'
        ? '한국어'
        : nativeLanguage == 'ja'
            ? '日本語'
            : '';
    final learningLangLabel = learningLanguage == 'ko'
        ? '한국어'
        : learningLanguage == 'ja'
            ? '日本語'
            : '';

    return CustomScrollView(
      slivers: [
        SliverAppBar(
          expandedHeight: 360,
          pinned: true,
          backgroundColor: AppTheme.background,
          elevation: 0,
          title: UserNameText(
              name: displayName,
              seed: displayName,
              style: const TextStyle(
                  color: AppTheme.textPrimary,
                  fontWeight: FontWeight.w700,
                  fontSize: 18)),
          centerTitle: true,
          actions: [
            IconButton(
              icon:
                  const Icon(Icons.edit_outlined, color: AppTheme.textPrimary),
              onPressed: () => context.go('/profile/edit'),
            ),
          ],
          flexibleSpace: FlexibleSpaceBar(
            background: _PhotoHeader(
              photoUrls: photoUrls,
              nationality: nationality,
              gender: gender,
            ),
          ),
        ),
        SliverToBoxAdapter(
          child: _ProfileContent(
            displayName: displayName,
            age: age,
            flag: flag,
            bio: bio,
            keywords: keywords,
            relationshipType: relationshipType,
            nativeLangLabel: nativeLangLabel,
            learningLangLabel: learningLangLabel,
          ),
        ),
      ],
    );
  }
}

class _PhotoHeader extends StatefulWidget {
  final List<String> photoUrls;
  final String nationality;
  final String gender;
  const _PhotoHeader({
    required this.photoUrls,
    required this.nationality,
    required this.gender,
  });

  @override
  State<_PhotoHeader> createState() => _PhotoHeaderState();
}

class _PhotoHeaderState extends State<_PhotoHeader> {
  int _current = 0;

  @override
  Widget build(BuildContext context) {
    if (widget.photoUrls.isEmpty) {
      return DefaultAvatar(
          nationality: widget.nationality, gender: widget.gender);
    }

    return Stack(
      fit: StackFit.expand,
      children: [
        PageView.builder(
          itemCount: widget.photoUrls.length,
          onPageChanged: (i) => setState(() => _current = i),
          itemBuilder: (_, i) => CachedNetworkImage(
            imageUrl: widget.photoUrls[i],
            fit: BoxFit.cover,
            placeholder: (_, __) =>
                const Center(child: CircularProgressIndicator()),
            errorWidget: (_, __, ___) =>
                const Center(child: Icon(Icons.broken_image_outlined)),
          ),
        ),
        // 하단 그라데이션
        Positioned.fill(
          child: DecoratedBox(
            decoration: const BoxDecoration(gradient: AppTheme.cardGradient),
          ),
        ),
        // 사진 인디케이터
        if (widget.photoUrls.length > 1)
          Positioned(
            top: 60,
            left: 0,
            right: 0,
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: List.generate(widget.photoUrls.length, (i) {
                return AnimatedContainer(
                  duration: const Duration(milliseconds: 200),
                  margin: const EdgeInsets.symmetric(horizontal: 3),
                  width: _current == i ? 20 : 6,
                  height: 4,
                  decoration: BoxDecoration(
                    color: _current == i
                        ? Colors.white
                        : Colors.white.withOpacity(0.5),
                    borderRadius: BorderRadius.circular(2),
                  ),
                );
              }),
            ),
          ),
      ],
    );
  }
}

class _ProfileContent extends StatelessWidget {
  final String displayName;
  final int age;
  final String flag;
  final String bio;
  final List<String> keywords;
  final String relationshipType;
  final String nativeLangLabel;
  final String learningLangLabel;

  const _ProfileContent({
    required this.displayName,
    required this.age,
    required this.flag,
    required this.bio,
    required this.keywords,
    required this.relationshipType,
    required this.nativeLangLabel,
    required this.learningLangLabel,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // 이름/나이/국적
        Padding(
          padding: const EdgeInsets.fromLTRB(20, 20, 20, 0),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              UserNameText(
                  name: displayName,
                  seed: displayName,
                  style: const TextStyle(
                      fontSize: 24,
                      fontWeight: FontWeight.w800,
                      color: AppTheme.textPrimary)),
              const SizedBox(width: 8),
              Padding(
                padding: const EdgeInsets.only(bottom: 2),
                child: Text('$age세',
                    style: const TextStyle(
                        fontSize: 18,
                        fontWeight: FontWeight.w500,
                        color: AppTheme.textSecondary)),
              ),
              if (flag.isNotEmpty) ...[
                const SizedBox(width: 8),
                Text(flag, style: const TextStyle(fontSize: 22)),
              ],
            ],
          ),
        ),
        // 관계유형 + 언어
        Padding(
          padding: const EdgeInsets.fromLTRB(20, 12, 20, 0),
          child: Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              if (relationshipType.isNotEmpty)
                _InfoChip(icon: Icons.favorite_border, label: relationshipType),
              if (nativeLangLabel.isNotEmpty)
                _InfoChip(
                    icon: Icons.chat_bubble_outline, label: nativeLangLabel),
              if (learningLangLabel.isNotEmpty)
                _InfoChip(
                    icon: Icons.school_outlined,
                    label: '배우는 중: $learningLangLabel'),
            ],
          ),
        ),
        // Bio
        if (bio.isNotEmpty) ...[
          const Padding(
            padding: EdgeInsets.fromLTRB(20, 20, 20, 8),
            child: Text('소개',
                style: TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w700,
                    color: AppTheme.textPrimary)),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 20),
            child: Text(bio,
                style: const TextStyle(
                    fontSize: 14, color: AppTheme.textSecondary, height: 1.6)),
          ),
        ],
        // 관심사 키워드
        if (keywords.isNotEmpty) ...[
          const Padding(
            padding: EdgeInsets.fromLTRB(20, 20, 20, 10),
            child: Text('관심사',
                style: TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w700,
                    color: AppTheme.textPrimary)),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 20),
            child: Wrap(
              spacing: 8,
              runSpacing: 8,
              children: keywords.map((kw) => _KeywordChip(label: kw)).toList(),
            ),
          ),
        ],
        // 편집 버튼
        Padding(
          padding: const EdgeInsets.fromLTRB(20, 28, 20, 32),
          child: SizedBox(
            width: double.infinity,
            child: OutlinedButton.icon(
              onPressed: () => context.go('/profile/edit'),
              icon: const Icon(Icons.edit_outlined, size: 18),
              label: const Text('프로필 편집'),
            ),
          ),
        ),
      ],
    );
  }
}

class _InfoChip extends StatelessWidget {
  final IconData icon;
  final String label;

  const _InfoChip({required this.icon, required this.label});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      decoration: BoxDecoration(
        color: AppTheme.surface,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: AppTheme.divider),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 14, color: AppTheme.primary),
          const SizedBox(width: 6),
          Text(label,
              style: const TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w500,
                  color: AppTheme.textPrimary)),
        ],
      ),
    );
  }
}

class _KeywordChip extends StatelessWidget {
  final String label;
  const _KeywordChip({required this.label});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 7),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: [Color(0xFFFFECF0), Color(0xFFFFEDE6)],
        ),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: AppTheme.primaryLight.withOpacity(0.5)),
      ),
      child: Text(label,
          style: const TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w600,
              color: AppTheme.primary)),
    );
  }
}
