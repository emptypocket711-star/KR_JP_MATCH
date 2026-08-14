import 'dart:io';
import 'dart:isolate';
import 'dart:typed_data';

import 'package:image/image.dart' as img;

const int maxUploadImageInputBytes = 15 * 1024 * 1024;
const int maxUploadImageOutputBytes = 5 * 1024 * 1024;
const int maxUploadImageDimension = 2400;
const int maxUploadImagePixels = 4 * 1000 * 1000;

class UploadImageSanitizationException implements Exception {
  const UploadImageSanitizationException(this.reason);

  final String reason;

  @override
  String toString() => 'UploadImageSanitizationException($reason)';
}

/// Decodes an untrusted JPEG and creates a new JPEG from RGB pixels only.
///
/// The fresh pixel buffer deliberately does not inherit EXIF, XMP, IPTC,
/// comments, ICC profiles, text chunks, or animation/frame metadata from the
/// source image. JPEG orientation is baked by the decoder before the metadata
/// is discarded.
Uint8List sanitizeJpegBytesForUpload(Uint8List sourceBytes) {
  if (sourceBytes.length < 4 || sourceBytes.length > maxUploadImageInputBytes) {
    throw const UploadImageSanitizationException('invalid-input-size');
  }

  try {
    final decoder = img.JpegDecoder();
    final info = decoder.startDecode(sourceBytes);
    if (info == null ||
        info.width <= 0 ||
        info.height <= 0 ||
        info.width > maxUploadImageDimension ||
        info.height > maxUploadImageDimension ||
        info.width > maxUploadImagePixels ~/ info.height) {
      throw const UploadImageSanitizationException('unsafe-dimensions');
    }

    final decoded = decoder.decode(sourceBytes);
    if (decoded == null ||
        !decoded.isValid ||
        decoded.width <= 0 ||
        decoded.height <= 0 ||
        decoded.width > maxUploadImageDimension ||
        decoded.height > maxUploadImageDimension ||
        decoded.width > maxUploadImagePixels ~/ decoded.height) {
      throw const UploadImageSanitizationException('decode-failed');
    }

    final rgbPixels = decoded.getBytes(order: img.ChannelOrder.rgb);
    final pixelsOnly = img.Image.fromBytes(
      width: decoded.width,
      height: decoded.height,
      bytes: rgbPixels.buffer,
      bytesOffset: rgbPixels.offsetInBytes,
      numChannels: 3,
      order: img.ChannelOrder.rgb,
    );
    final sanitized = img.encodeJpg(pixelsOnly, quality: 88);

    if (sanitized.isEmpty || sanitized.length > maxUploadImageOutputBytes) {
      throw const UploadImageSanitizationException('invalid-output-size');
    }
    if (jpegContainsPrivateMetadata(sanitized)) {
      throw const UploadImageSanitizationException('metadata-not-stripped');
    }
    return sanitized;
  } on UploadImageSanitizationException {
    rethrow;
  } catch (_) {
    throw const UploadImageSanitizationException('decode-failed');
  }
}

Future<String> sanitizeJpegFileForUpload(String sourcePath) async {
  try {
    final source = File(sourcePath);
    final length = await source.length();
    if (length < 4 || length > maxUploadImageInputBytes) {
      throw const UploadImageSanitizationException('invalid-input-size');
    }

    final sourceBytes = await source.readAsBytes();
    // Decoding and JPEG encoding can be CPU-heavy on older Android devices.
    // Keep it off the UI isolate so the crop confirmation does not freeze.
    final sanitized = await Isolate.run(
      () => sanitizeJpegBytesForUpload(sourceBytes),
    );
    final output = File('$sourcePath.hana-sanitized.jpg');
    await output.writeAsBytes(sanitized, flush: true);
    return output.path;
  } on UploadImageSanitizationException {
    rethrow;
  } catch (_) {
    throw const UploadImageSanitizationException('file-io-failed');
  }
}

/// Returns true for JPEG application/comment segments that can carry private
/// metadata. A freshly encoded Hana image contains only APP0 (JFIF), so every
/// other APP segment is rejected rather than trying to recognize an open-ended
/// set of EXIF, XMP, IPTC, maker-note, and vendor metadata formats.
bool jpegContainsPrivateMetadata(Uint8List bytes) {
  if (bytes.length < 4 || bytes[0] != 0xff || bytes[1] != 0xd8) {
    return true;
  }

  var offset = 2;
  while (offset < bytes.length) {
    if (bytes[offset] != 0xff) return true;
    while (offset < bytes.length && bytes[offset] == 0xff) {
      offset++;
    }
    if (offset >= bytes.length) return true;

    final marker = bytes[offset++];
    if (marker == 0xd9) return false;
    if (marker == 0xda) return false;
    if (marker == 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      continue;
    }
    if (offset + 1 >= bytes.length) return true;

    final segmentLength = (bytes[offset] << 8) | bytes[offset + 1];
    if (segmentLength < 2 || offset + segmentLength > bytes.length) {
      return true;
    }
    if ((marker >= 0xe1 && marker <= 0xef) || marker == 0xfe) {
      return true;
    }
    offset += segmentLength;
  }
  return true;
}
