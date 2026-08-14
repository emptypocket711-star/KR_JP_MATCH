/// New media references are first-party Firebase Storage object paths.
bool isCanonicalStorageMediaPath(String value) {
  return canonicalStorageMediaAuthorizationId(value) != null;
}

String? canonicalStorageMediaAuthorizationId(String value) {
  if (value.isEmpty || value.length > 512) return null;
  final segments = value.split('/');
  if (segments.length == 4 &&
      segments[0] == 'profile_media' &&
      _isSafePathSegment(segments[1]) &&
      _isSafePathSegment(segments[2]) &&
      segments[3] == 'image.jpg') {
    return segments[2];
  }
  if (segments.length == 5 &&
      segments[0] == 'chat_images' &&
      _isSafePathSegment(segments[1], firestoreDocumentId: true) &&
      _isSafePathSegment(segments[2]) &&
      _isSafePathSegment(segments[3]) &&
      segments[4] == 'image.jpg') {
    return segments[3];
  }
  return null;
}

bool _isSafePathSegment(
  String value, {
  bool firestoreDocumentId = false,
}) {
  if (value.isEmpty ||
      value.length > 128 ||
      value == '.' ||
      value == '..' ||
      value.contains('/')) {
    return false;
  }
  if (firestoreDocumentId && value.startsWith('__') && value.endsWith('__')) {
    return false;
  }
  return !value.runes
      .any((codePoint) => codePoint <= 0x1f || codePoint == 0x7f);
}

/// HTTPS is accepted only for read-only rollout compatibility with existing
/// objects in the one Firebase bucket bound to the current app environment.
/// New writes must use canonical paths.
bool isLegacyHttpsMediaReference(
  String value, {
  required String expectedBucket,
}) {
  if (value.isEmpty || value.length > 2048) return false;
  try {
    final uri = Uri.parse(value);
    if (uri.scheme != 'https' ||
        uri.host != 'firebasestorage.googleapis.com' ||
        uri.userInfo.isNotEmpty ||
        uri.hasPort ||
        uri.fragment.isNotEmpty) {
      return false;
    }

    final segments = uri.pathSegments;
    if (segments.length != 5 ||
        segments[0] != 'v0' ||
        segments[1] != 'b' ||
        segments[2] != expectedBucket ||
        segments[3] != 'o' ||
        segments[4].isEmpty) {
      return false;
    }
    final queryKeys = uri.queryParametersAll.keys.toSet();
    if (!queryKeys.every(const {'alt', 'token'}.contains) ||
        uri.queryParameters['alt'] != 'media') {
      return false;
    }

    // Uri.pathSegments decodes each segment after splitting the raw URL, so an
    // encoded object slash remains inside this final object-path value.
    final objectPath = segments[4];
    if (objectPath.isEmpty ||
        objectPath.length > 512 ||
        objectPath.startsWith('/') ||
        objectPath.contains('..')) {
      return false;
    }
    return isCanonicalStorageMediaPath(objectPath) ||
        RegExp(r'^users/[^/]+/[^/]+$').hasMatch(objectPath) ||
        RegExp(r'^profile_photos/[^/]+/.+$').hasMatch(objectPath);
  } on FormatException {
    return false;
  }
}
