import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'safety_provider.dart';

class BlockConfirmDialog extends ConsumerWidget {
  final String targetUid;
  final VoidCallback? onConfirm;

  const BlockConfirmDialog(
      {required this.targetUid, this.onConfirm, super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return AlertDialog(
      title: const Text('사용자 차단'),
      content: const Text('이 사용자를 차단하시겠습니까?\n\n차단하면 더 이상 대화할 수 없습니다.'),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('취소'),
        ),
        TextButton(
          onPressed: () async {
            try {
              final repository = ref.read(safetyRepositoryProvider);
              await repository.blockUser(targetUid);
              if (context.mounted) {
                Navigator.pop(context);
                onConfirm?.call();
                ScaffoldMessenger.of(
                  context,
                ).showSnackBar(const SnackBar(content: Text('사용자가 차단되었습니다')));
              }
            } catch (e) {
              if (context.mounted) {
                ScaffoldMessenger.of(
                  context,
                ).showSnackBar(SnackBar(content: Text('차단 실패: $e')));
              }
            }
          },
          child: const Text('차단', style: TextStyle(color: Colors.red)),
        ),
      ],
    );
  }
}
