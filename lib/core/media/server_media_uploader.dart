import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:cloud_functions/cloud_functions.dart';

import 'media_upload_reservation.dart';

typedef ServerMediaUploadCall = Future<Object?> Function(
  Map<String, dynamic> payload,
);
typedef ServerMediaStatusCall = Future<Object?> Function(
  String authorizationId,
);
typedef ServerMediaDelay = Future<void> Function(Duration duration);

/// Normalizes callable failures so the upload/recovery state machine can be
/// tested without a Firebase runtime.
class ServerMediaCallFailure implements Exception {
  const ServerMediaCallFailure(this.code, {this.details});

  final String code;
  final Object? details;

  @override
  String toString() => 'ServerMediaCallFailure($code)';
}

Future<ConfirmedMediaUpload> uploadReservedJpegFile({
  required FirebaseFunctions functions,
  required MediaUploadReservation reservation,
  required File file,
  required String sizeErrorMessage,
}) async {
  final upload = functions.httpsCallable(
    'uploadPrivateMediaBytes',
    options: HttpsCallableOptions(
      // The client must outlive the 120-second server deadline so a server
      // response is not converted into an avoidable ambiguous timeout.
      timeout: const Duration(seconds: 135),
      limitedUseAppCheckToken: true,
    ),
  );
  final status = functions.httpsCallable(
    'confirmMediaUpload',
    // Expired V2 leases may perform bounded server-side object recovery under
    // this 60-second callable, so the client deadline must outlive it.
    options: HttpsCallableOptions(timeout: const Duration(seconds: 75)),
  );

  return uploadReservedJpegBytes(
    reservation: reservation,
    bytes: await file.readAsBytes(),
    sizeErrorMessage: sizeErrorMessage,
    uploadCall: (payload) => _call(upload, payload),
    statusCall: (authorizationId) => _call(status, {
      'authorizationId': authorizationId,
    }),
  );
}

/// Uploads one bounded payload and performs status-only recovery before the
/// sole possible full-body retry. The injected calls keep this safety contract
/// unit-testable without Firebase or disk I/O.
Future<ConfirmedMediaUpload> uploadReservedJpegBytes({
  required MediaUploadReservation reservation,
  required Uint8List bytes,
  required String sizeErrorMessage,
  required ServerMediaUploadCall uploadCall,
  required ServerMediaStatusCall statusCall,
  ServerMediaDelay delay = _defaultDelay,
}) async {
  if (bytes.isEmpty ||
      bytes.length > reservation.maxBytes ||
      bytes.length > MediaUploadReservation.absoluteMaxBytes) {
    throw Exception(sizeErrorMessage);
  }
  final payload = <String, dynamic>{
    'authorizationId': reservation.authorizationId,
    'jpegBase64': base64Encode(bytes),
  };

  Object? response;
  try {
    response = await uploadCall(payload);
  } on ServerMediaCallFailure catch (error) {
    if (!_isAmbiguousUploadFailure(error.code)) rethrow;
    final recovery = await _recoverStatus(
      reservation: reservation,
      statusCall: statusCall,
      delay: delay,
    );
    if (recovery.confirmed case final confirmed?) return confirmed;

    if (recovery.retryAfter case final retryAfter?) {
      // The first invocation still owns an immutable server lease. Wait for
      // that exact lease instead of immediately resending a ~7 MiB request
      // that is guaranteed to abort.
      await delay(retryAfter + const Duration(milliseconds: 250));
      final afterLease = await _recoverStatus(
        reservation: reservation,
        statusCall: statusCall,
        delay: delay,
      );
      if (afterLease.confirmed case final confirmed?) return confirmed;
      if (afterLease.retryAfter != null) {
        throw const ServerMediaCallFailure('aborted');
      }
    }

    // Status proved that no committed upload exists (or reset an expired
    // missing-object lease). This is the only full-body retry.
    try {
      response = await uploadCall(payload);
    } on ServerMediaCallFailure catch (retryError) {
      if (!_isAmbiguousUploadFailure(retryError.code)) rethrow;
      // The retry is the final byte-carrying request. If only its response was
      // lost, one last status-only read recovers success; no third payload is
      // ever sent.
      final finalRecovery = await _recoverStatus(
        reservation: reservation,
        statusCall: statusCall,
        delay: delay,
      );
      if (finalRecovery.confirmed case final confirmed?) return confirmed;
      rethrow;
    }
  }

  return _validatedResponse(response, reservation);
}

Future<Object?> _call(HttpsCallable callable, Object? data) async {
  try {
    return (await callable.call(data)).data;
  } on FirebaseFunctionsException catch (error) {
    throw ServerMediaCallFailure(error.code, details: error.details);
  } on TimeoutException {
    throw const ServerMediaCallFailure('deadline-exceeded');
  }
}

ConfirmedMediaUpload _validatedResponse(
  Object? value,
  MediaUploadReservation reservation,
) {
  final confirmed = ConfirmedMediaUpload.fromCallableData(value);
  if (confirmed.authorizationId != reservation.authorizationId ||
      confirmed.path != reservation.path) {
    throw const FormatException('Confirmed media path changed');
  }
  return confirmed;
}

class _StatusRecovery {
  const _StatusRecovery({this.confirmed, this.retryAfter});

  final ConfirmedMediaUpload? confirmed;
  final Duration? retryAfter;
}

Future<_StatusRecovery> _recoverStatus({
  required MediaUploadReservation reservation,
  required ServerMediaStatusCall statusCall,
  required ServerMediaDelay delay,
}) async {
  for (var attempt = 0; attempt < 3; attempt++) {
    try {
      final value = await statusCall(reservation.authorizationId);
      return _StatusRecovery(
        confirmed: _validatedResponse(value, reservation),
      );
    } on ServerMediaCallFailure catch (error) {
      if (error.code == 'failed-precondition') {
        return const _StatusRecovery();
      }
      final retryAfter = _serverRetryAfter(error);
      if (retryAfter != null) {
        return _StatusRecovery(retryAfter: retryAfter);
      }
      if (!_isAmbiguousUploadFailure(error.code)) rethrow;
      if (attempt == 2) rethrow;
    }
    await delay(Duration(milliseconds: 500 * (attempt + 1)));
  }
  throw const ServerMediaCallFailure('internal');
}

Duration? _serverRetryAfter(ServerMediaCallFailure error) {
  if (error.code != 'aborted' || error.details is! Map) return null;
  final details = error.details! as Map;
  if (details['uploadState'] != 'server_uploading') return null;
  final retryAfterMillis = details['retryAfterMillis'];
  if (retryAfterMillis is! num || retryAfterMillis <= 0) return null;
  return Duration(
    milliseconds: retryAfterMillis.toInt().clamp(1, 3 * 60 * 1000).toInt(),
  );
}

bool _isAmbiguousUploadFailure(String code) {
  return code == 'aborted' ||
      code == 'unavailable' ||
      code == 'deadline-exceeded' ||
      code == 'internal';
}

Future<void> _defaultDelay(Duration duration) => Future<void>.delayed(duration);
