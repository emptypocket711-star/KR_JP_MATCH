import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../domain/lounge_post.dart';
import 'lounge_provider.dart';
import '../../../app/theme/app_theme.dart';

class LoungeComposeScreen extends ConsumerStatefulWidget {
  const LoungeComposeScreen({super.key});

  @override
  ConsumerState<LoungeComposeScreen> createState() =>
      _LoungeComposeScreenState();
}

class _LoungeComposeScreenState extends ConsumerState<LoungeComposeScreen> {
  final _contentCtrl = TextEditingController();
  String _selectedCategory = '일상';
  bool _isPosting = false;

  @override
  void dispose() {
    _contentCtrl.dispose();
    super.dispose();
  }

  Future<void> _post() async {
    final content = _contentCtrl.text.trim();
    if (content.isEmpty) return;

    setState(() => _isPosting = true);
    try {
      await ref.read(loungeProvider.notifier).createPost(
            content: content,
            category: _selectedCategory,
          );
      if (mounted) context.pop();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('게시 실패: $e')));
      }
    } finally {
      if (mounted) setState(() => _isPosting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final canPost = _contentCtrl.text.trim().isNotEmpty && !_isPosting;

    return Scaffold(
      backgroundColor: AppTheme.background,
      appBar: AppBar(
        title: const Text('글쓰기'),
        leading: IconButton(
          icon: const Icon(Icons.close),
          onPressed: () => context.pop(),
        ),
        actions: [
          Padding(
            padding: const EdgeInsets.only(right: 12),
            child: TextButton(
              onPressed: canPost ? _post : null,
              child: _isPosting
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Text('게시',
                      style: TextStyle(
                          color: AppTheme.primary,
                          fontWeight: FontWeight.w700,
                          fontSize: 16)),
            ),
          ),
        ],
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // 카테고리 선택
            const Text('카테고리',
                style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                    color: AppTheme.textSecondary)),
            const SizedBox(height: 10),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: loungeCategories.skip(1).map((cat) {
                final selected = cat == _selectedCategory;
                return GestureDetector(
                  onTap: () => setState(() => _selectedCategory = cat),
                  child: AnimatedContainer(
                    duration: const Duration(milliseconds: 150),
                    padding:
                        const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                    decoration: BoxDecoration(
                      color: selected ? AppTheme.primary : AppTheme.surface,
                      borderRadius: BorderRadius.circular(20),
                      border: Border.all(
                          color:
                              selected ? AppTheme.primary : AppTheme.divider),
                    ),
                    child: Text(cat,
                        style: TextStyle(
                            fontSize: 13,
                            fontWeight: FontWeight.w600,
                            color: selected
                                ? Colors.white
                                : AppTheme.textPrimary)),
                  ),
                );
              }).toList(),
            ),
            const SizedBox(height: 20),
            const Divider(color: AppTheme.divider),
            const SizedBox(height: 16),
            // 본문 입력
            TextField(
              controller: _contentCtrl,
              maxLength: 1000,
              maxLines: 12,
              onChanged: (_) => setState(() {}),
              decoration: InputDecoration(
                hintText: '한국어나 일본어로 자유롭게 이야기해보세요.\n한국と日本をつなぐ話を書いてみてください。',
                hintStyle: const TextStyle(
                    color: AppTheme.textSecondary, fontSize: 14, height: 1.6),
                border: InputBorder.none,
                enabledBorder: InputBorder.none,
                focusedBorder: InputBorder.none,
                fillColor: Colors.transparent,
                counterStyle: const TextStyle(
                    color: AppTheme.textSecondary, fontSize: 12),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
