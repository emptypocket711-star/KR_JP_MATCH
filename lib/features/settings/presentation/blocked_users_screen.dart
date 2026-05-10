import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../safety/presentation/safety_provider.dart';
import '../../../app/theme/app_theme.dart';
import '../../../core/widgets/default_avatar.dart';
import '../../../core/widgets/nationality_badge.dart';

class BlockedUsersScreen extends ConsumerWidget {
  const BlockedUsersScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final uid = FirebaseAuth.instance.currentUser?.uid;

    return Scaffold(
      backgroundColor: AppTheme.background,
      appBar: AppBar(
        backgroundColor: AppTheme.background,
        title: const Text('차단 목록'),
      ),
      body: uid == null
          ? const Center(child: Text('로그인이 필요합니다.'))
          : StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
              stream: FirebaseFirestore.instance
                  .collection('users')
                  .doc(uid)
                  .collection('blocks')
                  .orderBy('blockedAt', descending: true)
                  .snapshots(),
              builder: (context, snapshot) {
                if (snapshot.connectionState == ConnectionState.waiting) {
                  return const Center(child: CircularProgressIndicator());
                }

                final docs = snapshot.data?.docs ?? [];
                if (docs.isEmpty) {
                  return const Center(
                    child: Text(
                      '차단한 사용자가 없습니다.',
                      style: TextStyle(color: AppTheme.textSecondary),
                    ),
                  );
                }

                return ListView.separated(
                  padding: const EdgeInsets.all(16),
                  itemCount: docs.length,
                  separatorBuilder: (_, __) => const SizedBox(height: 10),
                  itemBuilder: (context, index) {
                    final doc = docs[index];
                    return _BlockedUserTile(
                      targetUid: doc.id,
                      data: doc.data(),
                      onUnblock: () async {
                        await ref
                            .read(safetyRepositoryProvider)
                            .unblockUser(doc.id);
                        if (context.mounted) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(content: Text('차단을 해제했습니다.')),
                          );
                        }
                      },
                    );
                  },
                );
              },
            ),
    );
  }
}

class _BlockedUserTile extends StatefulWidget {
  final String targetUid;
  final Map<String, dynamic> data;
  final Future<void> Function() onUnblock;

  const _BlockedUserTile({
    required this.targetUid,
    required this.data,
    required this.onUnblock,
  });

  @override
  State<_BlockedUserTile> createState() => _BlockedUserTileState();
}

class _BlockedUserTileState extends State<_BlockedUserTile> {
  bool _isLoading = false;

  @override
  Widget build(BuildContext context) {
    final displayName = widget.data['displayName'] as String? ?? '사용자';
    final photoUrl = widget.data['photoUrl'] as String? ?? '';
    final nationality = widget.data['nationality'] as String? ?? 'KR';
    final gender = widget.data['gender'] as String? ?? 'female';

    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppTheme.cardBg,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppTheme.divider),
      ),
      child: Row(
        children: [
          Stack(
            children: [
              if (photoUrl.isNotEmpty)
                CircleAvatar(
                  radius: 24,
                  backgroundImage: NetworkImage(photoUrl),
                  backgroundColor: AppTheme.surface,
                )
              else
                DefaultAvatarCircle(
                  nationality: nationality,
                  gender: gender,
                  radius: 24,
                ),
              Positioned(
                right: 0,
                bottom: 0,
                child: NationalityBadge(
                  nationality: nationality,
                  fontSize: 8,
                  padding:
                      const EdgeInsets.symmetric(horizontal: 5, vertical: 2),
                ),
              ),
            ],
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              displayName,
              style: const TextStyle(
                fontSize: 15,
                fontWeight: FontWeight.w700,
                color: AppTheme.textPrimary,
              ),
            ),
          ),
          TextButton(
            onPressed: _isLoading
                ? null
                : () async {
                    setState(() => _isLoading = true);
                    try {
                      await widget.onUnblock();
                    } finally {
                      if (mounted) setState(() => _isLoading = false);
                    }
                  },
            child: _isLoading
                ? const SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Text('해제'),
          ),
        ],
      ),
    );
  }
}
