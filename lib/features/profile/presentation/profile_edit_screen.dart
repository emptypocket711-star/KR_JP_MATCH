import 'dart:io';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_storage/firebase_storage.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import '../../../app/theme/app_theme.dart';
import '../../../core/widgets/bottom_nav_bar.dart';

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
  ('친구', Icons.people_outline),
  ('언어교환', Icons.translate),
  ('연애', Icons.favorite_border),
  ('결혼', Icons.diamond_outlined),
];

class ProfileEditScreen extends ConsumerStatefulWidget {
  const ProfileEditScreen({super.key});

  @override
  ConsumerState<ProfileEditScreen> createState() => _ProfileEditScreenState();
}

class _ProfileEditScreenState extends ConsumerState<ProfileEditScreen> {
  bool _loading = true;
  bool _saving = false;

  // 폼 상태
  List<String> _photoUrls = [];
  final _nameCtrl = TextEditingController();
  final _bioCtrl = TextEditingController();
  String _relationshipType = '';
  int _birthYear = 1995;
  String? _gender;
  String? _nationality;
  String? _residingCountry;
  String? _nativeLanguage;
  String? _learningLanguage;
  List<String> _keywords = [];
  String? _preferredGender;
  String? _preferredNationality;
  int _preferredAgeMin = 18;
  int _preferredAgeMax = 50;

  @override
  void initState() {
    super.initState();
    _loadProfile();
  }

  @override
  void dispose() {
    _nameCtrl.dispose();
    _bioCtrl.dispose();
    super.dispose();
  }

  String? _normalizeAny(String? value) => value == 'all' ? 'any' : value;

  Future<void> _loadProfile() async {
    final uid = FirebaseAuth.instance.currentUser?.uid;
    if (uid == null) return;
    final doc =
        await FirebaseFirestore.instance.collection('users').doc(uid).get();
    final d = doc.data() ?? {};
    setState(() {
      _photoUrls = (d['photoUrls'] as List?)?.cast<String>() ?? [];
      _nameCtrl.text = d['displayName'] as String? ?? '';
      _bioCtrl.text = d['bio'] as String? ?? '';
      _relationshipType = d['relationshipType'] as String? ?? '';
      _birthYear = d['birthYear'] as int? ?? 1995;
      _gender = d['gender'] as String?;
      _nationality = d['nationality'] as String?;
      _residingCountry = d['residingCountry'] as String?;
      _nativeLanguage = d['nativeLanguage'] as String?;
      _learningLanguage = d['learningLanguage'] as String?;
      _keywords = (d['keywords'] as List?)?.cast<String>() ?? [];
      _preferredGender = _normalizeAny(d['preferredGender'] as String?);
      _preferredNationality =
          _normalizeAny(d['preferredNationality'] as String?);
      _preferredAgeMin = d['preferredAgeMin'] as int? ?? 18;
      _preferredAgeMax = d['preferredAgeMax'] as int? ?? 50;
      _loading = false;
    });
  }

  Future<void> _addPhoto() async {
    if (_photoUrls.length >= 6) return;
    final picker = ImagePicker();
    final image = await picker.pickImage(source: ImageSource.gallery);
    if (image == null) return;

    setState(() => _saving = true);
    try {
      final uid = FirebaseAuth.instance.currentUser!.uid;
      final ref = FirebaseStorage.instance
          .ref('users/$uid/photo_${DateTime.now().millisecondsSinceEpoch}.jpg');
      await ref.putFile(File(image.path));
      final url = await ref.getDownloadURL();
      setState(() => _photoUrls = [..._photoUrls, url]);
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('사진 업로드 실패: $e')));
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  void _removePhoto(int index) {
    setState(() => _photoUrls = [..._photoUrls]..removeAt(index));
  }

  Future<void> _save() async {
    final name = _nameCtrl.text.trim();
    if (name.length < 2) {
      ScaffoldMessenger.of(context)
          .showSnackBar(const SnackBar(content: Text('닉네임을 2자 이상 입력해주세요')));
      return;
    }
    if (_photoUrls.isEmpty) {
      ScaffoldMessenger.of(context)
          .showSnackBar(const SnackBar(content: Text('사진을 1장 이상 등록해주세요')));
      return;
    }

    setState(() => _saving = true);
    try {
      final uid = FirebaseAuth.instance.currentUser!.uid;
      await FirebaseFirestore.instance.collection('users').doc(uid).update({
        'displayName': name,
        'bio': _bioCtrl.text.trim(),
        'relationshipType': _relationshipType,
        'birthYear': _birthYear,
        'gender': _gender,
        'nationality': _nationality,
        'residingCountry': _residingCountry,
        'nativeLanguage': _nativeLanguage,
        'learningLanguage': _learningLanguage,
        'keywords': _keywords,
        'photoUrls': _photoUrls,
        'preferredGender': _normalizeAny(_preferredGender),
        'preferredNationality': _normalizeAny(_preferredNationality),
        'preferredAgeMin': _preferredAgeMin,
        'preferredAgeMax': _preferredAgeMax,
        'updatedAt': FieldValue.serverTimestamp(),
      });
      if (mounted) context.go('/profile');
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('저장 실패: $e')));
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.background,
      appBar: AppBar(
        title: const Text('프로필 편집'),
        leading: IconButton(
          icon: const Icon(Icons.close),
          onPressed: () => context.go('/profile'),
        ),
        actions: [
          TextButton(
            onPressed: _saving ? null : _save,
            child: _saving
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Text('저장',
                    style: TextStyle(
                        color: AppTheme.primary,
                        fontWeight: FontWeight.w700,
                        fontSize: 16)),
          ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : SingleChildScrollView(
              padding: const EdgeInsets.only(bottom: 40),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _photoSection(),
                  _divider(),
                  _section('기본 정보', _basicInfoSection()),
                  _divider(),
                  _section('찾고 있는 관계', _relationshipSection()),
                  _divider(),
                  _section('자기소개', _bioSection()),
                  _divider(),
                  _section('관심사', _keywordsSection()),
                  _divider(),
                  _section('국적 / 언어', _nationalityLanguageSection()),
                  _divider(),
                  _section('선호 조건', _preferenceSection()),
                ],
              ),
            ),
      bottomNavigationBar: const BottomNavBar(currentIndex: 3),
    );
  }

  Widget _divider() =>
      const Divider(height: 1, thickness: 1, color: AppTheme.divider);

  Widget _section(String title, Widget child) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 20, 20, 4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title,
              style: const TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w700,
                  color: AppTheme.textSecondary,
                  letterSpacing: 0.3)),
          const SizedBox(height: 14),
          child,
        ],
      ),
    );
  }

  // ── 사진 ──────────────────────────────────────────────
  Widget _photoSection() {
    return Padding(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('사진',
              style: TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w700,
                  color: AppTheme.textSecondary,
                  letterSpacing: 0.3)),
          const SizedBox(height: 4),
          const Text('첫 번째 사진이 대표 사진이에요 (최대 6장)',
              style: TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
          const SizedBox(height: 14),
          GridView.count(
            crossAxisCount: 3,
            crossAxisSpacing: 8,
            mainAxisSpacing: 8,
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            children: [
              ..._photoUrls
                  .asMap()
                  .entries
                  .map((e) => _photoTile(e.key, e.value)),
              if (_photoUrls.length < 6) _addPhotoTile(),
            ],
          ),
        ],
      ),
    );
  }

  Widget _photoTile(int index, String url) {
    return Stack(
      fit: StackFit.expand,
      children: [
        ClipRRect(
          borderRadius: BorderRadius.circular(12),
          child: CachedNetworkImage(imageUrl: url, fit: BoxFit.cover),
        ),
        if (index == 0)
          Positioned(
            bottom: 4,
            left: 4,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
              decoration: BoxDecoration(
                  color: AppTheme.primary,
                  borderRadius: BorderRadius.circular(6)),
              child: const Text('대표',
                  style: TextStyle(
                      color: Colors.white,
                      fontSize: 10,
                      fontWeight: FontWeight.w600)),
            ),
          ),
        Positioned(
          top: 4,
          right: 4,
          child: GestureDetector(
            onTap: () => _removePhoto(index),
            child: Container(
              width: 22,
              height: 22,
              decoration: const BoxDecoration(
                  color: Colors.black54, shape: BoxShape.circle),
              child: const Icon(Icons.close, color: Colors.white, size: 14),
            ),
          ),
        ),
      ],
    );
  }

  Widget _addPhotoTile() {
    return GestureDetector(
      onTap: _saving ? null : _addPhoto,
      child: Container(
        decoration: BoxDecoration(
          color: AppTheme.surface,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: AppTheme.divider, width: 1.5),
        ),
        child: const Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.add_photo_alternate_outlined,
                color: AppTheme.textSecondary, size: 28),
            SizedBox(height: 4),
            Text('추가',
                style: TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
          ],
        ),
      ),
    );
  }

  // ── 기본 정보 ─────────────────────────────────────────
  Widget _basicInfoSection() {
    final age = DateTime.now().year - _birthYear;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        TextField(
          controller: _nameCtrl,
          maxLength: 20,
          decoration: const InputDecoration(
            labelText: '닉네임',
            counterText: '',
            hintText: '2~20자',
          ),
        ),
        const SizedBox(height: 20),
        Row(
          children: [
            const Text('출생연도',
                style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600)),
            const Spacer(),
            Text('$_birthYear년생 ($age세)',
                style: const TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                    color: AppTheme.primary)),
          ],
        ),
        Slider(
          value: _birthYear.toDouble(),
          min: 1950,
          max: 2007,
          divisions: 57,
          activeColor: AppTheme.primary,
          onChanged: (v) => setState(() => _birthYear = v.toInt()),
        ),
        const SizedBox(height: 8),
        const Text('성별',
            style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600)),
        const SizedBox(height: 10),
        Row(
          children: [
            _selectChip('남성', _gender == 'male',
                () => setState(() => _gender = 'male')),
            const SizedBox(width: 10),
            _selectChip('여성', _gender == 'female',
                () => setState(() => _gender = 'female')),
          ],
        ),
      ],
    );
  }

  // ── 관계 유형 ─────────────────────────────────────────
  Widget _relationshipSection() {
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: _relationshipTypes.map((item) {
        final (type, icon) = item;
        final selected = _relationshipType == type;
        return GestureDetector(
          onTap: () => setState(() => _relationshipType = type),
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 150),
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
            decoration: BoxDecoration(
              color: selected ? AppTheme.primary : AppTheme.surface,
              borderRadius: BorderRadius.circular(24),
              border: Border.all(
                  color: selected ? AppTheme.primary : AppTheme.divider),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(icon,
                    size: 16,
                    color: selected ? Colors.white : AppTheme.textSecondary),
                const SizedBox(width: 6),
                Text(type,
                    style: TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w600,
                        color: selected ? Colors.white : AppTheme.textPrimary)),
              ],
            ),
          ),
        );
      }).toList(),
    );
  }

  // ── 자기소개 ──────────────────────────────────────────
  Widget _bioSection() {
    return TextField(
      controller: _bioCtrl,
      maxLength: 500,
      maxLines: 5,
      decoration: const InputDecoration(
        hintText: '한국어 또는 일본어로 자유롭게 써주세요',
        counterText: '',
      ),
    );
  }

  // ── 관심사 ────────────────────────────────────────────
  Widget _keywordsSection() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('${_keywords.length}/5개 선택',
            style:
                const TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
        const SizedBox(height: 10),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: _allKeywords.map((kw) {
            final selected = _keywords.contains(kw);
            final disabled = !selected && _keywords.length >= 5;
            return GestureDetector(
              onTap: disabled
                  ? null
                  : () => setState(() {
                        if (selected) {
                          _keywords = [..._keywords]..remove(kw);
                        } else {
                          _keywords = [..._keywords, kw];
                        }
                      }),
              child: AnimatedContainer(
                duration: const Duration(milliseconds: 150),
                padding:
                    const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                decoration: BoxDecoration(
                  color: selected ? AppTheme.primary : AppTheme.surface,
                  borderRadius: BorderRadius.circular(24),
                  border: Border.all(
                      color: selected
                          ? AppTheme.primary
                          : disabled
                              ? AppTheme.divider
                              : AppTheme.divider),
                ),
                child: Text(kw,
                    style: TextStyle(
                        fontSize: 13,
                        fontWeight:
                            selected ? FontWeight.w600 : FontWeight.w400,
                        color: selected
                            ? Colors.white
                            : disabled
                                ? AppTheme.textSecondary
                                : AppTheme.textPrimary)),
              ),
            );
          }).toList(),
        ),
      ],
    );
  }

  // ── 국적 / 언어 ───────────────────────────────────────
  Widget _nationalityLanguageSection() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _labelRow('국적'),
        const SizedBox(height: 8),
        Row(children: [
          _flagChip('🇰🇷', '한국', _nationality == 'KR',
              () => setState(() => _nationality = 'KR')),
          const SizedBox(width: 10),
          _flagChip('🇯🇵', '일본', _nationality == 'JP',
              () => setState(() => _nationality = 'JP')),
        ]),
        const SizedBox(height: 16),
        _labelRow('거주 국가'),
        const SizedBox(height: 8),
        Row(children: [
          _flagChip('🇰🇷', '한국', _residingCountry == 'KR',
              () => setState(() => _residingCountry = 'KR')),
          const SizedBox(width: 10),
          _flagChip('🇯🇵', '일본', _residingCountry == 'JP',
              () => setState(() => _residingCountry = 'JP')),
        ]),
        const SizedBox(height: 16),
        _labelRow('모국어'),
        const SizedBox(height: 8),
        Row(children: [
          _flagChip('🇰🇷', '한국어', _nativeLanguage == 'ko',
              () => setState(() => _nativeLanguage = 'ko')),
          const SizedBox(width: 10),
          _flagChip('🇯🇵', '日本語', _nativeLanguage == 'ja',
              () => setState(() => _nativeLanguage = 'ja')),
        ]),
        const SizedBox(height: 16),
        _labelRow('배우는 언어'),
        const SizedBox(height: 8),
        Row(children: [
          _flagChip(
              '🇰🇷',
              '한국어',
              _learningLanguage == 'ko',
              _nativeLanguage == 'ko'
                  ? null
                  : () => setState(() => _learningLanguage = 'ko')),
          const SizedBox(width: 10),
          _flagChip(
              '🇯🇵',
              '日本語',
              _learningLanguage == 'ja',
              _nativeLanguage == 'ja'
                  ? null
                  : () => setState(() => _learningLanguage = 'ja')),
        ]),
      ],
    );
  }

  // ── 선호 조건 ─────────────────────────────────────────
  Widget _preferenceSection() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _labelRow('선호 성별'),
        const SizedBox(height: 8),
        Row(children: [
          _selectChip('남성', _preferredGender == 'male',
              () => setState(() => _preferredGender = 'male')),
          const SizedBox(width: 8),
          _selectChip('여성', _preferredGender == 'female',
              () => setState(() => _preferredGender = 'female')),
          const SizedBox(width: 8),
          _selectChip('무관', _preferredGender == 'any',
              () => setState(() => _preferredGender = 'any')),
        ]),
        const SizedBox(height: 16),
        _labelRow('선호 국적'),
        const SizedBox(height: 8),
        Row(children: [
          _flagChip('🇰🇷', '한국', _preferredNationality == 'KR',
              () => setState(() => _preferredNationality = 'KR')),
          const SizedBox(width: 10),
          _flagChip('🇯🇵', '일본', _preferredNationality == 'JP',
              () => setState(() => _preferredNationality = 'JP')),
          const SizedBox(width: 10),
          _selectChip('무관', _preferredNationality == 'any',
              () => setState(() => _preferredNationality = 'any')),
        ]),
        const SizedBox(height: 16),
        Row(
          children: [
            _labelRow('선호 나이대'),
            const Spacer(),
            Text('$_preferredAgeMin세 ~ $_preferredAgeMax세',
                style: const TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                    color: AppTheme.primary)),
          ],
        ),
        RangeSlider(
          values: RangeValues(
              _preferredAgeMin.toDouble(), _preferredAgeMax.toDouble()),
          min: 18,
          max: 70,
          divisions: 52,
          activeColor: AppTheme.primary,
          labels: RangeLabels('$_preferredAgeMin세', '$_preferredAgeMax세'),
          onChanged: (v) => setState(() {
            _preferredAgeMin = v.start.toInt();
            _preferredAgeMax = v.end.toInt();
          }),
        ),
      ],
    );
  }

  // ── 공용 위젯 ─────────────────────────────────────────
  Widget _labelRow(String label) {
    return Text(label,
        style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600));
  }

  Widget _selectChip(String label, bool selected, VoidCallback onTap) {
    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 150),
        padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 9),
        decoration: BoxDecoration(
          color: selected ? AppTheme.primary : AppTheme.surface,
          borderRadius: BorderRadius.circular(24),
          border:
              Border.all(color: selected ? AppTheme.primary : AppTheme.divider),
        ),
        child: Text(label,
            style: TextStyle(
                fontSize: 14,
                fontWeight: FontWeight.w600,
                color: selected ? Colors.white : AppTheme.textPrimary)),
      ),
    );
  }

  Widget _flagChip(
      String flag, String label, bool selected, VoidCallback? onTap) {
    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 150),
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
        decoration: BoxDecoration(
          color: selected ? AppTheme.primary : AppTheme.surface,
          borderRadius: BorderRadius.circular(24),
          border: Border.all(
              color: selected
                  ? AppTheme.primary
                  : onTap == null
                      ? AppTheme.divider.withOpacity(0.4)
                      : AppTheme.divider),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(flag, style: const TextStyle(fontSize: 16)),
            const SizedBox(width: 6),
            Text(label,
                style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                    color: selected
                        ? Colors.white
                        : onTap == null
                            ? AppTheme.textSecondary
                            : AppTheme.textPrimary)),
          ],
        ),
      ),
    );
  }
}
