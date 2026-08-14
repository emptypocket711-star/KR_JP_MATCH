import 'package:flutter_test/flutter_test.dart';
import 'package:hana/features/chat/data/message_send_retry.dart';

void main() {
  test('ambiguous retries keep one clientRequestId', () async {
    final attempts = <Map<String, dynamic>>[];
    final delays = <Duration>[];
    const requestId = '61f0b108-5810-4c68-8d52-89e2f96dd587';

    final messageId = await sendChatMessageWithRetry(
      payload: {
        'matchId': 'room-1',
        'clientRequestId': requestId,
        'messageType': 'text',
        'originalText': 'hello',
      },
      call: (payload) async {
        attempts.add(Map<String, dynamic>.from(payload));
        if (attempts.length < 3) {
          throw const ChatMessageSendFailure('deadline-exceeded');
        }
        return {'messageId': 'message-1', 'duplicate': true};
      },
      delay: (duration) async => delays.add(duration),
    );

    expect(messageId, 'message-1');
    expect(attempts, hasLength(3));
    expect(
      attempts.map((payload) => payload['clientRequestId']).toSet(),
      {requestId},
    );
    expect(
      delays,
      const [Duration(milliseconds: 350), Duration(milliseconds: 700)],
    );
  });

  test('non-ambiguous failure is not retried', () async {
    var attempts = 0;

    await expectLater(
      sendChatMessageWithRetry(
        payload: {
          'matchId': 'room-1',
          'clientRequestId': '61f0b108-5810-4c68-8d52-89e2f96dd587',
          'messageType': 'text',
          'originalText': 'hello',
        },
        call: (_) async {
          attempts++;
          throw const ChatMessageSendFailure('permission-denied');
        },
        delay: (_) async {},
      ),
      throwsA(
        isA<ChatMessageSendFailure>().having(
          (error) => error.code,
          'code',
          'permission-denied',
        ),
      ),
    );
    expect(attempts, 1);
  });

  test('missing idempotency key is rejected before the call', () async {
    var called = false;

    await expectLater(
      sendChatMessageWithRetry(
        payload: {
          'matchId': 'room-1',
          'messageType': 'text',
          'originalText': 'hello',
        },
        call: (_) async {
          called = true;
          return {'messageId': 'message-1'};
        },
      ),
      throwsFormatException,
    );
    expect(called, isFalse);
  });
}
