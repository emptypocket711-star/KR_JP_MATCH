import 'dart:async';

typedef ChatMessageSendCall = Future<Object?> Function(
  Map<String, dynamic> payload,
);
typedef ChatMessageRetryDelay = Future<void> Function(Duration duration);

class ChatMessageSendFailure implements Exception {
  const ChatMessageSendFailure(this.code, {this.details});

  final String code;
  final Object? details;

  @override
  String toString() => 'ChatMessageSendFailure($code)';
}

/// Sends one immutable logical message request.
///
/// Ambiguous transport failures are retried with the same payload, including
/// the same server idempotency key. This prevents a lost callable response
/// from creating a second message.
Future<String> sendChatMessageWithRetry({
  required Map<String, dynamic> payload,
  required ChatMessageSendCall call,
  ChatMessageRetryDelay delay = _defaultDelay,
}) async {
  final clientRequestId = payload['clientRequestId'];
  if (clientRequestId is! String || clientRequestId.isEmpty) {
    throw const FormatException('clientRequestId is required');
  }

  for (var attempt = 0; attempt < 3; attempt++) {
    try {
      return _messageIdFromResponse(await call(payload));
    } on ChatMessageSendFailure catch (error) {
      if (!_isAmbiguousFailure(error.code) || attempt == 2) rethrow;
    } on TimeoutException {
      if (attempt == 2) rethrow;
    }
    await delay(Duration(milliseconds: 350 * (attempt + 1)));
  }

  throw StateError('Message send retry exhausted');
}

String _messageIdFromResponse(Object? value) {
  if (value is! Map) {
    throw const FormatException('Invalid sendMessage response');
  }
  final messageId = value['messageId'];
  if (messageId is! String || messageId.isEmpty) {
    throw const FormatException('Invalid sendMessage response');
  }
  return messageId;
}

bool _isAmbiguousFailure(String code) {
  return code == 'unavailable' ||
      code == 'deadline-exceeded' ||
      code == 'internal';
}

Future<void> _defaultDelay(Duration duration) => Future<void>.delayed(duration);
