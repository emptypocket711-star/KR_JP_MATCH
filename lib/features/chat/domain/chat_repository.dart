import 'chat_message.dart';

abstract class ChatRepository {
  Stream<List<ChatMessage>> watchMessages(String matchId);

  Future<String> sendMessage(String matchId, String originalText);

  Future<void> leaveChat(String matchId);

  Future<void> setChatFavorite(String matchId, bool favorite);
}
