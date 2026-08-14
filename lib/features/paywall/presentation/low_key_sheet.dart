import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../app/theme/app_theme.dart';
import '../../../core/i18n/ui_text.dart';

class LowKeySheet extends StatelessWidget {
  const LowKeySheet({super.key});

  static Future<void> show(BuildContext context) {
    return showModalBottomSheet(
      context: context,
      backgroundColor: Colors.transparent,
      builder: (_) => const LowKeySheet(),
    );
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
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 36,
            height: 4,
            margin: const EdgeInsets.only(bottom: 20),
            decoration: BoxDecoration(
              color: AppTheme.divider,
              borderRadius: BorderRadius.circular(2),
            ),
          ),
          Container(
            width: 64,
            height: 64,
            decoration: BoxDecoration(
              color: AppTheme.primary.withValues(alpha: 0.1),
              shape: BoxShape.circle,
            ),
            child: const Icon(Icons.key_rounded,
                size: 32, color: AppTheme.primary),
          ),
          const SizedBox(height: 16),
          Text(
            context.t('열쇠가 없어요', '鍵がありません'),
            style: const TextStyle(
                fontSize: 20,
                fontWeight: FontWeight.w800,
                color: AppTheme.textPrimary),
          ),
          const SizedBox(height: 8),
          Text(
            context.t(
              '대화를 시작하려면 열쇠가 필요해요.\n오늘 아직 보상을 받지 않았다면 라운지에 첫 글을 작성하고 열쇠 3개를 받을 수 있어요.',
              '会話を始めるには鍵が必要です。\n今日まだボーナスを受け取っていない場合、ラウンジへの最初の投稿で鍵を3個受け取れます。',
            ),
            textAlign: TextAlign.center,
            style: const TextStyle(
                fontSize: 14, color: AppTheme.textSecondary, height: 1.5),
          ),
          const SizedBox(height: 28),
          SizedBox(
            width: double.infinity,
            child: DecoratedBox(
              decoration: BoxDecoration(
                gradient: AppTheme.primaryGradient,
                borderRadius: BorderRadius.circular(14),
              ),
              child: Material(
                color: Colors.transparent,
                child: InkWell(
                  borderRadius: BorderRadius.circular(14),
                  onTap: () {
                    Navigator.pop(context);
                    context.push('/paywall');
                  },
                  child: Padding(
                    padding: const EdgeInsets.symmetric(vertical: 15),
                    child: Center(
                      child: Text(
                        context.t('열쇠 받는 방법 보기', '鍵の入手方法を見る'),
                        style: const TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.w700,
                            color: Colors.white),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
          const SizedBox(height: 12),
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: Text(
              context.t('닫기', '閉じる'),
              style: const TextStyle(
                  fontSize: 15,
                  color: AppTheme.textSecondary,
                  fontWeight: FontWeight.w500),
            ),
          ),
        ],
      ),
    );
  }
}
