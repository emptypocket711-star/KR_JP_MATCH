import 'media_reference.dart';

class MediaUploadReservation {
  static const int protocolVersion = 2;
  static const int absoluteMaxBytes = 5 * 1024 * 1024;

  const MediaUploadReservation({
    required this.authorizationId,
    required this.path,
    required this.expiresAt,
    required this.maxBytes,
  });

  final String authorizationId;
  final String path;
  final DateTime expiresAt;
  final int maxBytes;

  factory MediaUploadReservation.fromCallableData(Object? value) {
    if (value is! Map) {
      throw const FormatException('Invalid media upload reservation');
    }
    final authorizationId = value['authorizationId'];
    final path = value['path'];
    final expiresAtMillis = value['expiresAtMillis'];
    final maxBytes = value['maxBytes'];
    final uploadProtocolVersion = value['uploadProtocolVersion'];
    if (authorizationId is! String ||
        authorizationId.isEmpty ||
        path is! String ||
        canonicalStorageMediaAuthorizationId(path) != authorizationId ||
        expiresAtMillis is! num ||
        maxBytes is! num ||
        uploadProtocolVersion != protocolVersion ||
        expiresAtMillis.toInt() <= 0 ||
        maxBytes.toInt() <= 0 ||
        maxBytes.toInt() > absoluteMaxBytes) {
      throw const FormatException('Invalid media upload reservation');
    }
    return MediaUploadReservation(
      authorizationId: authorizationId,
      path: path,
      expiresAt: DateTime.fromMillisecondsSinceEpoch(
        expiresAtMillis.toInt(),
        isUtc: true,
      ),
      maxBytes: maxBytes.toInt(),
    );
  }
}

class ConfirmedMediaUpload {
  const ConfirmedMediaUpload({
    required this.authorizationId,
    required this.path,
  });

  final String authorizationId;
  final String path;

  factory ConfirmedMediaUpload.fromCallableData(Object? value) {
    if (value is! Map) {
      throw const FormatException('Invalid confirmed media upload');
    }
    final authorizationId = value['authorizationId'];
    final path = value['path'];
    if (authorizationId is! String ||
        authorizationId.isEmpty ||
        path is! String ||
        canonicalStorageMediaAuthorizationId(path) != authorizationId) {
      throw const FormatException('Invalid confirmed media upload');
    }
    return ConfirmedMediaUpload(
      authorizationId: authorizationId,
      path: path,
    );
  }
}
