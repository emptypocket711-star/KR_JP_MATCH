import 'dart:async';
import 'dart:io';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:uuid/uuid.dart';

import '../../../app/config/app_config.dart';
import '../../../core/media/media_upload_reservation.dart';
import '../../../core/media/server_media_uploader.dart';
import '../../matches/domain/match.dart';
import '../domain/chat_message.dart';
import '../domain/chat_repository.dart';
import 'message_send_retry.dart';

class ChatRepositoryImpl implements ChatRepository {
  static const _uuid = Uuid();

  final _firestore = FirebaseFirestore.instance;
  final _functions = FirebaseFunctions.instanceFor(
    region: AppConfig.firebaseFunctionsRegion,
  );
  final _auth = FirebaseAuth.instance;
  final Map<String, String> _pendingImagePathsByRequestId = {};

  @override
  Stream<List<ChatMessage>> watchMessages(String matchId) {
    return _firestore
        .collection('matches')
        .doc(matchId)
        .collection('messages')
        .orderBy('createdAt', descending: true)
        .snapshots()
        .map(
          (snapshot) => snapshot.docs
              .map(
                (doc) => ChatMessage.fromMap({
                  ...doc.data(),
                  'messageId': doc.id,
                }),
              )
              .toList(),
        );
  }

  @override
  Future<Match> getMatch(String matchId) async {
    final snapshot = await _firestore.collection('matches').doc(matchId).get();
    if (!snapshot.exists) throw Exception('Chat room not found');
    return Match.fromMap({...snapshot.data()!, 'matchId': snapshot.id});
  }

  @override
  Future<String> sendMessage(
    String matchId,
    String originalText, {
    String? clientRequestId,
  }) {
    final requestId = clientRequestId ?? _uuid.v4();
    return _sendMessagePayload({
      'matchId': matchId,
      'clientRequestId': requestId,
      'messageType': 'text',
      'originalText': originalText,
    });
  }

  @override
  Future<String> sendImage(
    String matchId,
    String localPath, {
    String? clientRequestId,
  }) async {
    if (_auth.currentUser == null) throw Exception('Login is required');

    final requestId = clientRequestId ?? _uuid.v4();
    var imagePath = _pendingImagePathsByRequestId[requestId];
    if (imagePath == null) {
      final reservationResult = await _functions
          .httpsCallable(
        'reserveMediaUploadV2',
        options: HttpsCallableOptions(timeout: const Duration(seconds: 12)),
      )
          .call({'kind': 'chat', 'matchId': matchId});
      final reservation = MediaUploadReservation.fromCallableData(
        reservationResult.data,
      );
      final confirmed = await uploadReservedJpegFile(
        functions: _functions,
        reservation: reservation,
        file: File(localPath),
        sizeErrorMessage: 'Chat image exceeds the upload size limit',
      );
      if (confirmed.path != reservation.path) {
        throw const FormatException('Confirmed media path changed');
      }
      imagePath = confirmed.path;
      _pendingImagePathsByRequestId[requestId] = imagePath;
    }

    final messageId = await _sendMessagePayload({
      'matchId': matchId,
      'clientRequestId': requestId,
      'messageType': 'image',
      'imagePath': imagePath,
    });
    _pendingImagePathsByRequestId.remove(requestId);
    return messageId;
  }

  Future<String> _sendMessagePayload(Map<String, dynamic> payload) {
    final callable = _functions.httpsCallable(
      'sendMessage',
      options: HttpsCallableOptions(timeout: const Duration(seconds: 20)),
    );
    return sendChatMessageWithRetry(
      payload: payload,
      call: (request) async {
        try {
          return (await callable.call(request)).data;
        } on FirebaseFunctionsException catch (error) {
          throw ChatMessageSendFailure(error.code, details: error.details);
        } on TimeoutException {
          rethrow;
        }
      },
    );
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
