import 'package:cloud_firestore/cloud_firestore.dart';

class ChatMessage {
  final String messageId;
  final String senderId;
  final DateTime createdAt;
  final String messageType;
  final String originalText;
  final String originalLang;
  final Map<String, String?> translations;
  final String translationStatus;
  final bool deletedForSender;
  final String? imagePath;
  final String? imageUrl;
  final bool mediaDeleted;

  ChatMessage({
    required this.messageId,
    required this.senderId,
    required this.createdAt,
    this.messageType = 'text',
    required this.originalText,
    required this.originalLang,
    this.translations = const {},
    this.translationStatus = 'pending',
    this.deletedForSender = false,
    this.imagePath,
    this.imageUrl,
    this.mediaDeleted = false,
  });

  bool get isImage => messageType == 'image';

  String get imageReference {
    if (mediaDeleted) return '';
    final canonicalPath = imagePath?.trim() ?? '';
    if (canonicalPath.isNotEmpty) return canonicalPath;
    return imageUrl?.trim() ?? '';
  }

  factory ChatMessage.fromMap(Map<String, dynamic> data) {
    final imagePath = data['imagePath'] as String?;
    final imageUrl = data['imageUrl'] as String?;
    final storedMessageType = data['messageType'] as String?;
    return ChatMessage(
      messageId: data['messageId'] as String? ?? '',
      senderId: data['senderId'] as String? ?? '',
      createdAt: data['createdAt'] is Timestamp
          ? (data['createdAt'] as Timestamp).toDate()
          : DateTime.tryParse(data['createdAt']?.toString() ?? '') ??
              DateTime.now(),
      messageType: storedMessageType ??
          ((imagePath?.isNotEmpty ?? false) || (imageUrl?.isNotEmpty ?? false)
              ? 'image'
              : 'text'),
      originalText: data['originalText'] as String? ?? '',
      originalLang: data['originalLang'] as String? ?? 'unknown',
      translations: Map<String, String?>.from(
        (data['translations'] as Map?) ?? {},
      ),
      translationStatus: data['translationStatus'] as String? ?? 'pending',
      deletedForSender: data['deletedForSender'] as bool? ?? false,
      imagePath: imagePath,
      imageUrl: imageUrl,
      mediaDeleted: data['mediaDeleted'] as bool? ?? false,
    );
  }

  Map<String, dynamic> toMap() {
    return {
      'messageId': messageId,
      'senderId': senderId,
      'createdAt': createdAt.toIso8601String(),
      'messageType': messageType,
      'originalText': originalText,
      'originalLang': originalLang,
      'translations': translations,
      'translationStatus': translationStatus,
      'deletedForSender': deletedForSender,
      'imagePath': imagePath,
      'imageUrl': imageUrl,
      'mediaDeleted': mediaDeleted,
    };
  }
}
