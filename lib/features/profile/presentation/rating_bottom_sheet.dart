import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import '../../../app/theme/app_theme.dart';

const _ratingTags = [
  '친절해요',
  '재미있어요',
  '언어 교환에 열정적이에요',
  '배려해요',
  '매너있어요',
  '답장이 빨라요',
];

class RatingBottomSheet extends StatefulWidget {
  final String ratedUid;
  final String ratedName;
  final VoidCallback? onSubmitted;

  const RatingBottomSheet({
    required this.ratedUid,
    required this.ratedName,
    this.onSubmitted,
    super.key,
  });

  @override
  State<RatingBottomSheet> createState() => _RatingBottomSheetState();
}

class _RatingBottomSheetState extends State<RatingBottomSheet> {
  int _stars = 0;
  final Set<String> _selectedTags = {};
  bool _isSubmitting = false;
  bool _submitted = false;

  Future<void> _submit() async {
    if (_stars == 0 || _isSubmitting) return;
    final currentUser = FirebaseAuth.instance.currentUser;
    if (currentUser == null) return;

    setState(() => _isSubmitting = true);

    final ratingId = '${currentUser.uid}_${widget.ratedUid}';
    try {
      await FirebaseFirestore.instance.collection('ratings').doc(ratingId).set({
        'raterUid': currentUser.uid,
        'ratedUid': widget.ratedUid,
        'stars': _stars,
        'tags': _selectedTags.toList(),
        'createdAt': FieldValue.serverTimestamp(),
      });
      if (mounted) {
        setState(() => _submitted = true);
        widget.onSubmitted?.call();
      }
    } catch (_) {
      if (mounted) {
        setState(() => _isSubmitting = false);
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('평가 제출에 실패했어요. 다시 시도해 주세요.')),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        color: AppTheme.background,
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      padding: EdgeInsets.fromLTRB(
          24, 20, 24, MediaQuery.of(context).padding.bottom + 24),
      child: _submitted
          ? _SubmittedView(onClose: () => Navigator.of(context).pop())
          : _FormView(
              ratedName: widget.ratedName,
              stars: _stars,
              selectedTags: _selectedTags,
              isSubmitting: _isSubmitting,
              onStarTap: (s) => setState(() => _stars = s),
              onTagToggle: (t) => setState(() {
                if (_selectedTags.contains(t)) {
                  _selectedTags.remove(t);
                } else {
                  _selectedTags.add(t);
                }
              }),
              onSubmit: _submit,
            ),
    );
  }
}

class _FormView extends StatelessWidget {
  final String ratedName;
  final int stars;
  final Set<String> selectedTags;
  final bool isSubmitting;
  final void Function(int) onStarTap;
  final void Function(String) onTagToggle;
  final VoidCallback onSubmit;

  const _FormView({
    required this.ratedName,
    required this.stars,
    required this.selectedTags,
    required this.isSubmitting,
    required this.onStarTap,
    required this.onTagToggle,
    required this.onSubmit,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Center(
          child: Container(
            width: 36,
            height: 4,
            margin: const EdgeInsets.only(bottom: 20),
            decoration: BoxDecoration(
              color: AppTheme.divider,
              borderRadius: BorderRadius.circular(2),
            ),
          ),
        ),
        Text('$ratedName 님을 평가해요',
            style: const TextStyle(
                fontSize: 18,
                fontWeight: FontWeight.w800,
                color: AppTheme.textPrimary)),
        const SizedBox(height: 6),
        const Text('대화 경험을 솔직하게 남겨주세요',
            style: TextStyle(fontSize: 13, color: AppTheme.textSecondary)),
        const SizedBox(height: 24),
        // 별점
        Center(
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: List.generate(
              5,
              (i) => GestureDetector(
                onTap: () => onStarTap(i + 1),
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 6),
                  child: Icon(
                    i < stars ? Icons.star_rounded : Icons.star_outline_rounded,
                    size: 40,
                    color:
                        i < stars ? const Color(0xFFFFC107) : AppTheme.divider,
                  ),
                ),
              ),
            ),
          ),
        ),
        const SizedBox(height: 24),
        // 태그
        const Text('어떤 점이 좋았나요? (선택)',
            style: TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w700,
                color: AppTheme.textSecondary)),
        const SizedBox(height: 10),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: _ratingTags
              .map((tag) => _TagChip(
                    label: tag,
                    selected: selectedTags.contains(tag),
                    onTap: () => onTagToggle(tag),
                  ))
              .toList(),
        ),
        const SizedBox(height: 28),
        SizedBox(
          width: double.infinity,
          child: DecoratedBox(
            decoration: BoxDecoration(
              gradient: stars > 0
                  ? AppTheme.primaryGradient
                  : const LinearGradient(
                      colors: [Color(0xFFCCC8C5), Color(0xFFCCC8C5)]),
              borderRadius: BorderRadius.circular(14),
            ),
            child: Material(
              color: Colors.transparent,
              child: InkWell(
                onTap: stars > 0 && !isSubmitting ? onSubmit : null,
                borderRadius: BorderRadius.circular(14),
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 15),
                  child: isSubmitting
                      ? const Center(
                          child: SizedBox(
                            width: 20,
                            height: 20,
                            child: CircularProgressIndicator(
                                color: Colors.white, strokeWidth: 2.5),
                          ),
                        )
                      : const Center(
                          child: Text('평가 제출',
                              style: TextStyle(
                                  fontSize: 16,
                                  fontWeight: FontWeight.w700,
                                  color: Colors.white)),
                        ),
                ),
              ),
            ),
          ),
        ),
      ],
    );
  }
}

class _TagChip extends StatelessWidget {
  final String label;
  final bool selected;
  final VoidCallback onTap;

  const _TagChip(
      {required this.label, required this.selected, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
        decoration: BoxDecoration(
          color: selected
              ? AppTheme.primary.withValues(alpha: 0.1)
              : AppTheme.surface,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(
            color: selected ? AppTheme.primary : AppTheme.divider,
          ),
        ),
        child: Text(label,
            style: TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w600,
                color: selected ? AppTheme.primary : AppTheme.textSecondary)),
      ),
    );
  }
}

class _SubmittedView extends StatelessWidget {
  final VoidCallback onClose;
  const _SubmittedView({required this.onClose});

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        const SizedBox(height: 16),
        const Text('⭐', style: TextStyle(fontSize: 48)),
        const SizedBox(height: 12),
        const Text('평가가 완료됐어요!',
            style: TextStyle(
                fontSize: 18,
                fontWeight: FontWeight.w800,
                color: AppTheme.textPrimary)),
        const SizedBox(height: 8),
        const Text('소중한 의견 감사해요',
            style: TextStyle(fontSize: 14, color: AppTheme.textSecondary)),
        const SizedBox(height: 28),
        SizedBox(
          width: double.infinity,
          child: OutlinedButton(
            onPressed: onClose,
            style: OutlinedButton.styleFrom(
              padding: const EdgeInsets.symmetric(vertical: 14),
              side: const BorderSide(color: AppTheme.divider),
              shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(14)),
            ),
            child: const Text('닫기',
                style: TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w600,
                    color: AppTheme.textSecondary)),
          ),
        ),
      ],
    );
  }
}
