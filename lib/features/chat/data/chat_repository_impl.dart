import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_auth/firebase_auth.dart';
import '../domain/chat_repository.dart';
import '../domain/chat_message.dart';

class ChatRepositoryImpl implements ChatRepository {
  final _firestore = FirebaseFirestore.instance;
  final _functions = FirebaseFunctions.instance;

  @override
  Stream<List<ChatMessage>> watchMessages(String matchId) {
    return _firestore
        .collection('matches')
        .doc(matchId)
        .collection('messages')
        .orderBy('createdAt', descending: true)
        .snapshots()
        .map((snapshot) => snapshot.docs
            .map((doc) =>
                ChatMessage.fromMap({...doc.data(), 'messageId': doc.id}))
            .toList());
  }

  @override
  Future<String> sendMessage(String matchId, String originalText) async {
    final user = FirebaseAuth.instance.currentUser;
    if (user == null) throw Exception('Login is required');

    // 직접 Firestore 쓰기 (번역은 onMessageCreated 트리거가 처리)
    final messageRef = _firestore
        .collection('matches')
        .doc(matchId)
        .collection('messages')
        .doc();

    await messageRef.set({
      'messageId': messageRef.id,
      'senderId': user.uid,
      'createdAt': FieldValue.serverTimestamp(),
      'originalText': originalText,
      'originalLang': 'unknown',
      'translations': {'ko': null, 'ja': null},
      'translationStatus': 'pending',
      'deletedForSender': false,
    });

    await _firestore.collection('matches').doc(matchId).update({
      'lastMessageAt': FieldValue.serverTimestamp(),
      'lastMessagePreview': originalText.length > 50
          ? '${originalText.substring(0, 50)}...'
          : originalText,
      'updatedAt': FieldValue.serverTimestamp(),
    });

    return messageRef.id;
  }

  @override
  Future<void> leaveChat(String matchId) async {
    await _functions.httpsCallable('leaveChat').call({'matchId': matchId});
  }

  @override
  Future<void> setChatFavorite(String matchId, bool favorite) async {
    await _functions.httpsCallable('setChatFavorite').call({
      'matchId': matchId,
      'favorite': favorite,
    });
  }
}
