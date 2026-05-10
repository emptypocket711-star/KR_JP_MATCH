import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:firebase_auth/firebase_auth.dart';
import '../domain/chat_message.dart';
import 'chat_provider.dart';
import '../../safety/presentation/report_bottom_sheet.dart';
import '../../safety/presentation/block_confirm_dialog.dart';
import '../../matches/domain/match.dart';
import '../../../app/theme/app_theme.dart';
import '../../discovery/presentation/discovery_provider.dart';

const _icebreakers = [
  '좋아하는 한국/일본 음식이 뭐예요?',
  '일본어/한국어 공부는 얼마나 됐어요?',
  '한국/일본에서 가보고 싶은 곳이 있어요?',
  '좋아하는 K-pop이나 애니메이션이 있나요?',
  '주말에 보통 뭐 하세요?',
  '어떤 계기로 상대 나라에 관심이 생겼어요?',
];

const _randomQuestions = [
  '만약 한국/일본에서 살 수 있다면 어느 도시에 살고 싶어요?',
  '지금 가장 듣고 있는 노래가 뭐예요?',
  '버킷리스트 중 하나를 알려줘요!',
  '음식을 고른다면 한식 vs 일식, 어느 쪽?',
  '여행을 좋아해요? 가장 기억에 남는 여행은?',
  '지금 이 순간 가장 먹고 싶은 게 뭐예요?',
  '아침형 인간이에요, 저녁형 인간이에요?',
];

class ChatScreen extends ConsumerStatefulWidget {
  final String matchId;
  const ChatScreen({required this.matchId, super.key});

  @override
  ConsumerState<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends ConsumerState<ChatScreen> {
  final _messageController = TextEditingController();
  bool _showIcebreakers = true;

  @override
  void dispose() {
    _messageController.dispose();
    super.dispose();
  }

  String _getTargetUid(Match match, String currentUid) =>
      match.userIds.firstWhere((id) => id != currentUid, orElse: () => '');

  void _sendMessage(String text) {
    if (text.trim().isEmpty) return;
    ref
        .read(sendMessageProvider((widget.matchId, text)).future)
        .then((_) => _messageController.clear())
        .catchError((e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('$e')));
      }
    });
    setState(() => _showIcebreakers = false);
  }

  void _showRandomQuestion() {
    final q = List.from(_randomQuestions)..shuffle();
    _messageController.text = q.first as String;
    _messageController.selection = TextSelection.fromPosition(
        TextPosition(offset: _messageController.text.length));
  }

  @override
  Widget build(BuildContext context) {
    final messagesAsync = ref.watch(chatMessagesProvider(widget.matchId));
    final matchAsync = ref.watch(matchProvider(widget.matchId));
    final currentUser = FirebaseAuth.instance.currentUser;

    final match = matchAsync.asData?.value;
    final targetUid = match != null && currentUser != null
        ? _getTargetUid(match, currentUser.uid)
        : '';
    final partnerName = match != null && currentUser != null
        ? match.partnerName(currentUser.uid)
        : '상대방';

    return Scaffold(
      backgroundColor: AppTheme.background,
      appBar: _ChatAppBar(
        partnerName: partnerName,
        targetUid: targetUid,
        matchId: widget.matchId,
      ),
      body: Column(
        children: [
          Expanded(
            child: messagesAsync.when(
              data: (msgs) {
                if (msgs.isEmpty && _showIcebreakers) {
                  return _IcebreakersView(
                    onSelect: (text) {
                      _messageController.text = text;
                      setState(() => _showIcebreakers = false);
                    },
                  );
                }
                return ListView.builder(
                  reverse: true,
                  padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
                  itemCount: msgs.length,
                  itemBuilder: (_, i) => _MessageBubble(
                    message: msgs[i],
                    isCurrentUser: msgs[i].senderId == currentUser?.uid,
                  ),
                );
              },
              loading: () => const Center(child: CircularProgressIndicator()),
              error: (e, _) => Center(child: Text('$e')),
            ),
          ),
          _InputBar(
            controller: _messageController,
            onSend: _sendMessage,
            onRandomQuestion: _showRandomQuestion,
          ),
        ],
      ),
    );
  }
}

// ── AppBar ────────────────────────────────────────────────
class _ChatAppBar extends ConsumerWidget implements PreferredSizeWidget {
  final String partnerName;
  final String targetUid;
  final String matchId;

  const _ChatAppBar({
    required this.partnerName,
    required this.targetUid,
    required this.matchId,
  });

  @override
  Size get preferredSize => const Size.fromHeight(56);

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    void leaveChatAfterSafetyAction() {
      if (targetUid.isNotEmpty) {
        ref.read(discoveryStateProvider.notifier).removeCandidate(targetUid);
      }
      context.go('/chats');
    }

    Future<void> leaveChat() async {
      final confirmed = await showDialog<bool>(
        context: context,
        builder: (_) => AlertDialog(
          title: const Text('채팅방 나가기'),
          content: const Text('채팅방을 나가면 양쪽 채팅 목록에서 대화방이 사라집니다. 계속할까요?'),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('취소'),
            ),
            TextButton(
              onPressed: () => Navigator.pop(context, true),
              child: const Text('나가기', style: TextStyle(color: Colors.red)),
            ),
          ],
        ),
      );

      if (confirmed != true) return;
      await ref.read(leaveChatProvider(matchId).future);
      if (context.mounted) context.go('/chats');
    }

    return AppBar(
      backgroundColor: AppTheme.background,
      elevation: 0,
      leading: IconButton(
        icon: const Icon(Icons.arrow_back, color: AppTheme.textPrimary),
        onPressed: () => context.pop(),
      ),
      title: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(partnerName,
              style: const TextStyle(
                  fontFamily: 'MaruBuri',
                  fontSize: 16,
                  fontWeight: FontWeight.w600,
                  color: AppTheme.textPrimary)),
          const Text('KR → JP',
              style: TextStyle(
                  fontSize: 11,
                  color: AppTheme.textSecondary,
                  fontWeight: FontWeight.w400)),
        ],
      ),
      actions: [
        IconButton(
          icon: const Icon(Icons.search, color: AppTheme.textPrimary, size: 22),
          onPressed: () {},
        ),
        PopupMenuButton(
          icon: const Icon(Icons.more_vert,
              color: AppTheme.textPrimary, size: 22),
          onSelected: (value) {
            if (value == 'leave') {
              leaveChat();
            } else if (value == 'report') {
              if (targetUid.isEmpty) return;
              showModalBottomSheet(
                context: context,
                builder: (_) => ReportBottomSheet(
                  targetUid: targetUid,
                  matchId: matchId,
                  onReported: leaveChatAfterSafetyAction,
                ),
              );
            } else if (value == 'block') {
              if (targetUid.isEmpty) return;
              showDialog(
                context: context,
                builder: (_) => BlockConfirmDialog(
                  targetUid: targetUid,
                  onConfirm: leaveChatAfterSafetyAction,
                ),
              );
            }
          },
          itemBuilder: (_) => const [
            PopupMenuItem(value: 'leave', child: Text('채팅방 나가기')),
            PopupMenuItem(value: 'report', child: Text('신고하기')),
            PopupMenuItem(value: 'block', child: Text('차단하기')),
          ],
        ),
      ],
      bottom: const PreferredSize(
        preferredSize: Size.fromHeight(1),
        child: Divider(height: 1, color: AppTheme.divider),
      ),
    );
  }
}

// ── 메시지 버블 — "번역 보기" 토글 ───────────────────────
class _MessageBubble extends StatefulWidget {
  final ChatMessage message;
  final bool isCurrentUser;

  const _MessageBubble({required this.message, required this.isCurrentUser});

  @override
  State<_MessageBubble> createState() => _MessageBubbleState();
}

class _MessageBubbleState extends State<_MessageBubble> {
  bool _showTranslation = false;

  bool get _hasTranslation =>
      widget.message.translationStatus == 'done' &&
      (widget.message.translations['ja'] != null ||
          widget.message.translations['ko'] != null);

  String get _translatedText =>
      widget.message.translations['ja'] ??
      widget.message.translations['ko'] ??
      '';

  @override
  Widget build(BuildContext context) {
    final isMe = widget.isCurrentUser;

    return Align(
      alignment: isMe ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        margin: EdgeInsets.only(
          left: isMe ? 56 : 0,
          right: isMe ? 0 : 56,
          bottom: 12,
        ),
        child: Column(
          crossAxisAlignment:
              isMe ? CrossAxisAlignment.end : CrossAxisAlignment.start,
          children: [
            // 원문 버블
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
              decoration: BoxDecoration(
                color: isMe ? AppTheme.primary : AppTheme.cardBg,
                borderRadius: BorderRadius.only(
                  topLeft: const Radius.circular(16),
                  topRight: const Radius.circular(16),
                  bottomLeft: Radius.circular(isMe ? 16 : 4),
                  bottomRight: Radius.circular(isMe ? 4 : 16),
                ),
                boxShadow: [
                  BoxShadow(
                    color: Colors.black.withValues(alpha: 0.06),
                    blurRadius: 6,
                    offset: const Offset(0, 2),
                  ),
                ],
              ),
              child: Text(
                widget.message.originalText,
                style: TextStyle(
                    fontSize: 15,
                    color: isMe ? Colors.white : AppTheme.textPrimary,
                    height: 1.4),
              ),
            ),
            // 번역 토글 / 번역 내용
            if (_hasTranslation) ...[
              const SizedBox(height: 4),
              if (_showTranslation)
                // 번역 버블
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                  decoration: BoxDecoration(
                    color: isMe
                        ? AppTheme.primaryLight.withValues(alpha: 0.3)
                        : AppTheme.surface,
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(color: AppTheme.divider),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const Text('✦ ',
                              style: TextStyle(
                                  fontSize: 10, color: AppTheme.primary)),
                          const Text('번역',
                              style: TextStyle(
                                  fontSize: 10,
                                  color: AppTheme.primary,
                                  fontWeight: FontWeight.w600)),
                        ],
                      ),
                      const SizedBox(height: 4),
                      Text(_translatedText,
                          style: const TextStyle(
                              fontSize: 13,
                              color: AppTheme.textSecondary,
                              height: 1.4,
                              fontStyle: FontStyle.italic)),
                    ],
                  ),
                ),
              // 토글 버튼
              GestureDetector(
                onTap: () =>
                    setState(() => _showTranslation = !_showTranslation),
                child: Padding(
                  padding: const EdgeInsets.only(top: 2),
                  child: Text(
                    _showTranslation ? '번역 숨기기' : '번역 보기',
                    style: const TextStyle(
                        fontSize: 11,
                        color: AppTheme.primary,
                        fontWeight: FontWeight.w600),
                  ),
                ),
              ),
            ] else if (widget.message.translationStatus == 'pending') ...[
              const SizedBox(height: 4),
              Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  SizedBox(
                    width: 10,
                    height: 10,
                    child: CircularProgressIndicator(
                        strokeWidth: 1.5,
                        color: isMe
                            ? AppTheme.primaryLight
                            : AppTheme.textSecondary),
                  ),
                  const SizedBox(width: 6),
                  const Text('번역 중...',
                      style: TextStyle(
                          fontSize: 11, color: AppTheme.textSecondary)),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }
}

// ── 아이스브레이커 ─────────────────────────────────────────
class _IcebreakersView extends StatelessWidget {
  final Function(String) onSelect;
  const _IcebreakersView({required this.onSelect});

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) => SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: ConstrainedBox(
          constraints: BoxConstraints(minHeight: constraints.maxHeight - 48),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Text('🌸', style: TextStyle(fontSize: 48)),
              const SizedBox(height: 12),
              const Text('매칭을 축하해요!',
                  style: TextStyle(
                      fontSize: 20,
                      fontWeight: FontWeight.w800,
                      color: AppTheme.textPrimary)),
              const SizedBox(height: 6),
              const Text('먼저 말을 걸어보세요 😊',
                  style:
                      TextStyle(fontSize: 14, color: AppTheme.textSecondary)),
              const SizedBox(height: 28),
              const Align(
                alignment: Alignment.centerLeft,
                child: Text('추천 첫 마디',
                    style: TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w700,
                        color: AppTheme.primary)),
              ),
              const SizedBox(height: 10),
              ..._icebreakers.take(4).map((text) => GestureDetector(
                    onTap: () => onSelect(text),
                    child: Container(
                      width: double.infinity,
                      margin: const EdgeInsets.only(bottom: 8),
                      padding: const EdgeInsets.symmetric(
                          horizontal: 16, vertical: 13),
                      decoration: BoxDecoration(
                        color: AppTheme.cardBg,
                        borderRadius: BorderRadius.circular(14),
                        border: Border.all(
                            color: AppTheme.primary.withValues(alpha: 0.2)),
                        boxShadow: [
                          BoxShadow(
                              color: Colors.black.withValues(alpha: 0.04),
                              blurRadius: 6,
                              offset: const Offset(0, 2)),
                        ],
                      ),
                      child: Row(
                        children: [
                          Expanded(
                              child: Text(text,
                                  style: const TextStyle(
                                      fontSize: 14,
                                      color: AppTheme.textPrimary))),
                          const Icon(Icons.arrow_forward_ios,
                              size: 13, color: AppTheme.primary),
                        ],
                      ),
                    ),
                  )),
            ],
          ),
        ),
      ),
    );
  }
}

// ── 입력창 ────────────────────────────────────────────────
class _InputBar extends StatelessWidget {
  final TextEditingController controller;
  final Function(String) onSend;
  final VoidCallback onRandomQuestion;

  const _InputBar({
    required this.controller,
    required this.onSend,
    required this.onRandomQuestion,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        color: AppTheme.cardBg,
        border: Border(top: BorderSide(color: AppTheme.divider)),
      ),
      padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
      child: SafeArea(
        top: false,
        child: Row(
          children: [
            // 랜덤 질문 버튼
            GestureDetector(
              onTap: onRandomQuestion,
              child: Container(
                width: 38,
                height: 38,
                decoration: BoxDecoration(
                  color: AppTheme.surface,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: const Icon(Icons.casino_outlined,
                    color: AppTheme.primary, size: 18),
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: TextField(
                controller: controller,
                maxLines: null,
                textInputAction: TextInputAction.send,
                onSubmitted: onSend,
                decoration: InputDecoration(
                  hintText: '메시지를 입력하세요...',
                  filled: true,
                  fillColor: AppTheme.surface,
                  contentPadding:
                      const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(24),
                    borderSide: BorderSide.none,
                  ),
                ),
              ),
            ),
            const SizedBox(width: 8),
            GestureDetector(
              onTap: () => onSend(controller.text),
              child: Container(
                width: 38,
                height: 38,
                decoration: BoxDecoration(
                  color: AppTheme.primary,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: const Icon(Icons.send, color: Colors.white, size: 17),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
