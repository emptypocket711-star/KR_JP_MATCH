import 'dart:convert';
import 'dart:typed_data';

import 'package:cached_network_image/cached_network_image.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

import '../../app/config/app_config.dart';
import 'media_reference.dart';

export 'media_reference.dart';

const int authenticatedMediaReadMaxBytes = 5 * 1024 * 1024;

typedef StorageBytesLoader = Future<Uint8List> Function(String storagePath);
typedef CurrentMediaAuthUid = String? Function();

final Map<(String?, String), Future<Uint8List>> _privateMediaLoads =
    <(String?, String), Future<Uint8List>>{};

String? _currentFirebaseAuthUid() => FirebaseAuth.instance.currentUser?.uid;

@visibleForTesting
Uint8List parsePrivateMediaBytesResponse(Object? raw) {
  if (raw is! Map) throw const FormatException('Invalid media response');
  final contentType = raw['contentType'];
  final byteLength = raw['byteLength'];
  final bytesBase64 = raw['bytesBase64'];
  if (contentType != 'image/jpeg' ||
      byteLength is! int ||
      byteLength <= 0 ||
      byteLength > authenticatedMediaReadMaxBytes ||
      bytesBase64 is! String ||
      bytesBase64.length > 7 * 1024 * 1024) {
    throw const FormatException('Invalid media response');
  }
  final bytes = base64Decode(bytesBase64);
  if (bytes.isEmpty || bytes.length != byteLength) {
    throw const FormatException('Invalid media response');
  }
  return bytes;
}

Future<Uint8List> _fetchPrivateMediaBytes(String storagePath) async {
  final result = await FirebaseFunctions.instanceFor(
    region: AppConfig.firebaseFunctionsRegion,
  )
      .httpsCallable(
    'getPrivateMediaBytes',
    options: HttpsCallableOptions(timeout: const Duration(seconds: 30)),
  )
      .call({'path': storagePath});
  return parsePrivateMediaBytesResponse(result.data);
}

@visibleForTesting
Future<Uint8List> loadPrivateMediaBytesCoalesced(
  String storagePath,
  StorageBytesLoader fetch, {
  CurrentMediaAuthUid? currentUid,
}) {
  final readCurrentUid = currentUid ?? _currentFirebaseAuthUid;
  final capturedUid = readCurrentUid();
  final key = (capturedUid, storagePath);
  final existing = _privateMediaLoads[key];
  if (existing != null) return existing;
  final load = Future<Uint8List>.sync(() => fetch(storagePath)).then((bytes) {
    if (readCurrentUid() != capturedUid) {
      throw StateError('Authenticated media session changed during load');
    }
    return bytes;
  });
  _privateMediaLoads[key] = load;
  // Coalesce only concurrent widget loads. Remove the entry when the request
  // settles so a later rebuild revalidates block/leave/deletion state instead
  // of reviving stale authorized bytes. No bytes are written to disk.
  load.then<void>(
    (_) {
      if (identical(_privateMediaLoads[key], load)) {
        _privateMediaLoads.remove(key);
      }
    },
    onError: (Object _, StackTrace __) {
      if (identical(_privateMediaLoads[key], load)) {
        _privateMediaLoads.remove(key);
      }
    },
  );
  return load;
}

Future<Uint8List> _loadPrivateMediaBytes(String storagePath) =>
    loadPrivateMediaBytesCoalesced(storagePath, _fetchPrivateMediaBytes);

/// Displays private media without minting or consuming a permanent download
/// token. Canonical paths use an Auth + App Check callable that revalidates
/// account, visibility, block, and active-room state on every load. A legacy
/// HTTPS URL is rendered only when no canonical path exists in the document.
class AuthenticatedStorageImage extends StatefulWidget {
  const AuthenticatedStorageImage({
    super.key,
    required this.reference,
    this.legacyUrl,
    this.fit = BoxFit.cover,
    this.alignment = Alignment.center,
    this.width,
    this.height,
    this.placeholder,
    this.errorWidget,
    this.loadBytes,
  });

  final String reference;
  final String? legacyUrl;
  final BoxFit fit;
  final Alignment alignment;
  final double? width;
  final double? height;
  final Widget? placeholder;
  final Widget? errorWidget;

  @visibleForTesting
  final StorageBytesLoader? loadBytes;

  @override
  State<AuthenticatedStorageImage> createState() =>
      _AuthenticatedStorageImageState();
}

class _AuthenticatedStorageImageState extends State<AuthenticatedStorageImage> {
  Future<Uint8List>? _bytes;

  String? get _storagePath =>
      isCanonicalStorageMediaPath(widget.reference) ? widget.reference : null;

  String? get _legacyUrl {
    // Never fall back from an authorization failure on a canonical path to a
    // bearer URL. Legacy rendering is only for documents that have no path.
    if (_storagePath != null) return null;
    if (isLegacyHttpsMediaReference(
      widget.reference,
      expectedBucket: AppConfig.expectedFirebaseStorageBucket,
    )) {
      return widget.reference;
    }
    final legacy = widget.legacyUrl?.trim() ?? '';
    return isLegacyHttpsMediaReference(
      legacy,
      expectedBucket: AppConfig.expectedFirebaseStorageBucket,
    )
        ? legacy
        : null;
  }

  @override
  void initState() {
    super.initState();
    _refresh();
  }

  @override
  void didUpdateWidget(covariant AuthenticatedStorageImage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.reference != widget.reference ||
        oldWidget.legacyUrl != widget.legacyUrl ||
        oldWidget.loadBytes != widget.loadBytes) {
      _refresh();
    }
  }

  void _refresh() {
    final path = _storagePath;
    _bytes = path == null
        ? null
        : (widget.loadBytes ?? _loadPrivateMediaBytes)(path);
  }

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final devicePixelRatio = MediaQuery.devicePixelRatioOf(context);
        final cacheWidth = resolvedMediaDecodeDimension(
          explicitLogicalPixels: widget.width,
          constrainedLogicalPixels:
              constraints.hasBoundedWidth ? constraints.maxWidth : null,
          devicePixelRatio: devicePixelRatio,
        );
        final cacheHeight = resolvedMediaDecodeDimension(
          explicitLogicalPixels: widget.height,
          constrainedLogicalPixels:
              constraints.hasBoundedHeight ? constraints.maxHeight : null,
          devicePixelRatio: devicePixelRatio,
        );
        final path = _storagePath;
        if (path != null) {
          return FutureBuilder<Uint8List>(
            future: _bytes,
            builder: (context, snapshot) {
              if (snapshot.hasData) {
                return Image.memory(
                  snapshot.data!,
                  fit: widget.fit,
                  alignment: widget.alignment,
                  width: widget.width,
                  height: widget.height,
                  cacheWidth: cacheWidth,
                  cacheHeight: cacheHeight,
                  gaplessPlayback: true,
                  errorBuilder: (_, __, ___) => _error(),
                );
              }
              if (snapshot.hasError) return _error();
              return _placeholder();
            },
          );
        }

        final legacyUrl = _legacyUrl;
        if (legacyUrl != null) {
          return CachedNetworkImage(
            imageUrl: legacyUrl,
            fit: widget.fit,
            alignment: widget.alignment,
            width: widget.width,
            height: widget.height,
            memCacheWidth: cacheWidth,
            memCacheHeight: cacheHeight,
            placeholder: (_, __) => _placeholder(),
            errorWidget: (_, __, ___) => _error(),
          );
        }
        return _error();
      },
    );
  }

  Widget _placeholder() =>
      widget.placeholder ??
      const ColoredBox(
        color: Color(0xFFF1F1F1),
        child: Center(child: CircularProgressIndicator(strokeWidth: 2)),
      );

  Widget _error() =>
      widget.errorWidget ??
      ColoredBox(
        color: const Color(0xFFF1F1F1),
        child: Center(
          child: Icon(
            widget.reference.startsWith('profile_media/')
                ? Icons.person_outline
                : Icons.broken_image_outlined,
          ),
        ),
      );
}

@visibleForTesting
int resolvedMediaDecodeDimension({
  required double? explicitLogicalPixels,
  required double? constrainedLogicalPixels,
  required double devicePixelRatio,
}) {
  final logicalPixels = explicitLogicalPixels != null &&
          explicitLogicalPixels.isFinite &&
          explicitLogicalPixels > 0
      ? explicitLogicalPixels
      : constrainedLogicalPixels != null &&
              constrainedLogicalPixels.isFinite &&
              constrainedLogicalPixels > 0
          ? constrainedLogicalPixels
          : 1200 / devicePixelRatio.clamp(1, 4);
  // Resolve parent constraints as well as explicit dimensions. Most avatars
  // are sized by an outer SizedBox and otherwise decoded the full 4 MP source.
  return (logicalPixels * devicePixelRatio.clamp(1, 4)).ceil().clamp(1, 2400);
}
