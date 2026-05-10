import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../data/chat_repository_impl.dart';
import '../domain/chat_repository.dart';
import '../domain/chat_message.dart';
import '../../matches/domain/match.dart';

final chatRepositoryProvider = Provider<ChatRepository>((ref) {
  return ChatRepositoryImpl();
});

final chatMessagesProvider = StreamProvider.family<List<ChatMessage>, String>((
  ref,
  matchId,
) {
  final repository = ref.watch(chatRepositoryProvider);
  return repository.watchMessages(matchId);
});

final sendMessageProvider = FutureProvider.family<String, (String, String)>((
  ref,
  args,
) async {
  final (matchId, message) = args;
  final repository = ref.watch(chatRepositoryProvider);
  return repository.sendMessage(matchId, message);
});

final leaveChatProvider = FutureProvider.family<void, String>((ref, matchId) {
  final repository = ref.watch(chatRepositoryProvider);
  return repository.leaveChat(matchId);
});

final setChatFavoriteProvider =
    FutureProvider.family<void, (String, bool)>((ref, args) {
  final (matchId, favorite) = args;
  final repository = ref.watch(chatRepositoryProvider);
  return repository.setChatFavorite(matchId, favorite);
});

final matchProvider = FutureProvider.family<Match, String>((
  ref,
  matchId,
) async {
  final snap =
      await FirebaseFirestore.instance.collection('matches').doc(matchId).get();
  if (!snap.exists) throw Exception('Match not found');
  return Match.fromMap({...snap.data()!, 'matchId': snap.id});
});
