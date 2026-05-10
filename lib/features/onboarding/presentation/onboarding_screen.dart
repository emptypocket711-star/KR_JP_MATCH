import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_storage/firebase_storage.dart';
import '../domain/onboarding_repository.dart';
import 'onboarding_provider.dart';
import '../../auth/presentation/auth_provider.dart';

// 관심사 키워드 목록 (KR-JP 특화)
const _allKeywords = [
  'K-pop',
  '아이돌',
  '드라마',
  '영화',
  '애니메이션',
  '만화',
  '게임',
  '여행',
  '음식',
  '요리',
  '카페',
  '독서',
  '음악',
  '악기',
  '운동',
  '헬스',
  '등산',
  '자전거',
  '수영',
  '언어교환',
  '일본어 공부중',
  '한국어 공부중',
  '반려동물',
  '패션',
  '사진',
  '그림',
  '댄스',
  '한국문화',
  '일본문화',
  '야구',
  '축구',
];

const _relationshipTypes = [
  ('친구', '새로운 친구를 사귀고 싶어요', Icons.people),
  ('언어교환', '언어를 함께 배우고 싶어요', Icons.translate),
  ('연애', '진지한 연애를 원해요', Icons.favorite),
  ('결혼', '결혼을 전제로 만나고 싶어요', Icons.diamond),
];

class OnboardingScreen extends ConsumerStatefulWidget {
  const OnboardingScreen({super.key});

  @override
  ConsumerState<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _OnboardingScreenState extends ConsumerState<OnboardingScreen> {
  late PageController _pageController;
  int _currentPage = 0;
  bool _isLoading = false;

  // 0:관계유형 1:이름 2:생년/성별 3:국적 4:언어 5:소개 6:키워드 7:Q&A 8:사진 9:선호설정
  static const int _totalPages = 10;

  @override
  void initState() {
    super.initState();
    _pageController = PageController();
  }

  @override
  void dispose() {
    _pageController.dispose();
    super.dispose();
  }

  void _nextPage() {
    _pageController.nextPage(
      duration: const Duration(milliseconds: 300),
      curve: Curves.easeInOut,
    );
  }

  Future<void> _uploadPhotos(List<String> localPaths) async {
    final storage = FirebaseStorage.instance;
    final userId = FirebaseAuth.instance.currentUser?.uid;
    if (userId == null) throw Exception('Not authenticated');

    final existingCount =
        ref.read(onboardingFormStateProvider).photoUrls.length;
    for (int i = 0; i < localPaths.length; i++) {
      final file = File(localPaths[i]);
      final storageRef =
          storage.ref('users/$userId/photo_${existingCount + i}.jpg');
      await storageRef.putFile(file);
      final url = await storageRef.getDownloadURL();
      ref.read(onboardingFormStateProvider.notifier).addPhotoUrl(url);
    }
  }

  Future<void> _submitOnboarding() async {
    final formState = ref.read(onboardingFormStateProvider);

    if (formState.relationshipType.isEmpty ||
        formState.displayName.isEmpty ||
        formState.birthYear == null ||
        formState.gender == null ||
        formState.nationality == null ||
        formState.residingCountry == null ||
        formState.nativeLanguage == null ||
        formState.learningLanguage == null ||
        formState.bio.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('모든 항목을 입력해주세요.')),
      );
      return;
    }

    setState(() => _isLoading = true);

    try {
      final repository = ref.read(onboardingRepositoryProvider);
      final input = UserProfileInput(
        relationshipType: formState.relationshipType,
        displayName: formState.displayName,
        birthYear: formState.birthYear!,
        gender: formState.gender!,
        nationality: formState.nationality!,
        residingCountry: formState.residingCountry!,
        nativeLanguage: formState.nativeLanguage!,
        learningLanguage: formState.learningLanguage!,
        bio: formState.bio,
        occupation: formState.occupation,
        keywords: formState.keywords,
        qaItems: formState.qaItems,
        photoUrls: formState.photoUrls,
        preferredGender: formState.preferredGender,
        preferredNationality: formState.preferredNationality,
        preferredAgeMin: formState.preferredAgeMin,
        preferredAgeMax: formState.preferredAgeMax,
      );

      await repository.completeOnboarding(input);
      // profileExistsProvider 캐시를 무효화 → GoRouter가 재평가해서 /discovery로 이동
      // 직접 context.go('/discovery') 하지 않는 이유:
      // 캐시된 false 값으로 redirect → /onboarding 복귀 문제 방지
      if (mounted) ref.invalidate(profileExistsProvider);
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(e.toString())));
      }
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final formState = ref.watch(onboardingFormStateProvider);
    final formNotifier = ref.read(onboardingFormStateProvider.notifier);

    return Scaffold(
      appBar: AppBar(
        title: Text('${_currentPage + 1} / $_totalPages'),
        centerTitle: true,
        leading: _currentPage > 0
            ? IconButton(
                icon: const Icon(Icons.arrow_back),
                onPressed: () => _pageController.previousPage(
                  duration: const Duration(milliseconds: 300),
                  curve: Curves.easeInOut,
                ),
              )
            : null,
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(4),
          child: LinearProgressIndicator(
            value: (_currentPage + 1) / _totalPages,
            backgroundColor: Colors.grey[200],
            color: Theme.of(context).primaryColor,
          ),
        ),
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : PageView(
              controller: _pageController,
              physics: const NeverScrollableScrollPhysics(),
              onPageChanged: (page) => setState(() => _currentPage = page),
              children: [
                _RelationshipTypePage(
                  selected: formState.relationshipType,
                  onSelected: formNotifier.setRelationshipType,
                  onNext: _nextPage,
                ),
                _DisplayNamePage(
                  value: formState.displayName,
                  onChanged: formNotifier.setDisplayName,
                  onNext: _nextPage,
                ),
                _BirthYearAndGenderPage(
                  birthYear: formState.birthYear,
                  gender: formState.gender,
                  onBirthYearChanged: formNotifier.setBirthYear,
                  onGenderChanged: formNotifier.setGender,
                  onNext: _nextPage,
                ),
                _NationalityPage(
                  nationality: formState.nationality,
                  residingCountry: formState.residingCountry,
                  onNationalityChanged: formNotifier.setNationality,
                  onResidingCountryChanged: formNotifier.setResidingCountry,
                  onNext: _nextPage,
                ),
                _LanguagePage(
                  nativeLanguage: formState.nativeLanguage,
                  learningLanguage: formState.learningLanguage,
                  onNativeLanguageChanged: formNotifier.setNativeLanguage,
                  onLearningLanguageChanged: formNotifier.setLearningLanguage,
                  onNext: _nextPage,
                ),
                _BioPage(
                  bio: formState.bio,
                  occupation: formState.occupation,
                  onBioChanged: formNotifier.setBio,
                  onOccupationChanged: formNotifier.setOccupation,
                  onNext: _nextPage,
                ),
                _KeywordsPage(
                  selected: formState.keywords,
                  onToggle: formNotifier.toggleKeyword,
                  onNext: _nextPage,
                ),
                _QaPage(
                  qaItems: formState.qaItems,
                  onSetQa: formNotifier.setQaItem,
                  onNext: _nextPage,
                ),
                _PhotoPage(
                  photoUrls: formState.photoUrls,
                  onPhotosSelected: _uploadPhotos,
                  onNext: _nextPage,
                ),
                _PreferencesPage(
                  preferredGender: formState.preferredGender,
                  preferredNationality: formState.preferredNationality,
                  preferredAgeMin: formState.preferredAgeMin,
                  preferredAgeMax: formState.preferredAgeMax,
                  onPreferredGenderChanged: formNotifier.setPreferredGender,
                  onPreferredNationalityChanged:
                      formNotifier.setPreferredNationality,
                  onPreferredAgeMinChanged: formNotifier.setPreferredAgeMin,
                  onPreferredAgeMaxChanged: formNotifier.setPreferredAgeMax,
                  onSubmit: _submitOnboarding,
                ),
              ],
            ),
    );
  }
}

// ── 관계 유형 ──────────────────────────────────────────
class _RelationshipTypePage extends StatelessWidget {
  final String selected;
  final Function(String) onSelected;
  final VoidCallback onNext;

  const _RelationshipTypePage({
    required this.selected,
    required this.onSelected,
    required this.onNext,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Expanded(
          child: SingleChildScrollView(
            padding: const EdgeInsets.fromLTRB(24, 24, 24, 0),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const SizedBox(height: 16),
                Text('어떤 인연을 찾고 있나요?',
                    style: Theme.of(context)
                        .textTheme
                        .headlineSmall
                        ?.copyWith(fontWeight: FontWeight.bold)),
                const SizedBox(height: 8),
                Text('한국과 일본을 잇는 특별한 만남을 시작해보세요.',
                    style: Theme.of(context)
                        .textTheme
                        .bodyMedium
                        ?.copyWith(color: Colors.grey[600])),
                const SizedBox(height: 32),
                ...(_relationshipTypes.map((item) {
                  final (type, desc, icon) = item;
                  final isSelected = selected == type;
                  return Padding(
                    padding: const EdgeInsets.only(bottom: 12),
                    child: GestureDetector(
                      onTap: () => onSelected(type),
                      child: AnimatedContainer(
                        duration: const Duration(milliseconds: 180),
                        padding: const EdgeInsets.symmetric(
                            horizontal: 20, vertical: 18),
                        decoration: BoxDecoration(
                          color: isSelected
                              ? Theme.of(context).primaryColor.withOpacity(0.1)
                              : Colors.grey[100],
                          borderRadius: BorderRadius.circular(16),
                          border: Border.all(
                            color: isSelected
                                ? Theme.of(context).primaryColor
                                : Colors.transparent,
                            width: 2,
                          ),
                        ),
                        child: Row(
                          children: [
                            Icon(icon,
                                color: isSelected
                                    ? Theme.of(context).primaryColor
                                    : Colors.grey[500],
                                size: 28),
                            const SizedBox(width: 16),
                            Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(type,
                                    style: TextStyle(
                                        fontWeight: FontWeight.bold,
                                        fontSize: 16,
                                        color: isSelected
                                            ? Theme.of(context).primaryColor
                                            : Colors.black87)),
                                Text(desc,
                                    style: TextStyle(
                                        fontSize: 13, color: Colors.grey[600])),
                              ],
                            ),
                            const Spacer(),
                            if (isSelected)
                              Icon(Icons.check_circle,
                                  color: Theme.of(context).primaryColor),
                          ],
                        ),
                      ),
                    ),
                  );
                })),
                const SizedBox(height: 24),
              ],
            ),
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(24, 8, 24, 24),
          child: SizedBox(
            width: double.infinity,
            child: ElevatedButton(
              onPressed: selected.isNotEmpty ? onNext : null,
              style: ElevatedButton.styleFrom(
                  padding: const EdgeInsets.symmetric(vertical: 16),
                  shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12))),
              child: const Text('다음', style: TextStyle(fontSize: 16)),
            ),
          ),
        ),
      ],
    );
  }
}

// ── 이름 ────────────────────────────────────────────────
class _DisplayNamePage extends StatelessWidget {
  final String value;
  final Function(String) onChanged;
  final VoidCallback onNext;

  const _DisplayNamePage({
    required this.value,
    required this.onChanged,
    required this.onNext,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Expanded(
          child: SingleChildScrollView(
            padding: const EdgeInsets.fromLTRB(24, 24, 24, 0),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const SizedBox(height: 16),
                Text('닉네임을 알려주세요',
                    style: Theme.of(context)
                        .textTheme
                        .headlineSmall
                        ?.copyWith(fontWeight: FontWeight.bold)),
                const SizedBox(height: 8),
                Text('다른 사용자에게 표시될 이름이에요.',
                    style: Theme.of(context)
                        .textTheme
                        .bodyMedium
                        ?.copyWith(color: Colors.grey[600])),
                const SizedBox(height: 32),
                TextField(
                  autofocus: true,
                  decoration: InputDecoration(
                    hintText: '닉네임 입력',
                    helperText: '2~20자',
                    counterText: '${value.length}/20',
                    border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(12)),
                    focusedBorder: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(12),
                      borderSide: BorderSide(
                          color: Theme.of(context).primaryColor, width: 2),
                    ),
                  ),
                  onChanged: onChanged,
                  maxLength: 20,
                  buildCounter: (_,
                          {required currentLength,
                          required isFocused,
                          maxLength}) =>
                      null,
                ),
                const SizedBox(height: 24),
              ],
            ),
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(24, 8, 24, 24),
          child: SizedBox(
            width: double.infinity,
            child: ElevatedButton(
              onPressed: value.trim().length >= 2 ? onNext : null,
              style: ElevatedButton.styleFrom(
                  padding: const EdgeInsets.symmetric(vertical: 16),
                  shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12))),
              child: const Text('다음', style: TextStyle(fontSize: 16)),
            ),
          ),
        ),
      ],
    );
  }
}

// ── 생년 / 성별 ─────────────────────────────────────────
class _BirthYearAndGenderPage extends StatelessWidget {
  final int? birthYear;
  final String? gender;
  final Function(int) onBirthYearChanged;
  final Function(String) onGenderChanged;
  final VoidCallback onNext;

  const _BirthYearAndGenderPage({
    required this.birthYear,
    required this.gender,
    required this.onBirthYearChanged,
    required this.onGenderChanged,
    required this.onNext,
  });

  @override
  Widget build(BuildContext context) {
    final canProceed = birthYear != null && gender != null;
    return Column(
      children: [
        Expanded(
          child: SingleChildScrollView(
            padding: const EdgeInsets.fromLTRB(24, 24, 24, 0),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const SizedBox(height: 16),
                Text('기본 정보를 알려주세요',
                    style: Theme.of(context)
                        .textTheme
                        .headlineSmall
                        ?.copyWith(fontWeight: FontWeight.bold)),
                const SizedBox(height: 32),
                Text('출생연도', style: Theme.of(context).textTheme.titleMedium),
                const SizedBox(height: 8),
                Center(
                  child: Text('${birthYear ?? 1995}년생',
                      style: Theme.of(context)
                          .textTheme
                          .headlineMedium
                          ?.copyWith(
                              fontWeight: FontWeight.bold,
                              color: Theme.of(context).primaryColor)),
                ),
                Slider(
                  value: (birthYear ?? 1995).toDouble(),
                  min: 1950,
                  max: 2007,
                  divisions: 57,
                  onChanged: (v) => onBirthYearChanged(v.toInt()),
                ),
                const SizedBox(height: 32),
                Text('성별', style: Theme.of(context).textTheme.titleMedium),
                const SizedBox(height: 16),
                Row(
                  children: [
                    Expanded(
                      child: _GenderCard(
                        label: '남성',
                        icon: Icons.male,
                        selected: gender == 'male',
                        onTap: () => onGenderChanged('male'),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: _GenderCard(
                        label: '여성',
                        icon: Icons.female,
                        selected: gender == 'female',
                        onTap: () => onGenderChanged('female'),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 24),
              ],
            ),
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(24, 8, 24, 24),
          child: SizedBox(
            width: double.infinity,
            child: ElevatedButton(
              onPressed: canProceed ? onNext : null,
              style: ElevatedButton.styleFrom(
                  padding: const EdgeInsets.symmetric(vertical: 16),
                  shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12))),
              child: const Text('다음', style: TextStyle(fontSize: 16)),
            ),
          ),
        ),
      ],
    );
  }
}

class _GenderCard extends StatelessWidget {
  final String label;
  final IconData icon;
  final bool selected;
  final VoidCallback onTap;

  const _GenderCard({
    required this.label,
    required this.icon,
    required this.selected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 180),
        padding: const EdgeInsets.symmetric(vertical: 24),
        decoration: BoxDecoration(
          color: selected
              ? Theme.of(context).primaryColor.withOpacity(0.1)
              : Colors.grey[100],
          borderRadius: BorderRadius.circular(16),
          border: Border.all(
            color:
                selected ? Theme.of(context).primaryColor : Colors.transparent,
            width: 2,
          ),
        ),
        child: Column(
          children: [
            Icon(icon,
                size: 36,
                color: selected
                    ? Theme.of(context).primaryColor
                    : Colors.grey[500]),
            const SizedBox(height: 8),
            Text(label,
                style: TextStyle(
                    fontWeight: FontWeight.bold,
                    color: selected
                        ? Theme.of(context).primaryColor
                        : Colors.black87)),
          ],
        ),
      ),
    );
  }
}

// ── 국적 / 거주지 ────────────────────────────────────────
class _NationalityPage extends StatelessWidget {
  final String? nationality;
  final String? residingCountry;
  final Function(String) onNationalityChanged;
  final Function(String) onResidingCountryChanged;
  final VoidCallback onNext;

  const _NationalityPage({
    required this.nationality,
    required this.residingCountry,
    required this.onNationalityChanged,
    required this.onResidingCountryChanged,
    required this.onNext,
  });

  @override
  Widget build(BuildContext context) {
    final canProceed = nationality != null && residingCountry != null;
    return Column(
      children: [
        Expanded(
          child: SingleChildScrollView(
            padding: const EdgeInsets.fromLTRB(24, 24, 24, 0),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const SizedBox(height: 16),
                Text('어느 나라 출신인가요?',
                    style: Theme.of(context)
                        .textTheme
                        .headlineSmall
                        ?.copyWith(fontWeight: FontWeight.bold)),
                const SizedBox(height: 32),
                Text('국적', style: Theme.of(context).textTheme.titleMedium),
                const SizedBox(height: 12),
                Row(
                  children: [
                    Expanded(
                      child: _FlagCard(
                        flag: '🇰🇷',
                        label: '한국',
                        selected: nationality == 'KR',
                        onTap: () => onNationalityChanged('KR'),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: _FlagCard(
                        flag: '🇯🇵',
                        label: '일본',
                        selected: nationality == 'JP',
                        onTap: () => onNationalityChanged('JP'),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 32),
                Text('거주 국가', style: Theme.of(context).textTheme.titleMedium),
                const SizedBox(height: 12),
                Row(
                  children: [
                    Expanded(
                      child: _FlagCard(
                        flag: '🇰🇷',
                        label: '한국',
                        selected: residingCountry == 'KR',
                        onTap: () => onResidingCountryChanged('KR'),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: _FlagCard(
                        flag: '🇯🇵',
                        label: '일본',
                        selected: residingCountry == 'JP',
                        onTap: () => onResidingCountryChanged('JP'),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 24),
              ],
            ),
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(24, 8, 24, 24),
          child: SizedBox(
            width: double.infinity,
            child: ElevatedButton(
              onPressed: canProceed ? onNext : null,
              style: ElevatedButton.styleFrom(
                  padding: const EdgeInsets.symmetric(vertical: 16),
                  shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12))),
              child: const Text('다음', style: TextStyle(fontSize: 16)),
            ),
          ),
        ),
      ],
    );
  }
}

class _FlagCard extends StatelessWidget {
  final String flag, label;
  final bool selected;
  final VoidCallback? onTap;

  const _FlagCard({
    required this.flag,
    required this.label,
    required this.selected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 180),
        padding: const EdgeInsets.symmetric(vertical: 24),
        decoration: BoxDecoration(
          color: selected
              ? Theme.of(context).primaryColor.withOpacity(0.1)
              : Colors.grey[100],
          borderRadius: BorderRadius.circular(16),
          border: Border.all(
            color:
                selected ? Theme.of(context).primaryColor : Colors.transparent,
            width: 2,
          ),
        ),
        child: Column(
          children: [
            Text(flag, style: const TextStyle(fontSize: 36)),
            const SizedBox(height: 8),
            Text(label,
                style: TextStyle(
                    fontWeight: FontWeight.bold,
                    color: selected
                        ? Theme.of(context).primaryColor
                        : Colors.black87)),
          ],
        ),
      ),
    );
  }
}

// ── 언어 ────────────────────────────────────────────────
class _LanguagePage extends StatelessWidget {
  final String? nativeLanguage;
  final String? learningLanguage;
  final Function(String) onNativeLanguageChanged;
  final Function(String) onLearningLanguageChanged;
  final VoidCallback onNext;

  const _LanguagePage({
    required this.nativeLanguage,
    required this.learningLanguage,
    required this.onNativeLanguageChanged,
    required this.onLearningLanguageChanged,
    required this.onNext,
  });

  @override
  Widget build(BuildContext context) {
    final canProceed = nativeLanguage != null && learningLanguage != null;
    return Column(
      children: [
        Expanded(
          child: SingleChildScrollView(
            padding: const EdgeInsets.fromLTRB(24, 24, 24, 0),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const SizedBox(height: 16),
                Text('어떤 언어를 사용하나요?',
                    style: Theme.of(context)
                        .textTheme
                        .headlineSmall
                        ?.copyWith(fontWeight: FontWeight.bold)),
                const SizedBox(height: 32),
                Text('모국어', style: Theme.of(context).textTheme.titleMedium),
                const SizedBox(height: 12),
                Row(
                  children: [
                    Expanded(
                      child: _FlagCard(
                        flag: '🇰🇷',
                        label: '한국어',
                        selected: nativeLanguage == 'ko',
                        onTap: () => onNativeLanguageChanged('ko'),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: _FlagCard(
                        flag: '🇯🇵',
                        label: '日本語',
                        selected: nativeLanguage == 'ja',
                        onTap: () => onNativeLanguageChanged('ja'),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 32),
                Text('배우고 싶은 언어',
                    style: Theme.of(context).textTheme.titleMedium),
                const SizedBox(height: 12),
                Row(
                  children: [
                    Expanded(
                      child: _FlagCard(
                        flag: '🇰🇷',
                        label: '한국어',
                        selected: learningLanguage == 'ko',
                        onTap: nativeLanguage == 'ko'
                            ? null
                            : () => onLearningLanguageChanged('ko'),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: _FlagCard(
                        flag: '🇯🇵',
                        label: '日本語',
                        selected: learningLanguage == 'ja',
                        onTap: nativeLanguage == 'ja'
                            ? null
                            : () => onLearningLanguageChanged('ja'),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 24),
              ],
            ),
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(24, 8, 24, 24),
          child: SizedBox(
            width: double.infinity,
            child: ElevatedButton(
              onPressed: canProceed ? onNext : null,
              style: ElevatedButton.styleFrom(
                  padding: const EdgeInsets.symmetric(vertical: 16),
                  shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12))),
              child: const Text('다음', style: TextStyle(fontSize: 16)),
            ),
          ),
        ),
      ],
    );
  }
}

// ── 소개 + 직업 ──────────────────────────────────────────
class _BioPage extends StatelessWidget {
  final String bio;
  final String occupation;
  final Function(String) onBioChanged;
  final Function(String) onOccupationChanged;
  final VoidCallback onNext;

  const _BioPage({
    required this.bio,
    required this.occupation,
    required this.onBioChanged,
    required this.onOccupationChanged,
    required this.onNext,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Expanded(
          child: SingleChildScrollView(
            padding: const EdgeInsets.fromLTRB(24, 24, 24, 0),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const SizedBox(height: 16),
                Text('자기소개를 작성해주세요',
                    style: Theme.of(context)
                        .textTheme
                        .headlineSmall
                        ?.copyWith(fontWeight: FontWeight.bold)),
                const SizedBox(height: 8),
                Text('한국어 또는 일본어로 자유롭게 써주세요.',
                    style: Theme.of(context)
                        .textTheme
                        .bodyMedium
                        ?.copyWith(color: Colors.grey[600])),
                const SizedBox(height: 20),
                TextField(
                  decoration: InputDecoration(
                    labelText: '직업 (선택)',
                    hintText: '예) 대학생, 회사원, 디자이너…',
                    border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(12)),
                    focusedBorder: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(12),
                      borderSide: BorderSide(
                          color: Theme.of(context).primaryColor, width: 2),
                    ),
                  ),
                  onChanged: onOccupationChanged,
                  maxLength: 30,
                  buildCounter: (_,
                          {required currentLength,
                          required isFocused,
                          maxLength}) =>
                      null,
                ),
                const SizedBox(height: 16),
                TextField(
                  decoration: InputDecoration(
                    labelText: '자기소개',
                    hintText: '예) 안녕하세요! 일본 문화에 관심이 많아요. 같이 언어 교환해요 😊',
                    helperText: '${bio.length}/500 (최소 10자)',
                    border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(12)),
                    focusedBorder: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(12),
                      borderSide: BorderSide(
                          color: Theme.of(context).primaryColor, width: 2),
                    ),
                  ),
                  onChanged: onBioChanged,
                  maxLength: 500,
                  maxLines: 5,
                  buildCounter: (_,
                          {required currentLength,
                          required isFocused,
                          maxLength}) =>
                      null,
                ),
                const SizedBox(height: 24),
              ],
            ),
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(24, 8, 24, 24),
          child: SizedBox(
            width: double.infinity,
            child: ElevatedButton(
              onPressed: bio.trim().length >= 10 ? onNext : null,
              style: ElevatedButton.styleFrom(
                  padding: const EdgeInsets.symmetric(vertical: 16),
                  shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12))),
              child: const Text('다음', style: TextStyle(fontSize: 16)),
            ),
          ),
        ),
      ],
    );
  }
}

// ── 관심사 키워드 ────────────────────────────────────────
class _KeywordsPage extends StatelessWidget {
  final List<String> selected;
  final Function(String) onToggle;
  final VoidCallback onNext;

  const _KeywordsPage({
    required this.selected,
    required this.onToggle,
    required this.onNext,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const SizedBox(height: 16),
          Text('관심사를 선택해주세요',
              style: Theme.of(context)
                  .textTheme
                  .headlineSmall
                  ?.copyWith(fontWeight: FontWeight.bold)),
          const SizedBox(height: 8),
          Text('최대 5개까지 선택할 수 있어요. (${selected.length}/5)',
              style: Theme.of(context)
                  .textTheme
                  .bodyMedium
                  ?.copyWith(color: Colors.grey[600])),
          const SizedBox(height: 24),
          Expanded(
            child: SingleChildScrollView(
              child: Wrap(
                spacing: 8,
                runSpacing: 8,
                children: _allKeywords.map((kw) {
                  final isSelected = selected.contains(kw);
                  final isDisabled = !isSelected && selected.length >= 5;
                  return GestureDetector(
                    onTap: isDisabled ? null : () => onToggle(kw),
                    child: AnimatedContainer(
                      duration: const Duration(milliseconds: 150),
                      padding: const EdgeInsets.symmetric(
                          horizontal: 14, vertical: 8),
                      decoration: BoxDecoration(
                        color: isSelected
                            ? Theme.of(context).primaryColor
                            : isDisabled
                                ? Colors.grey[200]
                                : Colors.grey[100],
                        borderRadius: BorderRadius.circular(24),
                        border: Border.all(
                          color: isSelected
                              ? Theme.of(context).primaryColor
                              : Colors.grey[300]!,
                        ),
                      ),
                      child: Text(
                        kw,
                        style: TextStyle(
                          color: isSelected
                              ? Colors.white
                              : isDisabled
                                  ? Colors.grey[400]
                                  : Colors.black87,
                          fontWeight:
                              isSelected ? FontWeight.bold : FontWeight.normal,
                        ),
                      ),
                    ),
                  );
                }).toList(),
              ),
            ),
          ),
          const SizedBox(height: 16),
          SizedBox(
            width: double.infinity,
            child: ElevatedButton(
              onPressed: onNext,
              style: ElevatedButton.styleFrom(
                  padding: const EdgeInsets.symmetric(vertical: 16),
                  shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12))),
              child: Text(
                selected.isEmpty ? '건너뛰기' : '다음',
                style: const TextStyle(fontSize: 16),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

// ── 사진 ────────────────────────────────────────────────
class _PhotoPage extends StatefulWidget {
  final List<String> photoUrls;
  final Function(List<String>) onPhotosSelected;
  final VoidCallback onNext;

  const _PhotoPage({
    required this.photoUrls,
    required this.onPhotosSelected,
    required this.onNext,
  });

  @override
  State<_PhotoPage> createState() => _PhotoPageState();
}

class _PhotoPageState extends State<_PhotoPage> {
  final _picker = ImagePicker();
  bool _uploading = false;

  Future<void> _pickImage() async {
    if (widget.photoUrls.length >= 6) return;
    final image = await _picker.pickImage(source: ImageSource.gallery);
    if (image == null) return;
    setState(() => _uploading = true);
    try {
      await widget.onPhotosSelected([image.path]);
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('사진 업로드 실패: $e')));
      }
    } finally {
      if (mounted) setState(() => _uploading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const SizedBox(height: 16),
          Text('사진을 추가해주세요',
              style: Theme.of(context)
                  .textTheme
                  .headlineSmall
                  ?.copyWith(fontWeight: FontWeight.bold)),
          const SizedBox(height: 8),
          Text('사진이 있으면 매칭 확률이 높아져요! (최대 6장)',
              style: Theme.of(context)
                  .textTheme
                  .bodyMedium
                  ?.copyWith(color: Colors.grey[600])),
          const SizedBox(height: 24),
          Expanded(
            child: _uploading
                ? const Center(
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        CircularProgressIndicator(),
                        SizedBox(height: 16),
                        Text('업로드 중...'),
                      ],
                    ),
                  )
                : GridView.count(
                    crossAxisCount: 3,
                    crossAxisSpacing: 10,
                    mainAxisSpacing: 10,
                    children: [
                      ...widget.photoUrls.asMap().entries.map((e) {
                        return Stack(
                          children: [
                            Container(
                              decoration: BoxDecoration(
                                borderRadius: BorderRadius.circular(12),
                                image: DecorationImage(
                                  image: NetworkImage(e.value),
                                  fit: BoxFit.cover,
                                ),
                              ),
                            ),
                            if (e.key == 0)
                              Positioned(
                                bottom: 4,
                                left: 4,
                                child: Container(
                                  padding: const EdgeInsets.symmetric(
                                      horizontal: 6, vertical: 2),
                                  decoration: BoxDecoration(
                                    color: Theme.of(context).primaryColor,
                                    borderRadius: BorderRadius.circular(8),
                                  ),
                                  child: const Text('대표',
                                      style: TextStyle(
                                          color: Colors.white, fontSize: 10)),
                                ),
                              ),
                          ],
                        );
                      }),
                      if (widget.photoUrls.length < 6)
                        GestureDetector(
                          onTap: _pickImage,
                          child: Container(
                            decoration: BoxDecoration(
                              borderRadius: BorderRadius.circular(12),
                              border: Border.all(
                                  color: Theme.of(context).primaryColor,
                                  width: 2),
                              color: Theme.of(context)
                                  .primaryColor
                                  .withOpacity(0.05),
                            ),
                            child: Column(
                              mainAxisAlignment: MainAxisAlignment.center,
                              children: [
                                Icon(Icons.add_photo_alternate,
                                    color: Theme.of(context).primaryColor,
                                    size: 32),
                                const SizedBox(height: 4),
                                Text('추가',
                                    style: TextStyle(
                                        color: Theme.of(context).primaryColor,
                                        fontSize: 12)),
                              ],
                            ),
                          ),
                        ),
                    ],
                  ),
          ),
          const SizedBox(height: 16),
          SizedBox(
            width: double.infinity,
            child: ElevatedButton(
              onPressed: widget.onNext,
              style: ElevatedButton.styleFrom(
                  padding: const EdgeInsets.symmetric(vertical: 16),
                  shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12))),
              child: const Text('다음', style: TextStyle(fontSize: 16)),
            ),
          ),
        ],
      ),
    );
  }
}

// ── 선호 설정 ────────────────────────────────────────────
class _PreferencesPage extends StatelessWidget {
  final String? preferredGender;
  final String? preferredNationality;
  final int? preferredAgeMin;
  final int? preferredAgeMax;
  final Function(String) onPreferredGenderChanged;
  final Function(String) onPreferredNationalityChanged;
  final Function(int) onPreferredAgeMinChanged;
  final Function(int) onPreferredAgeMaxChanged;
  final VoidCallback onSubmit;

  const _PreferencesPage({
    required this.preferredGender,
    required this.preferredNationality,
    required this.preferredAgeMin,
    required this.preferredAgeMax,
    required this.onPreferredGenderChanged,
    required this.onPreferredNationalityChanged,
    required this.onPreferredAgeMinChanged,
    required this.onPreferredAgeMaxChanged,
    required this.onSubmit,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const SizedBox(height: 16),
          Text('선호 조건을 설정해주세요',
              style: Theme.of(context)
                  .textTheme
                  .headlineSmall
                  ?.copyWith(fontWeight: FontWeight.bold)),
          const SizedBox(height: 8),
          Text('입력하지 않으면 모든 조건으로 매칭됩니다. (선택사항)',
              style: Theme.of(context)
                  .textTheme
                  .bodyMedium
                  ?.copyWith(color: Colors.grey[600])),
          const SizedBox(height: 24),
          Expanded(
            child: SingleChildScrollView(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('선호 성별', style: Theme.of(context).textTheme.titleMedium),
                  const SizedBox(height: 12),
                  Row(
                    children: ['male', 'female', 'any'].map((v) {
                      final label = v == 'male'
                          ? '남성'
                          : v == 'female'
                              ? '여성'
                              : '무관';
                      return Expanded(
                        child: Padding(
                          padding: const EdgeInsets.only(right: 8),
                          child: _SelectChip(
                            label: label,
                            selected: preferredGender == v,
                            onTap: () => onPreferredGenderChanged(v),
                          ),
                        ),
                      );
                    }).toList(),
                  ),
                  const SizedBox(height: 24),
                  Text('선호 국적', style: Theme.of(context).textTheme.titleMedium),
                  const SizedBox(height: 12),
                  Row(
                    children: ['KR', 'JP', 'any'].map((v) {
                      final label = v == 'KR'
                          ? '🇰🇷 한국'
                          : v == 'JP'
                              ? '🇯🇵 일본'
                              : '무관';
                      return Expanded(
                        child: Padding(
                          padding: const EdgeInsets.only(right: 8),
                          child: _SelectChip(
                            label: label,
                            selected: preferredNationality == v,
                            onTap: () => onPreferredNationalityChanged(v),
                          ),
                        ),
                      );
                    }).toList(),
                  ),
                  const SizedBox(height: 24),
                  Text('선호 나이대',
                      style: Theme.of(context).textTheme.titleMedium),
                  const SizedBox(height: 8),
                  Text('${preferredAgeMin ?? 18}세 ~ ${preferredAgeMax ?? 50}세',
                      style: TextStyle(
                          color: Theme.of(context).primaryColor,
                          fontWeight: FontWeight.bold)),
                  RangeSlider(
                    values: RangeValues(
                      (preferredAgeMin ?? 18).toDouble(),
                      (preferredAgeMax ?? 50).toDouble(),
                    ),
                    min: 18,
                    max: 70,
                    divisions: 52,
                    labels: RangeLabels(
                      '${preferredAgeMin ?? 18}세',
                      '${preferredAgeMax ?? 50}세',
                    ),
                    onChanged: (v) {
                      onPreferredAgeMinChanged(v.start.toInt());
                      onPreferredAgeMaxChanged(v.end.toInt());
                    },
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),
          SizedBox(
            width: double.infinity,
            child: ElevatedButton(
              onPressed: onSubmit,
              style: ElevatedButton.styleFrom(
                  padding: const EdgeInsets.symmetric(vertical: 16),
                  shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12))),
              child: const Text('프로필 완성하기',
                  style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
            ),
          ),
        ],
      ),
    );
  }
}

// ── 프로필 문답 ──────────────────────────────────────────
const _qaQuestions = [
  '한국/일본 문화에서 가장 좋아하는 것은?',
  '함께 가보고 싶은 곳이 있나요?',
  '나를 한 마디로 표현하면?',
  '이상형의 조건이 있다면?',
  '좋아하는 음식이나 음악을 소개해줘요',
  '언어교환을 시작한 계기가 뭔가요?',
];

class _QaPage extends StatefulWidget {
  final List<Map<String, String>> qaItems;
  final void Function(int index, String question, String answer) onSetQa;
  final VoidCallback onNext;

  const _QaPage({
    required this.qaItems,
    required this.onSetQa,
    required this.onNext,
  });

  @override
  State<_QaPage> createState() => _QaPageState();
}

class _QaPageState extends State<_QaPage> {
  final List<String?> _selectedQuestions = [null, null];
  final List<TextEditingController> _controllers = [
    TextEditingController(),
    TextEditingController(),
  ];

  @override
  void initState() {
    super.initState();
    for (int i = 0; i < widget.qaItems.length && i < 2; i++) {
      _selectedQuestions[i] = widget.qaItems[i]['question'];
      _controllers[i].text = widget.qaItems[i]['answer'] ?? '';
    }
  }

  @override
  void dispose() {
    for (final c in _controllers) {
      c.dispose();
    }
    super.dispose();
  }

  bool get _canProceed =>
      _selectedQuestions[0] != null && _controllers[0].text.trim().length >= 5;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const SizedBox(height: 16),
          Text('나를 소개하는 질문에 답해주세요',
              style: Theme.of(context)
                  .textTheme
                  .headlineSmall
                  ?.copyWith(fontWeight: FontWeight.bold)),
          const SizedBox(height: 8),
          Text('1개 필수, 2개 선택 가능해요.',
              style: Theme.of(context)
                  .textTheme
                  .bodyMedium
                  ?.copyWith(color: Colors.grey[600])),
          const SizedBox(height: 24),
          Expanded(
            child: SingleChildScrollView(
              child: Column(
                children: List.generate(2, (i) {
                  final isRequired = i == 0;
                  return Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Text('질문 ${i + 1}${isRequired ? ' (필수)' : ' (선택)'}',
                              style: Theme.of(context)
                                  .textTheme
                                  .titleSmall
                                  ?.copyWith(
                                      color: Theme.of(context).primaryColor)),
                        ],
                      ),
                      const SizedBox(height: 8),
                      // 질문 선택 드롭다운
                      Container(
                        decoration: BoxDecoration(
                          border: Border.all(color: Colors.grey[300]!),
                          borderRadius: BorderRadius.circular(12),
                        ),
                        child: DropdownButtonHideUnderline(
                          child: DropdownButton<String>(
                            value: _selectedQuestions[i],
                            hint: const Padding(
                              padding: EdgeInsets.symmetric(horizontal: 12),
                              child: Text('질문을 선택해주세요'),
                            ),
                            isExpanded: true,
                            borderRadius: BorderRadius.circular(12),
                            padding: const EdgeInsets.symmetric(horizontal: 8),
                            items: _qaQuestions
                                .where((q) =>
                                    q == _selectedQuestions[i] ||
                                    !_selectedQuestions.contains(q))
                                .map((q) => DropdownMenuItem(
                                      value: q,
                                      child: Text(q,
                                          style: const TextStyle(fontSize: 14)),
                                    ))
                                .toList(),
                            onChanged: (q) {
                              setState(() => _selectedQuestions[i] = q);
                              if (q != null) {
                                widget.onSetQa(i, q, _controllers[i].text);
                              }
                            },
                          ),
                        ),
                      ),
                      if (_selectedQuestions[i] != null) ...[
                        const SizedBox(height: 8),
                        TextField(
                          controller: _controllers[i],
                          maxLength: 100,
                          maxLines: 2,
                          decoration: InputDecoration(
                            hintText: '답변을 입력해주세요 (5자 이상)',
                            border: OutlineInputBorder(
                                borderRadius: BorderRadius.circular(12)),
                            focusedBorder: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(12),
                              borderSide: BorderSide(
                                  color: Theme.of(context).primaryColor,
                                  width: 2),
                            ),
                            counterText: '',
                          ),
                          onChanged: (v) {
                            setState(() {});
                            widget.onSetQa(i, _selectedQuestions[i]!, v);
                          },
                        ),
                      ],
                      const SizedBox(height: 20),
                    ],
                  );
                }),
              ),
            ),
          ),
          SizedBox(
            width: double.infinity,
            child: ElevatedButton(
              onPressed: _canProceed ? widget.onNext : null,
              style: ElevatedButton.styleFrom(
                  padding: const EdgeInsets.symmetric(vertical: 16),
                  shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12))),
              child: const Text('다음', style: TextStyle(fontSize: 16)),
            ),
          ),
        ],
      ),
    );
  }
}

class _SelectChip extends StatelessWidget {
  final String label;
  final bool selected;
  final VoidCallback onTap;

  const _SelectChip({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 150),
        padding: const EdgeInsets.symmetric(vertical: 12),
        decoration: BoxDecoration(
          color: selected ? Theme.of(context).primaryColor : Colors.grey[100],
          borderRadius: BorderRadius.circular(12),
          border: Border.all(
            color:
                selected ? Theme.of(context).primaryColor : Colors.grey[300]!,
          ),
        ),
        child: Center(
          child: Text(
            label,
            style: TextStyle(
              color: selected ? Colors.white : Colors.black87,
              fontWeight: selected ? FontWeight.bold : FontWeight.normal,
              fontSize: 13,
            ),
          ),
        ),
      ),
    );
  }
}
