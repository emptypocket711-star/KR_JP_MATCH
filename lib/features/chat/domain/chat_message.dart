import 'package:cloud_firestore/cloud_firestore.dart';

class ChatMessage {
  final String messageId;
  final String senderId;
  final DateTime createdAt;
  final String originalText;
  final String originalLang;
  final Map<String, String?> translations;
  final String translationStatus;
  final bool deletedForSender;

  ChatMessage({
    required this.messageId,
    required this.senderId,
    required this.createdAt,
    required this.originalText,
    required this.originalLang,
    this.translations = const {},
    this.translationStatus = 'pending',
    this.deletedForSender = false,
  });

  factory ChatMessage.fromMap(Map<String, dynamic> data) {
    return ChatMessage(
      messageId: data['messageId'] as String,
      senderId: data['senderId'] as String,
      createdAt: data['createdAt'] is Timestamp
          ? (data['createdAt'] as Timestamp).toDate()
          : DateTime.tryParse(data['createdAt']?.toString() ?? '') ??
              DateTime.now(),
      originalText: data['originalText'] as String,
      originalLang: data['originalLang'] as String? ?? 'unknown',
      translations: Map<String, String?>.from(
        (data['translations'] as Map?) ?? {},
      ),
      translationStatus: data['translationStatus'] as String? ?? 'pending',
      deletedForSender: data['deletedForSender'] as bool? ?? false,
    );
  }

  Map<String, dynamic> toMap() {
    return {
      'messageId': messageId,
      'senderId': senderId,
      'createdAt': createdAt.toIso8601String(),
      'originalText': originalText,
      'originalLang': originalLang,
      'translations': translations,
      'translationStatus': translationStatus,
      'deletedForSender': deletedForSender,
    };
  }
}
