import 'package:flutter_test/flutter_test.dart';
import 'package:hana/features/chat/domain/chat_message.dart';

void main() {
  test('canonical imagePath wins over a legacy imageUrl', () {
    final message = ChatMessage.fromMap({
      'messageId': 'message-1',
      'senderId': 'sender-1',
      'createdAt': '2026-08-14T01:02:03.000Z',
      'messageType': 'image',
      'originalText': '',
      'imagePath': 'chat_images/room-1/sender-1/auth-1/image.jpg',
      'imageUrl':
          'https://firebasestorage.googleapis.com/v0/b/example/o/legacy.jpg?alt=media',
    });

    expect(message.isImage, isTrue);
    expect(
      message.imageReference,
      'chat_images/room-1/sender-1/auth-1/image.jpg',
    );
    expect(message.toMap()['imagePath'], message.imagePath);
  });

  test('legacy imageUrl infers an image message when messageType is absent',
      () {
    const legacyUrl =
        'https://firebasestorage.googleapis.com/v0/b/example/o/legacy.jpg?alt=media';
    final message = ChatMessage.fromMap({
      'messageId': 'message-2',
      'senderId': 'sender-2',
      'createdAt': '2026-08-14T01:02:03.000Z',
      'imageUrl': legacyUrl,
    });

    expect(message.messageType, 'image');
    expect(message.imageReference, legacyUrl);
  });

  test('mediaDeleted prevents rendering either media reference', () {
    final message = ChatMessage.fromMap({
      'messageId': 'message-3',
      'senderId': 'sender-3',
      'createdAt': '2026-08-14T01:02:03.000Z',
      'messageType': 'image',
      'imagePath': 'chat_images/room-1/sender-3/auth-3/image.jpg',
      'imageUrl': 'https://example.com/image.jpg',
      'mediaDeleted': true,
    });

    expect(message.mediaDeleted, isTrue);
    expect(message.imageReference, isEmpty);
  });

  test('older text records remain nullable and backwards compatible', () {
    final message = ChatMessage.fromMap({
      'messageId': 'message-4',
      'senderId': 'sender-4',
      'createdAt': '2026-08-14T01:02:03.000Z',
      'originalText': '안녕하세요',
    });

    expect(message.messageType, 'text');
    expect(message.originalLang, 'unknown');
    expect(message.translationStatus, 'pending');
    expect(message.imageReference, isEmpty);
  });
}
