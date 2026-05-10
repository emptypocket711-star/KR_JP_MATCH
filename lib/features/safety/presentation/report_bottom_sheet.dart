import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'safety_provider.dart';

class ReportBottomSheet extends ConsumerStatefulWidget {
  final String targetUid;
  final String? matchId;
  final VoidCallback? onReported;

  const ReportBottomSheet({
    required this.targetUid,
    this.matchId,
    this.onReported,
    super.key,
  });

  @override
  ConsumerState<ReportBottomSheet> createState() => _ReportBottomSheetState();
}

class _ReportBottomSheetState extends ConsumerState<ReportBottomSheet> {
  String? _selectedReason;
  final _memoController = TextEditingController();
  bool _isSubmitting = false;

  @override
  void dispose() {
    _memoController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_selectedReason == null) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('신고 이유를 선택해주세요')));
      return;
    }

    setState(() => _isSubmitting = true);

    try {
      final repository = ref.read(safetyRepositoryProvider);
      await repository.reportUser(
        widget.targetUid,
        _selectedReason!,
        note: _memoController.text,
        matchId: widget.matchId,
      );

      if (mounted) {
        Navigator.pop(context);
        widget.onReported?.call();
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(const SnackBar(content: Text('신고가 접수되었습니다')));
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text('신고 접수 실패: $e')));
      }
    } finally {
      if (mounted) {
        setState(() => _isSubmitting = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      child: Padding(
        padding: EdgeInsets.only(
          left: 16,
          right: 16,
          top: 16,
          bottom: MediaQuery.of(context).viewInsets.bottom + 16,
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              '이 사용자를 신고하는 이유',
              style: Theme.of(context).textTheme.headlineSmall,
            ),
            const SizedBox(height: 16),
            _buildReasonTile('spam', '스팸'),
            _buildReasonTile('harassment', '괴롭힘'),
            _buildReasonTile('inappropriate_photo', '부적절한 사진'),
            _buildReasonTile('fake_profile', '가짜 프로필'),
            _buildReasonTile('other', '기타'),
            const SizedBox(height: 24),
            Text('추가 설명 (선택)', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 8),
            TextField(
              controller: _memoController,
              maxLength: 1000,
              maxLines: 4,
              decoration: InputDecoration(
                hintText: '신고 사유에 대한 자세한 설명을 작성해주세요',
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(8),
                ),
              ),
            ),
            const SizedBox(height: 24),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                onPressed: _isSubmitting ? null : _submit,
                child: _isSubmitting
                    ? const SizedBox(
                        height: 20,
                        width: 20,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Text('신고하기'),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildReasonTile(String value, String label) {
    return ListTile(
      contentPadding: EdgeInsets.zero,
      title: Text(label),
      leading: Radio<String>(
        value: value,
        groupValue: _selectedReason,
        onChanged: (newValue) {
          setState(() => _selectedReason = newValue);
        },
      ),
    );
  }
}
