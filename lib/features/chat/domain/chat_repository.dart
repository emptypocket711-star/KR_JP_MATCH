import 'chat_message.dart';
import '../../matches/domain/match.dart';

abstract class ChatRepository {
  Stream<List<ChatMessage>> watchMessages(String matchId);

  Future<Match> getMatch(String matchId);

  Future<String> sendMessage(
    String matchId,
    String originalText, {
    String? clientRequestId,
  });

  Future<String> sendImage(
    String matchId,
    String localPath, {
    String? clientRequestId,
  });

  Future<void> leaveChat(String matchId);

  Future<void> setChatFavorite(String matchId, bool favorite);
}
