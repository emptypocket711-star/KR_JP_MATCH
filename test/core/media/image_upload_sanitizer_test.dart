import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:hana/core/media/image_upload_sanitizer.dart';
import 'package:image/image.dart' as img;

void main() {
  group('sanitizeJpegBytesForUpload', () {
    test('re-encodes pixels without EXIF, XMP, IPTC, or comments', () {
      final sourceImage = img.Image(width: 8, height: 6)
        ..setPixelRgb(2, 3, 120, 80, 40);
      final cleanJpeg = img.encodeJpg(sourceImage, quality: 95);
      final sourceWithMetadata = _insertAfterSoi(cleanJpeg, [
        _segment(0xe1, 'Exif\u0000\u0000GPSLatitude=37.5665'),
        _segment(0xe1, 'http://ns.adobe.com/xap/1.0/ secret-xmp'),
        _segment(0xed, 'Photoshop 3.0 private-iptc'),
        _segment(0xee, 'Adobe vendor-private-data'),
        _segment(0xfe, 'device-comment'),
      ]);

      expect(jpegContainsPrivateMetadata(sourceWithMetadata), isTrue);

      final result = sanitizeJpegBytesForUpload(sourceWithMetadata);
      final decoded = img.decodeJpg(result);

      expect(decoded, isNotNull);
      expect(decoded!.width, 8);
      expect(decoded.height, 6);
      expect(jpegContainsPrivateMetadata(result), isFalse);
      expect(_latin1(result), isNot(contains('GPSLatitude')));
      expect(_latin1(result), isNot(contains('secret-xmp')));
      expect(_latin1(result), isNot(contains('private-iptc')));
      expect(_latin1(result), isNot(contains('vendor-private-data')));
      expect(_latin1(result), isNot(contains('device-comment')));
    });

    test('rejects corrupt input instead of returning original bytes', () {
      expect(
        () => sanitizeJpegBytesForUpload(
          Uint8List.fromList([0xff, 0xd8, 0xff, 0xd9]),
        ),
        throwsA(isA<UploadImageSanitizationException>()),
      );
    });

    test('rejects a JPEG whose dimensions exceed the pixel budget', () {
      final small = img.encodeJpg(img.Image(width: 2, height: 2));
      final oversizedHeader = Uint8List.fromList(small);
      final sofOffset = _findMarker(oversizedHeader, 0xc0);
      expect(sofOffset, greaterThanOrEqualTo(0));
      // SOF: marker, length(2), precision(1), height(2), width(2).
      oversizedHeader[sofOffset + 5] = 0x09;
      oversizedHeader[sofOffset + 6] = 0x61; // 2401px high

      expect(
        () => sanitizeJpegBytesForUpload(oversizedHeader),
        throwsA(isA<UploadImageSanitizationException>()),
      );
    });
  });
}

Uint8List _insertAfterSoi(List<int> jpeg, List<Uint8List> segments) {
  return Uint8List.fromList([
    jpeg[0],
    jpeg[1],
    for (final segment in segments) ...segment,
    ...jpeg.skip(2),
  ]);
}

Uint8List _segment(int marker, String payload) {
  final data = Uint8List.fromList(payload.codeUnits);
  final length = data.length + 2;
  return Uint8List.fromList([
    0xff,
    marker,
    (length >> 8) & 0xff,
    length & 0xff,
    ...data,
  ]);
}

int _findMarker(Uint8List bytes, int wantedMarker) {
  for (var index = 0; index + 1 < bytes.length; index++) {
    if (bytes[index] == 0xff && bytes[index + 1] == wantedMarker) {
      return index;
    }
  }
  return -1;
}

String _latin1(List<int> bytes) => String.fromCharCodes(bytes);
